"""Live sources. Interfaces are fixed; each is wired up in the PRD that owns its contract.

They raise NotImplementedError until then rather than guessing addresses or ABIs.
"""

import os
from datetime import datetime

from models import Market
from scanner import VenueQuote


class _Live:
    name = ""
    todo = ""

    def quotes(self, pair: str, as_of: datetime) -> list[VenueQuote]:
        raise NotImplementedError(f"{self.name}: {self.todo}")

    def market(self, venue: str, as_of: datetime) -> Market:
        raise NotImplementedError(f"{self.name}: {self.todo}")


class HookedV4PoolSource(_Live):
    """RPC read of the hooked v4 pool: slot0 price and the hook's current dynamic fee."""

    name = "v4_pool"
    todo = "TODO(PRD 4): read PoolManager state once the hook is deployed (V4_RPC_URL, V4_POOL_MANAGER)"

    def __init__(self):
        self.rpc_url = os.environ.get("V4_RPC_URL")


class UniswapTradingApiSource(_Live):
    """Uniswap Trading API quote at size, for slippage and gas estimates."""

    name = "uniswap_api"
    todo = "TODO: call the Trading API quote endpoint with UNISWAP_API_KEY (confirm endpoint and token addresses in docs)"

    def __init__(self):
        self.api_key = os.environ.get("UNISWAP_API_KEY")


class AquaRouterSource(_Live):
    """Static call to AquaSwapVMRouter quote() on the Anvil fork."""

    name = "aqua_router"
    todo = "TODO(PRD 3): static-call quote() on AquaSwapVMRouter v1.0.2 (confirm chain and ABI at the v1.0.2 tag)"

    def __init__(self):
        self.rpc_url = os.environ.get("AQUA_FORK_RPC_URL")
        self.router = os.environ.get("AQUA_SWAPVM_ROUTER")
