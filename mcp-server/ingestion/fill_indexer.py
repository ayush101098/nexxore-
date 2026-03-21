"""
Wallet fill indexer — polls Hyperliquid REST API for per-wallet fills.
Discovers wallets from leaderboard + cross-references, then indexes
their complete fill history into trading.fills.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone, timedelta
from typing import Any

import httpx

from .config import Config
from .db import Database

log = logging.getLogger("nexxore.fill_indexer")

# Hyperliquid rate limits: ~1200 requests per minute for info endpoint
_RATE_LIMIT_DELAY = 0.08  # 80ms between requests


class FillIndexer:
    """
    Indexes wallet-attributed fills via Hyperliquid REST API.

    1. Discovers wallets from leaderboard + wallet_queue table
    2. Fetches fills for each wallet using userFillsByTime
    3. Stores fills in trading.fills with dedup
    4. Also fetches + stores open positions for each wallet
    """

    def __init__(self, db: Database, config: Config) -> None:
        self.db = db
        self.config = config
        self._running = False
        self._client: httpx.AsyncClient | None = None

        self._stats = {
            "wallets_indexed": 0,
            "fills_stored": 0,
            "positions_stored": 0,
            "errors": 0,
            "cycles": 0,
        }

    # ── public interface ──────────────────────────────────

    async def start(self) -> None:
        """Run the fill indexer in a loop."""
        self._running = True
        self._client = httpx.AsyncClient(timeout=15)

        log.info("Fill indexer started (interval=%ds)", self.config.fill_index_interval)

        try:
            while self._running:
                await self._index_cycle()
                self._stats["cycles"] += 1
                await asyncio.sleep(self.config.fill_index_interval)
        finally:
            if self._client:
                await self._client.aclose()

    async def stop(self) -> None:
        self._running = False

    @property
    def stats(self) -> dict[str, Any]:
        return {**self._stats}

    # ── discovery ─────────────────────────────────────────

    async def discover_wallets(self) -> int:
        """Discover wallets from Hyperliquid leaderboard and add to queue."""
        try:
            wallets = await self._fetch_leaderboard_wallets()
            if wallets:
                count = await self.db.add_wallets_to_queue(
                    wallets, source="leaderboard"
                )
                log.info("Discovered %d wallets from leaderboard", count)
                return count
        except Exception as e:
            log.error("Wallet discovery failed: %s", e)
            self._stats["errors"] += 1
        return 0

    # ── main index cycle ──────────────────────────────────

    async def _index_cycle(self) -> None:
        """One indexing cycle: get pending wallets → fetch fills → store."""
        wallets = await self.db.get_pending_wallets(
            limit=self.config.wallet_index_batch
        )

        if not wallets:
            # If no pending wallets, discover more
            await self.discover_wallets()
            wallets = await self.db.get_pending_wallets(limit=10)

        if not wallets:
            return

        log.info("Indexing fills for %d wallets", len(wallets))

        for wallet in wallets:
            try:
                fill_count = await self._index_wallet(wallet)
                await self.db.mark_wallet_indexed(wallet, fill_count)
                self._stats["wallets_indexed"] += 1
                await asyncio.sleep(_RATE_LIMIT_DELAY)
            except Exception as e:
                log.warning("Failed to index wallet %s: %s", wallet[:10], e)
                self._stats["errors"] += 1

    async def _index_wallet(self, wallet: str) -> int:
        """Fetch and store all fills + positions for a single wallet."""
        # 1. Fetch recent fills (last 90 days)
        fills = await self._fetch_user_fills(wallet, days=90)
        if fills:
            normalized = [self._normalize_fill(f, wallet) for f in fills]
            await self.db.insert_fills(normalized)
            self._stats["fills_stored"] += len(normalized)

        # 2. Fetch current positions
        positions = await self._fetch_user_positions(wallet)
        if positions:
            normalized_pos = [
                self._normalize_position(p, wallet) for p in positions
            ]
            await self.db.upsert_positions(normalized_pos)
            self._stats["positions_stored"] += len(normalized_pos)

        return len(fills)

    # ── Hyperliquid REST API calls ────────────────────────

    async def _fetch_user_fills(
        self, wallet: str, days: int = 90
    ) -> list[dict[str, Any]]:
        """Fetch fills for a wallet using userFillsByTime."""
        assert self._client is not None

        now = int(datetime.now(timezone.utc).timestamp() * 1000)
        start = int(
            (datetime.now(timezone.utc) - timedelta(days=days)).timestamp()
            * 1000
        )

        all_fills: list[dict[str, Any]] = []

        # Paginate through time windows (API returns max 2000 per call)
        current_start = start
        while current_start < now:
            try:
                resp = await self._client.post(
                    self.config.rest_url,
                    json={
                        "type": "userFillsByTime",
                        "user": wallet,
                        "startTime": current_start,
                    },
                    timeout=15,
                )
                resp.raise_for_status()
                fills = resp.json()

                if not fills:
                    break

                all_fills.extend(fills)

                # Move start to after last fill
                last_time = max(f["time"] for f in fills)
                current_start = last_time + 1

                await asyncio.sleep(_RATE_LIMIT_DELAY)

                # Safety: if we got fewer than 2000, we've got all fills
                if len(fills) < 2000:
                    break

            except httpx.HTTPStatusError as e:
                if e.response.status_code == 429:
                    log.warning("Rate limited, backing off 5s")
                    await asyncio.sleep(5)
                    continue
                raise

        return all_fills

    async def _fetch_user_positions(
        self, wallet: str
    ) -> list[dict[str, Any]]:
        """Fetch current open positions for a wallet."""
        assert self._client is not None

        try:
            resp = await self._client.post(
                self.config.rest_url,
                json={"type": "clearinghouseState", "user": wallet},
                timeout=10,
            )
            resp.raise_for_status()
            data = resp.json()

            positions = []
            for pos in data.get("assetPositions", []):
                p = pos.get("position", {})
                if float(p.get("szi", "0")) != 0:
                    positions.append(p)

            return positions

        except Exception as e:
            log.warning("Failed to fetch positions for %s: %s", wallet[:10], e)
            return []

    async def _fetch_leaderboard_wallets(self) -> list[str]:
        """Fetch top wallets from Hyperliquid leaderboard-like data.
        Uses clearinghouseState for known addresses as seed."""
        assert self._client is not None

        # Fetch the top traders via a meta+universe query
        # Hyperliquid doesn't have a direct leaderboard endpoint,
        # so we seed with well-known whale addresses and expand from there.
        seed_wallets = [
            # Top known Hyperliquid traders (public addresses)
            "0x0000000000000000000000000000000000000000",
        ]

        # Try fetching from any available leaderboard source
        try:
            resp = await self._client.post(
                self.config.rest_url,
                json={"type": "leaderboard"},
                timeout=10,
            )
            if resp.status_code == 200:
                data = resp.json()
                if isinstance(data, list):
                    wallets = [
                        entry.get("ethAddress") or entry.get("user", "")
                        for entry in data
                        if entry.get("ethAddress") or entry.get("user")
                    ]
                    return wallets[:500]  # Top 500
        except Exception:
            pass  # Leaderboard endpoint may not exist

        return seed_wallets

    # ── normalizers ───────────────────────────────────────

    @staticmethod
    def _normalize_fill(
        fill: dict[str, Any], wallet: str
    ) -> dict[str, Any]:
        """Normalize a Hyperliquid fill to our schema."""
        return {
            "time": datetime.fromtimestamp(
                fill["time"] / 1000, tz=timezone.utc
            ),
            "coin": fill["coin"],
            "wallet": wallet.lower(),
            "side": fill["side"],  # 'Buy' or 'Sell'
            "price": float(fill["px"]),
            "size": abs(float(fill["sz"])),
            "fee": float(fill.get("fee", "0")),
            "fee_token": fill.get("feeToken", "USDC"),
            "closed_pnl": float(fill.get("closedPnl", "0")),
            "direction": fill.get("dir"),
            "order_id": str(fill.get("oid", "")),
            "trade_id": str(fill.get("tid", "")),
            "is_liquidation": fill.get("liquidation", False),
            "crossed": fill.get("crossed", False),
            "hash": fill.get("hash"),
        }

    @staticmethod
    def _normalize_position(
        pos: dict[str, Any], wallet: str
    ) -> dict[str, Any]:
        """Normalize a Hyperliquid position to our schema."""
        szi = float(pos.get("szi", "0"))
        entry_px = float(pos.get("entryPx", "0"))
        mark_px = float(pos.get("positionValue", "0")) / abs(szi) if szi else 0

        return {
            "wallet": wallet.lower(),
            "coin": pos.get("coin", ""),
            "side": "long" if szi > 0 else "short",
            "size": abs(szi),
            "entry_price": entry_px,
            "mark_price": mark_px,
            "unrealized_pnl": float(pos.get("unrealizedPnl", "0")),
            "leverage": float(pos.get("leverage", {}).get("value", "1"))
            if isinstance(pos.get("leverage"), dict)
            else float(pos.get("leverage", "1")),
            "liquidation_price": float(pos.get("liquidationPx", "0"))
            if pos.get("liquidationPx")
            else None,
            "margin_used": float(pos.get("marginUsed", "0")),
            "return_on_equity": float(pos.get("returnOnEquity", "0")),
        }
