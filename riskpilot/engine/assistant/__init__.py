"""Ask RiskPilot: a private risk assistant on 0G Private Computer (PRD 7).

Grounding, so it is not a chat wrapper:
- every call carries a context JSON built from engine data only: the wallet's holdings and
  profile, open positions with their Greeks, the full stress grid of its book, and its recent
  decisions. "What if ETH drops 20%?" is answered from the -20% rows of that grid, never from
  the model's own maths;
- the system prompt: explain only the numbers provided, quote figures exactly, cite
  decision_ids, no price predictions, say "I don't have that" when data is missing;
- post-check: every $ figure and % in the answer must appear in the context. If one doesn't,
  regenerate once; if it still doesn't, return the answer with a warning listing them;
- any 0G error means "Assistant unavailable". Nothing cached or invented is shown as new.

0G Private Computer is OpenAI-compatible (docs.0g.ai, router): POST {base}/chat/completions with
Authorization: Bearer <ZG_API_KEY>; every response carries x_0g_trace.request_id. The key stays in
the engine's environment and never reaches the browser.
"""

import hashlib
import json
import os
import re
import urllib.error
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation

# From 0G's docs and live model list (GET https://router-api.0g.ai/v1/models): 0G's own model.
ZG_BASE_URL = "https://router-api.0g.ai/v1"
ZG_MODEL = "0gm-1.0-35b-a3b"
TRUST_HEADER = {"X-0G-Provider-Trust-Mode": "private"}

SYSTEM_PROMPT = """You are RiskPilot's risk assistant. You explain a DeFi wallet's risk using ONLY the JSON context you are given.
Rules:
- Explain only the numbers in the context. Quote every dollar figure and percentage exactly as it appears there (dollars to the cent). Never compute, estimate, round or invent a number.
- For "what if ETH moves X%" questions, answer from the stress_grid rows whose spot_shock equals that move (vol_shock 0 first, then the +20 vol-point row), and name the rows you used.
- When you mention a decision, cite its decision_id exactly (dec_ followed by 16 hex characters).
- No price predictions, no advice to buy or sell, no opinions about the market.
- If the context does not contain what is asked, say "I don't have that" and say which data is missing.
- Keep answers short: at most 6 sentences, plain text, no tables."""

BRIEF_PROMPT = """Write today's risk brief for this wallet from the context's `last_24h` block and the current figures: what changed in the last 24 hours (worst stress loss now and 24 hours ago), positions near the edges of their ranges, and trades that were declined and why (cite decision_ids). Plain text, at most 8 short lines. Quote figures exactly from the context."""


class AssistantUnavailable(Exception):
    """0G could not be reached, refused, or returned something unusable."""


@dataclass
class Completion:
    content: str
    request_id: str
    model: str


Llm = Callable[[list[dict]], Completion]


def zg_client(api_key: str | None = None, base_url: str | None = None, model: str | None = None,
              timeout: float = 90) -> Llm:
    """A chat call to 0G Private Computer. Raises AssistantUnavailable on any failure."""
    key = api_key if api_key is not None else os.environ.get("ZG_API_KEY")
    base = (base_url or os.environ.get("ZG_BASE_URL") or ZG_BASE_URL).rstrip("/")
    name = model or os.environ.get("ZG_MODEL") or ZG_MODEL

    def call(messages: list[dict]) -> Completion:
        if not key:
            raise AssistantUnavailable("ZG_API_KEY is not set in the engine's environment")
        body = {"model": name, "messages": messages, "temperature": 0.1, "max_tokens": 700,
                # Short, factual answers: no thinking trace.
                "chat_template_kwargs": {"enable_thinking": False}}
        req = urllib.request.Request(f"{base}/chat/completions", json.dumps(body).encode(), {
            "Content-Type": "application/json", "Authorization": f"Bearer {key}", **TRUST_HEADER})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                reply = json.load(r)
        except urllib.error.HTTPError as e:
            raise AssistantUnavailable(f"0G returned HTTP {e.code}: {e.read()[:200].decode(errors='replace')}") from None
        except (OSError, ValueError) as e:
            raise AssistantUnavailable(f"0G unreachable: {e}") from None
        try:
            content = reply["choices"][0]["message"]["content"] or ""
            request_id = reply["x_0g_trace"]["request_id"]
        except (KeyError, IndexError, TypeError):
            raise AssistantUnavailable("0G reply had no content or no x_0g_trace.request_id") from None
        if not content.strip():
            raise AssistantUnavailable("0G returned an empty answer")
        return Completion(content.strip(), request_id, reply.get("model", name))

    return call


# ── grounding post-check ─────────────────────────────────────────────────────

