"""FastAPI app for the RiskPilot engine (PRD 2)."""

import math
import os
from decimal import Decimal
from collections.abc import Callable
from datetime import datetime, timezone

import jsonschema
import pydantic
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from decision import MODEL_VERSION, generate_execution_decision, iso, usd
from demo import load_arc, load_curves, seed_requests
from models import AquaPriceBody, EvaluateBody, EvaluateRequest, Holdings, ScanBody, StressBody
from pricing import DAYS_PER_YEAR, aqua_position, aqua_premium_floor
from profiles import PROFILES
from scanner import Source, scan
from scanner.holdings import DEFAULT_RPC, read_gas_gwei, read_holdings
from scanner.live import (
    AquaRouterSource, HookedV4PoolSource, UniswapTradingApiSource, hook_pool_state, load_hook, main_pool_price,
)
from scanner.recorded import RecordedSource
from schemas import validate
from store import Store
from stress import run_stress_test

# SwapVM flat-fee units: 1e9 = 100% (swap-vm v1.0.2 Fee.sol BPS).
FEE_BPS = 10**9

PAGE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "web", "index.html")
# Where the /riskpilot page may call the engine from: the deployed site and local dev servers.
CORS_ORIGINS = ["https://nexxore.xyz", "https://www.nexxore.xyz"]
CORS_LOCAL = r"http://(localhost|127\.0\.0\.1)(:\d+)?"

POSITION_STATUS = {"pending": "pending", "confirmed": "open", "reverted": "failed"}


def default_sources() -> dict[str, Source]:
    sources = [RecordedSource(), HookedV4PoolSource(), UniswapTradingApiSource(), AquaRouterSource()]
    return {s.name: s for s in sources}


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _chain_holdings(wallet: str) -> Holdings:
    return read_holdings(os.environ.get("DEMO_RPC_URL", DEFAULT_RPC), wallet)


def _chain_gas() -> Decimal:
    return read_gas_gwei(os.environ.get("DEMO_RPC_URL", DEFAULT_RPC))


