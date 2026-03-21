"""
Layer 1 — Polymarket REST API Client

Covers two public API surfaces:
  • Gamma API  — market metadata, categories, resolution info
  • CLOB API   — order book, prices, trades, price history

Features:
  • Token-bucket rate limiter
  • Exponential-backoff retries on 429 / 5xx / connection errors
  • Automatic pagination for bulk market fetches
"""

import requests
import time
import logging
from dataclasses import dataclass, field
from typing import Optional, List, Dict, Any

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# ── Rate Limiter ──────────────────────────────────────────────

@dataclass
class RateLimiter:
    """Simple token-bucket rate limiter."""

    calls_per_second: float
    _last_call: float = field(default=0.0, repr=False)

    def wait(self):
        now = time.time()
        elapsed = now - self._last_call
        min_interval = 1.0 / self.calls_per_second

        if elapsed < min_interval:
            time.sleep(min_interval - elapsed)

        self._last_call = time.time()


# ── Polymarket Client ─────────────────────────────────────────

class PolymarketClient:
    """
    Client for Polymarket's public APIs.

    Most read operations are publicly accessible, though heavy
    usage may require API keys or careful rate-limit handling.
    """

    GAMMA_BASE = "https://gamma-api.polymarket.com"
    CLOB_BASE = "https://clob.polymarket.com"

    def __init__(self, rate_limit: float = 5.0):
        self.session = requests.Session()
        self.session.headers.update({
            "User-Agent": "nexxore-pipeline/1.0",
            "Accept": "application/json",
        })
        self.rate_limiter = RateLimiter(calls_per_second=rate_limit)
        self._request_count = 0

    # ── internal request helper ───────────────────────────────

    def _get(
        self,
        base_url: str,
        endpoint: str,
        params: Optional[Dict[str, Any]] = None,
        retries: int = 3,
    ) -> Any:
        """GET with retry logic and rate limiting."""
        url = f"{base_url}{endpoint}"
        self.rate_limiter.wait()

        for attempt in range(retries):
            try:
                response = self.session.get(url, params=params, timeout=10)
                response.raise_for_status()
                self._request_count += 1
                return response.json()

            except requests.exceptions.HTTPError as e:
                if e.response.status_code == 429:
                    wait_time = 2 ** attempt
                    logger.warning(f"Rate limited. Waiting {wait_time}s…")
                    time.sleep(wait_time)
                elif e.response.status_code >= 500:
                    logger.warning(
                        f"Server error {e.response.status_code}. "
                        f"Attempt {attempt + 1}/{retries}"
                    )
                    time.sleep(1)
                else:
                    raise

            except requests.exceptions.ConnectionError:
                logger.warning(
                    f"Connection error. Attempt {attempt + 1}/{retries}"
                )
                time.sleep(2 ** attempt)

            except requests.exceptions.Timeout:
                logger.warning(f"Timeout. Attempt {attempt + 1}/{retries}")
                time.sleep(1)

        raise Exception(f"Failed after {retries} attempts: {url}")

    # ── Gamma API (Market Metadata) ───────────────────────────

    def get_markets(
        self,
        limit: int = 100,
        offset: int = 0,
        active: bool = True,
        closed: bool = False,
    ) -> List[Dict]:
        """
        Fetch list of markets with metadata.

        Returns market IDs, questions, categories,
        resolution criteria, and current state.
        """
        params = {
            "limit": limit,
            "offset": offset,
            "active": str(active).lower(),
            "closed": str(closed).lower(),
        }
        return self._get(self.GAMMA_BASE, "/markets", params)

    def get_market(self, market_id: str) -> Dict:
        """Fetch a single market by ID."""
        return self._get(self.GAMMA_BASE, f"/markets/{market_id}")

    def get_markets_paginated(
        self,
        active: bool = True,
        max_markets: Optional[int] = None,
    ) -> List[Dict]:
        """Fetch all markets, handling pagination automatically."""
        markets: List[Dict] = []
        offset = 0
        limit = 100

        while True:
            batch = self.get_markets(
                limit=limit, offset=offset, active=active
            )

            if not batch:
                break

            markets.extend(batch)
            logger.info(f"Fetched {len(markets)} markets so far…")

            if len(batch) < limit:
                break

            if max_markets and len(markets) >= max_markets:
                markets = markets[:max_markets]
                break

            offset += limit

        return markets

    # ── CLOB API (Price and Order Book Data) ──────────────────

    def get_price(self, token_id: str, side: str = "buy") -> Dict:
        """
        Get current best price for a token.

        token_id: the outcome token ID (YES or NO token)
        side: "buy" or "sell"
        """
        params = {"token_id": token_id, "side": side}
        return self._get(self.CLOB_BASE, "/price", params)

    def get_order_book(self, token_id: str) -> Dict:
        """
        Get the full order book for a token.
        Returns bids and asks with sizes.
        """
        return self._get(self.CLOB_BASE, f"/book?token_id={token_id}")

    def get_midpoint(self, token_id: str) -> Dict:
        """Get midpoint price (average of best bid and ask)."""
        return self._get(self.CLOB_BASE, f"/midpoint?token_id={token_id}")

    def get_spread(self, token_id: str) -> Dict:
        """Get current bid-ask spread."""
        return self._get(self.CLOB_BASE, f"/spread?token_id={token_id}")

    def get_trades(
        self,
        market_id: Optional[str] = None,
        token_id: Optional[str] = None,
        limit: int = 100,
        before: Optional[str] = None,
    ) -> List[Dict]:
        """
        Fetch recent trades.
        Supports filtering by market or token.
        """
        params: Dict[str, Any] = {"limit": limit}
        if market_id:
            params["market"] = market_id
        if token_id:
            params["token_id"] = token_id
        if before:
            params["before"] = before

        return self._get(self.CLOB_BASE, "/trades", params)

    def get_price_history(
        self,
        token_id: str,
        interval: str = "1h",
        fidelity: int = 60,
    ) -> Dict:
        """
        Fetch historical price data (OHLC format).

        interval: time range — "1d", "1w", "1m", "all"
        fidelity: candle size in minutes
        """
        params = {
            "token_id": token_id,
            "interval": interval,
            "fidelity": fidelity,
        }
        return self._get(self.CLOB_BASE, "/prices-history", params)

    @property
    def request_count(self) -> int:
        return self._request_count
