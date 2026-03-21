"""
Historical backfill for Hyperliquid data.
Fetches candle history, funding rate history, and bulk wallet fills
for backtesting purposes.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone, timedelta
from typing import Any

import httpx

from .config import Config
from .db import Database

log = logging.getLogger("nexxore.backfill")


class HistoricalBackfill:
    """
    Backfill historical Hyperliquid data for backtesting.

    Supports:
    1. Funding rate history per coin
    2. Wallet fill history (deep, up to 1 year)
    3. Candle/trade history via snapshots
    """

    def __init__(self, db: Database, config: Config) -> None:
        self.db = db
        self.config = config

    async def backfill_funding_rates(
        self, coins: list[str] | None = None, days: int = 365
    ) -> int:
        """Backfill historical funding rates for specified coins."""
        if coins is None:
            coins = await self._get_coin_universe()

        total = 0
        async with httpx.AsyncClient(timeout=15) as client:
            for coin in coins:
                try:
                    count = await self._backfill_coin_funding(
                        client, coin, days
                    )
                    total += count
                    log.info(
                        "Backfilled %d funding snapshots for %s", count, coin
                    )
                    await asyncio.sleep(0.1)
                except Exception as e:
                    log.warning("Funding backfill failed for %s: %s", coin, e)

        log.info("Total funding rate snapshots backfilled: %d", total)
        return total

    async def backfill_wallet_fills(
        self, wallets: list[str], days: int = 365
    ) -> int:
        """Deep-backfill fills for a list of wallets."""
        total = 0
        async with httpx.AsyncClient(timeout=15) as client:
            for wallet in wallets:
                try:
                    count = await self._backfill_wallet(
                        client, wallet, days
                    )
                    total += count
                    log.info(
                        "Backfilled %d fills for %s", count, wallet[:10]
                    )
                    await asyncio.sleep(0.1)
                except Exception as e:
                    log.warning(
                        "Fill backfill failed for %s: %s", wallet[:10], e
                    )

        log.info("Total fills backfilled: %d", total)
        return total

    async def backfill_asset_metadata(self) -> int:
        """Fetch and store the full coin universe with current metadata."""
        async with httpx.AsyncClient(timeout=15) as client:
            # Fetch meta
            resp = await client.post(
                self.config.rest_url,
                json={"type": "meta"},
            )
            resp.raise_for_status()
            meta = resp.json()

            # Fetch all mid prices
            resp2 = await client.post(
                self.config.rest_url,
                json={"type": "allMids"},
            )
            resp2.raise_for_status()
            mids = resp2.json()

            assets = []
            for i, coin_meta in enumerate(meta.get("universe", [])):
                name = coin_meta["name"]
                mid = float(mids.get(name, "0"))
                assets.append(
                    {
                        "coin": name,
                        "asset_index": i,
                        "max_leverage": coin_meta.get("maxLeverage"),
                        "sz_decimals": coin_meta.get("szDecimals"),
                        "mark_price": mid,
                        "mid_price": mid,
                        "funding_rate": None,
                        "open_interest": None,
                        "volume_24h": None,
                    }
                )

            count = await self.db.upsert_assets(assets)
            log.info("Stored %d asset metadata entries", count)
            return count

    # ── internal ──────────────────────────────────────────

    async def _backfill_coin_funding(
        self, client: httpx.AsyncClient, coin: str, days: int
    ) -> int:
        """Fetch funding rate history for a single coin."""
        resp = await client.post(
            self.config.rest_url,
            json={
                "type": "fundingHistory",
                "coin": coin,
                "startTime": int(
                    (
                        datetime.now(timezone.utc) - timedelta(days=days)
                    ).timestamp()
                    * 1000
                ),
            },
        )
        resp.raise_for_status()
        data = resp.json()

        if not data:
            return 0

        rates = [
            {
                "time": datetime.fromtimestamp(
                    entry["time"] / 1000, tz=timezone.utc
                ),
                "coin": coin,
                "funding_rate": float(entry["fundingRate"]),
                "premium": float(entry.get("premium", "0")),
                "open_interest": None,
                "mark_price": None,
                "oracle_price": None,
            }
            for entry in data
        ]

        return await self.db.insert_funding_rates(rates)

    async def _backfill_wallet(
        self, client: httpx.AsyncClient, wallet: str, days: int
    ) -> int:
        """Deep-backfill fills for a single wallet."""
        start_ms = int(
            (
                datetime.now(timezone.utc) - timedelta(days=days)
            ).timestamp()
            * 1000
        )
        now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)

        all_fills: list[dict[str, Any]] = []
        current_start = start_ms

        while current_start < now_ms:
            resp = await client.post(
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
            last_time = max(f["time"] for f in fills)
            current_start = last_time + 1

            await asyncio.sleep(0.1)

            if len(fills) < 2000:
                break

        if all_fills:
            normalized = []
            for f in all_fills:
                normalized.append(
                    {
                        "time": datetime.fromtimestamp(
                            f["time"] / 1000, tz=timezone.utc
                        ),
                        "coin": f["coin"],
                        "wallet": wallet.lower(),
                        "side": f["side"],
                        "price": float(f["px"]),
                        "size": abs(float(f["sz"])),
                        "fee": float(f.get("fee", "0")),
                        "fee_token": f.get("feeToken", "USDC"),
                        "closed_pnl": float(f.get("closedPnl", "0")),
                        "direction": f.get("dir"),
                        "order_id": str(f.get("oid", "")),
                        "trade_id": str(f.get("tid", "")),
                        "is_liquidation": f.get("liquidation", False),
                        "crossed": f.get("crossed", False),
                        "hash": f.get("hash"),
                    }
                )
            await self.db.insert_fills(normalized)

        return len(all_fills)

    async def _get_coin_universe(self) -> list[str]:
        """Fetch available coins from Hyperliquid."""
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                self.config.rest_url,
                json={"type": "meta"},
            )
            resp.raise_for_status()
            data = resp.json()
        return [a["name"] for a in data.get("universe", [])]
