"""Scanner: poll pluggable price sources and emit price_gap Opportunities.

A Source returns VenueQuotes for a pair, and the market snapshot (quote at
size, liquidity, gas, fee, volatility) that /evaluate needs for one venue.
One quote across all sources is marked as the reference (fair) price.

Quote cap: Aqua's quote() runs the curve math on virtual reserves, so it
prices trades a one-sided curve cannot fill. A venue that reports its real
balances has every opportunity capped at what it can actually pay out, and
dropped when that is zero.
"""

import hashlib
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from typing import Protocol

from models import Market
from schemas import validate


@dataclass(frozen=True)
class VenueQuote:
    venue: str
    target: str | None  # primitive that would trade here; None for reference-only feeds
    price: Decimal
    observed_at: datetime
    source: str
    reference: bool = False
    # Real balances behind the quote (Aqua: aqua.safeBalances). None = not capped.
    eth_balance: Decimal | None = None
    usdc_balance: Decimal | None = None


class Source(Protocol):
    name: str

    def quotes(self, pair: str, as_of: datetime) -> list[VenueQuote]: ...

    def market(self, venue: str, as_of: datetime) -> Market: ...


def _iso(dt: datetime) -> str:
    return dt.isoformat().replace("+00:00", "Z")


def fillable_usd(q: VenueQuote, reference_price: Decimal) -> Decimal | None:
    """USD the venue can actually fill in the direction the gap points, or None if uncapped.

    Venue above reference: we sell ETH to it, so it pays USDC. Below: we buy ETH, so it pays ETH.
    """
    if q.price > reference_price:
        return q.usdc_balance
    return None if q.eth_balance is None else q.eth_balance * q.price


def scan(pair: str, sources: list[Source], as_of: datetime, size: Decimal, min_gap_bps: Decimal) -> list[dict]:
    quotes = [q for s in sources for q in s.quotes(pair, as_of)]
    reference = next((q for q in quotes if q.reference), None)
    if reference is None:
        return []

    opportunities = []
    for q in quotes:
        if q.reference or q.target is None:
            continue
        gap_bps = abs(q.price - reference.price) / reference.price * 10_000
        if gap_bps < min_gap_bps:
            continue
        cap = fillable_usd(q, reference.price)
        trade_size = size if cap is None else min(size, cap.quantize(Decimal("0.01")))
        if trade_size <= 0:
            continue  # the quote prices a direction the venue cannot fill
        key = f"{q.venue}|{q.price}|{_iso(q.observed_at)}|{reference.price}"
        opp = {
            "opportunity_id": "opp_" + hashlib.sha256(key.encode()).hexdigest()[:12],
            "type": "price_gap",
            "pair": pair,
            "source_venue": q.venue,
            "target": q.target,
            "observed_price": str(q.price),
            "reference_price": str(reference.price),
            "size": str(trade_size),
            "observed_at": _iso(q.observed_at),
            "source": q.source,
        }
        validate("opportunity", opp)
        opportunities.append(opp)
    return opportunities
