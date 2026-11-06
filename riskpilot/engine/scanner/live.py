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


class HookedV4PoolSource(_Live):
    """RPC read of the hooked v4 pool on the demo chain: its price and the hook's dynamic fee,
    with the fork's main ETH/USDC v4 pool as the reference price."""

    name = "v4_pool"
    todo = "TODO: market() needs a quote at size (simulate the swap) for slippage and liquidity"

    def __init__(self, rpc_url: str | None = None):
        self.rpc_url = rpc_url or os.environ.get("DEMO_RPC_URL", DEFAULT_RPC)

    def market(self, venue: str, as_of: datetime, size: Decimal = Decimal("10000")) -> Market:
        """Market snapshot for trading `size` USD through the hooked pool, all from the chain:
        a Quoter quote at size (fee-exclusive price), the hook's fee and sigma, eth_gasPrice."""
        hook = load_hook()
        if hook is None or venue != "uniswap_v4_hooked":
            raise NotImplementedError(f"v4_pool: no live market for {venue!r}")
        state = hook_pool_state(self.rpc_url, hook)
        mid, ref, fee = state["hooked_price"], state["main_price"], Decimal(state["fee_pips"]) / Decimal(10**6)
        sell_eth = mid > ref  # ETH is dearer here: sell it into the hooked pool
        if sell_eth:
            amount_in = int(size / mid * Decimal(10**18))  # WETH wei
        else:
            amount_in = int(size * Decimal(10**6))  # USDC units
        data = (
            SEL_QUOTE_EXACT_IN_SINGLE + _word(0x20) + _addr(USDC) + _addr(WETH) + _word(DYNAMIC_FEE_FLAG)
            + _word(60) + _addr(hook["hook"]) + _word(0 if sell_eth else 1) + _word(amount_in) + _word(0x100) + _word(0)
        )
        out = _eth_call(self.rpc_url, QUOTER, data)
        amount_out, gas_estimate = int(out[2:66], 16), int(out[66:130], 16)
        # The quote is after the pool fee (taken from the input); price it ex-fee, since the
        # engine itemizes the fee separately.
        effective_in = Decimal(amount_in) * (1 - fee)
        if sell_eth:
            price = (Decimal(amount_out) / Decimal(10**6)) / (effective_in / Decimal(10**18))
        else:
            price = (Decimal(amount_in) * (1 - fee) / Decimal(10**6)) / (Decimal(amount_out) / Decimal(10**18))
        [gas_reply] = _post(self.rpc_url, [{"jsonrpc": "2.0", "id": 0, "method": SEL_GAS_PRICE, "params": []}])
        gas_gwei = (Decimal(int(gas_reply["result"], 16)) / Decimal(10**9)).quantize(Decimal("0.000001"))
        return Market.model_validate({
            "quote": {"price": str(price.quantize(Decimal("0.01"))), "mid": str(mid), "quoted_at": as_of.isoformat(),
                      "expires_at": (as_of + timedelta(seconds=20)).isoformat(), "latency_seconds": "2",
                      "source": "demo chain V4Quoter.quoteExactInputSingle"},
            # The quoter filled the whole size, so the pool can take it.
            "liquidity": str(size),
            "gas": {"units": str(gas_estimate + BASE_TX_GAS), "price_gwei": str(gas_gwei), "observed_at": as_of.isoformat(),
                    "source": "demo chain eth_gasPrice; units = quoter gasEstimate + 21,000"},
            "fee_rate": str(fee),
            "volatility": {"annualized": str(state["sigma"]), "observed_at": as_of.isoformat(), "source": "hook.getVolatility"},
            # Hedge leg: the offsetting trade on the main ETH/USDC pool at its 0.05% fee.
            "hedge": {"ratio": "1", "cost": str((size * Decimal("0.0005")).quantize(Decimal("0.01")))},
        })

    def quotes(self, pair: str, as_of: datetime) -> list[VenueQuote]:
        hook = load_hook()
        if hook is None:
            raise NotImplementedError("v4_pool: no contracts/hook/demo/hook.json; run make hook-pool")
        state = hook_pool_state(self.rpc_url, hook)
        src = "demo chain StateView"
        return [
            VenueQuote("uniswap_v4_main", None, state["main_price"], as_of, f"{src}:main", reference=True),
            VenueQuote("uniswap_v4_hooked", "v4_swap", state["hooked_price"], as_of, f"{src}:hooked"),
        ]


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
