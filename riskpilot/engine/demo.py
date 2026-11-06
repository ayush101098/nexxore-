"""Demo seed: the three opportunities the /riskpilot page opens with.

1. price gap on the hooked v4 pool at mainnet gas          -> REJECT (costs eat the edge)
2. put-like Aqua curve, 3,011.09 USDC over 2,667-3,400     -> REJECT (adds stress above budget)
3. call-like Aqua curve, 5 held WETH over 3,400-4,335      -> APPROVE (covered call on held ETH)

Inputs come from the engine's recorded fixtures, re-stamped to `now` so they are
fresh, with the wallet's holdings and gas price read from the demo chain when it
is up. Curve parameters (range, size, fee) come from contracts/aqua/demo/curves.json,
written by `make demo-chain`, so the decision matches the order the page signs.
"""

import copy
import json
import os
from collections.abc import Callable
from datetime import datetime
from decimal import Decimal
from pathlib import Path

from models import EvaluateRequest, Holdings

FIXTURES = Path(__file__).resolve().parent / "tests" / "fixtures"
DEMO_DIR = Path(os.environ.get("RISKPILOT_DEMO_DIR", Path(__file__).resolve().parents[1] / "contracts" / "aqua" / "demo"))
FEE_UNITS = Decimal(10**9)  # SwapVM flat fee: 1e9 = 100%


def load_curves() -> dict | None:
    path = DEMO_DIR / "curves.json"
    return json.loads(path.read_text()) if path.exists() else None


def _restamp(obj, offset):
    """Shift every timestamp (keys ending in _at, plus as_of) by offset."""
    if isinstance(obj, dict):
        out = {}
        for k, v in obj.items():
            if isinstance(v, str) and (k.endswith("_at") or k == "as_of"):
                out[k] = (datetime.fromisoformat(v) + offset).isoformat().replace("+00:00", "Z")
            else:
                out[k] = _restamp(v, offset)
        return out
    if isinstance(obj, list):
        return [_restamp(v, offset) for v in obj]
    return obj


def _fixture(name: str, now: datetime) -> dict:
    request = json.loads((FIXTURES / f"{name}.json").read_text())["request"]
    return _restamp(request, now - datetime.fromisoformat(request["as_of"]))


def seed_requests(
    now: datetime,
    wallet: str | None,
    read_holdings: Callable[[str], Holdings],
    read_gas_gwei: Callable[[], Decimal],
) -> tuple[list[tuple[str, EvaluateRequest]], dict]:
    """Return [(label, request)] plus a sources report for the page's status bar."""
    curves = load_curves()
    sources: dict = {"curves": "demo/curves.json" if curves else "unavailable"}
    wallet = wallet or (curves or {}).get("maker")

    holdings, gas = None, None
    if wallet:
        try:
            holdings = read_holdings(wallet)
            sources["holdings"] = "demo chain"
        except Exception as e:  # noqa: BLE001 - any RPC failure means the source is unavailable
            sources["holdings"] = f"unavailable: {e}"
    try:
        gas = read_gas_gwei()
        sources["gas"] = "demo chain eth_gasPrice"
    except Exception as e:  # noqa: BLE001
        sources["gas"] = f"unavailable: {e}"

    gap = _fixture("reject", now)
    gap["opportunity"]["opportunity_id"] = "opp_demogap"

    put = _fixture("aqua_downside", now)
    put["opportunity"]["opportunity_id"] = "opp_demoput"

    call = _fixture("aqua_upside_held_eth", now)
    call["opportunity"]["opportunity_id"] = "opp_democall"
    up = (curves or {}).get("upside")
    q = Decimal(up["weth_amount"]) / Decimal(10**18) if up else Decimal(5)
    size = f"{q * Decimal(call['market']['quote']['mid']):.2f}"
    call["size"] = call["opportunity"]["size"] = size
    call["holdings"] = {"weth": str(q), "usdc": "0"}  # declared fallback; replaced by the chain read
    if up:
        call["aqua"] = {
            "side": "call_like",
            "range_low": str(Decimal(up["range_low_usdc"]) / Decimal(10**6)),
            "range_high": str(Decimal(up["range_high_usdc"]) / Decimal(10**6)),
        }
        call["market"]["fee_rate"] = str(Decimal(up["fee_instruction"]) / FEE_UNITS)
    down = (curves or {}).get("downside")
    if down:
        put["market"]["fee_rate"] = str(Decimal(down["fee_instruction"]) / FEE_UNITS)

    for r in (put, call):
        if holdings is not None:
            r["holdings"] = {"weth": str(holdings.weth), "usdc": str(holdings.usdc)}
        if gas is not None:
            r["market"]["gas"]["price_gwei"] = str(gas)
            r["market"]["gas"]["source"] = "demo chain eth_gasPrice"

    requests = [
        ("Price gap · hooked v4 pool", gap),
        ("Put-like curve · 2,667–3,400", put),
        ("Call-like curve · 3,400–4,335", call),
    ]
    return [(label, EvaluateRequest.model_validate(copy.deepcopy(r))) for label, r in requests], {
        "wallet": wallet,
        "holdings": None if holdings is None else {"weth": str(holdings.weth), "usdc": str(holdings.usdc)},
        "sources": sources,
    }
