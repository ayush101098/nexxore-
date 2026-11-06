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