def create_app(
    store: Store,
    sources: dict[str, Source] | None = None,
    clock: Callable[[], datetime] = _utcnow,
    holdings_reader: Callable[[str], Holdings] = _chain_holdings,
    gas_reader: Callable[[], Decimal] = _chain_gas,
    spot_reader: Callable[[], Decimal] | None = None,
    gap_reader: Callable[[datetime], tuple[dict, dict]] | None = None,
) -> FastAPI:
    sources = sources if sources is not None else default_sources()
    app = FastAPI(title="RiskPilot engine", version=MODEL_VERSION)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=CORS_ORIGINS,
        allow_origin_regex=CORS_LOCAL,
        allow_methods=["GET", "POST"],
        allow_headers=["content-type"],
    )

    @app.middleware("http")
    async def _private_network(request: Request, call_next):
        # Chrome asks before a public page (nexxore.xyz) calls a localhost engine.
        response = await call_next(request)
        if request.headers.get("access-control-request-private-network") == "true":
            response.headers["Access-Control-Allow-Private-Network"] = "true"
        return response

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
        holdings = body.holdings
        if holdings is None and body.wallet:
            try:
                holdings = holdings_reader(body.wallet)
            except ValueError as e:
                raise HTTPException(422, str(e)) from None
            except (OSError, RuntimeError) as e:
                raise HTTPException(502, f"could not read holdings for {body.wallet}: {e}") from None
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
            holdings=holdings,
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

    @app.get("/profiles")
    def get_profiles() -> dict:
        return {
            name: {"lambda": str(p.lam), "budget": str(p.budget), "min_edge": str(p.min_edge), "k": str(p.k)}
            for name, p in PROFILES.items()
        }

    @app.post("/demo/seed")
    def post_demo_seed(wallet: str | None = None) -> dict:
        """Evaluate the three demo opportunities now, store the decisions, return both."""
        rpc = os.environ.get("DEMO_RPC_URL", DEFAULT_RPC)
        v4 = HookedV4PoolSource(rpc)

        def live_gap(now):
            opps = [o for o in scan("ETH/USDC", [v4], now, Decimal("10000.00"), Decimal("5")) if o["source_venue"] == "uniswap_v4_hooked"]
            if not opps:
                raise RuntimeError("no gap on the hooked pool")
            return opps[0], v4.market("uniswap_v4_hooked", now, Decimal(opps[0]["size"])).model_dump(mode="json")

        requests, report = seed_requests(
            clock(), wallet, holdings_reader, gas_reader,
            read_spot=spot_reader or (lambda: main_pool_price(rpc)),
            live_gap=gap_reader if gap_reader is not None else (live_gap if load_hook() else None),
        )
        items = []
        for label, req in requests:
            decision = generate_execution_decision(req)
            store.save_decision(decision)
            items.append({"label": label, "opportunity": req.opportunity, "decision": decision})
        return {**report, "as_of": iso(clock()), "items": items}

    @app.get("/demo/info")
    def get_demo_info() -> dict:
        curves = load_curves()
        if curves is None:
            raise HTTPException(404, "no demo/curves.json; run make demo-chain in contracts/aqua")
        # Wei amounts exceed JS's safe-integer range: send them as strings.
        big = lambda v: {k: big(x) for k, x in v.items()} if isinstance(v, dict) else (str(v) if isinstance(v, int) and abs(v) > 2**53 else v)
        info = big(curves)
        hook = load_hook()
        if hook is not None:
            try:
                live = {k: str(v) for k, v in hook_pool_state(os.environ.get("DEMO_RPC_URL", DEFAULT_RPC), hook).items()}
            except (OSError, RuntimeError, ValueError) as e:
                live = {"error": str(e)}
            info["hook"] = {**hook, "live": live}
        arc = load_arc()
        if arc is not None:
            # The escrow stake is engine config (nothing is typed into the page).
            info["arc"] = {**arc, "stake_usdc": os.environ.get("ARC_DEMO_STAKE_USDC", "5")}
        return info

    @app.post("/decisions/{decision_id}/replay")
    def post_replay(decision_id: str) -> dict:
        """Re-run a stored decision from its recorded inputs; it must come out identical."""
        stored = store.get_decision(decision_id)
        if stored is None:
            raise HTTPException(404, f"unknown decision {decision_id}")
        replayed = generate_execution_decision(EvaluateRequest.model_validate(stored["inputs"]["request"]))
        return {"matches": replayed == stored, "decision": replayed}

    @app.get("/decisions/{decision_id}/settlement")
    def get_settlement(decision_id: str, amount: Decimal) -> dict:
        """Payout for `amount` USDC escrowed on Arc against an executed, approved decision.

        Demo rule: the escrow earns the decision's net edge pro rata to its size,
        payout = amount * (1 + net_edge / size). It is the engine's priced result for the
        verified execution, not a realized P&L measurement.
        """
        decision = store.get_decision(decision_id)
        if decision is None:
            raise HTTPException(404, f"unknown decision {decision_id}")
        if decision["verdict"] != "APPROVE":
            raise HTTPException(409, f"decision {decision_id} is {decision['verdict']}, not APPROVE")
        executions = [e for e in store.executions_for_decision(decision_id) if e["status"] == "confirmed"]
        if not executions:
            raise HTTPException(409, f"decision {decision_id} has no verified execution yet")
        if amount <= 0:
            raise HTTPException(422, "amount must be positive")
        size = Decimal(decision["inputs"]["request"]["size"])
        payout = (amount * (1 + Decimal(decision["net_edge"]) / size)).quantize(Decimal("0.000001"))
        return {
            "decision_id": decision_id,
            "amount": str(amount),
            "payout": str(payout),
            "rule": "payout = amount × (1 + net_edge / size)",
            "net_edge": decision["net_edge"],
            "size": str(size),
            "execution_tx": executions[-1]["tx_hash"],
        }

    @app.post("/decisions/{decision_id}/settlement")
    def post_settlement(decision_id: str, body: dict) -> dict:
        """Record the Arc settle() transaction on the decision's Execution."""
        tx = body.get("settlement_tx", "")
        executions = store.executions_for_decision(decision_id)
        if not executions:
            raise HTTPException(404, f"no execution for {decision_id}")
        execution = {**executions[-1], "settlement_tx": tx}
        validate("execution", execution)
        store.save_execution(execution)
        return execution

    @app.get("/executions")
    def get_executions(limit: int = 100) -> list[dict]:
        return store.list_executions(limit)

    @app.get("/riskpilot", include_in_schema=False)
    def get_page() -> FileResponse:
        return FileResponse(PAGE, media_type="text/html")

    # The page imports /riskpilot/web/adapters.js, the same path Vercel serves.
    app.mount("/riskpilot/web", StaticFiles(directory=os.path.dirname(PAGE)), name="web")

    @app.get("/health")
    def health() -> dict:
        return {"status": "ok", "model_version": MODEL_VERSION, "time": iso(clock())}

    return app
