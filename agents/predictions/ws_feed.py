"""
Layer 4 — Real-Time WebSocket Feed

Connects to Polymarket's CLOB WebSocket for low-latency
streaming of price changes, order book updates, and trades.

Features:
  • Automatic reconnection with exponential backoff (max 60 s)
  • Async ingestion queue → batch writer to avoid DB contention
  • Handles price_change, book, and last_trade_price events
"""

import asyncio
import json
import logging
from datetime import datetime
from typing import Callable, List, Optional, Set

try:
    import websockets
except ImportError:
    websockets = None  # type: ignore[assignment]

from .storage import MarketDatabase

logger = logging.getLogger(__name__)


class PolymarketWebSocket:
    """
    Real-time WebSocket connection to Polymarket's CLOB.

    Subscribes to price updates and order book changes
    for a set of token IDs.
    """

    WS_URL = "wss://ws-subscriptions-clob.polymarket.com/ws/market"

    # Queue-based ingestion settings
    BATCH_FLUSH_INTERVAL = 2.0   # seconds between DB flushes
    MAX_BATCH_SIZE = 200         # flush early if queue reaches this

    def __init__(
        self,
        db: MarketDatabase,
        on_update: Optional[Callable] = None,
    ):
        if websockets is None:
            raise ImportError(
                "websockets package is required. "
                "Install with: pip install websockets"
            )

        self.db = db
        self.on_update = on_update
        self.subscribed_tokens: Set[str] = set()
        self._ws = None
        self._running = False
        self._reconnect_delay = 1
        self._message_count = 0

        # Async ingestion queue
        self._queue: asyncio.Queue = asyncio.Queue()

    # ── public API ────────────────────────────────────────────

    async def subscribe(self, token_ids: List[str]):
        """Add tokens to the subscription list."""
        new_tokens = set(token_ids) - self.subscribed_tokens
        self.subscribed_tokens.update(new_tokens)

        if self._ws and new_tokens:
            await self._send_subscription(list(new_tokens))

    def stop(self):
        self._running = False

    # ── connection loop ───────────────────────────────────────

    async def connect(self):
        """Main connection loop with automatic reconnection."""
        self._running = True

        while self._running:
            try:
                logger.info(f"Connecting to {self.WS_URL}…")

                async with websockets.connect(
                    self.WS_URL,
                    ping_interval=30,
                    ping_timeout=10,
                    close_timeout=5,
                ) as ws:
                    self._ws = ws
                    self._reconnect_delay = 1  # reset on success

                    if self.subscribed_tokens:
                        await self._send_subscription(
                            list(self.subscribed_tokens)
                        )

                    logger.info("Connected. Listening for updates…")

                    async for message in ws:
                        await self._handle_message(message)

            except Exception as e:
                if websockets and isinstance(
                    e, websockets.exceptions.ConnectionClosed
                ):
                    logger.warning(f"Connection closed: {e}")
                else:
                    logger.error(f"WebSocket error: {e}")

            finally:
                self._ws = None

            if self._running:
                logger.info(
                    f"Reconnecting in {self._reconnect_delay}s…"
                )
                await asyncio.sleep(self._reconnect_delay)
                self._reconnect_delay = min(
                    self._reconnect_delay * 2, 60
                )

    # ── batch writer (runs as a separate task) ────────────────

    async def batch_writer(self):
        """
        Drains the ingestion queue and flushes snapshots to DB
        in batches.  Reduces SQLite lock contention when the
        WebSocket feed is producing dozens of updates per second.
        """
        while self._running:
            batch = []
            try:
                # Wait for at least one item
                item = await asyncio.wait_for(
                    self._queue.get(), timeout=self.BATCH_FLUSH_INTERVAL
                )
                batch.append(item)
            except asyncio.TimeoutError:
                pass

            # Drain remaining items up to MAX_BATCH_SIZE
            while not self._queue.empty() and len(batch) < self.MAX_BATCH_SIZE:
                batch.append(self._queue.get_nowait())

            if batch:
                self._flush_batch(batch)

    def _flush_batch(self, batch: list):
        """Write a batch of snapshot records to the DB."""
        for record in batch:
            try:
                self.db.record_price_snapshot(**record)
            except Exception as e:
                logger.debug(f"Batch write error: {e}")

        logger.debug(f"Flushed {len(batch)} snapshots to DB")

    # ── internal helpers ──────────────────────────────────────

    async def _send_subscription(self, token_ids: List[str]):
        message = {"assets_ids": token_ids, "type": "Market"}
        await self._ws.send(json.dumps(message))
        logger.info(f"Subscribed to {len(token_ids)} tokens")

    async def _handle_message(self, raw_message: str):
        """Parse and process an incoming WebSocket message."""
        try:
            data = json.loads(raw_message)
            self._message_count += 1

            events = data if isinstance(data, list) else [data]

            for event in events:
                event_type = (
                    event.get("event_type")
                    or event.get("type")
                    or ""
                )

                if event_type == "price_change":
                    await self._handle_price_change(event)

                elif event_type == "book":
                    await self._handle_book_update(event)

                elif event_type == "last_trade_price":
                    await self._handle_trade(event)

                else:
                    logger.debug(f"Unhandled event type: {event_type}")

        except json.JSONDecodeError:
            logger.warning(f"Invalid JSON: {raw_message[:100]}")
        except Exception as e:
            logger.error(f"Message handling error: {e}")

    async def _handle_price_change(self, event: dict):
        """Process a price change event."""
        token_id = event.get("asset_id", "")
        price = float(event.get("price", 0))

        if not token_id or price is None:
            return

        # Look up market context
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
            market_id = row["market_id"]
            outcome = row["outcome"]

            # Enqueue for batch writing
            await self._queue.put({
                "token_id": token_id,
                "market_id": market_id,
                "outcome": outcome,
                "price": price,
                "source": "ws",
            })

            # Notify callback
            if self.on_update:
                await self.on_update({
                    "type": "price",
                    "token_id": token_id,
                    "market_id": market_id,
                    "outcome": outcome,
                    "price": price,
                    "timestamp": datetime.utcnow().isoformat(),
                })

    async def _handle_book_update(self, event: dict):
        """Process an order book update."""
        token_id = event.get("asset_id", "")
        bids = event.get("bids", [])
        asks = event.get("asks", [])

        if not bids or not asks:
            return

        try:
            best_bid = max(float(b["price"]) for b in bids)
            best_ask = min(float(a["price"]) for a in asks)
            mid = (best_bid + best_ask) / 2

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
                await self._queue.put({
                    "token_id": token_id,
                    "market_id": row["market_id"],
                    "outcome": row["outcome"],
                    "price": mid,
                    "bid": best_bid,
                    "ask": best_ask,
                    "source": "ws",
                })

        except (ValueError, KeyError) as e:
            logger.debug(f"Book parse error: {e}")

    async def _handle_trade(self, event: dict):
        """Process a trade event."""
        token_id = event.get("asset_id", "")
        price = float(event.get("price", 0))
        size = float(event.get("size", 0))
        side = event.get("side", "unknown")
        trade_id = event.get("id", f"ws_{token_id}_{datetime.utcnow().timestamp()}")

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
            self.db.record_trade(
                trade_id=trade_id,
                market_id=row["market_id"],
                token_id=token_id,
                outcome=row["outcome"],
                side=side,
                price=price,
                size=size,
            )

        logger.debug(f"Trade: {token_id[:8]}… @ {price:.4f}")

    @property
    def message_count(self) -> int:
        return self._message_count
