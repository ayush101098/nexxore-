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
MAKER = "0x905aCd442c7B3EF9BfEB0A3189f3686c1Cd0c697"  # the demo wallet: the owner's address

# What `make demo-chain` writes for the demo curves (DemoParams: spot 2,218.55, w = 1.275,
# a 7 ETH call-like curve and 1 ETH of USDC put-like, fees at f_min).
CURVES = {
    "maker": MAKER,
    "spot_usdc": 2218550000,
    "upside": {"side": "call_like", "range_low_usdc": 2218550000, "range_high_usdc": 2828651250,
               "fee_instruction": 2013952, "weth_amount": 7 * 10**18, "usdc_amount": 0},
    "downside": {"side": "put_like", "range_low_usdc": 1740039215, "range_high_usdc": 2218550000,
                 "fee_instruction": 2274072, "weth_amount": 0, "usdc_amount": 1964780000},
}


@pytest.fixture(autouse=True)
def curves_file(tmp_path, monkeypatch):
    (tmp_path / "curves.json").write_text(json.dumps(CURVES))
    monkeypatch.setattr(demo, "DEMO_DIR", tmp_path)


CHAIN = {"block": 26354383, "base_fee_gwei": Decimal("0.000000007"), "tip_gwei": Decimal("0.000089"), "eth": Decimal("992")}


def client(holdings=None, gas=None, spot=None, gap=None, chain=CHAIN, clock=lambda: NOW) -> TestClient:
    def down(value):
        def read(*_):
            if value is None:
                raise OSError("connection refused")
            return value
        return read

    app = create_app(
        Store(":memory:"), clock=clock, holdings_reader=down(holdings), gas_reader=down(gas),
        spot_reader=down(spot), gap_reader=down(gap), chain_reader=down(chain),
    )
    return TestClient(app)


def test_seed_gives_reject_reject_approve_from_chain_holdings():
    c = client(holdings=Holdings(weth="8", usdc="5000"), gas=Decimal("0.0875"), spot=Decimal("2218.55"))
    body = c.post("/demo/seed?profile=moderate").json()
    assert body["wallet"] == MAKER
    assert body["sources"]["holdings"] == "demo chain"
    assert body["sources"]["spot"].startswith("demo chain")
    assert body["sources"]["price_gap"].startswith("recorded fixture")  # no live pool in this test
    verdicts = [i["decision"]["verdict"] for i in body["items"]]
    assert verdicts == ["REJECT", "REJECT", "APPROVE"]
    for item in body["items"]:
        validate("opportunity", item["opportunity"])
        validate("decision", item["decision"])
        # Re-stamped to now, so nothing is stale.
        assert item["decision"]["created_at"] == "2026-11-06T14:00:00Z"
    call = body["items"][2]["decision"]
    assert call["risk_charge"] == "0.00"
    assert "worst stress loss falls from" in call["reason"]
    assert call["inputs"]["prices"]["mid"] == "2218.55", "curves priced at the fork's spot"
    assert call["inputs"]["aqua"]["range_high"] == "2828.65125"
    assert call["inputs"]["request"]["holdings"] == {"weth": "8", "usdc": "5000"}
    put = body["items"][1]["decision"]
    assert put["inputs"]["aqua"]["range_low"] == "1740.039215"
    assert put["reason"].startswith("Rejected: adds $629.93 worst-case loss; limit $250 (")
    assert len(call["inputs"]["stress_grid"]) == 14
    # Seeded decisions land in history.
    assert len(c.get("/decisions").json()) == 3


def test_seed_without_the_chain_reports_sources_unavailable():
    body = client(chain=None).post("/demo/seed?profile=moderate").json()
    assert body["holdings"] is None
    assert body["sources"]["holdings"].startswith("unavailable")
    assert body["sources"]["gas"].startswith("unavailable")
    # Falls back to the declared inputs, and says so in the decision's sources.
    assert body["sources"]["spot"] == "demo/curves.json (DemoParams.SPOT)"
    call = body["items"][2]["decision"]
    assert call["inputs"]["request"]["holdings"] == {"weth": "7", "usdc": "0"}
    assert call["verdict"] == "APPROVE"


def test_replay_reproduces_the_stored_decision():
    c = client(holdings=Holdings(weth="8", usdc="5000"), gas=Decimal("0.0875"), spot=Decimal("2218.55"))
    decision = c.post("/demo/seed?profile=moderate").json()["items"][1]["decision"]
    replay = c.post(f"/decisions/{decision['decision_id']}/replay").json()
    assert replay["matches"] is True
    assert replay["decision"] == {k: v for k, v in decision.items() if k != "signature"}


