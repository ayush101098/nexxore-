"""Live sources. Interfaces are fixed; each is wired up in the PRD that owns its contract.

They raise NotImplementedError until then rather than guessing addresses or ABIs.
"""

import json
import os
from datetime import datetime, timedelta
from decimal import Decimal
from pathlib import Path

from models import Market
from scanner import VenueQuote
from scanner.holdings import DEFAULT_RPC, _post


class _Live:
    name = ""
    todo = ""

    def quotes(self, pair: str, as_of: datetime) -> list[VenueQuote]:
        raise NotImplementedError(f"{self.name}: {self.todo}")

    def market(self, venue: str, as_of: datetime) -> Market:
        raise NotImplementedError(f"{self.name}: {self.todo}")


# Uniswap v4 StateView, Ethereum mainnet (developers.uniswap.org/contracts/v4/deployments).
STATE_VIEW = "0x7ffe42c4a5deea5b0fec41c94c136cf115597227"
SEL_GET_SLOT0 = "0xc815641c"  # getSlot0(bytes32)
SEL_GET_FEE = "0xe5f3d3a5"  # VolatilityFeeHook.getFee(bytes32)
SEL_GET_VOL = "0x17f58ccc"  # VolatilityFeeHook.getVolatility(bytes32)
HOOK_DIR = Path(os.environ.get("RISKPILOT_HOOK_DIR", Path(__file__).resolve().parents[2] / "contracts" / "hook" / "demo"))


# V4Quoter, Ethereum mainnet (same deployments page); quoteExactInputSingle(((address,address,
# uint24,int24,address),bool,uint128,bytes)) -> (amountOut, gasEstimate), callable with eth_call.
QUOTER = "0x99bd42B2B22e531f283b7F8a86dFf631EB16A9D1"
SEL_QUOTE_EXACT_IN_SINGLE = "0xaa9d21cb"
SEL_GAS_PRICE = "eth_gasPrice"
MAIN_POOL_ID = "0x21c67e77068de97969ba93d4aab21826d33ca12bb9f565d8496e8fda8a82ca27"  # ETH/USDC 0.05%, spacing 10
USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"
DYNAMIC_FEE_FLAG = 0x800000
BASE_TX_GAS = 21_000


def _word(x: int) -> str:
    return hex(x)[2:].rjust(64, "0")


def _addr(a: str) -> str:
    return a[2:].lower().rjust(64, "0")


def _eth_call(rpc_url: str, to: str, data: str, post=_post) -> str:
    [reply] = post(rpc_url, [{"jsonrpc": "2.0", "id": 0, "method": "eth_call", "params": [{"to": to, "data": data}, "latest"]}])
    if "error" in reply:
        raise RuntimeError(f"eth_call to {to} failed: {reply['error']}")
    return reply["result"]


def main_pool_price(rpc_url: str, post=_post) -> Decimal:
    """USDC per ETH on the fork's main ETH/USDC v4 pool, via StateView."""
    sqrt = int(_eth_call(rpc_url, STATE_VIEW, SEL_GET_SLOT0 + MAIN_POOL_ID[2:], post)[2:66], 16)
    return (Decimal(sqrt) ** 2 * Decimal(10**12) / Decimal(2**192)).quantize(Decimal("0.01"))


def load_hook() -> dict | None:
    path = HOOK_DIR / "hook.json"
    return json.loads(path.read_text()) if path.exists() else None


def hook_pool_state(rpc_url: str, hook: dict, post=_post) -> dict:
    """Live state of the hooked pool and the fork's main ETH/USDC pool, from the chain."""
    def call(to, data):
        return {"to": to, "data": data}

    calls = [
        call(STATE_VIEW, SEL_GET_SLOT0 + hook["hooked_pool_id"][2:]),
        call(STATE_VIEW, SEL_GET_SLOT0 + hook["main_pool_id"][2:]),
        call(hook["hook"], SEL_GET_FEE + hook["hooked_pool_id"][2:]),
        call(hook["hook"], SEL_GET_VOL + hook["hooked_pool_id"][2:]),
    ]
    body = [{"jsonrpc": "2.0", "id": i, "method": "eth_call", "params": [c, "latest"]} for i, c in enumerate(calls)]
    replies = sorted(post(rpc_url, body), key=lambda r: r["id"])
    for r in replies:
        if "error" in r:
            raise RuntimeError(f"rpc error reading the hook pool: {r['error']}")
    hooked_sqrt = int(replies[0]["result"][2:66], 16)
    main_sqrt = int(replies[1]["result"][2:66], 16)
    # Hooked pool is USDC(0)/WETH(1): WETH-wei per USDC-unit. Main pool is ETH(0)/USDC(1).
    hooked = Decimal(2**192) * Decimal(10**12) / Decimal(hooked_sqrt) ** 2
    main = Decimal(main_sqrt) ** 2 * Decimal(10**12) / Decimal(2**192)
    return {
        "hooked_price": hooked.quantize(Decimal("0.01")),
        "main_price": main.quantize(Decimal("0.01")),
        "gap_bps": ((hooked - main) / main * 10_000).quantize(Decimal("0.1")),
        "fee_pips": int(replies[2]["result"], 16),
        "sigma": (Decimal(int(replies[3]["result"], 16)) / Decimal(10**18)).quantize(Decimal("0.0001")),
    }