_MONEY = re.compile(r"[−-]?\$\s?[−-]?\d[\d,]*(?:\.\d+)?")
_PERCENT = re.compile(r"[−+-]?\d[\d,]*(?:\.\d+)?\s?%")
_NUMBER = re.compile(r"^[−+-]?\d[\d,]*(?:\.\d+)?$")
_DECISION = re.compile(r"dec_[0-9a-f]{16}")


def _num(text: str) -> Decimal | None:
    try:
        return Decimal(text.replace("−", "-").replace(",", "").replace("$", "").replace("%", "").replace(" ", ""))
    except InvalidOperation:
        return None


def context_numbers(obj) -> set[Decimal]:
    """Every number the context states, plus each fraction written as a percentage (0.25 -> 25)."""
    out: set[Decimal] = set()

    def add(v: Decimal):
        out.update({v, abs(v)})
        if abs(v) <= 10:
            out.update({v * 100, abs(v) * 100})

    def walk(x):
        if isinstance(x, dict):
            for v in x.values():
                walk(v)
        elif isinstance(x, list):
            for v in x:
                walk(v)
        elif isinstance(x, bool):
            return
        elif isinstance(x, (int, float)):
            add(Decimal(str(x)))
        elif isinstance(x, str) and _NUMBER.match(x.strip()):
            if (v := _num(x)) is not None:
                add(v)
        elif isinstance(x, str):
            # Engine-written text (decision reasons) states figures too: "$23.56 gap", "0.227%".
            for m in [*_MONEY.findall(x), *_PERCENT.findall(x)]:
                if (v := _num(m)) is not None:
                    out.update({v, abs(v)})

    walk(obj)
    return out


def _decimals(text: str) -> int:
    t = text.replace("%", "").strip()
    return len(t.split(".")[1]) if "." in t else 0


def _matches(v: Decimal, k: Decimal, places: int) -> bool:
    try:
        return abs(k) == abs(v) or abs(k).quantize(Decimal(1).scaleb(-places)) == abs(v)
    except InvalidOperation:
        return False


def unsupported_figures(answer: str, context: dict) -> list[str]:
    """$ figures and percentages in the answer that the context does not contain.
    Dollars must match exactly, or to the cent when written with cents ($629.93, not $630).
    Percentages may be the context's value rounded to the decimals written (0.2274% for 0.2274072)."""
    known = context_numbers(context)
    bad = []
    for m, money in [*((m, True) for m in _MONEY.findall(answer)), *((m, False) for m in _PERCENT.findall(answer))]:
        v = _num(m)
        if v is None:
            continue
        places = _decimals(m)
        if money and places not in (0, 2):
            places = -1  # odd precision: exact match only
        ok = any(abs(k) == abs(v) for k in known) if (money and places in (-1, 0)) else any(_matches(v, k, places) for k in known)
        if not ok:
            bad.append(m.strip())
    return bad


def cited_decisions(answer: str, context: dict) -> list[str]:
    known = set(_DECISION.findall(json.dumps(context)))
    return [d for d in dict.fromkeys(_DECISION.findall(answer)) if d in known]


# ── context ──────────────────────────────────────────────────────────────────

def snapshot_id(context: dict) -> str:
    return "ctx_" + hashlib.sha256(json.dumps(context, sort_keys=True, separators=(",", ":")).encode()).hexdigest()[:16]


def _decisions_for(store, wallet: str, limit: int = 200) -> list[dict]:
    w = wallet.lower()
    return [d for d in store.list_decisions(limit) if (d.get("signature") or {}).get("message", {}).get("wallet", "").lower() == w]


def _short(d: dict) -> dict:
    req = d["inputs"].get("request", {})
    return {
        "decision_id": d["decision_id"], "created_at": d["created_at"], "verdict": d["verdict"], "reason": d["reason"],
        "opportunity": req.get("opportunity", {}).get("source_venue"), "aqua_side": (d["inputs"].get("aqua") or {}).get("side"),
        "size_usd": str(req.get("size")), "gross_edge": d["gross_edge"], "net_edge": d["net_edge"], "risk_charge": d["risk_charge"],
        "stress_loss_before": d["stress_loss_before"], "stress_loss_after": d["stress_loss_after"], "budget": d["budget"],
    }


