"""
Cohort recomputation scheduler.
Periodically recomputes wallet metrics and reassigns cohort tiers.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

import asyncpg

from .metrics import WalletMetricsComputer
from .classifier import CohortClassifier

log = logging.getLogger("nexxore.cohorts.scheduler")


class CohortScheduler:
    """
    Runs the cohort classification pipeline on a schedule.

    Pipeline:
    1. Compute wallet metrics from fills (WalletMetricsComputer)
    2. Classify wallets into tiers (CohortClassifier)
    3. Log summary
    """

    def __init__(
        self,
        pool: asyncpg.Pool,
        interval: float = 300,
        min_trades: int = 10,
    ) -> None:
        self.pool = pool
        self.interval = interval
        self.min_trades = min_trades
        self.metrics_computer = WalletMetricsComputer(pool)
        self.classifier = CohortClassifier(pool)
        self._running = False
        self._stats = {
            "cycles": 0,
            "last_wallets_computed": 0,
            "last_wallets_classified": 0,
            "last_cycle_time": None,
        }

    async def start(self) -> None:
        """Run the scheduler in a loop."""
        self._running = True
        log.info(
            "Cohort scheduler started (interval=%ds, min_trades=%d)",
            self.interval,
            self.min_trades,
        )

        while self._running:
            try:
                await self.run_once()
            except Exception as e:
                log.error("Cohort cycle error: %s", e)

            await asyncio.sleep(self.interval)

    async def run_once(self) -> dict[str, Any]:
        """Run a single classification cycle."""
        import time

        start = time.monotonic()

        # 1. Compute metrics
        wallets_computed = await self.metrics_computer.compute_all(
            min_trades=self.min_trades
        )

        # 2. Classify
        wallets_classified = await self.classifier.classify_all(
            min_trades=self.min_trades
        )

        elapsed = time.monotonic() - start

        self._stats["cycles"] += 1
        self._stats["last_wallets_computed"] = wallets_computed
        self._stats["last_wallets_classified"] = wallets_classified
        self._stats["last_cycle_time"] = round(elapsed, 2)

        # 3. Log summary
        summary = await self.classifier.get_cohort_summary()
        log.info(
            "Cohort cycle #%d complete in %.1fs — "
            "%d computed, %d classified — %s",
            self._stats["cycles"],
            elapsed,
            wallets_computed,
            wallets_classified,
            summary.get("pnl_tiers", {}),
        )

        return {
            "wallets_computed": wallets_computed,
            "wallets_classified": wallets_classified,
            "elapsed_seconds": round(elapsed, 2),
            "summary": summary,
        }

    async def stop(self) -> None:
        self._running = False

    @property
    def stats(self) -> dict[str, Any]:
        return {**self._stats}