def test_profiles_and_demo_info():
    c = client()
    moderate = c.get("/profiles").json()["moderate"]
    assert {k: moderate[k] for k in ("lambda", "budget", "min_edge", "k")} == {"lambda": "0.5", "budget": "250.00", "min_edge": "5.00", "k": "2"}
    assert (moderate["label"], moderate["budget_share"], moderate["aqua_margin"], moderate["max_slippage"]) == ("Moderate", "0.025", "0.20", "0.0050")
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


def test_settlement_payout_needs_an_executed_approve():
    c = client(holdings=Holdings(weth="8", usdc="5000"), gas=Decimal("0.0875"), spot=Decimal("2218.55"))
    items = c.post("/demo/seed?profile=moderate").json()["items"]
    approved, rejected = items[2]["decision"], items[1]["decision"]
    assert c.get(f"/decisions/{rejected['decision_id']}/settlement?amount=10").status_code == 409
    assert c.get(f"/decisions/{approved['decision_id']}/settlement?amount=10").status_code == 409  # not executed

    tx = "0x" + "cd" * 32
    c.post("/executions", json={"decision_id": approved["decision_id"], "chain_id": 31337, "tx_hash": tx,
                                "status": "confirmed", "verified_at": "2026-11-06T14:00:05Z", "settlement_tx": None})
    s = c.get(f"/decisions/{approved['decision_id']}/settlement?amount=10").json()
    expected = Decimal(10) * (1 + Decimal(approved["net_edge"]) / Decimal(approved["inputs"]["request"]["size"]))
    assert Decimal(s["payout"]) == expected.quantize(Decimal("0.000001"))
    assert s["execution_tx"] == tx

    settle_tx = "0x" + "ef" * 32
    e = c.post(f"/decisions/{approved['decision_id']}/settlement", json={"settlement_tx": settle_tx}).json()
    assert e["settlement_tx"] == settle_tx and e["tx_hash"] == tx


def test_seed_uses_the_live_hooked_pool_when_it_is_up():
    gap_opp = {"opportunity_id": "opp_live", "type": "price_gap", "pair": "ETH/USDC", "source_venue": "uniswap_v4_hooked",
               "target": "v4_swap", "observed_price": "2229.27", "reference_price": "2218.55", "size": "10000.00",
               "observed_at": "2026-11-06T14:00:00Z", "source": "demo chain StateView:hooked"}
    market = {"quote": {"price": "2203.82", "mid": "2229.27", "quoted_at": "2026-11-06T14:00:00Z",
                        "expires_at": "2026-11-06T14:00:20Z", "latency_seconds": "2", "source": "demo chain V4Quoter"},
              "liquidity": "10000", "gas": {"units": "67432", "price_gwei": "1.0", "observed_at": "2026-11-06T14:00:00Z",
                                            "source": "demo chain eth_gasPrice"},
              "fee_rate": "0.01", "volatility": {"annualized": "4.0", "observed_at": "2026-11-06T14:00:00Z", "source": "hook.getVolatility"},
              "hedge": {"ratio": "1", "cost": "5.00"}}
    static = {**gap_opp, "opportunity_id": "opp_static", "source_venue": "uniswap_v4_static"}
    gaps = [("hooked v4 pool", gap_opp, market), ("static 0.30% v4 pool", static, {**market, "fee_rate": "0.003"})]
    c = client(holdings=Holdings(weth="8", usdc="5000"), gas=Decimal("1"), spot=Decimal("2218.55"), gap=gaps)
    body = c.post("/demo/seed?profile=moderate").json()
    assert body["sources"]["price_gap"] == "demo chain: 2 v4 pools via StateView and V4Quoter"
    labels = [i["label"] for i in body["items"]]
    assert labels[:2] == ["Price gap · hooked v4 pool", "Price gap · static 0.30% v4 pool"]
    hooked, flat = body["items"][0]["decision"], body["items"][1]["decision"]
    assert hooked["opportunity_id"] == "opp_live"
    assert hooked["costs"]["fees"] == "100.00", "the hook's 1% fee on $10,000"
    assert flat["costs"]["fees"] == "30.00", "the static pool's 0.30% on $10,000"
    assert hooked["verdict"] == "REJECT"
