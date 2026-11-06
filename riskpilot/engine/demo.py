"""Demo seed: the three opportunities the /riskpilot page opens with.

1. every live price gap the scanner finds across the demo chain's v4 ETH/USDC pools
   (the hooked pool, the static 0.30% comparison pool, the fork's own 0.30% pool)
2. put-like Aqua curve, 1 ETH of USDC below spot    -> REJECT (adds stress above budget)
3. call-like Aqua curve, 7 held WETH above spot     -> APPROVE (covered call on held ETH)

Everything comes from the demo chain when it is up: the price gap from the hooked pool
(StateView price, V4Quoter quote at size, the hook's fee and sigma, eth_gasPrice), the
ETH spot for the Aqua curves from the fork's main ETH/USDC pool, and the wallet's holdings.
Curve parameters (range, size, fee) come from contracts/aqua/demo/curves.json, written by
`make demo-chain`, so the decision matches the order the page signs. The Aqua curves use a
stated 55% implied volatility. Anything unavailable falls back to the engine's recorded
fixtures, re-stamped to `now`, and the sources report says so.
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


ARC_DEPLOYMENT = Path(
    os.environ.get("RISKPILOT_ARC_DEPLOYMENT", Path(__file__).resolve().parents[1] / "contracts" / "arc" / "deployments" / "arc-testnet.json")
)


def load_arc() -> dict | None:
    """RiskPilotEscrow on Arc testnet, written by make deploy-arc-testnet."""
    return json.loads(ARC_DEPLOYMENT.read_text()) if ARC_DEPLOYMENT.exists() else None


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
    read_spot: Callable[[], Decimal] | None = None,
    live_gaps: Callable[[datetime], list[tuple[str, dict, dict]]] | None = None,
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
    gaps = [("Price gap · hooked v4 pool", gap)]
    sources["price_gap"] = "recorded fixture"
    if live_gaps is not None:
        try:
            found = live_gaps(now)
            if found:
                gaps = []
                for label, opportunity, market in found:
                    g = copy.deepcopy(gap)
                    g.update(opportunity=opportunity, size=opportunity["size"], market=market, book=[])
                    gaps.append((f"Price gap · {label}", g))
                sources["price_gap"] = f"demo chain: {len(found)} v4 pools via StateView and V4Quoter"
            else:
                sources["price_gap"] = "recorded fixture (no live gap above the scan threshold)"
        except Exception as e:  # noqa: BLE001
            sources["price_gap"] = f"recorded fixture (live pools unavailable: {e})"

    spot = None
    if read_spot is not None:
        try:
            spot = read_spot()
            sources["spot"] = "demo chain: main ETH/USDC v4 pool via StateView"
        except Exception as e:  # noqa: BLE001
            sources["spot"] = f"unavailable: {e}"
    if spot is None and curves and "spot_usdc" in curves:
        spot = Decimal(curves["spot_usdc"]) / Decimal(10**6)
        sources["spot"] = "demo/curves.json (DemoParams.SPOT)"

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
        put["aqua"] = {
            "side": "put_like",
            "range_low": str(Decimal(down["range_low_usdc"]) / Decimal(10**6)),
            "range_high": str(Decimal(down["range_high_usdc"]) / Decimal(10**6)),
        }
        put["size"] = put["opportunity"]["size"] = f"{Decimal(down['usdc_amount']) / Decimal(10**6):.2f}"

    for r in (put, call):
        if spot is not None:
            for k in ("observed_price", "reference_price"):
                r["opportunity"][k] = f"{spot:.2f}"
            label = sources["spot"]
            r["opportunity"]["source"] = label
            # The maker quotes the curve at spot: no taker quote at size for a curve not yet shipped.
            r["market"]["quote"].update(price=f"{spot:.2f}", mid=f"{spot:.2f}", source=f"{label} (curve priced at spot)")
            r["market"]["volatility"]["source"] = "stated: 55% implied volatility"
    if spot is not None and up:
        call["size"] = call["opportunity"]["size"] = f"{q * spot:.2f}"

    gap_requests = [g for _, g in gaps]
    for r in (*gap_requests, put, call):
        if holdings is not None:
            r["holdings"] = {"weth": str(holdings.weth), "usdc": str(holdings.usdc)}
        live_market = r in gap_requests and sources["price_gap"].startswith("demo chain")
        if gas is not None and not live_market:  # live gap markets already read gas from the chain
            r["market"]["gas"]["price_gwei"] = str(gas)
            r["market"]["gas"]["source"] = "demo chain eth_gasPrice"

    def span(r):
        return f"{Decimal(r['aqua']['range_low']):,.0f}–{Decimal(r['aqua']['range_high']):,.0f}"

    requests = [
        *gaps,
        (f"Put-like curve · {span(put)}", put),
        (f"Call-like curve · {span(call)}", call),
    ]
    return [(label, EvaluateRequest.model_validate(copy.deepcopy(r))) for label, r in requests], {
        "wallet": wallet,
        "holdings": None if holdings is None else {"weth": str(holdings.weth), "usdc": str(holdings.usdc)},
        "sources": sources,
    }


def opportunity_key(req: EvaluateRequest) -> str:
    """Stable across blocks and reseeds (the decision id is not): what the page keeps selected."""
    o = req.opportunity
    return ":".join([o["type"], o["source_venue"], req.aqua.side if req.aqua else o["target"]])