ZERO = "0x0000000000000000000000000000000000000000"
# The fork's ETH/USDC 0.30% v4 pool (native ETH, fee 3000, spacing 60, no hook): keccak256(abi.encode(key)).
V4_ETH_USDC_30_ID = "0xdce6394339af00981949f5f3baf27e3610c76326a700af57e4b3e3ae4977f78d"


def v4_venues(hook: dict) -> list[dict]:
    """Every v4 ETH/USDC pool on the demo chain the scanner reads. `eth0`: ETH is currency0."""
    return [
        {"venue": "uniswap_v4_hooked", "label": "hooked v4 pool", "pool_id": hook["hooked_pool_id"], "eth0": False,
         "key": (USDC, WETH, DYNAMIC_FEE_FLAG, 60, hook["hook"]), "fee": "hook"},
        {"venue": "uniswap_v4_static", "label": "static 0.30% v4 pool", "pool_id": hook["flat_pool_id"], "eth0": False,
         "key": (USDC, WETH, 3000, 20, ZERO), "fee": 3000},
        {"venue": "uniswap_v4_eth_usdc_30", "label": "v4 ETH/USDC 0.30%", "pool_id": V4_ETH_USDC_30_ID, "eth0": True,
         "key": (ZERO, USDC, 3000, 60, ZERO), "fee": 3000},
    ]


def _usdc_per_eth(sqrt_price: int, eth0: bool) -> Decimal:
    if eth0:  # ETH(0)/USDC(1): USDC units per wei
        return Decimal(sqrt_price) ** 2 * Decimal(10**12) / Decimal(2**192)
    return Decimal(2**192) * Decimal(10**12) / Decimal(sqrt_price) ** 2  # USDC(0)/WETH(1)


