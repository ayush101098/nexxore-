"""Recorded-quotes source: replays a JSON snapshot so tests and the demo run offline.

Timestamps in the file are shifted so that recorded_at lines up with as_of,
which keeps every input as fresh as it was when it was recorded.
"""

import json
from datetime import datetime
from decimal import Decimal
from pathlib import Path

from models import Market
from scanner import VenueQuote

DEFAULT_PATH = Path(__file__).resolve().parents[1] / "data" / "recorded_quotes.json"


def _shift(obj, offset):
    if isinstance(obj, dict):
        return {
            k: (_iso(datetime.fromisoformat(v) + offset) if k.endswith("_at") else _shift(v, offset))
            for k, v in obj.items()
        }
    return obj


def _iso(dt: datetime) -> str:
    return dt.isoformat().replace("+00:00", "Z")


class RecordedSource:
    name = "recorded"

    def __init__(self, path: Path = DEFAULT_PATH):
        self._data = json.loads(Path(path).read_text())
        self._recorded_at = datetime.fromisoformat(self._data["recorded_at"])

    def quotes(self, pair: str, as_of: datetime) -> list[VenueQuote]:
        if pair != self._data["pair"]:
            return []
        offset = as_of - self._recorded_at
        return [
            VenueQuote(
                venue=q["venue"],
                target=q["target"],
                price=Decimal(q["price"]),
                observed_at=datetime.fromisoformat(q["observed_at"]) + offset,
                source=q["source"],
                reference=q.get("reference", False),
            )
            for q in self._data["quotes"]
        ]

    def market(self, venue: str, as_of: datetime) -> Market:
        if venue not in self._data["markets"]:
            raise KeyError(f"no recorded market for venue {venue!r}")
        return Market.model_validate(_shift(self._data["markets"][venue], as_of - self._recorded_at))
