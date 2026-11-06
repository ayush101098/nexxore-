"""generate_execution_decision: a resolved EvaluateRequest -> Decision.

Deterministic: no clock reads and no randomness. The caller supplies as_of,
and decision_id is a hash of the whole request, so the same request always
gives the same Decision. Decision.inputs.request replays it.

E_net = q (P_exit - P_entry) - C_gas - C_slip - C_fees - C_hedge
        - lambda * max(0, L_after - L_before)
"""

import hashlib
import json
import math
from datetime import datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal

from models import EvaluateRequest
from profiles import PROFILES
from schemas import validate
from stress import run_stress_test

MODEL_VERSION = "engine-0.1.0"
MAX_INPUT_AGE_S = 30
MAX_CLOCK_SKEW_S = 5
DECISION_TTL_S = 30
SECONDS_PER_YEAR = 365 * 24 * 3600

# Inputs outside these bounds are treated as a bad feed, not a trade signal.
SANITY = {
    "observed_price": (Decimal(100), Decimal(100000)),
    "reference_price": (Decimal(100), Decimal(100000)),
    "quote_mid": (Decimal(100), Decimal(100000)),
    "quote_price": (Decimal(100), Decimal(100000)),
    "volatility": (Decimal("0.05"), Decimal(5)),
    "gas_price_gwei": (Decimal(0), Decimal(5000)),
    "gas_units": (Decimal(0), Decimal(10_000_000)),
    "fee_rate": (Decimal(0), Decimal("0.05")),
    "hedge_ratio": (Decimal(0), Decimal(1)),
    "latency_seconds": (Decimal(0), Decimal(MAX_INPUT_AGE_S)),
    "size": (Decimal("0.01"), Decimal(10_000_000)),
    "gap": (Decimal(0), Decimal("0.10")),  # |reference - observed| / reference
}


