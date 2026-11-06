"""The /riskpilot page's endpoints: demo seed, replay, profiles, CORS."""

import json
from datetime import datetime, timezone
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

import demo
from api import create_app
from models import Holdings
from schemas import validate
from store import Store

NOW = datetime(2026, 11, 6, 14, 0, tzinfo=timezone.utc)
MAKER = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"

# What `make demo-chain` writes for the demo curves (DemoParams: w = 1.275, 5 ETH call, f_min fees).
CURVES = {
    "maker": MAKER,
    "upside": {"side": "call_like", "range_low_usdc": 3400000000, "range_high_usdc": 4335000000,
               "fee_instruction": 2013952, "weth_amount": 5 * 10**18, "usdc_amount": 0},
    "downside": {"side": "put_like", "range_low_usdc": 2666666666, "range_high_usdc": 3400000000,
                 "fee_instruction": 2274072, "weth_amount": 0, "usdc_amount": 3011090000},
}


@pytest.fixture(autouse=True)
def curves_file(tmp_path, monkeypatch):
    (tmp_path / "curves.json").write_text(json.dumps(CURVES))
    monkeypatch.setattr(demo, "DEMO_DIR", tmp_path)


def client(holdings=None, gas=None) -> TestClient:
    def read_holdings(wallet):
        if holdings is None:
            raise OSError("connection refused")
        return holdings

    def read_gas():
        if gas is None:
            raise OSError("connection refused")
        return gas

    app = create_app(Store(":memory:"), clock=lambda: NOW, holdings_reader=read_holdings, gas_reader=read_gas)
    return TestClient(app)


def test_seed_gives_reject_reject_approve_from_chain_holdings():
    c = client(holdings=Holdings(weth="6", usdc="5000"), gas=Decimal("0.0875"))
    body = c.post("/demo/seed").json()
    assert body["wallet"] == MAKER
    assert body["sources"] == {"curves": "demo/curves.json", "holdings": "demo chain", "gas": "demo chain eth_gasPrice"}
    verdicts = [i["decision"]["verdict"] for i in body["items"]]
    assert verdicts == ["REJECT", "REJECT", "APPROVE"]
    for item in body["items"]:
        validate("opportunity", item["opportunity"])
        validate("decision", item["decision"])
        # Re-stamped to now, so nothing is stale.
        assert item["decision"]["created_at"] == "2026-11-06T14:00:00Z"
    call = body["items"][2]["decision"]
    assert call["risk_charge"] == "0.00"
    assert call["reason"].endswith("worst stress loss falls from $8,160.00 to $8,127.78")
    put = body["items"][1]["decision"]
    assert put["reason"].endswith("(+$965.39 from this trade)")
    assert call["inputs"]["aqua"]["range_high"] == "4335"
    assert call["inputs"]["request"]["holdings"] == {"weth": "6", "usdc": "5000"}
    assert len(call["inputs"]["stress_grid"]) == 14
    # Seeded decisions land in history.
    assert len(c.get("/decisions").json()) == 3


def test_seed_without_the_chain_reports_sources_unavailable():
    body = client().post("/demo/seed").json()
    assert body["holdings"] is None
    assert body["sources"]["holdings"].startswith("unavailable")
    assert body["sources"]["gas"].startswith("unavailable")
    # Falls back to the declared inputs, and says so in the decision's sources.
    call = body["items"][2]["decision"]
    assert call["inputs"]["request"]["holdings"] == {"weth": "5", "usdc": "0"}
    assert call["verdict"] == "APPROVE"


def test_replay_reproduces_the_stored_decision():
    c = client(holdings=Holdings(weth="6", usdc="5000"), gas=Decimal("0.0875"))
    decision = c.post("/demo/seed").json()["items"][1]["decision"]
    replay = c.post(f"/decisions/{decision['decision_id']}/replay").json()
    assert replay["matches"] is True
    assert replay["decision"] == decision


def test_profiles_and_demo_info():
    c = client()
    assert c.get("/profiles").json()["balanced"] == {"lambda": "0.5", "budget": "250.00", "min_edge": "5.00", "k": "2"}
    assert c.get("/demo/info").json()["upside"]["fee_instruction"] == 2013952


def test_cors_allows_the_site_and_localhost_with_private_network_access():
    c = client()
    for origin in ("https://nexxore.xyz", "http://localhost:5173"):
        r = c.options(
            "/demo/seed",
            headers={
                "Origin": origin,
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Private-Network": "true",
            },
        )
        assert r.headers["access-control-allow-origin"] == origin
        assert r.headers["access-control-allow-private-network"] == "true"
    r = c.get("/profiles", headers={"Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in r.headers
