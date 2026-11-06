"""Sections 5 and 6: EIP-712 signatures, build, idempotent executions, /v1, the arc-worker."""

from datetime import timedelta
from decimal import Decimal

import build
from arc_worker import ArcWorker, decision_key, payout_units
from signing import EngineKey
from store import Store
from tests.test_demo import MAKER, NOW, client
from tests.test_profiles import HELD

TX = "0x" + "ab" * 32


def call_like(c):
    return next(i["decision"] for i in c.post("/v1/demo/seed?profile=moderate").json()["items"] if i["label"].startswith("Call-like"))


def test_decisions_are_signed_and_tampering_breaks_the_signature():
    c = client(**HELD)
    d = call_like(c)
    key = c.app.state.key
    assert d["signature"]["signer"] == key.address and d["signature"]["message"]["wallet"] == MAKER
    assert key.verify(d)
    assert not key.verify({**d, "verdict": "REJECT"})
    assert not EngineKey().verify(d)  # another engine's key


def test_build_returns_calls_for_a_live_signed_approve(monkeypatch):
    monkeypatch.setattr(build, "_allowance", lambda *a: 0)
    c = client(**HELD)
    d = call_like(c)
    body = c.post(f"/v1/decisions/{d['decision_id']}/build").json()
    assert [x["label"] for x in body["calls"]] == ["approve WETH for Aqua", "ship curve"]
    assert body["calls"][0]["data"].startswith("0x095ea7b3")  # approve(address,uint256), exact amount
    assert int(body["calls"][0]["data"][-64:], 16) == 7 * 10**18


def test_build_refuses_rejects_expired_tampered_and_old_profile(monkeypatch):
    monkeypatch.setattr(build, "_allowance", lambda *a: 0)
    t = [NOW]
    c = client(**HELD, clock=lambda: t[0])
    items = c.post("/v1/demo/seed?profile=moderate").json()["items"]
    put = next(i["decision"] for i in items if i["label"].startswith("Put-like"))
    call = next(i["decision"] for i in items if i["label"].startswith("Call-like"))
    assert c.post(f"/v1/decisions/{put['decision_id']}/build").status_code == 409  # REJECT
    assert c.post(f"/v1/decisions/{call['decision_id']}/build").status_code == 200
    store = c.app.state.store
    store.save_decision({**call, "signature": {**call["signature"], "signature": "0x" + "00" * 65}})
    r = c.post(f"/v1/decisions/{call['decision_id']}/build")
    assert r.status_code == 409 and "signature does not verify" in r.json()["detail"]
    store.save_decision(call)
    t[0] = NOW + timedelta(seconds=31)
    r = c.post(f"/v1/decisions/{call['decision_id']}/build")
    assert r.status_code == 409 and "expired" in r.json()["detail"]


def test_executions_are_idempotent():
    c = client(**HELD)
    d = call_like(c)
    ex = {"decision_id": d["decision_id"], "chain_id": 31337, "tx_hash": TX, "status": "confirmed",
          "verified_at": "2026-11-06T14:00:05Z", "settlement_tx": None}
    first = c.post("/v1/executions", json=ex).json()
    second = c.post("/v1/executions", json=ex).json()
    assert first == second
    assert len(c.get("/v1/executions").json()) == 1


def test_v1_and_legacy_routes_and_metrics():
    c = client(**HELD)
    assert c.get("/v1/health").json()["engine_signer"] == c.get("/health").json()["engine_signer"]
    assert "/v1/stream" in c.get("/v1/openapi.json").json()["paths"]
    c.get("/v1/profiles")
    assert c.get("/v1/metrics").json()["GET /profiles"]["count"] >= 1


# ── arc-worker ──────────────────────────────────────────────────────────────

