"""FastAPI app for the RiskPilot engine (PRD 2)."""

import math
from collections.abc import Callable
from datetime import datetime, timezone

import jsonschema
import pydantic
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse

from decision import MODEL_VERSION, generate_execution_decision, iso, usd
from models import AquaPriceBody, EvaluateBody, EvaluateRequest, ScanBody, StressBody
from pricing import DAYS_PER_YEAR, aqua_position, aqua_premium_floor
from scanner import Source, scan
from scanner.live import AquaRouterSource, HookedV4PoolSource, UniswapTradingApiSource
from scanner.recorded import RecordedSource
from schemas import validate
from store import Store
from stress import run_stress_test

# SwapVM flat-fee units: 1e9 = 100% (swap-vm v1.0.2 Fee.sol BPS).
FEE_BPS = 10**9

POSITION_STATUS = {"pending": "pending", "confirmed": "open", "reverted": "failed"}


def default_sources() -> dict[str, Source]:
    sources = [RecordedSource(), HookedV4PoolSource(), UniswapTradingApiSource(), AquaRouterSource()]
    return {s.name: s for s in sources}


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def create_app(
    store: Store,
    sources: dict[str, Source] | None = None,
    clock: Callable[[], datetime] = _utcnow,
) -> FastAPI:
    sources = sources if sources is not None else default_sources()
    app = FastAPI(title="RiskPilot engine", version=MODEL_VERSION)

    @app.exception_handler(jsonschema.ValidationError)
    async def _schema_error(_: Request, e: jsonschema.ValidationError):
        return JSONResponse(status_code=422, content={"detail": e.message})

    @app.exception_handler(pydantic.ValidationError)
    async def _model_error(_: Request, e: pydantic.ValidationError):
        return JSONResponse(status_code=422, content={"detail": e.errors(include_url=False, include_context=False)})

    @app.exception_handler(NotImplementedError)
    async def _not_wired(_: Request, e: NotImplementedError):
        return JSONResponse(status_code=501, content={"detail": str(e)})

    def source(name: str) -> Source:
        if name not in sources:
            raise HTTPException(404, f"unknown source {name!r}; known: {sorted(sources)}")
        return sources[name]

    @app.post("/scan")
    def post_scan(body: ScanBody) -> list[dict]:
        as_of = body.as_of or clock()
        return scan(body.pair, [source(n) for n in body.sources], as_of, body.size, body.min_gap_bps)

    @app.post("/evaluate")
    def post_evaluate(body: EvaluateBody) -> dict:
        validate("opportunity", body.opportunity)
        as_of = body.as_of or clock()
        market = body.market
        if market is None:
            # Opportunity.source is "<source name>:<feed>", e.g. "recorded:uniswap_v4_hooked".
            name = body.opportunity["source"].split(":", 1)[0]
            try:
                market = source(name).market(body.opportunity["source_venue"], as_of)
            except KeyError as e:
                raise HTTPException(404, str(e.args[0])) from None
        req = EvaluateRequest(
            opportunity=body.opportunity,
            size=body.size if body.size is not None else body.opportunity["size"],
            profile=body.profile,
            market=market,
            book=body.book if body.book is not None else store.open_positions(),
            as_of=as_of,
            tolerance=body.tolerance,
            gas_budget=body.gas_budget,
            aqua=body.aqua,
        )
        decision = generate_execution_decision(req)
        store.save_decision(decision)
        return decision

    @app.post("/aqua/price")
    def post_aqua_price(body: AquaPriceBody) -> dict:
        try:
            r = aqua_position(
                float(body.spot), float(body.range_low), float(body.range_high),
                body.side, float(body.size), float(body.volatility),
            )
        except ValueError as e:
            raise HTTPException(422, str(e)) from None
        floor = aqua_premium_floor(
            float(body.spot), float(body.range_low), float(body.range_high), body.side, float(body.volatility)
        )
        return {
            "label": "Options-like payoff from a swap curve. Greeks are equivalent values, not an option contract.",
            "side": body.side,
            "equivalent_strike": f"{r['equivalent_strike']:.2f}",
            "equivalent_term_years": f"{r['equivalent_term_years']:.8f}",
            "equivalent_term_days": f"{r['equivalent_term_years'] * DAYS_PER_YEAR:.4f}",
            "equivalent_greeks": r["equivalent_greeks"].as_strings(),
            "position_greeks": r["position_greeks"].as_strings(),
            # Short equivalent terms give sub-cent premiums, so keep more precision than usd().
            "equivalent_premium": f"{r['equivalent_premium']:.6f}",
            "collateral": str(usd(r["collateral"])),
            "max_loss": str(usd(r["max_loss"])),
            # Aqua premium rule: the Fee instruction must be at least f_min.
            "premium_floor": {
                "c_eq_per_eth": f"{floor['c_eq']:.6f}",
                "markup": f"{floor['markup']:.2f}",
                "f_min": f"{floor['f_min']:.8f}",
                "fee_instruction_min": str(math.ceil(floor["f_min"] * FEE_BPS)),
            },
        }

    @app.post("/stress")
    def post_stress(body: StressBody) -> dict:
        result = run_stress_test(body.positions, spot=float(body.spot) if body.spot is not None else None)
        row = lambda s: {
            "spot_shock": f"{s['spot_shock']:.2f}",
            "vol_shock": f"{s['vol_shock']:.2f}",
            "pnl": str(usd(s["pnl"])),
        }
        return {
            "scenarios": [row(s) for s in result["scenarios"]],
            "worst_loss": str(usd(result["worst_loss"])),
            "worst_scenario": row(result["worst_scenario"]),
        }

    @app.post("/executions")
    def post_execution(execution: dict) -> dict:
        validate("execution", execution)
        decision = store.get_decision(execution["decision_id"])
        if decision is None:
            raise HTTPException(404, f"unknown decision {execution['decision_id']}")
        if decision["verdict"] != "APPROVE":
            raise HTTPException(409, f"decision {decision['decision_id']} is {decision['verdict']}, not APPROVE")

        position = store.position_for_decision(decision["decision_id"])
        if position is None:
            proposed = decision["inputs"]["proposed_position"]
            position = {
                "position_id": "pos_" + decision["decision_id"].removeprefix("dec_"),
                "decision_id": decision["decision_id"],
                **proposed,
                "entry": {"price": proposed["entry"]["price"], "at": execution["verified_at"] or decision["created_at"]},
            }
        position["status"] = POSITION_STATUS[execution["status"]]
        validate("position", position)
        store.save_execution(execution)
        store.save_position(position)
        return position

    @app.get("/decisions")
    def get_decisions(limit: int = 50) -> list[dict]:
        return store.list_decisions(limit)

    @app.get("/decisions/{decision_id}")
    def get_decision(decision_id: str) -> dict:
        decision = store.get_decision(decision_id)
        if decision is None:
            raise HTTPException(404, f"unknown decision {decision_id}")
        return decision

    @app.get("/health")
    def health() -> dict:
        return {"status": "ok", "model_version": MODEL_VERSION, "time": iso(clock())}

    return app
