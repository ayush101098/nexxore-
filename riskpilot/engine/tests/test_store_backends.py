"""The decision log behaves the same on SQLite (local) and Postgres (Neon, the hosted agent).
Postgres runs only when TEST_DATABASE_URL is set; it uses a fresh schema and drops it after.
Use Neon's *direct* connection string here (the pooled one does not accept startup options)."""

import os
import uuid

import pytest

from store import Store, open_store

PG_URL = os.environ.get("TEST_DATABASE_URL", "")


def _pg():
    import psycopg

    schema = "rp_test_" + uuid.uuid4().hex[:8]
    with psycopg.connect(PG_URL, autocommit=True) as c:
        c.execute(f"CREATE SCHEMA {schema}")
    sep = "&" if "?" in PG_URL else "?"
    url = f"{PG_URL}{sep}options=-csearch_path%3D{schema}"
    return url, schema


@pytest.fixture(params=["sqlite", pytest.param("postgres", marks=pytest.mark.skipif(not PG_URL, reason="TEST_DATABASE_URL not set"))])
def store(request):
    if request.param == "sqlite":
        yield Store(":memory:")
        return
    url, schema = _pg()
    s = open_store(url)
    yield s
    import psycopg
    with psycopg.connect(PG_URL, autocommit=True) as c:
        c.execute(f"DROP SCHEMA {schema} CASCADE")


def dec(i, at="2026-11-06T14:00:0{}Z"):
    return {"decision_id": f"dec_{i:016x}", "created_at": at.format(i), "verdict": "APPROVE", "net_edge": "5.71",
            "inputs": {"request": {"size": "10000.00"}, "floats": [0.1, 1e-9]}}


def test_decisions_round_trip_and_order(store):
    for i in range(3):
        store.save_decision(dec(i))
    assert store.get_decision(dec(1)["decision_id"]) == dec(1)  # exact round trip: Replay compares equal
    assert [d["decision_id"] for d in store.list_decisions(2)] == [dec(2)["decision_id"], dec(1)["decision_id"]]
    store.save_decision({**dec(1), "verdict": "REJECT"})  # replace
    assert store.get_decision(dec(1)["decision_id"])["verdict"] == "REJECT"
    assert len(store.list_decisions(10)) == 3
    assert store.get_decision("dec_missing") is None


def test_positions_executions_settlements(store):
    p = {"position_id": "pos_1", "decision_id": "dec_1", "status": "open"}
    store.save_position(p)
    store.save_position({**p, "status": "closed"})
    assert store.position_for_decision("dec_1")["status"] == "closed" and store.open_positions() == []
    store.save_position({"position_id": "pos_2", "decision_id": "dec_2", "status": "open"})
    assert [x["position_id"] for x in store.open_positions()] == ["pos_2"]
    for tx in ("0xa", "0xb"):
        store.save_execution({"tx_hash": tx, "decision_id": "dec_1", "status": "confirmed"})
    store.save_execution({"tx_hash": "0xa", "decision_id": "dec_1", "status": "confirmed", "settlement_tx": "0xs"})
    assert [e["tx_hash"] for e in store.executions_for_decision("dec_1")] == ["0xb", "0xa"]  # a replace moves last
    assert [e["tx_hash"] for e in store.list_executions()] == ["0xa", "0xb"]
    store.save_settlement({"decision_id": "dec_1", "status": "Funded"})
    store.save_settlement({"decision_id": "dec_1", "status": "Settled", "tx": "0xs"})
    assert store.get_settlement("dec_1")["status"] == "Settled" and len(store.list_settlements()) == 1


def test_profiles_and_assistant_log(store):
    w = "0x905aCd442c7B3EF9BfEB0A3189f3686c1Cd0c697"
    assert store.get_profile(w) is None
    store.set_profile(w, "moderate", "2026-11-06T14:00:00Z", "deploy: demo default, not signed")
    store.set_profile(w.upper().replace("0X", "0x"), "conservative", "2026-11-06T15:00:00Z")
    assert store.get_profile(w) == {"wallet": w.lower(), "profile": "conservative", "set_at": "2026-11-06T15:00:00Z", "source": "EIP-191 signature"}
    for n, at in ((1, "2026-11-06T14:00:00Z"), (2, "2026-11-06T15:00:00Z")):
        store.save_assistant({"request_id": f"req-{n}", "wallet": w, "created_at": at, "context_snapshot_id": f"ctx_{n}"},
                             {"wallet": w.lower(), "as_of": at, "worst_stress_loss": "7134.18"})
    assert [r["request_id"] for r in store.assistant_log(w)] == ["req-2", "req-1"]
    assert store.assistant_context("ctx_1")["as_of"] == "2026-11-06T14:00:00Z"
    assert [c["as_of"] for c in store.assistant_contexts_for(w)] == ["2026-11-06T14:00:00Z", "2026-11-06T15:00:00Z"]


def test_open_store_picks_the_backend():
    assert isinstance(open_store(":memory:"), Store)
