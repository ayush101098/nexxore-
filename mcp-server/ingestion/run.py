"""
Ingestion layer entry point.

Usage:
    python -m ingestion.run                     # Start full pipeline (WS + fill indexer)
    python -m ingestion.run --trades-only       # Only WS trade stream
    python -m ingestion.run --fills-only        # Only REST fill indexer
    python -m ingestion.run --backfill          # Historical backfill
    python -m ingestion.run --backfill-funding  # Backfill funding rates only
    python -m ingestion.run --seed-assets       # Seed coin universe
    python -m ingestion.run --add-wallets w1,w2 # Add wallets to queue
    python -m ingestion.run --status            # Show ingestion stats
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import signal
import sys

from .config import Config
from .db import Database
from .ws_trades import HyperliquidTradeStream
from .fill_indexer import FillIndexer
from .backfill import HistoricalBackfill

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("nexxore.ingestion")


async def run_full_pipeline(config: Config) -> None:
    """Run WS trade stream + fill indexer concurrently."""
    db = Database(config)
    await db.connect()

    stream = HyperliquidTradeStream(db, config)
    indexer = FillIndexer(db, config)

    # Handle shutdown
    loop = asyncio.get_event_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(
            sig,
            lambda: asyncio.create_task(_shutdown(stream, indexer, db)),
        )

    log.info("Starting full ingestion pipeline")

    # Seed asset metadata first
    backfill = HistoricalBackfill(db, config)
    await backfill.backfill_asset_metadata()

    # Discover initial wallets
    await indexer.discover_wallets()

    # Run both concurrently
    await asyncio.gather(
        stream.start(config.coin_list),
        indexer.start(),
    )


async def run_trades_only(config: Config) -> None:
    """Run only the WebSocket trade stream."""
    db = Database(config)
    await db.connect()

    stream = HyperliquidTradeStream(db, config)

    log.info("Starting trade stream only")
    await stream.start(config.coin_list)


async def run_fills_only(config: Config) -> None:
    """Run only the REST fill indexer."""
    db = Database(config)
    await db.connect()

    indexer = FillIndexer(db, config)

    log.info("Starting fill indexer only")
    await indexer.start()


async def run_backfill(config: Config, days: int = 365) -> None:
    """Run historical backfill."""
    db = Database(config)
    await db.connect()

    backfill = HistoricalBackfill(db, config)

    log.info("Starting historical backfill (%d days)", days)

    # 1. Seed assets
    await backfill.backfill_asset_metadata()

    # 2. Backfill funding rates
    await backfill.backfill_funding_rates(days=days)

    # 3. Backfill fills for queued wallets
    wallets = await db.get_pending_wallets(limit=500)
    if wallets:
        await backfill.backfill_wallet_fills(wallets, days=days)

    await db.close()
    log.info("Backfill complete")


async def run_backfill_funding(config: Config, days: int = 365) -> None:
    """Backfill only funding rates."""
    db = Database(config)
    await db.connect()

    backfill = HistoricalBackfill(db, config)
    await backfill.backfill_funding_rates(days=days)

    await db.close()


async def seed_assets(config: Config) -> None:
    """Seed the coin universe metadata."""
    db = Database(config)
    await db.connect()

    backfill = HistoricalBackfill(db, config)
    count = await backfill.backfill_asset_metadata()

    await db.close()
    log.info("Seeded %d assets", count)


async def add_wallets(config: Config, wallets: list[str]) -> None:
    """Add wallets to the indexing queue."""
    db = Database(config)
    await db.connect()

    count = await db.add_wallets_to_queue(wallets, source="manual")
    await db.close()
    log.info("Added %d wallets to queue", count)


async def show_status(config: Config) -> None:
    """Show current ingestion statistics."""
    db = Database(config)
    await db.connect()

    stats = await db.get_stats()
    await db.close()

    print("\n╔══════════════════════════════════════╗")
    print("║   Nexxore Ingestion Status           ║")
    print("╚══════════════════════════════════════╝\n")
    print(f"  Market trades:       {stats['market_trades']:>12,}")
    print(f"  Wallet fills:        {stats['fills']:>12,}")
    print(f"  Wallets classified:  {stats['wallets_classified']:>12,}")
    print(f"  Coins tracked:       {stats['coins_tracked']:>12,}")
    print()


async def _shutdown(
    stream: HyperliquidTradeStream,
    indexer: FillIndexer,
    db: Database,
) -> None:
    """Graceful shutdown."""
    log.info("Shutting down…")
    await stream.stop()
    await indexer.stop()
    await db.close()
    sys.exit(0)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Nexxore MCP Server — Data Ingestion Layer"
    )
    parser.add_argument(
        "--trades-only",
        action="store_true",
        help="Run only WebSocket trade stream",
    )
    parser.add_argument(
        "--fills-only",
        action="store_true",
        help="Run only REST fill indexer",
    )
    parser.add_argument(
        "--backfill",
        action="store_true",
        help="Run historical backfill (funding + fills)",
    )
    parser.add_argument(
        "--backfill-funding",
        action="store_true",
        help="Backfill only funding rate history",
    )
    parser.add_argument(
        "--seed-assets",
        action="store_true",
        help="Seed coin universe metadata",
    )
    parser.add_argument(
        "--add-wallets",
        type=str,
        help="Comma-separated wallet addresses to add to queue",
    )
    parser.add_argument(
        "--status",
        action="store_true",
        help="Show ingestion statistics",
    )
    parser.add_argument(
        "--days",
        type=int,
        default=365,
        help="Days of history for backfill (default: 365)",
    )

    args = parser.parse_args()
    config = Config()

    if args.trades_only:
        asyncio.run(run_trades_only(config))
    elif args.fills_only:
        asyncio.run(run_fills_only(config))
    elif args.backfill:
        asyncio.run(run_backfill(config, days=args.days))
    elif args.backfill_funding:
        asyncio.run(run_backfill_funding(config, days=args.days))
    elif args.seed_assets:
        asyncio.run(seed_assets(config))
    elif args.add_wallets:
        wallets = [w.strip() for w in args.add_wallets.split(",")]
        asyncio.run(add_wallets(config, wallets))
    elif args.status:
        asyncio.run(show_status(config))
    else:
        asyncio.run(run_full_pipeline(config))


if __name__ == "__main__":
    main()
