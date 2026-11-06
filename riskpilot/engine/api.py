"""FastAPI app for the RiskPilot engine (PRD 2)."""

import asyncio
import json
import logging
import math
import os
import time
from decimal import Decimal
from collections.abc import Callable
from datetime import datetime, timezone

import jsonschema
import pydantic
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from decision import MODEL_VERSION, generate_execution_decision, iso, usd
from demo import load_arc, load_curves, opportunity_key, seed_requests
from models import AquaPriceBody, EvaluateBody, EvaluateRequest, Holdings, ScanBody, StressBody
from pricing import DAYS_PER_YEAR, aqua_position, aqua_premium_floor
from profiles import PROFILES, REQUOTE_MOVE, STALENESS_S, TTL_S, derive, get_profile
from scanner import Source, scan
from scanner.holdings import DEFAULT_RPC, read_chain_context, read_gas_gwei, read_holdings
from scanner.live import (
    V4_LABELS, AquaRouterSource, HookedV4PoolSource, UniswapTradingApiSource, hook_pool_state, load_hook, main_pool_price,
)
from scanner.recorded import RecordedSource
from schemas import validate
from signing import EngineKey
from store import Store
from stream import HEARTBEAT_S, BlockWatcher, Hub, Sources
from stress import run_stress_test

log = logging.getLogger("riskpilot")

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


def _chain_context(wallet: str | None) -> dict:
    return read_chain_context(os.environ.get("DEMO_RPC_URL", DEFAULT_RPC), wallet)


def profile_message(wallet: str, profile: str, set_at: str) -> str:
    """The EIP-191 message a wallet signs to set its profile."""
    return f"RiskPilot profile\nwallet: {wallet.lower()}\nprofile: {profile}\nset_at: {set_at}"


def recover_signer(message: str, signature: str) -> str:
    from eth_account import Account
    from eth_account.messages import encode_defunct

    return Account.recover_message(encode_defunct(text=message), signature=signature)