class HookedV4PoolSource(_Live):
    """Every v4 ETH/USDC pool on the demo chain: the hooked pool, our static 0.30% comparison pool
    and the fork's own ETH/USDC 0.30% pool, against the main 0.05% pool as the reference price.
    Prices from StateView, quotes at size from V4Quoter, the hooked pool's fee from the hook."""

    name = "v4_pool"
    todo = ""

    def __init__(self, rpc_url: str | None = None):
        self.rpc_url = rpc_url or os.environ.get("DEMO_RPC_URL", DEFAULT_RPC)

    def _prices(self, hook: dict) -> dict:
        venues = v4_venues(hook)
        ids = [hook["main_pool_id"]] + [v["pool_id"] for v in venues]
        body = [{"jsonrpc": "2.0", "id": i, "method": "eth_call",
                 "params": [{"to": STATE_VIEW, "data": SEL_GET_SLOT0 + pid[2:]}, "latest"]} for i, pid in enumerate(ids)]
        replies = sorted(_post(self.rpc_url, body), key=lambda r: r["id"])
        for r in replies:
            if "error" in r:
                raise RuntimeError(f"rpc error reading v4 pools: {r['error']}")
        sqrt = [int(r["result"][2:66], 16) for r in replies]
        out = {"uniswap_v4_main": _usdc_per_eth(sqrt[0], True)}
        for v, sp in zip(venues, sqrt[1:]):
            if sp:  # 0 = pool not initialized on this chain
                out[v["venue"]] = _usdc_per_eth(sp, v["eth0"])
        return out

    def market(self, venue: str, as_of: datetime, size: Decimal = Decimal("10000")) -> Market:
        """Market snapshot for trading `size` USD through one v4 pool, all from the chain:
        a V4Quoter quote at size (priced ex-fee), the pool's fee (the hook's, for the hooked pool),
        the hooked pool's realized sigma for ETH/USDC, and eth_gasPrice. No hedge leg: the trade
        sells ETH into the dearer pool (or buys from the cheaper one), and the stress test prices
        what that does to the wallet's holdings."""
        hook = load_hook()
        v = next((v for v in v4_venues(hook) if v["venue"] == venue), None) if hook else None
        if v is None:
            raise NotImplementedError(f"v4_pool: no live market for {venue!r}")
        prices = self._prices(hook)
        state = hook_pool_state(self.rpc_url, hook)
        mid, ref = prices[venue].quantize(Decimal("0.01")), prices["uniswap_v4_main"]
        fee = Decimal(state["fee_pips"] if v["fee"] == "hook" else v["fee"]) / Decimal(10**6)
        sell_eth = mid > ref
        amount_in = int(size / mid * Decimal(10**18)) if sell_eth else int(size * Decimal(10**6))
        zero_for_one = sell_eth == v["eth0"]  # selling ETH is zeroForOne when ETH is currency0
        c0, c1, key_fee, spacing, hooks = v["key"]
        data = (
            SEL_QUOTE_EXACT_IN_SINGLE + _word(0x20) + _addr(c0) + _addr(c1) + _word(key_fee) + _word(spacing)
            + _addr(hooks) + _word(1 if zero_for_one else 0) + _word(amount_in) + _word(0x100) + _word(0)
        )
        out = _eth_call(self.rpc_url, QUOTER, data)
        amount_out, gas_estimate = int(out[2:66], 16), int(out[66:130], 16)
        # The quote is after the pool fee (taken from the input); price it ex-fee, since the
        # engine itemizes the fee separately.
        effective_in = Decimal(amount_in) * (1 - fee)
        if sell_eth:
            price = (Decimal(amount_out) / Decimal(10**6)) / (effective_in / Decimal(10**18))
        else:
            price = (effective_in / Decimal(10**6)) / (Decimal(amount_out) / Decimal(10**18))
        [gas_reply] = _post(self.rpc_url, [{"jsonrpc": "2.0", "id": 0, "method": SEL_GAS_PRICE, "params": []}])
        gas_gwei = (Decimal(int(gas_reply["result"], 16)) / Decimal(10**9)).quantize(Decimal("0.000001"))
        fee_src = "hook.getFee" if v["fee"] == "hook" else f"pool key fee {v['fee']} pips"
        return Market.model_validate({
            "quote": {"price": str(price.quantize(Decimal("0.01"))), "mid": str(mid), "quoted_at": as_of.isoformat(),
                      "expires_at": (as_of + timedelta(seconds=20)).isoformat(), "latency_seconds": "2",
                      "source": f"demo chain V4Quoter.quoteExactInputSingle · {v['label']} · fee from {fee_src}"},
            # The quoter filled the whole size, so the pool can take it.
            "liquidity": str(size),
            "gas": {"units": str(gas_estimate + BASE_TX_GAS), "price_gwei": str(gas_gwei), "observed_at": as_of.isoformat(),
                    "source": "demo chain eth_gasPrice; units = quoter gasEstimate + 21,000"},
            "fee_rate": str(fee),
            "volatility": {"annualized": str(state["sigma"]), "observed_at": as_of.isoformat(),
                           "source": "hook.getVolatility (ETH/USDC realized, hooked pool)"},
            "hedge": {"ratio": "0", "cost": "0"},
        })

    def quotes(self, pair: str, as_of: datetime) -> list[VenueQuote]:
        hook = load_hook()
        if hook is None:
            raise NotImplementedError("v4_pool: no contracts/hook/demo/hook.json; run make hook-pool")
        prices = self._prices(hook)
        src = "demo chain StateView"
        out = [VenueQuote("uniswap_v4_main", None, prices.pop("uniswap_v4_main").quantize(Decimal("0.01")), as_of, f"{src}:main", reference=True)]
        for venue, price in prices.items():
            out.append(VenueQuote(venue, "v4_swap", price.quantize(Decimal("0.01")), as_of, f"{src}:{venue}"))
        return out


V4_LABELS = {"uniswap_v4_hooked": "hooked v4 pool", "uniswap_v4_static": "static 0.30% v4 pool", "uniswap_v4_eth_usdc_30": "v4 ETH/USDC 0.30%"}


class UniswapTradingApiSource(_Live):
    """Uniswap Trading API quote at size, for slippage and gas estimates."""

    name = "uniswap_api"
    todo = "TODO: call the Trading API quote endpoint with UNISWAP_API_KEY (confirm endpoint and token addresses in docs)"

    def __init__(self):
        self.api_key = os.environ.get("UNISWAP_API_KEY")


class AquaRouterSource(_Live):
    """Static call to AquaSwapVMRouter quote() on the Ethereum mainnet fork.

    quote() ignores the curve's real Aqua balances, so cap amountOut at
    aqua.safeBalances(...) for tokenOut (see contracts/aqua/README.md).
    """

    name = "aqua_router"
    todo = "TODO: static-call quote() on AquaSwapVMRouter v1.0.2 (Ethereum mainnet fork; see contracts/aqua)"

    def __init__(self):
        self.rpc_url = os.environ.get("AQUA_FORK_RPC_URL")
        self.router = os.environ.get("AQUA_SWAPVM_ROUTER")
