"""Live sources. Interfaces are fixed; each is wired up in the PRD that owns its contract.

They raise NotImplementedError until then rather than guessing addresses or ABIs.
"""

import json
import os
from datetime import datetime
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
