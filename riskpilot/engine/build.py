"""POST /v1/decisions/{id}/build: the EIP-5792 calls[] that execute an approved decision.

The same transactions the page's adapters send (web/adapters.js), so any wallet or agent can
execute through the API: exact-amount approvals (only when the allowance is short), then the
main call. Price gaps swap through the demo's v4 router; Aqua curves ship from the maker.
"""

import json
import urllib.request
from decimal import Decimal

from eth_abi import encode
from eth_utils import keccak, to_checksum_address

from demo import load_curves
from scanner.live import load_hook

WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"
USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
AQUA = "0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a"
ROUTER = "0x111111338c5091E8440b67B168bAe16a668AC0De"
MIN_SQRT = 4295128739 + 1
MAX_SQRT = 1461446703485210103287273052203988822378723970342 - 1
ZERO = "0x0000000000000000000000000000000000000000"


def _sel(sig: str) -> bytes:
    return keccak(text=sig)[:4]


def _call(to: str, sig: str, types: list[str], args: list, label: str) -> dict:
    return {"to": to_checksum_address(to), "data": "0x" + (_sel(sig) + encode(types, args)).hex(), "value": "0x0", "label": label}


def _allowance(rpc: str, token: str, owner: str, spender: str) -> int:
    data = "0x" + (_sel("allowance(address,address)") + encode(["address", "address"], [owner, spender])).hex()
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "eth_call", "params": [{"to": token, "data": data}, "latest"]}).encode()
    with urllib.request.urlopen(urllib.request.Request(rpc, body, {"Content-Type": "application/json"}), timeout=1.5) as r:
        return int(json.load(r)["result"], 16)


def _approve(rpc, token, owner, spender, amount, label) -> list[dict]:
    if _allowance(rpc, token, owner, spender) >= amount:
        return []
    return [_call(token, "approve(address,uint256)", ["address", "uint256"], [spender, amount], label)]


def build_calls(d: dict, wallet: str, rpc: str) -> list[dict]:
    if d["inputs"].get("aqua"):
        return _aqua(d, wallet, rpc)
    return _v4(d, wallet, rpc)


def _v4(d: dict, wallet: str, rpc: str) -> list[dict]:
    hook = load_hook()
    venue = d["inputs"]["request"]["opportunity"]["source_venue"]
    pools = {} if hook is None else {
        "uniswap_v4_hooked": (USDC, WETH, 0x800000, 60, hook["hook"]),
        "uniswap_v4_static": (USDC, WETH, 3000, 20, ZERO),
    }
    if venue not in pools:
        raise NotImplementedError(f"no executable route for {venue} on the demo chain")
    req, m = d["inputs"]["request"], d["inputs"]["request"]["market"]
    fee, price = Decimal(m["fee_rate"]), Decimal(m["quote"]["price"])
    tol = Decimal(d["inputs"]["profile"].get("slippage_tolerance") or req["tolerance"])
    eth = Decimal(d["inputs"]["proposed_position"]["params"]["trade_eth"])
    sell = eth < 0
    amount_in = int(abs(eth) * 10**18) if sell else int(Decimal(req["size"]) * 10**6)
    expected = abs(eth) * price * (1 - fee) if sell else Decimal(req["size"]) * (1 - fee) / price
    min_out = int(expected * (1 - tol) * (10**6 if sell else 10**18))
    token_in = WETH if sell else USDC
    swap = _call(
        hook["swap_router"],
        "swap((address,address,uint24,int24,address),(bool,int256,uint160),(bool,bool),bytes)",
        ["(address,address,uint24,int24,address)", "(bool,int256,uint160)", "(bool,bool)", "bytes"],
        [pools[venue], (not sell, -amount_in, MAX_SQRT if sell else MIN_SQRT), (False, False), b""],
        "swap through the v4 pool",
    )
    # The demo router has no on-chain amountOutMinimum: min_out is checked by simulation before sending.
    swap["min_out"] = str(min_out)
    return _approve(rpc, token_in, wallet, hook["swap_router"], amount_in, "approve for the v4 router") + [swap]


def _aqua(d: dict, wallet: str, rpc: str) -> list[dict]:
    curves = load_curves()
    if curves is None:
        raise NotImplementedError("no demo/curves.json")
    c = curves["upside"] if d["inputs"]["aqua"]["side"] == "call_like" else curves["downside"]
    if wallet.lower() != curves["maker"].lower():
        raise NotImplementedError(f"only the curve's maker {curves['maker']} can ship it")
    amounts = [int(c["weth_amount"]), int(c["usdc_amount"])]
    calls = []
    for token, amt, name in ((WETH, amounts[0], "WETH"), (USDC, amounts[1], "USDC")):
        if amt:
            calls += _approve(rpc, token, wallet, AQUA, amt, f"approve {name} for Aqua")
    calls.append(_call(AQUA, "ship(address,bytes,address[],uint256[])", ["address", "bytes", "address[]", "uint256[]"],
                       [ROUTER, bytes.fromhex(c["order"][2:]), [WETH, USDC], amounts], "ship curve"))
    return calls
