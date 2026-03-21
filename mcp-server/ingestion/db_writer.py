"""
DBWriter — thin write-path wrapper around the Database class.

Exposes a simple interface for the backfill pipeline:
  connect()  → open pool
  write_fill(fill) → buffer a single Fill
  flush()    → batch-insert buffered fills
  close()    → flush remainder + close pool
"""

from __future__ import annotations

import logging
from typing import Sequence

from .config import Config
from .db import Database
from .models import Fill

log = logging.getLogger("nexxore.db_writer")

# Default buffer size before auto-flush
_DEFAULT_BUFFER_SIZE = 500


class DBWriter:
    """
    Buffered fill writer for the Hyperliquid ingestion pipeline.

    Usage::

        writer = DBWriter()
        await writer.connect()

        for fill in fills:
            await writer.write_fill(fill)

        await writer.close()  # flushes remaining buffer
    """

    def __init__(
        self,
        config: Config | None = None,
        buffer_size: int = _DEFAULT_BUFFER_SIZE,
    ) -> None:
        self.config = config or Config()
        self.buffer_size = buffer_size
        self._db = Database(self.config)
        self._buffer: list[dict] = []
        self._total_written = 0

    # ── lifecycle ─────────────────────────────────────────

    async def connect(self) -> None:
        """Open the database connection pool."""
        await self._db.connect()
        log.info("DBWriter connected (buffer_size=%d)", self.buffer_size)

    async def close(self) -> None:
        """Flush remaining buffer and close the pool."""
        await self.flush()
        await self._db.close()
        log.info("DBWriter closed (total_written=%d)", self._total_written)

    # ── write interface ───────────────────────────────────

    async def write_fill(self, fill: Fill) -> None:
        """
        Buffer a single Fill for batch insertion.
        Auto-flushes when the buffer reaches ``buffer_size``.
        """
        row = fill.to_db_row()

        # Remap to the shape expected by Database.insert_fills()
        self._buffer.append(
            {
                "time": row["ts"],
                "coin": row["coin"],
                "wallet": row["wallet"],
                "side": "Buy" if row["side"] == "B" else "Sell",
                "price": row["price"],
                "size": row["size"],
                "fee": row["fee"],
                "fee_token": "USDC",
                "closed_pnl": 0,
                "direction": None,
                "order_id": row["order_id"],
                "trade_id": row["trade_id"],
                "is_liquidation": False,
                "crossed": row["crossed"],
                "hash": None,
            }
        )

        if len(self._buffer) >= self.buffer_size:
            await self.flush()

    async def write_fills(self, fills: Sequence[Fill]) -> None:
        """Buffer multiple fills at once."""
        for f in fills:
            await self.write_fill(f)

    async def flush(self) -> int:
        """Flush the buffer to the database. Returns number of rows written."""
        if not self._buffer:
            return 0

        count = await self._db.insert_fills(self._buffer)
        self._total_written += count
        log.debug("Flushed %d fills (total=%d)", count, self._total_written)
        self._buffer.clear()
        return count

    # ── stats ─────────────────────────────────────────────

    @property
    def total_written(self) -> int:
        return self._total_written

    @property
    def buffer_pending(self) -> int:
        return len(self._buffer)
