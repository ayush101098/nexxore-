"""
TimescaleDB connection pool and query helpers for the ingestion layer.
Uses asyncpg for high-throughput async writes.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any, Sequence

import asyncpg

from .config import Config

log = logging.getLogger("nexxore.db")


class Database:
    """Async TimescaleDB connection pool with batch insert helpers."""

    def __init__(self, config: Config) -> None:
        self.config = config
        self._pool: asyncpg.Pool | None = None

    # ── lifecycle ─────────────────────────────────────────

    async def connect(self) -> None:
        """Create connection pool."""
        self._pool = await asyncpg.create_pool(
            self.config.database_url,
            min_size=2,
            max_size=20,
            command_timeout=30,
        )
        log.info("Connected to TimescaleDB (%s)", self.config.database_url[:40])

    async def close(self) -> None:
        if self._pool:
            await self._pool.close()
            log.info("Database pool closed")

    @property
    def pool(self) -> asyncpg.Pool:
        if not self._pool:
            raise RuntimeError("Database not connected. Call connect() first.")
        return self._pool

    # ── market trades (anonymous, from WS) ────────────────

    async def insert_market_trades(
        self, trades: Sequence[dict[str, Any]]
    ) -> int:
        """Batch-insert anonymous market trades. Returns count inserted."""
        if not trades:
            return 0

        records = [
            (
                t["time"],
                t["coin"],
                t["side"],
                t["price"],
                t["size"],
                t["price"] * t["size"],  # notional
                t.get("trade_id"),
                t.get("hash"),
            )
            for t in trades
        ]

        async with self.pool.acquire() as conn:
            await conn.executemany(
                """
                INSERT INTO trading.market_trades
                    (time, coin, side, price, size, notional, trade_id, hash)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                """,
                records,
            )

        return len(records)

    # ── wallet fills (attributed, from REST) ──────────────

    async def insert_fills(self, fills: Sequence[dict[str, Any]]) -> int:
        """Batch-insert wallet-attributed fills. Uses ON CONFLICT for dedup."""
        if not fills:
            return 0

        records = [
            (
                f["time"],
                f["coin"],
                f["wallet"],
                f["side"],
                f["price"],
                f["size"],
                f["price"] * f["size"],
                f.get("fee", 0),
                f.get("fee_token", "USDC"),
                f.get("closed_pnl", 0),
                f.get("direction"),
                f.get("order_id"),
                f.get("trade_id"),
                f.get("is_liquidation", False),
                f.get("crossed", False),
                f.get("hash"),
            )
            for f in fills
        ]

        async with self.pool.acquire() as conn:
            await conn.executemany(
                """
                INSERT INTO trading.fills
                    (time, coin, wallet, side, price, size, notional,
                     fee, fee_token, closed_pnl, direction,
                     order_id, trade_id, is_liquidation, crossed, hash)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
                ON CONFLICT DO NOTHING
                """,
                records,
            )

        return len(records)

    # ── funding rates ─────────────────────────────────────

    async def insert_funding_rates(
        self, rates: Sequence[dict[str, Any]]
    ) -> int:
        """Insert funding rate snapshots."""
        if not rates:
            return 0

        records = [
            (
                r.get("time", datetime.now(timezone.utc)),
                r["coin"],
                r["funding_rate"],
                r.get("premium"),
                r.get("open_interest"),
                r.get("mark_price"),
                r.get("oracle_price"),
            )
            for r in rates
        ]

        async with self.pool.acquire() as conn:
            await conn.executemany(
                """
                INSERT INTO trading.funding_rates
                    (time, coin, funding_rate, premium, open_interest,
                     mark_price, oracle_price)
                VALUES ($1,$2,$3,$4,$5,$6,$7)
                """,
                records,
            )

        return len(records)

    # ── orderbook snapshots ───────────────────────────────

    async def insert_orderbook_snapshot(
        self, snapshot: dict[str, Any]
    ) -> None:
        """Insert a single orderbook snapshot."""
        async with self.pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO trading.orderbook_snapshots
                    (time, coin, bid_depth, ask_depth, spread,
                     mid_price, imbalance, levels_json)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
                """,
                snapshot.get("time", datetime.now(timezone.utc)),
                snapshot["coin"],
                snapshot.get("bid_depth"),
                snapshot.get("ask_depth"),
                snapshot.get("spread"),
                snapshot.get("mid_price"),
                snapshot.get("imbalance"),
                snapshot.get("levels_json"),
            )

    # ── asset metadata ────────────────────────────────────

    async def upsert_assets(
        self, assets: Sequence[dict[str, Any]]
    ) -> int:
        """Upsert coin universe metadata."""
        if not assets:
            return 0

        async with self.pool.acquire() as conn:
            for a in assets:
                await conn.execute(
                    """
                    INSERT INTO trading.assets
                        (coin, asset_index, max_leverage, sz_decimals,
                         mark_price, mid_price, funding_rate,
                         open_interest, volume_24h, updated_at)
                    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
                    ON CONFLICT (coin) DO UPDATE SET
                        mark_price = EXCLUDED.mark_price,
                        mid_price = EXCLUDED.mid_price,
                        funding_rate = EXCLUDED.funding_rate,
                        open_interest = EXCLUDED.open_interest,
                        volume_24h = EXCLUDED.volume_24h,
                        updated_at = NOW()
                    """,
                    a.get("coin"),
                    a.get("asset_index"),
                    a.get("max_leverage"),
                    a.get("sz_decimals"),
                    a.get("mark_price"),
                    a.get("mid_price"),
                    a.get("funding_rate"),
                    a.get("open_interest"),
                    a.get("volume_24h"),
                )

        return len(assets)

    # ── positions snapshot ────────────────────────────────

    async def upsert_positions(
        self, positions: Sequence[dict[str, Any]]
    ) -> int:
        """Upsert open positions for a wallet."""
        if not positions:
            return 0

        async with self.pool.acquire() as conn:
            for p in positions:
                await conn.execute(
                    """
                    INSERT INTO trading.positions
                        (wallet, coin, side, size, entry_price, mark_price,
                         unrealized_pnl, leverage, liquidation_price,
                         margin_used, return_on_equity, updated_at)
                    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
                    ON CONFLICT (wallet, coin) DO UPDATE SET
                        side = EXCLUDED.side,
                        size = EXCLUDED.size,
                        entry_price = EXCLUDED.entry_price,
                        mark_price = EXCLUDED.mark_price,
                        unrealized_pnl = EXCLUDED.unrealized_pnl,
                        leverage = EXCLUDED.leverage,
                        liquidation_price = EXCLUDED.liquidation_price,
                        margin_used = EXCLUDED.margin_used,
                        return_on_equity = EXCLUDED.return_on_equity,
                        updated_at = NOW()
                    """,
                    p["wallet"],
                    p["coin"],
                    p["side"],
                    p["size"],
                    p["entry_price"],
                    p.get("mark_price"),
                    p.get("unrealized_pnl"),
                    p.get("leverage"),
                    p.get("liquidation_price"),
                    p.get("margin_used"),
                    p.get("return_on_equity"),
                )

        return len(positions)

    # ── wallet queue ──────────────────────────────────────

    async def add_wallets_to_queue(
        self, wallets: Sequence[str], source: str = "manual"
    ) -> int:
        """Add wallets to the discovery/indexing queue."""
        async with self.pool.acquire() as conn:
            await conn.executemany(
                """
                INSERT INTO trading.wallet_queue (wallet, source)
                VALUES ($1, $2)
                ON CONFLICT (wallet) DO NOTHING
                """,
                [(w, source) for w in wallets],
            )
        return len(wallets)

    async def get_pending_wallets(self, limit: int = 100) -> list[str]:
        """Get wallets pending indexing, ordered by priority."""
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT wallet FROM trading.wallet_queue
                WHERE status = 'pending'
                ORDER BY priority DESC, created_at ASC
                LIMIT $1
                """,
                limit,
            )
        return [r["wallet"] for r in rows]

    async def mark_wallet_indexed(
        self, wallet: str, fill_count: int
    ) -> None:
        """Mark a wallet as indexed."""
        async with self.pool.acquire() as conn:
            await conn.execute(
                """
                UPDATE trading.wallet_queue
                SET status = 'indexed',
                    last_indexed = NOW(),
                    fill_count = $2
                WHERE wallet = $1
                """,
                wallet,
                fill_count,
            )

    # ── stats ─────────────────────────────────────────────

    async def get_stats(self) -> dict[str, Any]:
        """Get ingestion statistics."""
        async with self.pool.acquire() as conn:
            mt_count = await conn.fetchval(
                "SELECT count(*) FROM trading.market_trades"
            )
            fill_count = await conn.fetchval(
                "SELECT count(*) FROM trading.fills"
            )
            wallet_count = await conn.fetchval(
                "SELECT count(*) FROM trading.wallet_metrics"
            )
            asset_count = await conn.fetchval(
                "SELECT count(*) FROM trading.assets"
            )

        return {
            "market_trades": mt_count or 0,
            "fills": fill_count or 0,
            "wallets_classified": wallet_count or 0,
            "coins_tracked": asset_count or 0,
        }
