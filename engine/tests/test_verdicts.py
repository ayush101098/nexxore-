"""Verdict fixtures (one per verdict) and the rule order from PRD 2."""

import copy
import json
from decimal import Decimal
from pathlib import Path

import pytest

from decision import generate_execution_decision
from models import EvaluateRequest
from schemas import validate

FIXTURES = Path(__file__).parent / "fixtures"


def load(name: str) -> dict:
    return json.loads((FIXTURES / f"{name}.json").read_text())


def decide(request: dict) -> dict:
    return generate_execution_decision(EvaluateRequest.model_validate(request))


@pytest.mark.parametrize("name", ["approve", "reject", "requote", "require_review"])
def test_fixture_verdict_and_reason(name):
    fixture = load(name)
    decision = decide(fixture["request"])
    validate("decision", decision)
    assert decision["verdict"] == fixture["expected"]["verdict"]
    assert decision["reason"] == fixture["expected"]["reason"]


@pytest.mark.parametrize("name", ["approve", "reject"])
def test_net_edge_itemizes_every_cost_line(name):
    decision = decide(load(name)["request"])
    assert set(decision["costs"]) == {"gas", "slippage", "fees", "hedge"}
    itemized = (
        Decimal(decision["gross_edge"])
        - sum(Decimal(v) for v in decision["costs"].values())
        - Decimal(decision["risk_charge"])
    )
    assert Decimal(decision["net_edge"]) == itemized


def test_approve_expires_30s_ahead_and_others_expire_immediately():
    approved = decide(load("approve")["request"])
    assert approved["created_at"] == "2026-11-06T09:30:00Z"
    assert approved["expires_at"] == "2026-11-06T09:30:30Z"
    rejected = decide(load("reject")["request"])
    assert rejected["expires_at"] == rejected["created_at"]


def test_same_input_same_output_across_100_runs():
    request = load("approve")["request"]
    outputs = {json.dumps(decide(request), sort_keys=True) for _ in range(100)}
    assert len(outputs) == 1


def test_inputs_are_enough_to_replay():
    decision = decide(load("reject")["request"])
    assert decide(decision["inputs"]["request"]) == decision


def _approve_with(mutate) -> dict:
    request = copy.deepcopy(load("approve")["request"])
    mutate(request)
    return decide(request)


@pytest.mark.parametrize(
    "mutate, verdict, reason",
    [
        (
            lambda r: r["opportunity"].update(observed_price="0.50"),
            "REQUIRE_REVIEW",
            "Review: observed_price 0.50 outside sanity bounds [100, 100000]",
        ),
        (
            lambda r: r["market"]["quote"].update(expires_at="2026-11-06T09:29:55Z"),
            "REQUOTE",
            "Requote: quote expired 5 s ago",
        ),
        (
            lambda r: r["market"].update(liquidity="8000.00"),
            "REJECT",
            "Rejected: liquidity $8,000.00 below size $10,000.00",
        ),
        (
            lambda r: r.update(gas_budget="0.50"),
            "REJECT",
            "Rejected: gas $0.91 above $0.50 budget",
        ),
        (
            lambda r: r["market"].update(hedge={"ratio": "0", "cost": "0"}),
            "REJECT",
            "Rejected: post-trade stress loss $4,027.09 above $250.00 budget",
        ),
    ],
)
def test_each_rule(mutate, verdict, reason):
    decision = _approve_with(mutate)
    assert (decision["verdict"], decision["reason"]) == (verdict, reason)


def test_rules_fire_in_order():
    # Stale input (rule 1) wins over a moved price (rule 2) and thin liquidity (rule 3).
    def mutate(r):
        r["market"]["volatility"]["observed_at"] = "2026-11-06T09:29:15Z"
        r["market"]["quote"]["mid"] = "3397.00"
        r["market"]["liquidity"] = "100.00"

    assert _approve_with(mutate)["verdict"] == "REQUIRE_REVIEW"


def test_conservative_profile_is_stricter():
    request = copy.deepcopy(load("approve")["request"])
    request["profile"] = "conservative"
    decision = decide(request)
    assert decision["budget"] == "150.00"
    # λ = 1.0 doubles the risk charge on the same $20.00 stress increase.
    assert decision["risk_charge"] == "20.00"