class FakeArc:
    """Escrow on a fake chain: one Funded log, deposits() status, settle() sends."""

    def __init__(self, key, status=1, fail=0):
        self.key, self.status, self.fail, self.sent = key, status, fail, 0

    def __call__(self, method, params):
        if method == "eth_blockNumber":
            return "0x10"
        if method == "eth_getLogs":
            return [{"topics": ["0x", self.key], "data": hex(5_000_000), "transactionHash": "0xfund"}]
        if method == "eth_call":
            word = lambda v: hex(v)[2:].rjust(64, "0")
            return "0x" + word(int(MAKER, 16)) + word(1) + word(5_000_000) + word(self.status)
        if method == "eth_sendRawTransaction":
            if self.fail:
                self.fail -= 1
                raise RuntimeError("nonce too low")
            self.sent += 1
            self.status = 2
            return "0x" + "cd" * 32
        if method == "eth_getTransactionReceipt":
            return {"status": "0x1"}
        if method == "eth_getTransactionCount":
            return "0x0"
        if method == "eth_estimateGas":
            return "0x10000"
        if method == "eth_feeHistory":
            return {"baseFeePerGas": ["0x1", "0x1"], "reward": [["0x1"]]}
        raise AssertionError(method)


DEP = {"escrow": "0x2E983A1Ba5e8b38AAAeC4B440B9dDcFBf72E15d1", "operator": MAKER, "usdc": "0x3600000000000000000000000000000000000000",
       "chain_id": 5042002, "deployed_block": 1}
OPERATOR_KEY = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"


def executed_store():
    c = client(**HELD)
    d = call_like(c)
    store = Store(":memory:")
    store.save_decision(d)
    store.save_execution({"decision_id": d["decision_id"], "chain_id": 31337, "tx_hash": TX, "status": "confirmed",
                          "verified_at": "2026-11-06T14:00:05Z", "settlement_tx": None})
    return store, d


def test_worker_settles_once_and_a_restart_does_not_settle_again():
    store, d = executed_store()
    chain = FakeArc(decision_key(d["decision_id"]))
    ArcWorker(DEP, "", store, OPERATOR_KEY, rpc=chain, sleep=lambda s: None).poll()
    assert chain.sent == 1 and store.get_settlement(d["decision_id"])["status"] == "Settled"
    ArcWorker(DEP, "", store, OPERATOR_KEY, rpc=chain, sleep=lambda s: None).poll()  # restart: catch-up replays Funded
    assert chain.sent == 1
    assert store.executions_for_decision(d["decision_id"])[-1]["settlement_tx"] == "0x" + "cd" * 32


def test_worker_retries_2_8_30_then_reports_failure():
    store, d = executed_store()
    waits = []
    chain = FakeArc(decision_key(d["decision_id"]), fail=4)
    ArcWorker(DEP, "", store, OPERATOR_KEY, rpc=chain, sleep=waits.append).poll()
    s = store.get_settlement(d["decision_id"])
    assert waits == [2, 8, 30] and s["status"] == "Failed" and "nonce too low" in s["reason"]


def test_worker_waits_for_the_verified_execution_and_the_operator_key():
    c = client(**HELD)
    d = call_like(c)
    store = Store(":memory:")
    store.save_decision(d)
    chain = FakeArc(decision_key(d["decision_id"]))
    ArcWorker(DEP, "", store, OPERATOR_KEY, rpc=chain, sleep=lambda s: None).poll()
    assert store.get_settlement(d["decision_id"])["waiting"] == "execution" and chain.sent == 0
    store2, d2 = executed_store()
    ArcWorker(DEP, "", store2, None, rpc=FakeArc(decision_key(d2["decision_id"])), sleep=lambda s: None).poll()
    assert store2.get_settlement(d2["decision_id"])["waiting"] == "operator key"


def test_payout_uses_6_decimals():
    _, d = executed_store()
    net, size = Decimal(d["net_edge"]), Decimal(d["inputs"]["request"]["size"])
    assert payout_units(d, 5_000_000) == int(5_000_000 * (1 + net / size))
