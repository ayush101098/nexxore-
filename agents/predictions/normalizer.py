"""
Layer 2 — Data Normalization

Converts raw Polymarket API responses into clean, typed dataclasses.
Handles missing fields, type coercion, timestamp parsing, and validation.
"""

import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import List, Optional, Dict, Any

logger = logging.getLogger(__name__)


# ── Data Models ───────────────────────────────────────────────

@dataclass
class OutcomeToken:
    """A single outcome in a market (YES token or NO token)."""

    token_id: str
    outcome: str          # "Yes" or "No"
    price: float
    winner: Optional[bool] = None


@dataclass
class Market:
    """Normalized market representation."""

    market_id: str
    condition_id: str
    question: str
    description: str
    category: str

    # Timing
    created_at: datetime
    end_date_iso: Optional[datetime]

    # State
    active: bool
    closed: bool
    archived: bool
    resolved: bool

    # Outcome tokens
    tokens: List[OutcomeToken] = field(default_factory=list)

    # Liquidity
    volume: float = 0.0
    liquidity: float = 0.0

    # Resolution
    resolution_source: str = ""
    winner: Optional[str] = None

    # ── derived properties ────────────────────────────────────

    @property
    def yes_price(self) -> Optional[float]:
        for token in self.tokens:
            if token.outcome and token.outcome.lower() == "yes":
                return token.price
        return None

    @property
    def no_price(self) -> Optional[float]:
        for token in self.tokens:
            if token.outcome and token.outcome.lower() == "no":
                return token.price
        return None

    @property
    def implied_probability(self) -> Optional[float]:
        """Market-implied probability derived from the YES token price."""
        return self.yes_price

    def to_dict(self) -> Dict[str, Any]:
        return {
            "market_id": self.market_id,
            "condition_id": self.condition_id,
            "question": self.question,
            "category": self.category,
            "yes_price": self.yes_price,
            "no_price": self.no_price,
            "volume": self.volume,
            "liquidity": self.liquidity,
            "active": self.active,
            "closed": self.closed,
            "resolved": self.resolved,
            "end_date": (
                self.end_date_iso.isoformat() if self.end_date_iso else None
            ),
        }


# ── Normalizer ────────────────────────────────────────────────

class MarketNormalizer:
    """
    Converts raw API responses into clean Market objects.
    Handles missing fields, type coercion, and validation.
    """

    _TIMESTAMP_FORMATS = [
        "%Y-%m-%dT%H:%M:%S.%fZ",
        "%Y-%m-%dT%H:%M:%SZ",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d",
    ]

    def normalize_market(self, raw: Dict[str, Any]) -> Optional[Market]:
        """
        Normalize a single raw market from the Gamma API.
        Returns None if the market data is unusable.
        """
        try:
            tokens = self._extract_tokens(raw)
            created_at = self._parse_timestamp(raw.get("createdAt", ""))
            end_date = self._parse_timestamp(raw.get("endDateIso", ""))

            return Market(
                market_id=str(raw.get("id", "")),
                condition_id=str(raw.get("conditionId", "")),
                question=raw.get("question", ""),
                description=raw.get("description", ""),
                category=raw.get("category", ""),
                created_at=created_at or datetime.utcnow(),
                end_date_iso=end_date,
                active=bool(raw.get("active", False)),
                closed=bool(raw.get("closed", False)),
                archived=bool(raw.get("archived", False)),
                resolved=bool(raw.get("resolved", False)),
                tokens=tokens,
                volume=float(raw.get("volume", 0) or 0),
                liquidity=float(raw.get("liquidity", 0) or 0),
                resolution_source=raw.get("resolutionSource", ""),
                winner=raw.get("winner"),
            )

        except Exception as e:
            logger.warning(
                f"Failed to normalize market "
                f"{raw.get('id', 'unknown')}: {e}"
            )
            return None

    def normalize_batch(self, raw_markets: List[Dict]) -> List[Market]:
        """Normalize a list of raw markets, dropping failures."""
        normalized = []

        for raw in raw_markets:
            market = self.normalize_market(raw)
            if market and market.market_id:
                normalized.append(market)

        logger.info(
            f"Normalized {len(normalized)}/{len(raw_markets)} markets"
        )
        return normalized

    # ── internal helpers ──────────────────────────────────────

    def _extract_tokens(self, raw: Dict) -> List[OutcomeToken]:
        tokens: List[OutcomeToken] = []

        # Tokens can appear in different fields depending on API version
        token_data = raw.get("tokens") or raw.get("outcomes") or []

        for t in token_data:
            try:
                token = OutcomeToken(
                    token_id=str(t.get("token_id", t.get("id", ""))),
                    outcome=str(t.get("outcome", "")),
                    price=float(t.get("price", 0.5) or 0.5),
                    winner=t.get("winner"),
                )
                if token.token_id:
                    tokens.append(token)
            except Exception as e:
                logger.debug(f"Token parse error: {e}")
                continue

        return tokens

    def _parse_timestamp(self, ts_string: str) -> Optional[datetime]:
        if not ts_string:
            return None

        for fmt in self._TIMESTAMP_FORMATS:
            try:
                return datetime.strptime(ts_string, fmt)
            except ValueError:
                continue

        return None
