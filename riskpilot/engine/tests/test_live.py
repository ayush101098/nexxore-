"""The public live endpoint: the demo chain through /v1/rpc (reads and signed transactions only),
and the assistant's per-client limit."""

import json

import api
from tests.test_demo import client, curves_file  # noqa: F401 - autouse: the test curves.json
from tests.test_profiles import HELD


class Upstream:
    """Stands in for anvil: records what was forwarded."""

    def __init__(self):
        self.seen = []

    def __call__(self, req, timeout=None):
        calls = json.loads(req.data)
        self.seen.extend(c["method"] for c in calls)
        body = json.dumps([{"jsonrpc": "2.0", "id": c["id"], "result": "0x1"} for c in calls]).encode()

        class R:
            def __enter__(s): return s
            def __exit__(s, *a): return False
            def read(s): return body
        return R()


def test_rpc_forwards_reads_and_signed_txs_only(monkeypatch):
    up = Upstream()
    monkeypatch.setattr(api.urllib.request, "urlopen", up)
    c = client(**HELD)
    r = c.post("/v1/rpc", json={"jsonrpc": "2.0", "id": 1, "method": "eth_blockNumber", "params": []}).json()
    assert r == {"jsonrpc": "2.0", "id": 1, "result": "0x1"}
    batch = [{"jsonrpc": "2.0", "id": i, "method": m, "params": []} for i, m in enumerate(
        ["eth_call", "anvil_setBalance", "eth_sendTransaction", "evm_revert", "eth_sendRawTransaction", "anvil_impersonateAccount"])]
    out = c.post("/v1/rpc", json=batch).json()
    ok = {o["id"] for o in out if "result" in o}
    refused = {o["id"]: o["error"]["message"] for o in out if "error" in o}
    assert ok == {0, 4}  # eth_call, eth_sendRawTransaction
    assert set(refused) == {1, 2, 3, 5} and all(m.startswith("method not allowed") for m in refused.values())
    assert up.seen == ["eth_blockNumber", "eth_call", "eth_sendRawTransaction"]  # nothing else reached the chain


def test_assistant_is_rate_limited_per_client(monkeypatch):
    from tests.test_assistant import Fake0G
    monkeypatch.setattr(api, "ASSISTANT_LIMIT", (2, 3600))
    c = client(**HELD, llm=Fake0G("I don't have that."))
    c.post("/demo/seed?profile=moderate")
    body = {"wallet": "0x905aCd442c7B3EF9BfEB0A3189f3686c1Cd0c697", "question": "hi"}
    h = {"CF-Connecting-IP": "203.0.113.9"}
    assert [c.post("/v1/assistant/ask", json=body, headers=h).status_code for _ in range(3)] == [200, 200, 429]
    assert c.post("/v1/assistant/ask", json=body, headers={"CF-Connecting-IP": "203.0.113.10"}).status_code == 200