def create_app(
    store: Store,
    sources: dict[str, Source] | None = None,
    clock: Callable[[], datetime] = _utcnow,
    holdings_reader: Callable[[str], Holdings] = _chain_holdings,
    gas_reader: Callable[[], Decimal] = _chain_gas,
    spot_reader: Callable[[], Decimal] | None = None,
    gap_reader: Callable[[datetime], list[tuple[str, dict, dict]]] | None = None,
    chain_reader: Callable[[str | None], dict] = _chain_context,
    stream: bool = False,
    engine_key: EngineKey | None = None,
    arc_reader: Callable[[dict], dict] | None = None,
) -> FastAPI:
    sources = sources if sources is not None else default_sources()
    key = engine_key or EngineKey()
    hub = Hub()
    reads = Sources()
    latest: dict[str, dict] = {}  # wallet -> its newest evaluated opportunities
    latency: dict[str, list[float]] = {}
    started = time.time()
    rpc_url = os.environ.get("DEMO_RPC_URL", DEFAULT_RPC)
    app = FastAPI(
        title="RiskPilot engine", version=MODEL_VERSION,
        description="Risk-aware execution engine for programmable liquidity. Every route is also served under /v1.",
        openapi_url="/openapi.json",
    )
    app.state.hub, app.state.key, app.state.latest, app.state.store = hub, key, latest, store

    @app.middleware("http")
    async def _v1_and_metrics(request: Request, call_next):
        # /v1/<route> is the versioned API; the unversioned routes stay as aliases.
        path = request.scope["path"]
        if path == "/v1" or path.startswith("/v1/"):
            request.scope["path"] = path[3:] or "/"
            request.scope["raw_path"] = request.scope["path"].encode()
        t = time.perf_counter()
        response = await call_next(request)
        route = request.scope.get("route")
        name = f"{request.method} {getattr(route, 'path', request.scope['path'])}"
        if not name.endswith("/stream"):
            ms = (time.perf_counter() - t) * 1000
            latency.setdefault(name, []).append(ms)
            del latency[name][:-500]
        return response
    app.add_middleware(
        CORSMiddleware,
        allow_origins=CORS_ORIGINS,
        allow_origin_regex=CORS_LOCAL,
        allow_methods=["GET", "POST", "PUT"],
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

    def derivation(profile: str, wallet: str | None, holdings: Holdings | None, spot: Decimal | None,
                   impact: Decimal | None, ctx: dict | Exception | None = None) -> tuple[int | None, dict]:
        """This block's derived values: budget from wallet value, slippage, size cap, gas ceiling."""
        p = get_profile(profile)
        if ctx is None:
            try:
                ctx = chain_reader(wallet)
            except Exception as e:  # noqa: BLE001
                ctx = e
        if isinstance(ctx, Exception):  # chain unavailable: the cap applies, and the decision says so
            return None, {**derive(p, None, impact), "unavailable": f"chain context: {ctx}"}
        value = None
        if ctx.get("eth") is not None and holdings is not None and spot is not None:
            value = (ctx["eth"] + holdings.weth) * spot + holdings.usdc
        d = derive(p, value, impact, ctx.get("base_fee_gwei"), ctx.get("tip_gwei"))
        d["block"] = ctx["block"]
        return ctx["block"], d

    def apply_profile(req: EvaluateRequest, wallet: str | None, ctx: dict | Exception | None = None,
                      spot: Decimal | None = None) -> EvaluateRequest:
        m = req.market
        impact = abs(m.quote.price - m.quote.mid) / m.quote.mid if m.quote.mid else None
        block, derived = derivation(req.profile, wallet, req.holdings, spot or m.quote.mid, impact, ctx)
        update = {"block": block, "derived": derived, "budget": Decimal(derived["budget"])}
        cap = derived.get("max_position")
        if req.aqua is None and cap is not None and req.size > Decimal(cap):
            update["size"] = Decimal(cap)  # largest position the profile allows; the quote was at a larger size
        return req.model_copy(update=update)

    def sign(decision: dict, wallet: str | None) -> dict:
        decision = {**decision, "signature": key.sign(decision, wallet)}
        store.save_decision(decision)
        log.info(json.dumps({"event": "decision", "decision_id": decision["decision_id"], "verdict": decision["verdict"],
                             "wallet": wallet, "block": decision["inputs"]["request"].get("block")}))
        return decision

    def seed_for(wallet: str | None, profile: str | None) -> dict:
        """Scan, evaluate and size every demo opportunity for a wallet under its profile."""
        who = wallet or (load_curves() or {}).get("maker")
        if profile is None:
            row = store.get_profile(who) if who else None
            if row is None:
                raise HTTPException(409, {"needs_profile": True, "wallet": who,
                                          "detail": "choose a profile first: PUT /v1/profile"})
            profile = row["profile"]
        profile = {"balanced": "moderate"}.get(profile, profile)
        if profile not in PROFILES:
            raise HTTPException(422, f"profile must be one of {sorted(PROFILES)}")
        v4 = HookedV4PoolSource(rpc_url)
        now = clock()

        def live_gaps(at):
            """Every v4 pool whose price is at least 5 bps from the main ETH/USDC pool."""
            out = []
            for opp in scan("ETH/USDC", [v4], at, Decimal("10000.00"), Decimal("5")):
                market = v4.market(opp["source_venue"], at, Decimal(opp["size"])).model_dump(mode="json")
                out.append((V4_LABELS[opp["source_venue"]], opp, market))
            return out

        gaps = gap_reader if gap_reader is not None else (live_gaps if load_hook() else None)
        spot_fn = spot_reader or (lambda: main_pool_price(rpc_url))
        # Every source is read in parallel, each with a 1.5 s timeout.
        got = reads.run({
            "holdings": (lambda: holdings_reader(who)) if who else (lambda: None),
            "gas": gas_reader,
            "spot": spot_fn,
            "chain": lambda: chain_reader(who),
            **({"gaps": lambda: gaps(now)} if gaps else {}),
        })

        def value(name):
            def read(*_):
                v = got[name]
                if isinstance(v, Exception):
                    raise v
                return v
            return read

        requests, report = seed_requests(
            now, who, value("holdings"), value("gas"), read_spot=value("spot"),
            live_gaps=value("gaps") if gaps else None,
        )
        spot = None if isinstance(got["spot"], Exception) else got["spot"]
        items = []
        for label, req in requests:
            req = apply_profile(req.model_copy(update={"profile": profile}), report["wallet"], got["chain"], spot)
            decision = sign(generate_execution_decision(req), report["wallet"])
            items.append({"label": label, "key": opportunity_key(req), "opportunity": req.opportunity, "decision": decision})
        first = items[0]["decision"]["inputs"]["profile"] if items else {}
        body = {**report, "as_of": iso(now), "profile": first, "items": items,
                "block": None if isinstance(got["chain"], Exception) else got["chain"]["block"],
                "unavailable": reads.unavailable()}
        if report["wallet"]:
            latest[report["wallet"].lower()] = body
        return body

    def health_body() -> dict:
        watcher = getattr(app.state, "watcher", None)
        deps = {
            "chain": {"rpc": rpc_url, "up": watcher.chain_up if watcher else None,
                      "block": watcher.block if watcher else None, "stream": watcher.mode if watcher else "off"},
            "sources": {"unavailable": reads.unavailable(), "errors": dict(reads.errors)},
        }
        warnings = []
        arc = load_arc()
        if arc is not None and arc_reader is not None:
            try:
                a = arc_reader(arc)
                deps["arc"] = a
                if Decimal(a.get("operator_usdc", "0")) < 1:
                    warnings.append(f"operator {arc.get('operator')} holds {a.get('operator_usdc')} USDC on Arc (below 1)")
            except Exception as e:  # noqa: BLE001
                deps["arc"] = {"up": False, "error": str(e)}
        worker = getattr(app.state, "arc_worker", None)
        if worker is not None:
            deps["arc_worker"] = worker.status()
        if key.ephemeral:
            warnings.append("engine key is ephemeral (set RISKPILOT_ENGINE_KEY)")
        return {"status": "ok", "model_version": MODEL_VERSION, "time": iso(clock()), "engine_signer": key.address,
                "uptime_s": round(time.time() - started), "dependencies": deps, "warnings": warnings}

    def refresh_wallets(_block: int | None = None) -> None:
        for wallet in hub.wallets():
            if store.get_profile(wallet) is None:
                continue
            try:
                t = time.perf_counter()
                body = seed_for(wallet, None)
                body["evaluated_ms"] = round((time.perf_counter() - t) * 1000, 1)
                hub.publish("opportunity", body, wallet)
            except Exception as e:  # noqa: BLE001
                log.warning(json.dumps({"event": "refresh_failed", "wallet": wallet, "error": str(e)}))

    @app.on_event("startup")
    def _start_stream() -> None:
        if stream:
            app.state.watcher = BlockWatcher(rpc_url, hub, refresh_wallets, refresh_wallets, health_body)
            app.state.watcher.start()

    @app.on_event("shutdown")
    def _stop_stream() -> None:
        if getattr(app.state, "watcher", None):
            app.state.watcher.stop()

    @app.get("/stream", include_in_schema=True)
    async def get_stream(request: Request, wallet: str | None = None):
        """Server-sent events: block, opportunity, decision, health, settlement. 15 s heartbeat."""
        q = hub.subscribe(wallet)

        async def events():
            try:
                yield f"event: health\ndata: {json.dumps(health_body())}\n\n"
                if wallet and store.get_profile(wallet):
                    body = latest.get(wallet.lower())
                    if body is None:
                        body = await asyncio.get_running_loop().run_in_executor(None, lambda: seed_for(wallet, None))
                    yield f"event: opportunity\ndata: {json.dumps(body)}\n\n"
                while True:
                    if await request.is_disconnected():
                        break
                    try:
                        yield await asyncio.wait_for(q.get(), timeout=HEARTBEAT_S)
                    except asyncio.TimeoutError:
                        yield ": heartbeat\n\n"
            finally:
                hub.unsubscribe(q)

        return StreamingResponse(events(), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    @app.get("/opportunities")
    def get_opportunities(wallet: str) -> dict:
        """The wallet's evaluated opportunities at the current block (evaluated now if not yet)."""
        cached = latest.get(wallet.lower())
        watcher = getattr(app.state, "watcher", None)
        head = watcher.block if watcher else None
        if cached is not None and head is not None and cached.get("block") == head:
            return cached
        return seed_for(wallet, None)

    @app.get("/positions")
    def get_positions(wallet: str | None = None) -> list[dict]:
        return store.open_positions()

    @app.get("/metrics")
    def get_metrics() -> dict:
        def pct(xs, q):
            xs = sorted(xs)
            return round(xs[min(len(xs) - 1, int(q * len(xs)))], 2)
        return {name: {"count": len(xs), "p50_ms": pct(xs, 0.5), "p95_ms": pct(xs, 0.95)}
                for name, xs in sorted(latency.items()) if xs}

    @app.post("/decisions/{decision_id}/build")
    def post_build(decision_id: str) -> dict:
        """EIP-5792 calls[] for an APPROVE decision that is live and signed by this engine."""
        from build import build_calls

        d = store.get_decision(decision_id)
        if d is None:
            raise HTTPException(404, f"unknown decision {decision_id}")
        if d["verdict"] != "APPROVE":
            raise HTTPException(409, f"decision {decision_id} is {d['verdict']}, not APPROVE")
        if datetime.fromisoformat(d["expires_at"]) <= clock():
            raise HTTPException(409, f"decision {decision_id} expired at {d['expires_at']}")
        if not key.verify(d):
            raise HTTPException(409, f"decision {decision_id} signature does not verify against {key.address}")
        wallet = d["signature"]["message"]["wallet"]
        row = store.get_profile(wallet)
        if row is not None and row["profile"] != d["inputs"]["profile"]["name"]:
            raise HTTPException(409, f"profile changed to {row['profile']} after this decision; re-evaluate")
        try:
            calls = build_calls(d, wallet, rpc_url)
        except NotImplementedError as e:
            raise HTTPException(501, str(e)) from None
        return {"decision_id": decision_id, "chain_id": 31337, "from": wallet, "version": "1.0",
                "atomicRequired": True, "calls": calls, "signature": d["signature"]}

    @app.get("/settlements")
    def get_settlements(decision_id: str | None = None) -> list[dict]:
        rows = store.list_settlements()
        return [r for r in rows if decision_id is None or r["decision_id"] == decision_id]

    @app.get("/profile")
    def get_wallet_profile(wallet: str) -> dict:
        """The wallet's profile; profile is null until the wallet chooses one (PUT /v1/profile)."""
        return store.get_profile(wallet) or {"wallet": wallet.lower(), "profile": None, "set_at": None, "source": None}

    @app.put("/profile")
    def put_wallet_profile(body: dict) -> dict:
        """Set a wallet's profile once. Body: wallet, profile, set_at, signature (EIP-191 over profile_message)."""
        wallet, name, set_at, sig = (body.get(k) for k in ("wallet", "profile", "set_at", "signature"))
        if not (isinstance(wallet, str) and wallet.startswith("0x") and len(wallet) == 42):
            raise HTTPException(422, "wallet must be an address")
        name = {"balanced": "moderate"}.get(name, name)
        if name not in PROFILES:
            raise HTTPException(422, f"profile must be one of {sorted(PROFILES)}")
        if not (isinstance(set_at, str) and isinstance(sig, str)):
            raise HTTPException(422, "set_at and signature are required")
        try:
            signer = recover_signer(profile_message(wallet, name, set_at), sig)
        except Exception as e:  # noqa: BLE001 - malformed signature
            raise HTTPException(401, f"bad signature: {e}") from None
        if signer.lower() != wallet.lower():
            raise HTTPException(401, f"signature is from {signer}, not {wallet}")
        previous = store.get_profile(wallet)
        store.set_profile(wallet, name, set_at)
        # A change cancels live approvals: the wallet's decisions are re-evaluated under the new profile
        # (build refuses any decision made under the old one).
        latest.pop(wallet.lower(), None)
        if wallet.lower() in hub.wallets():
            try:
                hub.publish("opportunity", seed_for(wallet, None), wallet)
            except HTTPException:
                pass
        return {**store.get_profile(wallet), "previous": previous["profile"] if previous else None,
                "message": profile_message(wallet, name, set_at)}

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
        profile = body.profile
        if "profile" not in body.model_fields_set and body.wallet and (row := store.get_profile(body.wallet)):
            profile = row["profile"]
        req = EvaluateRequest(
            opportunity=body.opportunity,
            size=body.size if body.size is not None else body.opportunity["size"],
            profile=profile,
            market=market,
            book=body.book if body.book is not None else store.open_positions(),
            as_of=as_of,
            tolerance=body.tolerance,
            gas_budget=body.gas_budget,
            aqua=body.aqua,
            holdings=holdings,
        )
        if body.wallet:
            req = apply_profile(req, body.wallet)
        return sign(generate_execution_decision(req), body.wallet)

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
        known = [e for e in store.executions_for_decision(execution["decision_id"]) if e["tx_hash"] == execution["tx_hash"]]
        if known and (pos := store.position_for_decision(execution["decision_id"])) is not None and known[0]["status"] == execution["status"]:
            return pos  # idempotent: the same report twice changes nothing
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
        hub.publish("decision", {"decision_id": decision["decision_id"], "execution": execution, "position": position})
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
            name: {
                "label": p.label, "lambda": str(p.lam), "budget": str(p.budget), "budget_share": str(p.budget_share),
                "budget_cap": str(p.budget_cap), "min_edge": str(p.min_edge), "k": str(p.k),
                "aqua_margin": str(p.aqua_margin), "max_slippage": str(p.max_slippage),
                "max_position_share": str(p.max_position_share), "ttl_s": TTL_S, "staleness_s": STALENESS_S,
                "requote_move": str(REQUOTE_MOVE),
            }
            for name, p in PROFILES.items()
        }

    @app.post("/demo/seed")
    def post_demo_seed(wallet: str | None = None, profile: str | None = None) -> dict:
        """Evaluate the demo opportunities now under the wallet's profile, store the decisions, return both."""
        return seed_for(wallet, profile)

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
            except (OSError, RuntimeError, ValueError, ArithmeticError) as e:  # pool missing on this chain
                live = {"error": str(e) or type(e).__name__}
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
        unsigned = {k: v for k, v in stored.items() if k != "signature"}
        return {"matches": replayed == unsigned, "decision": replayed}

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
        return health_body()

    def versioned_openapi() -> dict:
        """The published spec (docs/openapi.yaml, /v1/openapi.json): every path under /v1."""
        if app.openapi_schema is None:
            from fastapi.openapi.utils import get_openapi

            spec = get_openapi(title=app.title, version=app.version, description=app.description, routes=app.routes)
            spec["paths"] = {("/v1" + p): v for p, v in spec["paths"].items() if not p.startswith("/riskpilot")}
            spec["servers"] = [{"url": "http://localhost:8000", "description": "make up"}]
            app.openapi_schema = spec
        return app.openapi_schema

    app.openapi = versioned_openapi

    return app
