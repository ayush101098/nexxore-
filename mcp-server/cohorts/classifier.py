"""
Cohort classifier — computes per-wallet stats from fills and assigns
behavioural tiers (pnl_tier, size_tier, profit_factor).

Tier rules
----------
pnl_tier (by total_pnl):
    > 100 000   → money_printer
    > 10 000    → profitable
    > −1 000    → break_even
    > −50 000   → losing
    else        → giga_rekt

size_tier (by total_volume):
    > 10 000 000 → leviathan
    > 1 000 000  → whale
    > 100 000    → dolphin
    > 10 000     → fish
    else         → shrimp

Public API
----------
- ``compute_wallet_stats(wallet, conn)``   → dict of aggregate metrics
- ``assign_tiers(stats)``                  → dict with pnl_tier + size_tier
- ``run_batch(wallets)``                   → concurrent classify (Semaphore 20)
- ``run_continuous()``                     → loop every 60 s for active wallets
- ``classify_all(min_trades)``             → batch-classify all wallets (compat)
- ``classify_wallet(wallet)``              → single wallet tier info
- ``get_cohort_summary()``                 → aggregate tier counts
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

import asyncpg

log = logging.getLogger("nexxore.cohorts.classifier")

# ── Tier thresholds ───────────────────────────────────────

_PNL_TIERS: list[tuple[str, float]] = [
    ("money_printer", 100_000),
    ("profitable",     10_000),
    ("break_even",     -1_000),   # total_pnl > -1 000
    ("losing",        -50_000),   # total_pnl > -50 000
    # else → giga_rekt
]

_SIZE_TIERS: list[tuple[str, float]] = [
    ("leviathan", 10_000_000),
    ("whale",      1_000_000),
    ("dolphin",      100_000),
    ("fish",          10_000),
    # else → shrimp
]

# Concurrency limit for run_batch
_BATCH_SEMAPHORE_LIMIT = 20

# How often run_continuous re-classifies active wallets
_CONTINUOUS_INTERVAL_S = 60

# "Active" = wallet has a fill in the last N minutes
_ACTIVE_WINDOW_MINUTES = 10


class CohortClassifier:
    """
    Reads raw fills, computes aggregate wallet stats, and assigns
    pnl_tier / size_tier.  Upserts results into ``trading.wallet_cohorts``.
    """

    def __init__(self, pool: asyncpg.Pool) -> None:
        self.pool = pool

    # ──────────────────────────────────────────────────────
    #  1. compute_wallet_stats
    # ──────────────────────────────────────────────────────

    async def compute_wallet_stats(
        self,
        wallet: str,
        conn: asyncpg.Connection,
    ) -> dict[str, Any] | None:
        """
        Calculate aggregate metrics for *wallet* from ``trading.fills``.

        Returns ``None`` if the wallet has no fills.

        Returned keys::

            wallet, total_pnl, trade_count, win_rate, total_volume,
            largest_win, largest_loss, profit_factor
        """
        row = await conn.fetchrow(
            """
            WITH position_pnl AS (
                -- Per-coin realised PnL: sell notional − buy notional
                SELECT
                    coin,
                    SUM(CASE WHEN side IN ('A', 'Sell') THEN notional ELSE 0 END)
                  - SUM(CASE WHEN side IN ('B', 'Buy')  THEN notional ELSE 0 END)
                    AS coin_pnl
                FROM trading.fills
                WHERE wallet = $1
                GROUP BY coin
            ),
            agg AS (
                SELECT
                    SUM(coin_pnl)                                                  AS total_pnl,
                    SUM(CASE WHEN coin_pnl > 0 THEN coin_pnl  ELSE 0 END)         AS gross_profit,
                    SUM(CASE WHEN coin_pnl < 0 THEN coin_pnl  ELSE 0 END)         AS gross_loss,
                    COUNT(*) FILTER (WHERE coin_pnl > 0)                           AS winning_positions,
                    COUNT(*) FILTER (WHERE coin_pnl < 0)                           AS losing_positions,
                    MAX(coin_pnl)                                                  AS largest_win,
                    MIN(coin_pnl)                                                  AS largest_loss
                FROM position_pnl
            ),
            counts AS (
                SELECT
                    COUNT(*)                  AS trade_count,
                    COALESCE(SUM(notional), 0) AS total_volume
                FROM trading.fills
                WHERE wallet = $1
            )
            SELECT
                a.total_pnl,
                c.trade_count,
                c.total_volume,
                a.gross_profit,
                a.gross_loss,
                a.winning_positions,
                a.losing_positions,
                a.largest_win,
                a.largest_loss
            FROM agg a, counts c
            """,
            wallet.lower(),
        )

        if row is None or row["trade_count"] == 0:
            return None

        total_pnl = float(row["total_pnl"] or 0)
        gross_profit = float(row["gross_profit"] or 0)
        gross_loss = abs(float(row["gross_loss"] or 0))
        wins = int(row["winning_positions"] or 0)
        losses = int(row["losing_positions"] or 0)
        closed = wins + losses

        return {
            "wallet": wallet.lower(),
            "total_pnl": total_pnl,
            "trade_count": int(row["trade_count"]),
            "win_rate": round(wins / closed * 100, 2) if closed > 0 else 0.0,
            "total_volume": float(row["total_volume"]),
            "largest_win": float(row["largest_win"] or 0),
            "largest_loss": float(row["largest_loss"] or 0),
            "profit_factor": round(gross_profit / gross_loss, 4)
            if gross_loss > 0
            else float("inf")
            if gross_profit > 0
            else 0.0,
        }

    # ──────────────────────────────────────────────────────
    #  2. assign_tiers
    # ──────────────────────────────────────────────────────

    @staticmethod
    def assign_tiers(stats: dict[str, Any]) -> dict[str, str]:
        """
        Determine ``pnl_tier`` and ``size_tier`` from computed stats.

        Returns::

            {"pnl_tier": "...", "size_tier": "..."}
        """
        total_pnl = stats["total_pnl"]
        total_volume = stats["total_volume"]

        # PnL tier
        pnl_tier = "giga_rekt"
        for tier, threshold in _PNL_TIERS:
            if total_pnl > threshold:
                pnl_tier = tier
                break

        # Size tier
        size_tier = "shrimp"
        for tier, threshold in _SIZE_TIERS:
            if total_volume > threshold:
                size_tier = tier
                break

        return {"pnl_tier": pnl_tier, "size_tier": size_tier}

    # ──────────────────────────────────────────────────────
    #  3. run_batch
    # ──────────────────────────────────────────────────────

    async def run_batch(self, wallets: list[str]) -> int:
        """
        Classify *wallets* concurrently (max 20 at a time).
        Upserts results to ``trading.wallet_cohorts``.
        Returns number of wallets successfully classified.
        """
        sem = asyncio.Semaphore(_BATCH_SEMAPHORE_LIMIT)
        classified = 0

        async def _process_one(wallet: str) -> bool:
            async with sem:
                async with self.pool.acquire() as conn:
                    stats = await self.compute_wallet_stats(wallet, conn)
                    if stats is None:
                        return False

                    tiers = self.assign_tiers(stats)
                    await self._upsert_cohort(conn, stats, tiers)
                    return True

        tasks = [asyncio.create_task(_process_one(w)) for w in wallets]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        for res in results:
            if res is True:
                classified += 1
            elif isinstance(res, Exception):
                log.warning("Batch classify error: %s", res)

        log.info("run_batch: classified %d / %d wallets", classified, len(wallets))
        return classified

    # ──────────────────────────────────────────────────────
    #  4. run_continuous
    # ──────────────────────────────────────────────────────

    async def run_continuous(self) -> None:
        """
        Poll for wallets with fills in the last 10 minutes, re-classify
        them, then sleep 60 s.  Runs forever until cancelled.
        """
        log.info(
            "Continuous classifier started "
            "(interval=%ds, active_window=%dm)",
            _CONTINUOUS_INTERVAL_S,
            _ACTIVE_WINDOW_MINUTES,
        )

        while True:
            t0 = time.monotonic()
            try:
                active_wallets = await self._get_active_wallets()

                if active_wallets:
                    count = await self.run_batch(active_wallets)
                    elapsed = time.monotonic() - t0
                    log.info(
                        "Continuous cycle: %d active wallets, "
                        "%d reclassified in %.1fs",
                        len(active_wallets),
                        count,
                        elapsed,
                    )
                else:
                    log.debug("No active wallets in last %d min", _ACTIVE_WINDOW_MINUTES)

            except Exception as exc:
                log.error("Continuous cycle error: %s", exc)

            await asyncio.sleep(_CONTINUOUS_INTERVAL_S)

    # ──────────────────────────────────────────────────────
    #  Backward-compat: classify_all / classify_wallet
    #  (used by CohortScheduler)
    # ──────────────────────────────────────────────────────

    async def classify_all(self, min_trades: int = 10) -> int:
        """
        Classify every wallet with at least *min_trades* fills.
        Wraps :meth:`run_batch` for compatibility with the scheduler.
        """
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT DISTINCT wallet FROM trading.fills
                GROUP BY wallet
                HAVING COUNT(*) >= $1
                """,
                min_trades,
            )

        wallets = [r["wallet"] for r in rows]
        if not wallets:
            return 0

        return await self.run_batch(wallets)

    async def classify_wallet(self, wallet: str) -> dict[str, Any] | None:
        """Classify a single wallet. Returns tier info dict or ``None``."""
        async with self.pool.acquire() as conn:
            stats = await self.compute_wallet_stats(wallet, conn)
            if stats is None:
                return None

            tiers = self.assign_tiers(stats)
            await self._upsert_cohort(conn, stats, tiers)

            return {**stats, **tiers}

    async def get_cohort_summary(self) -> dict[str, Any]:
        """Aggregate tier counts across all classified wallets."""
        async with self.pool.acquire() as conn:
            pnl_rows = await conn.fetch(
                """
                SELECT pnl_tier, COUNT(*) AS cnt
                FROM trading.wallet_cohorts
                GROUP BY pnl_tier ORDER BY cnt DESC
                """
            )
            size_rows = await conn.fetch(
                """
                SELECT size_tier, COUNT(*) AS cnt
                FROM trading.wallet_cohorts
                GROUP BY size_tier ORDER BY cnt DESC
                """
            )
            total = await conn.fetchval(
                "SELECT COUNT(*) FROM trading.wallet_cohorts"
            )

        return {
            "total_classified": total or 0,
            "pnl_tiers": {r["pnl_tier"]: r["cnt"] for r in pnl_rows},
            "size_tiers": {r["size_tier"]: r["cnt"] for r in size_rows},
        }

    # ──────────────────────────────────────────────────────
    #  Internal helpers
    # ──────────────────────────────────────────────────────

    async def _upsert_cohort(
        self,
        conn: asyncpg.Connection,
        stats: dict[str, Any],
        tiers: dict[str, str],
    ) -> None:
        """Write stats + tiers to wallet_cohorts.

        Saves the current pnl_tier as prev_pnl_tier before overwriting
        so the ``tier_migration`` MCP tool can detect tier changes.
        """
        await conn.execute(
            """
            INSERT INTO trading.wallet_cohorts (
                wallet, pnl_tier, size_tier,
                updated_at
            ) VALUES ($1, $2, $3, NOW())
            ON CONFLICT (wallet) DO UPDATE SET
                prev_pnl_tier = trading.wallet_cohorts.pnl_tier,
                pnl_tier      = EXCLUDED.pnl_tier,
                size_tier     = EXCLUDED.size_tier,
                updated_at    = NOW()
            """,
            stats["wallet"],
            tiers["pnl_tier"],
            tiers["size_tier"],
        )

    async def _get_active_wallets(self) -> list[str]:
        """Return wallets that have a fill in the last N minutes."""
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT DISTINCT wallet
                FROM trading.fills
                WHERE time > NOW() - $1 * INTERVAL '1 minute'
                """,
                _ACTIVE_WINDOW_MINUTES,
            )
        return [r["wallet"] for r in rows]
