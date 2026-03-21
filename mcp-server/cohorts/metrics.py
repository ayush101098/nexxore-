"""
Wallet metrics computation from fill data.
Computes PnL, win rate, volume, Sharpe, drawdown, etc.
Stores results in trading.wallet_metrics.
"""

from __future__ import annotations

import logging
import math
from datetime import datetime, timezone
from typing import Any

import asyncpg

log = logging.getLogger("nexxore.cohorts.metrics")


class WalletMetricsComputer:
    """
    Computes aggregate metrics per wallet from trading.fills.
    Writes results to trading.wallet_metrics.
    """

    def __init__(self, pool: asyncpg.Pool) -> None:
        self.pool = pool

    async def compute_all(self, min_trades: int = 10) -> int:
        """
        Recompute metrics for all wallets that have at least min_trades fills.
        Uses SQL aggregations for performance.
        """
        async with self.pool.acquire() as conn:
            # Step 1: Aggregate fill data per wallet
            result = await conn.execute(
                """
                INSERT INTO trading.wallet_metrics (
                    wallet, total_pnl, trade_count, win_count, loss_count,
                    win_rate, total_volume, total_fees, largest_win, largest_loss,
                    avg_trade_size, unique_coins_traded, active_since, last_trade,
                    updated_at
                )
                SELECT
                    wallet,
                    COALESCE(SUM(closed_pnl), 0)               AS total_pnl,
                    COUNT(*)                                     AS trade_count,
                    COUNT(*) FILTER (WHERE closed_pnl > 0)       AS win_count,
                    COUNT(*) FILTER (WHERE closed_pnl < 0)       AS loss_count,
                    CASE
                        WHEN COUNT(*) FILTER (WHERE closed_pnl != 0) > 0
                        THEN ROUND(
                            (COUNT(*) FILTER (WHERE closed_pnl > 0))::numeric
                            / NULLIF(COUNT(*) FILTER (WHERE closed_pnl != 0), 0)
                            * 100, 2
                        )
                        ELSE 0
                    END                                          AS win_rate,
                    COALESCE(SUM(notional), 0)                   AS total_volume,
                    COALESCE(SUM(fee), 0)                        AS total_fees,
                    COALESCE(MAX(closed_pnl), 0)                 AS largest_win,
                    COALESCE(MIN(closed_pnl), 0)                 AS largest_loss,
                    COALESCE(AVG(notional), 0)                   AS avg_trade_size,
                    COUNT(DISTINCT coin)                          AS unique_coins_traded,
                    MIN(time)                                    AS active_since,
                    MAX(time)                                    AS last_trade,
                    NOW()
                FROM trading.fills
                GROUP BY wallet
                HAVING COUNT(*) >= $1
                ON CONFLICT (wallet) DO UPDATE SET
                    total_pnl = EXCLUDED.total_pnl,
                    trade_count = EXCLUDED.trade_count,
                    win_count = EXCLUDED.win_count,
                    loss_count = EXCLUDED.loss_count,
                    win_rate = EXCLUDED.win_rate,
                    total_volume = EXCLUDED.total_volume,
                    total_fees = EXCLUDED.total_fees,
                    largest_win = EXCLUDED.largest_win,
                    largest_loss = EXCLUDED.largest_loss,
                    avg_trade_size = EXCLUDED.avg_trade_size,
                    unique_coins_traded = EXCLUDED.unique_coins_traded,
                    active_since = EXCLUDED.active_since,
                    last_trade = EXCLUDED.last_trade,
                    updated_at = NOW()
                """,
                min_trades,
            )

            # Parse affected row count
            count = int(result.split()[-1]) if result else 0
            log.info("Computed metrics for %d wallets", count)

            # Step 2: Compute profit factor and advanced metrics
            await self._compute_profit_factor(conn)

            return count

    async def compute_wallet(self, wallet: str) -> dict[str, Any] | None:
        """Compute and return metrics for a single wallet."""
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                SELECT
                    wallet,
                    COALESCE(SUM(closed_pnl), 0)           AS total_pnl,
                    COUNT(*)                                 AS trade_count,
                    COUNT(*) FILTER (WHERE closed_pnl > 0)   AS win_count,
                    COUNT(*) FILTER (WHERE closed_pnl < 0)   AS loss_count,
                    COALESCE(SUM(notional), 0)               AS total_volume,
                    COALESCE(SUM(fee), 0)                    AS total_fees,
                    COALESCE(MAX(closed_pnl), 0)             AS largest_win,
                    COALESCE(MIN(closed_pnl), 0)             AS largest_loss,
                    COALESCE(AVG(notional), 0)               AS avg_trade_size,
                    COUNT(DISTINCT coin)                      AS unique_coins_traded,
                    MIN(time)                                AS active_since,
                    MAX(time)                                AS last_trade
                FROM trading.fills
                WHERE wallet = $1
                GROUP BY wallet
                """,
                wallet.lower(),
            )

            if not row:
                return None

            metrics = dict(row)

            # Compute win rate
            closing_trades = metrics["win_count"] + metrics["loss_count"]
            metrics["win_rate"] = (
                round(metrics["win_count"] / closing_trades * 100, 2)
                if closing_trades > 0
                else 0
            )

            # Compute profit factor
            gross_profit = await conn.fetchval(
                """
                SELECT COALESCE(SUM(closed_pnl), 0)
                FROM trading.fills
                WHERE wallet = $1 AND closed_pnl > 0
                """,
                wallet.lower(),
            )
            gross_loss = abs(
                await conn.fetchval(
                    """
                    SELECT COALESCE(SUM(closed_pnl), 0)
                    FROM trading.fills
                    WHERE wallet = $1 AND closed_pnl < 0
                    """,
                    wallet.lower(),
                )
                or 0
            )

            metrics["profit_factor"] = (
                round(gross_profit / gross_loss, 2)
                if gross_loss > 0
                else float("inf") if gross_profit > 0 else 0
            )

            # Upsert to wallet_metrics
            await conn.execute(
                """
                INSERT INTO trading.wallet_metrics (
                    wallet, total_pnl, trade_count, win_count, loss_count,
                    win_rate, total_volume, total_fees, largest_win, largest_loss,
                    avg_trade_size, profit_factor, unique_coins_traded,
                    active_since, last_trade, updated_at
                )
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW())
                ON CONFLICT (wallet) DO UPDATE SET
                    total_pnl = EXCLUDED.total_pnl,
                    trade_count = EXCLUDED.trade_count,
                    win_count = EXCLUDED.win_count,
                    loss_count = EXCLUDED.loss_count,
                    win_rate = EXCLUDED.win_rate,
                    total_volume = EXCLUDED.total_volume,
                    total_fees = EXCLUDED.total_fees,
                    largest_win = EXCLUDED.largest_win,
                    largest_loss = EXCLUDED.largest_loss,
                    avg_trade_size = EXCLUDED.avg_trade_size,
                    profit_factor = EXCLUDED.profit_factor,
                    unique_coins_traded = EXCLUDED.unique_coins_traded,
                    active_since = EXCLUDED.active_since,
                    last_trade = EXCLUDED.last_trade,
                    updated_at = NOW()
                """,
                wallet.lower(),
                metrics["total_pnl"],
                metrics["trade_count"],
                metrics["win_count"],
                metrics["loss_count"],
                metrics["win_rate"],
                metrics["total_volume"],
                metrics["total_fees"],
                metrics["largest_win"],
                metrics["largest_loss"],
                metrics["avg_trade_size"],
                metrics["profit_factor"],
                metrics["unique_coins_traded"],
                metrics["active_since"],
                metrics["last_trade"],
            )

            return metrics

    async def _compute_profit_factor(self, conn: asyncpg.Connection) -> None:
        """Batch-compute profit factor for all wallets."""
        await conn.execute(
            """
            WITH pf AS (
                SELECT
                    wallet,
                    COALESCE(SUM(closed_pnl) FILTER (WHERE closed_pnl > 0), 0)
                        AS gross_profit,
                    ABS(COALESCE(SUM(closed_pnl) FILTER (WHERE closed_pnl < 0), 0))
                        AS gross_loss
                FROM trading.fills
                GROUP BY wallet
            )
            UPDATE trading.wallet_metrics wm
            SET profit_factor = CASE
                WHEN pf.gross_loss > 0 THEN ROUND((pf.gross_profit / pf.gross_loss)::numeric, 2)
                WHEN pf.gross_profit > 0 THEN 999.0
                ELSE 0
            END
            FROM pf
            WHERE wm.wallet = pf.wallet
            """
        )
