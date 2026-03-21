"""
Hyperliquid WebSocket trade stream subscriber.
Subscribes to `trades` channel for ALL coins, buffers in async queue,
and batch-writes to TimescaleDB.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any

import orjson
import websockets
from websockets.asyncio.client import ClientConnection

from .config import Config
from .db import Database

log = logging.getLogger("nexxore.ws_trades")


class HyperliquidTradeStream:
    """
    Real-time trade ingestion from Hyperliquid WebSocket.

    Subscribes to `trades` for every coin in the universe.
    Buffers trades in an async queue and flushes to DB in batches.
    Auto-reconnects on disconnect.
    """

    def __init__(self, db: Database, config: Config) -> None:
        self.db = db
        self.config = config
        self._queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self._ws: ClientConnection | None = None
        self._running = False
        self._reconnect_delay = 1.0
        self._max_reconnect_delay = 60.0
        self._coins: list[str] = []

        # Stats
        self._stats = {
            "messages_received": 0,
            "trades_ingested": 0,
            "batches_written": 0,
            "errors": 0,
            "last_trade_time": None,
        }

    # ── public interface ──────────────────────────────────

    async def start(self, coins: list[str] | None = None) -> None:
        """Start the trade stream. If coins is None, fetch full universe."""
        self._running = True
        self._coins = coins or await self._fetch_coin_universe()
        log.info("Starting trade stream for %d coins", len(self._coins))

        # Run listener + batch writer concurrently
        await asyncio.gather(
            self._listen_loop(),
            self._batch_writer(),
        )

    async def stop(self) -> None:
        """Gracefully stop the stream."""
        self._running = False
        if self._ws:
            await self._ws.close()
            log.info("WebSocket closed")

    @property
    def stats(self) -> dict[str, Any]:
        return {**self._stats, "queue_size": self._queue.qsize()}

    # ── WebSocket listener ────────────────────────────────

    async def _listen_loop(self) -> None:
        """Connect → subscribe → listen. Auto-reconnect on failure."""
        while self._running:
            try:
                async with websockets.connect(
                    self.config.ws_url,
                    ping_interval=20,
                    ping_timeout=10,
                    close_timeout=5,
                    max_size=10 * 1024 * 1024,  # 10 MB
                ) as ws:
                    self._ws = ws
                    self._reconnect_delay = 1.0  # reset
                    log.info("Connected to %s", self.config.ws_url)

                    # Subscribe to trades for every coin
                    await self._subscribe_all(ws)

                    # Listen for messages
                    async for raw in ws:
                        try:
                            msg = orjson.loads(raw)
                            await self._handle_message(msg)
                        except Exception as e:
                            log.warning("Message parse error: %s", e)
                            self._stats["errors"] += 1

            except websockets.ConnectionClosed as e:
                log.warning("WS connection closed: %s", e)
            except Exception as e:
                log.error("WS error: %s", e)
                self._stats["errors"] += 1

            if self._running:
                log.info(
                    "Reconnecting in %.1fs…", self._reconnect_delay
                )
                await asyncio.sleep(self._reconnect_delay)
                self._reconnect_delay = min(
                    self._reconnect_delay * 2,
                    self._max_reconnect_delay,
                )

    async def _subscribe_all(self, ws: ClientConnection) -> None:
        """Subscribe to trades channel for every coin."""
        for coin in self._coins:
            sub_msg = orjson.dumps(
                {
                    "method": "subscribe",
                    "subscription": {"type": "trades", "coin": coin},
                }
            )
            await ws.send(sub_msg)

        log.info("Subscribed to trades for %d coins", len(self._coins))

    async def _handle_message(self, msg: dict[str, Any]) -> None:
        """Parse incoming WS message and enqueue trades."""
        channel = msg.get("channel")
        data = msg.get("data")

        if channel != "trades" or not isinstance(data, list):
            return

        self._stats["messages_received"] += 1

        for trade in data:
            parsed = {
                "time": datetime.fromtimestamp(
                    trade["time"] / 1000, tz=timezone.utc
                ),
                "coin": trade["coin"],
                "side": trade["side"],  # 'A' or 'B'
                "price": float(trade["px"]),
                "size": float(trade["sz"]),
                "trade_id": str(trade.get("tid", "")),
                "hash": trade.get("hash"),
            }
            await self._queue.put(parsed)

    # ── batch writer ──────────────────────────────────────

    async def _batch_writer(self) -> None:
        """Drain queue and write to DB in batches."""
        batch: list[dict[str, Any]] = []

        while self._running:
            try:
                # Drain up to batch_size items or wait flush_interval
                deadline = time.monotonic() + self.config.flush_interval

                while len(batch) < self.config.batch_size:
                    timeout = max(0, deadline - time.monotonic())
                    try:
                        item = await asyncio.wait_for(
                            self._queue.get(), timeout=timeout
                        )
                        batch.append(item)
                    except asyncio.TimeoutError:
                        break

                if batch:
                    count = await self.db.insert_market_trades(batch)
                    self._stats["trades_ingested"] += count
                    self._stats["batches_written"] += 1
                    self._stats["last_trade_time"] = (
                        batch[-1]["time"].isoformat()
                    )

                    if self._stats["batches_written"] % 50 == 0:
                        log.info(
                            "Ingested %s trades total (%d in batch, queue=%d)",
                            f"{self._stats['trades_ingested']:,}",
                            count,
                            self._queue.qsize(),
                        )

                    batch = []

            except Exception as e:
                log.error("Batch write error: %s", e)
                self._stats["errors"] += 1
                await asyncio.sleep(1)

    # ── helpers ───────────────────────────────────────────

    async def _fetch_coin_universe(self) -> list[str]:
        """Fetch all available coins from Hyperliquid REST API."""
        import httpx

        async with httpx.AsyncClient() as client:
            resp = await client.post(
                self.config.rest_url,
                json={"type": "meta"},
                timeout=10,
            )
            resp.raise_for_status()
            data = resp.json()

        coins = [
            asset["name"]
            for asset in data.get("universe", [])
        ]
        log.info("Fetched %d coins from Hyperliquid", len(coins))
        return coins