def build_context(store, wallet: str, opportunities: dict | None, stress_fn: Callable[[list[dict], float], dict],
                  now: datetime | None = None) -> dict:
    """Everything the assistant may say, from engine data only."""
    now = now or datetime.now(timezone.utc)
    items = (opportunities or {}).get("items", [])
    first = items[0]["decision"] if items else None
    req = first["inputs"]["request"] if first else {}
    holdings = req.get("holdings") or {}
    spot = float(req.get("market", {}).get("quote", {}).get("mid", 0) or 0)

    positions = store.open_positions()
    book = [{"primitive": "spot", "params": {"source": "holdings"}, "greeks": {"delta": str(holdings.get("weth", "0"))}}] if holdings else []
    grid = stress_fn(book + positions, spot) if spot else {"scenarios": [], "worst_loss": 0, "worst_scenario": None}
    stress_grid = [{"spot_shock": f"{s['spot_shock']:.2f}", "vol_shock": f"{s['vol_shock']:.2f}", "pnl": f"{s['pnl']:.2f}"} for s in grid["scenarios"]]

    # Positions near the edges of their ranges: how far spot is from each Aqua range bound.
    near = []
    for p in positions:
        prm = p.get("params", {})
        if p.get("primitive") == "aqua" and spot:
            lo, hi = float(prm["range_low"]), float(prm["range_high"])
            near.append({"position_id": p["position_id"], "side": prm.get("side"), "range_low": prm["range_low"], "range_high": prm["range_high"],
                         "spot": f"{spot:.2f}", "distance_to_low_pct": f"{(spot - lo) / spot * 100:.2f}", "distance_to_high_pct": f"{(hi - spot) / spot * 100:.2f}"})

    mine = _decisions_for(store, wallet)
    day = [d for d in mine if datetime.fromisoformat(d["created_at"]) >= now - timedelta(hours=24)]
    oldest = min(day, key=lambda d: d["created_at"]) if day else None
    declined = {}
    for d in sorted(day, key=lambda d: d["created_at"]):
        if d["verdict"] != "APPROVE":
            declined[(d["inputs"].get("request", {}).get("opportunity", {}).get("source_venue"), (d["inputs"].get("aqua") or {}).get("side"))] = d
    return {
        "wallet": wallet.lower(),
        "as_of": now.isoformat().replace("+00:00", "Z"),
        "block": (opportunities or {}).get("block"),
        "spot_eth_usd": f"{spot:.2f}" if spot else None,
        "profile": (opportunities or {}).get("profile"),
        "holdings": holdings,
        "positions": [{"position_id": p["position_id"], "decision_id": p["decision_id"], "primitive": p["primitive"], "status": p["status"],
                       "params": p.get("params"), "collateral": p.get("collateral"), "entry": p.get("entry"), "greeks": p.get("greeks")} for p in positions],
        "stress_grid": stress_grid,
        "stress_grid_note": "P&L in USD of the wallet's whole book (held WETH plus open positions) for each spot_shock (fraction, -0.20 = ETH down 20%) and vol_shock (fraction, 0.20 = +20 vol points).",
        "worst_stress_loss": f"{grid['worst_loss']:.2f}",
        "current_opportunities": [{"label": i["label"], **_short(i["decision"])} for i in items],
        "recent_decisions": [_short(d) for d in mine[:20]],
        "last_24h": {
            "decisions": len(day),
            "approved": sum(d["verdict"] == "APPROVE" for d in day),
            "declined": [_short(d) for d in declined.values()],
            "worst_stress_loss_24h_ago": oldest["stress_loss_before"] if oldest else None,
            "worst_stress_loss_now": first["stress_loss_before"] if first else None,
            "positions_near_range_edges": near,
        },
    }


# ── the assistant ────────────────────────────────────────────────────────────

def answer(llm: Llm, context: dict, question: str, kind: str = "ask") -> dict:
    """Ask 0G with the context; post-check the figures; regenerate once if needed."""
    user = (BRIEF_PROMPT if kind == "brief" else f"Question: {question}") + "\n\nContext (JSON):\n" + json.dumps(context, separators=(",", ":"))
    messages = [{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": user}]
    first = llm(messages)
    bad = unsupported_figures(first.content, context)
    attempts, final = [first.request_id], first
    if bad:
        retry = messages + [{"role": "assistant", "content": first.content},
                            {"role": "user", "content": "These figures are not in the context: " + ", ".join(bad)
                             + ". Answer again using only figures that appear in the context, quoted exactly."}]
        final = llm(retry)
        attempts.append(final.request_id)
        bad = unsupported_figures(final.content, context)
    return {
        "answer": final.content,
        "request_id": final.request_id,
        "request_ids": attempts,
        "model": final.model,
        "cited_decision_ids": cited_decisions(final.content, context),
        "context_snapshot_id": snapshot_id(context),
        "regenerated": len(attempts) > 1,
        "warning": f"These figures could not be matched to RiskPilot's data: {', '.join(bad)}" if bad else None,
    }
