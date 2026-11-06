"""Ask RiskPilot (PRD 7): grounded in engine data, post-checked, request IDs, unavailable on error."""

import json

from assistant import AssistantUnavailable, Completion, cited_decisions, unsupported_figures
from tests.test_demo import MAKER, client, curves_file  # noqa: F401 - autouse: the test curves.json
from tests.test_profiles import HELD


class Fake0G:
    """Stands in for 0G Private Computer: replies in turn, records what it was sent."""

    def __init__(self, *replies):
        self.replies, self.sent, self.n = list(replies), [], 0

    def __call__(self, messages):
        self.sent.append(messages)
        reply = self.replies[min(self.n, len(self.replies) - 1)]
        self.n += 1
        if isinstance(reply, Exception):
            raise reply
        text = reply(messages) if callable(reply) else reply
        return Completion(text, f"0g-req-{self.n}", "0gm-1.0-35b-a3b")


def context_of(fake) -> dict:
    return json.loads(fake.sent[0][1]["content"].split("Context (JSON):\n", 1)[1])


def seeded(llm):
    c = client(**HELD, llm=llm)
    c.post("/demo/seed?profile=moderate")
    return c


def row(ctx, spot, vol="0.00"):
    return next(r for r in ctx["stress_grid"] if r["spot_shock"] == spot and r["vol_shock"] == vol)


def test_answer_is_built_from_the_stress_grid_and_cites_decisions():
    def grounded(messages):
        ctx = json.loads(messages[1]["content"].split("Context (JSON):\n", 1)[1])
        put = next(o for o in ctx["current_opportunities"] if o["aqua_side"] == "put_like")
        return (f"At -20% your book's P&L is ${row(ctx, '-0.20')['pnl']} (stress_grid row -0.20, vol 0.00). "
                f"The put-like curve was rejected ({put['decision_id']}): it adds downside while your worst case is ${ctx['worst_stress_loss']}.")
    fake = Fake0G(grounded)
    c = seeded(fake)
    r = c.post("/v1/assistant/ask", json={"wallet": MAKER, "question": "What happens to my positions if ETH drops 20%?"}).json()
    ctx = context_of(fake)
    assert row(ctx, "-0.20")["pnl"] in r["answer"] and float(row(ctx, "-0.20")["pnl"]) < 0
    assert r["request_id"] == "0g-req-1" and r["warning"] is None and not r["regenerated"]
    assert r["cited_decision_ids"] and all(d.startswith("dec_") for d in r["cited_decision_ids"])
    assert r["context_snapshot_id"].startswith("ctx_")
    # The system prompt carries the grounding rules.
    assert "Explain only the numbers in the context" in fake.sent[0][0]["content"]
    # Stored with its request ID and the exact context, replayable.
    logged = c.get(f"/v1/assistant/log?wallet={MAKER}").json()
    assert logged[0]["request_id"] == "0g-req-1" and logged[0]["question"].startswith("What happens")
    assert c.get(f"/v1/assistant/context/{r['context_snapshot_id']}").json() == ctx


def test_an_invented_figure_is_regenerated_once():
    fake = Fake0G("Your loss at -20% would be about $1,000,000.00.",
                  lambda m: f"At -20% the stress grid shows ${row(context_of(fake), '-0.20')['pnl']}.")
    r = seeded(fake).post("/v1/assistant/ask", json={"wallet": MAKER, "question": "ETH -20%?"}).json()
    assert r["regenerated"] and r["request_ids"] == ["0g-req-1", "0g-req-2"] and r["warning"] is None
    assert "not in the context: $1,000,000.00" in fake.sent[1][-1]["content"]


def test_a_figure_still_invented_after_regenerating_is_shown_with_a_warning():
    fake = Fake0G("ETH will fall 37.5% and you lose $123.45.")
    r = seeded(fake).post("/v1/assistant/ask", json={"wallet": MAKER, "question": "What next?"}).json()
    assert r["regenerated"] and "$123.45" in r["warning"] and "37.5%" in r["warning"]


def test_0g_unavailable_shows_assistant_unavailable_and_stores_nothing():
    fake = Fake0G(AssistantUnavailable("0G unreachable: timed out"))
    c = seeded(fake)
    r = c.post("/v1/assistant/ask", json={"wallet": MAKER, "question": "Why did you reject that trade?"})
    assert r.status_code == 503 and r.json()["detail"]["detail"] == "Assistant unavailable"
    assert c.get(f"/v1/assistant/log?wallet={MAKER}").json() == []


def test_brief_reports_the_last_24h_with_request_id():
    fake = Fake0G(lambda m: "Worst stress loss now ${}.".format(context_of(fake)["last_24h"]["worst_stress_loss_now"]))
    c = seeded(fake)
    r = c.post("/v1/assistant/brief", json={"wallet": MAKER}).json()
    ctx = context_of(fake)
    assert r["kind"] == "brief" and r["request_id"] == "0g-req-1" and r["warning"] is None
    # The unit-test seed: a recorded gap (REJECT), the put-like (REJECT) and the call-like (APPROVE).
    assert ctx["last_24h"]["decisions"] == 3 and ctx["last_24h"]["approved"] == 1
    assert {d["verdict"] for d in ctx["last_24h"]["declined"]} == {"REJECT"}
    # Like with like: the whole-book worst loss now; nothing earlier on the first brief.
    assert ctx["last_24h"]["worst_stress_loss_now"] == ctx["worst_stress_loss"]
    assert ctx["last_24h"]["worst_stress_loss_earlier"] is None
    c.post("/v1/assistant/brief", json={"wallet": MAKER})
    second = json.loads(fake.sent[-1][1]["content"].split("Context (JSON):\n", 1)[1])
    assert second["last_24h"]["worst_stress_loss_earlier"] == ctx["worst_stress_loss"]
    assert "last_24h.stress_summary" in fake.sent[0][1]["content"]
    assert ctx["last_24h"]["stress_summary"].endswith("This is the first reading in the last 24 hours.")


def test_post_check_rules():
    ctx = {"a": "629.93", "b": "-0.20", "fee": "0.002274072", "budget": "250.00"}
    assert unsupported_figures("adds $629.93 at a -20% move; limit $250; fee 0.2274%", ctx) == []
    assert unsupported_figures("adds about $630", ctx) == ["$630"]  # dollars are exact, not rounded
    # Figures inside engine-written reasons count as context.
    assert unsupported_figures("net edge −$15.80, $23.56 gap", {"reason": "Rejected: net edge -$15.80 below $5.00 hurdle ($23.56 gap)"}) == []
    assert cited_decisions("see dec_0123456789abcdef and dec_ffffffffffffffff", {"x": "dec_0123456789abcdef"}) == ["dec_0123456789abcdef"]


def test_zg_client_without_a_key_is_unavailable(monkeypatch):
    from assistant import zg_client
    monkeypatch.delenv("ZG_API_KEY", raising=False)
    try:
        zg_client()([{"role": "user", "content": "hi"}])
    except AssistantUnavailable as e:
        assert "ZG_API_KEY" in str(e)
    else:
        raise AssertionError("expected AssistantUnavailable")
