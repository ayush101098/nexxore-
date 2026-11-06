"""Read a wallet's WETH and USDC balances over JSON-RPC (the demo chain by default)."""

import json
import urllib.request
from collections.abc import Callable
from decimal import Decimal

from models import Holdings

# Ethereum mainnet tokens (the demo chain is a mainnet fork); see contracts/aqua/src/DemoParams.sol.
WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"
USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
BALANCE_OF = "0x70a08231"
DEFAULT_RPC = "http://127.0.0.1:8545"


def _post(url: str, body: list) -> list:
    req = urllib.request.Request(url, json.dumps(body).encode(), {"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.load(resp)


def read_gas_gwei(rpc_url: str, post: Callable[[str, list], list] = _post) -> Decimal:
    [reply] = post(rpc_url, [{"jsonrpc": "2.0", "id": 0, "method": "eth_gasPrice", "params": []}])
    if "error" in reply:
        raise RuntimeError(f"rpc error reading gas price: {reply['error']}")
    return (Decimal(int(reply["result"], 16)) / Decimal(10**9)).quantize(Decimal("0.000001"))


def read_holdings(rpc_url: str, wallet: str, post: Callable[[str, list], list] = _post) -> Holdings:
    if not (wallet.startswith("0x") and len(wallet) == 42):
        raise ValueError(f"not an address: {wallet!r}")
    data = BALANCE_OF + wallet[2:].lower().rjust(64, "0")
    calls = [
        {"jsonrpc": "2.0", "id": i, "method": "eth_call", "params": [{"to": token, "data": data}, "latest"]}
        for i, token in enumerate((WETH, USDC))
    ]
    replies = sorted(post(rpc_url, calls), key=lambda r: r["id"])
    for r in replies:
        if "error" in r:
            raise RuntimeError(f"rpc error reading holdings: {r['error']}")
    weth, usdc = (int(r["result"], 16) for r in replies)
    return Holdings(weth=Decimal(weth) / Decimal(10**18), usdc=Decimal(usdc) / Decimal(10**6))


def read_chain_context(rpc_url: str, wallet: str | None, post: Callable[[str, list], list] = _post) -> dict:
    """One batched read per block: head block, the wallet's native ETH, and eth_feeHistory
    (last block's base fee and median priority fee) for the gas ceiling."""
    calls = [
        {"jsonrpc": "2.0", "id": 0, "method": "eth_blockNumber", "params": []},
        {"jsonrpc": "2.0", "id": 1, "method": "eth_feeHistory", "params": ["0x1", "latest", [50]]},
    ]
    if wallet:
        calls.append({"jsonrpc": "2.0", "id": 2, "method": "eth_getBalance", "params": [wallet, "latest"]})
    replies = {r["id"]: r for r in post(rpc_url, calls)}
    for r in replies.values():
        if "error" in r:
            raise RuntimeError(f"rpc error reading chain context: {r['error']}")
    fh = replies[1]["result"]
    gwei = lambda h: (Decimal(int(h, 16)) / Decimal(10**9)).quantize(Decimal("0.000000001"))
    reward = (fh.get("reward") or [["0x0"]])[-1]
    return {
        "block": int(replies[0]["result"], 16),
        # baseFeePerGas has one more entry than blocks: the last is the next block's base fee.
        "base_fee_gwei": gwei(fh["baseFeePerGas"][-1]),
        "tip_gwei": gwei(reward[0] if reward else "0x0"),
        "eth": None if not wallet else Decimal(int(replies[2]["result"], 16)) / Decimal(10**18),
    }