def usd(x) -> Decimal:
    return Decimal(str(x)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def fmt_usd(d: Decimal) -> str:
    return f"{'-' if d < 0 else ''}${abs(d):,.2f}"


def iso(dt: datetime) -> str:
    return dt.isoformat().replace("+00:00", "Z")


def _seconds(delta: timedelta) -> str:
    return f"{delta.total_seconds():g}"


def _decision_id(req: EvaluateRequest) -> str:
    canonical = json.dumps([MODEL_VERSION, req.model_dump(mode="json")], sort_keys=True, separators=(",", ":"))
    return "dec_" + hashlib.sha256(canonical.encode()).hexdigest()[:16]


def _sanity_failure(req: EvaluateRequest) -> str | None:
    opp, m = req.opportunity, req.market
    observed, reference = Decimal(opp["observed_price"]), Decimal(opp["reference_price"])
    values = {
        "observed_price": observed,
        "reference_price": reference,
        "quote_mid": m.quote.mid,
        "quote_price": m.quote.price,
        "volatility": m.volatility.annualized,
        "gas_price_gwei": m.gas.price_gwei,
        "gas_units": m.gas.units,
        "fee_rate": m.fee_rate,
        "hedge_ratio": m.hedge.ratio,
        "latency_seconds": m.quote.latency_seconds,
        "size": req.size,
    }
    for name, value in values.items():
        lo, hi = SANITY[name]
        if not lo <= value <= hi:
            return f"Review: {name} {value} outside sanity bounds [{lo}, {hi}]"
    gap = abs(reference - observed) / reference
    if gap > SANITY["gap"][1]:
        return f"Review: {gap:.2%} gap between observed and reference looks like a bad feed"
    return None


def _timestamps(req: EvaluateRequest) -> dict[str, datetime]:
    m = req.market
    return {
        "opportunity": datetime.fromisoformat(req.opportunity["observed_at"]),
        "quote": m.quote.quoted_at,
        "gas": m.gas.observed_at,
        "volatility": m.volatility.observed_at,
    }


def _staleness_failure(req: EvaluateRequest) -> str | None:
    ages = {name: req.as_of - ts for name, ts in _timestamps(req).items()}
    for name, age in ages.items():
        if age < timedelta(seconds=-MAX_CLOCK_SKEW_S):
            return f"Review: {name} input is {_seconds(-age)} s in the future"
    name, age = max(ages.items(), key=lambda kv: kv[1])
    if age > timedelta(seconds=MAX_INPUT_AGE_S):
        return f"Review: {name} input is {_seconds(age)} s old (limit {MAX_INPUT_AGE_S} s)"
    return None


def _proposed_position(req: EvaluateRequest, trade_delta: float) -> dict:
    """The exposure this trade leaves after its hedge leg: spot delta on the v4 pool."""
    residual = trade_delta * (1 - float(req.market.hedge.ratio))
    return {
        "primitive": "v4_swap",
        "params": {"trade_eth": f"{trade_delta:.6f}", "hedge_ratio": str(req.market.hedge.ratio)},
        "collateral": str(usd(req.size)),
        "entry": {"price": str(req.market.quote.price), "at": iso(req.as_of)},
        "greeks": {"delta": f"{residual:.6f}", "gamma": "0", "vega": "0", "theta": "0"},
    }


def generate_execution_decision(req: EvaluateRequest) -> dict:
    opp, m, profile = req.opportunity, req.market, PROFILES[req.profile]
    reference = Decimal(opp["reference_price"])
    mid = m.quote.mid
    zero = usd(0)
    gross, costs, risk_charge, hurdle = zero, dict.fromkeys(["gas", "slippage", "fees", "hedge"], zero), zero, zero
    loss_before = loss_after = uncertainty = zero
    proposed = None

    verdict, reason = None, _sanity_failure(req)
    if reason:
        verdict = "REQUIRE_REVIEW"
    else:
        q = float(req.size / mid)  # ETH
        side = 1 if mid < reference else -1  # buy ETH below fair value, sell above
        gross = usd(q * float(abs(reference - mid)))
        costs = {
            "gas": usd(float(m.gas.units * m.gas.price_gwei) * 1e-9 * float(mid)),
            "slippage": usd(abs(float(m.quote.price - mid)) * q),
            "fees": usd(m.fee_rate * req.size),
            "hedge": usd(m.hedge.cost),
        }
        proposed = _proposed_position(req, side * q)
        loss_before = usd(run_stress_test(req.book, spot=float(mid))["worst_loss"])
        loss_after = usd(run_stress_test(req.book + [proposed], spot=float(mid))["worst_loss"])
        risk_charge = usd(profile.lam * max(zero, loss_after - loss_before))
        latency_years = float(m.quote.latency_seconds) / SECONDS_PER_YEAR
        uncertainty = usd(float(mid) * float(m.volatility.annualized) * math.sqrt(latency_years) * q)
        hurdle = max(profile.min_edge, usd(profile.k * uncertainty))

    net = gross - sum(costs.values()) - risk_charge

    if verdict is None:
        verdict, reason = _verdict(req, gross, costs, risk_charge, net, hurdle, loss_after, profile.budget)

    expires = req.as_of + timedelta(seconds=DECISION_TTL_S) if verdict == "APPROVE" else req.as_of
    decision = {
        "decision_id": _decision_id(req),
        "opportunity_id": opp["opportunity_id"],
        "verdict": verdict,
        "gross_edge": str(gross),
        "costs": {k: str(v) for k, v in costs.items()},
        "risk_charge": str(risk_charge),
        "net_edge": str(net),
        "stress_loss_before": str(loss_before),
        "stress_loss_after": str(loss_after),
        "budget": str(profile.budget),
        "reason": reason,
        "inputs": {
            "prices": {
                "observed": opp["observed_price"],
                "reference": opp["reference_price"],
                "mid": str(mid),
                "quote": str(m.quote.price),
            },
            "sources": {
                "opportunity": opp["source"],
                "quote": m.quote.source,
                "gas": m.gas.source,
                "volatility": m.volatility.source,
            },
            "timestamps": {"as_of": iso(req.as_of)} | {k: iso(v) for k, v in _timestamps(req).items()},
            "volatility": str(m.volatility.annualized),
            "uncertainty": str(uncertainty),
            "hurdle": str(hurdle),
            "proposed_position": proposed,
            "request": req.model_dump(mode="json"),
        },
        "model_version": MODEL_VERSION,
        "created_at": iso(req.as_of),
        "expires_at": iso(expires),
    }
    validate("decision", decision)
    return decision


def _verdict(req, gross, costs, risk_charge, net, hurdle, loss_after, budget) -> tuple[str, str]:
    m = req.market
    # 1. stale inputs (sanity bounds were checked before pricing)
    if reason := _staleness_failure(req):
        return "REQUIRE_REVIEW", reason
    # 2. expired quote or price moved past tolerance
    if req.as_of > m.quote.expires_at:
        return "REQUOTE", f"Requote: quote expired {_seconds(req.as_of - m.quote.expires_at)} s ago"
    observed = Decimal(req.opportunity["observed_price"])
    move = abs(m.quote.mid - observed) / observed
    if move > req.tolerance:
        return "REQUOTE", f"Requote: price moved {move:.2%} since observation (tolerance {req.tolerance:.2%})"
    # 3. liquidity and gas
    if m.liquidity < req.size:
        return "REJECT", f"Rejected: liquidity {fmt_usd(m.liquidity)} below size {fmt_usd(req.size)}"
    if costs["gas"] > req.gas_budget:
        return "REJECT", f"Rejected: gas {fmt_usd(costs['gas'])} above {fmt_usd(req.gas_budget)} budget"
    # 4. post-trade stress
    if loss_after > budget:
        return "REJECT", f"Rejected: post-trade stress loss {fmt_usd(loss_after)} above {fmt_usd(budget)} budget"
    # 5. net edge
    if net < hurdle:
        items = [f"{fmt_usd(gross)} gap"] + [f"{fmt_usd(v)} {k}" for k, v in costs.items() if v]
        if risk_charge:
            items.append(f"{fmt_usd(risk_charge)} risk charge")
        return "REJECT", f"Rejected: net edge {fmt_usd(net)} below {fmt_usd(hurdle)} hurdle ({', '.join(items)})"
    # 6. approve
    return (
        "APPROVE",
        f"Approved: net edge {fmt_usd(net)} clears {fmt_usd(hurdle)} hurdle; "
        f"stress loss {fmt_usd(loss_after)} within {fmt_usd(budget)} budget",
    )
