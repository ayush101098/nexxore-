"""End-to-end through the HTTP API: scan -> evaluate -> execute, plus /aqua/price and /stress."""

import json
import math
from datetime import datetime, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from api import create_app
from schemas import validate
from store import Store

AS_OF = datetime(2026, 11, 6, 9, 30, tzinfo=timezone.utc)
FIXTURES = Path(__file__).parent / "fixtures"
TX = "0x" + "ab" * 32


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app(Store(":memory:"), clock=lambda: AS_OF))


def fixture_request(name: str) -> dict:
    return json.loads((FIXTURES / f"{name}.json").read_text())["request"]


def test_scan_emits_gaps_above_threshold(client):
    opps = client.post("/scan", json={"sources": ["recorded"]}).json()
    for o in opps:
        validate("opportunity", o)
    # chainlink is the reference; the static pool's 1.8 bps gap is under the 5 bps default.
    # aqua_router (ETH-only upside curve) quotes above reference, but selling ETH to it needs
    # USDC it does not hold, so the quote cap drops it.
    assert sorted(o["source_venue"] for o in opps) == ["aqua_router_put", "uniswap_v4_hooked"]


def test_scan_caps_aqua_quotes_at_the_curves_real_balance(client):
    opps = {o["source_venue"]: o for o in client.post("/scan", json={"size": "10000.00"}).json()}
    # The put-like curve bids above reference and holds 3,241.77 USDC: that is all it can pay.
    assert opps["aqua_router_put"]["size"] == "3241.77"
    assert opps["uniswap_v4_hooked"]["size"] == "10000.00"  # no balances reported -> uncapped


def test_scan_is_deterministic(client):
    first = client.post("/scan", json={}).json()
    assert client.post("/scan", json={}).json() == first


def test_unwired_live_source_is_501(client):
    r = client.post("/scan", json={"sources": ["uniswap_api"]})
    assert r.status_code == 501 and "TODO" in r.json()["detail"]


def test_decision_id_traces_from_opportunity_to_settlement(client):
    opp = next(o for o in client.post("/scan", json={}).json() if o["source_venue"] == "uniswap_v4_hooked")
    # Market comes from the recorded source; the book from the (empty) store.
    decision = client.post("/evaluate", json={"opportunity": opp}).json()
    assert decision["verdict"] == "APPROVE", decision["reason"]
    assert decision["opportunity_id"] == opp["opportunity_id"]
    assert client.get(f"/decisions/{decision['decision_id']}").json() == decision
    assert client.get("/decisions").json()[0]["decision_id"] == decision["decision_id"]

    execution = {
        "decision_id": decision["decision_id"],
        "chain_id": 1301,
        "tx_hash": TX,
        "status": "confirmed",
        "verified_at": "2026-11-06T09:30:12Z",
        "settlement_tx": None,
    }
    position = client.post("/executions", json=execution).json()
    validate("position", position)
    assert position["decision_id"] == decision["decision_id"]
    assert position["status"] == "open"
    assert position["greeks"] == decision["inputs"]["proposed_position"]["greeks"]

    # The open position now sits in the book for the next decision.
    again = client.post("/evaluate", json={"opportunity": opp, "as_of": "2026-11-06T09:30:01Z"}).json()
    assert again["inputs"]["request"]["book"] == [position]


def test_execution_against_a_rejected_decision_is_409(client):
    decision = client.post("/evaluate", json=fixture_request("reject")).json()
    r = client.post(
        "/executions",
        json={"decision_id": decision["decision_id"], "chain_id": 1301, "tx_hash": TX,
              "status": "confirmed", "verified_at": None, "settlement_tx": None},
    )
    assert r.status_code == 409


def test_evaluate_rejects_a_malformed_opportunity(client):
    body = fixture_request("approve")
    body["opportunity"]["pair"] = "BTC/USDC"
    assert client.post("/evaluate", json=body).status_code == 422


def _bs(S, K, T, v, call):
    n = lambda x: 0.5 * math.erfc(-x / math.sqrt(2))
    d1 = (math.log(S / K) + 0.5 * v * v * T) / (v * math.sqrt(T))
    d2 = d1 - v * math.sqrt(T)
    return S * n(d1) - K * n(d2) if call else K * n(-d2) - S * n(-d1)


@pytest.mark.parametrize("side, low, high", [("call_like", 3400, 3600), ("put_like", 3100, 3300)])
def test_aqua_price_matches_black_scholes_at_k_eq_t_eq(client, side, low, high):
    spot, size, vol = 3386, 2.0, 0.65
    r = client.post(
        "/aqua/price",
        json={"spot": str(spot), "range_low": str(low), "range_high": str(high),
              "side": side, "size": str(size), "volatility": str(vol)},
    ).json()
    k = math.sqrt(low * high)
    ratio = math.sqrt(high / low)
    t = 2 * math.pi / vol**2 * ((math.sqrt(ratio) - 1) / (math.sqrt(ratio) + 1)) ** 2
    assert float(r["equivalent_strike"]) == pytest.approx(k, rel=0.01)
    assert float(r["equivalent_term_years"]) == pytest.approx(t, rel=0.01)
    assert float(r["equivalent_premium"]) == pytest.approx(size * _bs(spot, k, t, vol, side == "call_like"), rel=0.01)
    assert "not an option contract" in r["label"]


def test_aqua_price_rejects_range_on_wrong_side(client):
    r = client.post(
        "/aqua/price",
        json={"spot": "3386", "range_low": "3000", "range_high": "3500",
              "side": "put_like", "size": "1", "volatility": "0.65"},
    )
    assert r.status_code == 422


def test_stress_endpoint(client):
    book = fixture_request("approve")["book"]
    r = client.post("/stress", json={"positions": book, "spot": "3386"}).json()
    assert len(r["scenarios"]) == 14
    assert r["worst_loss"] == "27.09"
    assert r["worst_scenario"]["spot_shock"] == "-0.40"


def test_aqua_price_reports_the_premium_floor_for_the_demo_curve(client):
    r = client.post(
        "/aqua/price",
        json={"spot": "3400", "range_low": "3400", "range_high": "4335",
              "side": "call_like", "size": "1", "volatility": "0.55"},
    ).json()
    assert r["equivalent_strike"] == "3839.14"
    assert float(r["equivalent_term_days"]) == pytest.approx(6.99, abs=0.01)
    floor = r["premium_floor"]
    assert float(floor["c_eq_per_eth"]) == pytest.approx(6.44, abs=0.01)
    assert float(floor["f_min"]) == pytest.approx(0.002014, rel=0.001)
    # SwapVM flat fee in 1e9 units, rounded up so the fee never falls below f_min.
    assert floor["fee_instruction_min"] == "2013952"


def test_evaluate_reads_holdings_for_a_wallet():
    from models import Holdings

    wallets = []

    def reader(wallet):
        wallets.append(wallet)
        return Holdings(weth="1.0", usdc="0")

    client = TestClient(create_app(Store(":memory:"), clock=lambda: AS_OF, holdings_reader=reader))
    body = json.loads((FIXTURES / "aqua_upside_held_eth.json").read_text())["request"]
    body.pop("holdings")
    body["wallet"] = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
    decision = client.post("/evaluate", json=body).json()
    assert wallets == [body["wallet"]]
    assert decision["inputs"]["request"]["holdings"] == {"weth": "1.0", "usdc": "0"}
    assert decision["risk_charge"] == "0.00"
