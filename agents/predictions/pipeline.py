"""
Layer 5 — Pipeline Orchestrator

Wires together every layer and runs them concurrently:

  1. Fetch & store market metadata              (startup)
  2. Identify liquid markets worth monitoring   (startup)
  3. Subscribe to real-time WebSocket updates   (ongoing)
  4. Periodic REST price snapshots as backup    (ongoing)
  5. Periodic metadata refresh for new markets  (ongoing)
  6. Batch writer for DB flush                  (ongoing)
"""

import asyncio
import logging
import random
from typing import Optional, Set

from .api_client import PolymarketClient
from .normalizer import MarketNormalizer
from .storage import MarketDatabase
from .ws_feed import PolymarketWebSocket

logger = logging.getLogger(__name__)


class PolymarketPipeline:
    """
    Orchestrates the full Polymarket data pipeline.

    Usage::

        pipeline = PolymarketPipeline(db_path="polymarket.db")
        asyncio.run(pipeline.run())
    """

    def __init__(
        self,
        db_path: str = "polymarket.db",
        min_liquidity: float = 5000,
        snapshot_interval: int = 60,
        refresh_interval: int = 300,
        rate_limit: float = 3.0,
        max_initial_markets: int = 500,
        rest_snapshot_batch: int = 50,
    ):
        self.db = MarketDatabase(db_path)
        self.client = PolymarketClient(rate_limit=rate_limit)
        self.normalizer = MarketNormalizer()
        self.ws = PolymarketWebSocket(
            db=self.db,
            on_update=self._on_price_update,
        )

        self.min_liquidity = min_liquidity
        self.snapshot_interval = snapshot_interval
        self.refresh_interval = refresh_interval
        self.max_initial_markets = max_initial_markets
        self.rest_snapshot_batch = rest_snapshot_batch

        self._monitored_tokens: Set[str] = set()
        self._update_count = 0

    # ── callback ──────────────────────────────────────────────

    async def _on_price_update(self, update: dict):
        """Called when a real-time price update arrives."""
        self._update_count += 1

        if self._update_count % 100 == 0:
            logger.info(f"Processed {self._update_count} real-time updates")

    # ── startup: market seeding ───────────────────────────────

    def initialize_markets(self):
        """
        Fetch all active markets and store them.
        Run this on startup.
        """
        logger.info("Fetching active markets…")

        raw_markets = self.client.get_markets_paginated(
            active=True,
            max_markets=self.max_initial_markets,
        )

        markets = self.normalizer.normalize_batch(raw_markets)

        for market in markets:
            self.db.upsert_market(market)

        logger.info(f"Stored {len(markets)} markets")
        return markets

    def identify_monitor_targets(self):
        """
        Select which markets to actively monitor.
        Filters by liquidity and activity.
        """
        active = self.db.get_active_markets(
            min_liquidity=self.min_liquidity
        )

        token_ids = list(set(
            row["token_id"]
            for row in active
            if row.get("token_id")
        ))

        unique_markets = len(set(r["market_id"] for r in active))
        logger.info(
            f"Found {len(token_ids)} tokens to monitor "
            f"(from {unique_markets} markets)"
        )

        return token_ids

    # ── periodic tasks ────────────────────────────────────────

    async def take_rest_snapshots(self):
        """
        Periodically fetch prices via REST for monitored tokens.
        Backup for when WebSocket data is stale.
        """
        while True:
            try:
                tokens = list(self._monitored_tokens)
                random.shuffle(tokens)

                for token_id in tokens[: self.rest_snapshot_batch]:
                    try:
                        mid_data = self.client.get_midpoint(token_id)
                        price = float(mid_data.get("mid", 0))

                        if price > 0:
                            with self.db.connection() as conn:
                                row = conn.execute(
                                    """
                                    SELECT market_id, outcome
                                    FROM outcome_tokens
                                    WHERE token_id = ?
                                    """,
                                    (token_id,),
                                ).fetchone()

                            if row:
                                self.db.record_price_snapshot(
                                    token_id=token_id,
                                    market_id=row["market_id"],
                                    outcome=row["outcome"],
                                    price=price,
                                    source="rest",
                                )

                    except Exception as e:
                        logger.debug(
                            f"Snapshot failed for {token_id[:8]}…: {e}"
                        )

                logger.debug(
                    f"REST snapshot complete for {min(len(tokens), self.rest_snapshot_batch)} tokens"
                )

            except Exception as e:
                logger.error(f"Snapshot cycle error: {e}")

            await asyncio.sleep(self.snapshot_interval)

    async def refresh_market_metadata(self):
        """
        Periodically refresh market metadata.
        Picks up new markets and status changes.
        """
        while True:
            await asyncio.sleep(self.refresh_interval)

            try:
                logger.info("Refreshing market metadata…")

                raw = self.client.get_markets(limit=100, active=True)
                markets = self.normalizer.normalize_batch(raw)

                for market in markets:
                    self.db.upsert_market(market)

                # Check for new tokens to monitor
                new_tokens = self.identify_monitor_targets()
                truly_new = set(new_tokens) - self._monitored_tokens

                if truly_new:
                    logger.info(
                        f"Adding {len(truly_new)} new tokens to feed"
                    )
                    self._monitored_tokens.update(truly_new)
                    await self.ws.subscribe(list(truly_new))

            except Exception as e:
                logger.error(f"Metadata refresh error: {e}")

    # ── main entry point ──────────────────────────────────────

    async def run(self):
        """Start the full pipeline."""
        logger.info("=" * 50)
        logger.info("  Starting Polymarket Pipeline")
        logger.info("=" * 50)

        # Step 1: seed markets
        self.initialize_markets()

        # Step 2: identify monitoring targets
        token_ids = self.identify_monitor_targets()
        self._monitored_tokens = set(token_ids)

        # Step 3: subscribe WebSocket
        await self.ws.subscribe(token_ids)

        stats = self.db.get_market_count()
        logger.info(
            f"Pipeline ready — {stats['total_markets']} markets, "
            f"{len(token_ids)} tokens monitored"
        )

        # Step 4: run all tasks concurrently
        await asyncio.gather(
            self.ws.connect(),               # real-time feed
            self.ws.batch_writer(),           # queue → DB flush
            self.take_rest_snapshots(),       # REST backup
            self.refresh_market_metadata(),   # periodic refresh
        )

    def status(self) -> dict:
        """Return pipeline health status."""
        stats = self.db.get_market_count()
        return {
            "monitored_tokens": len(self._monitored_tokens),
            "ws_messages": self.ws.message_count,
            "rest_requests": self.client.request_count,
            "realtime_updates": self._update_count,
            **stats,
        }
