"""
Prediction Agent CLI — Entry point for the Polymarket data pipeline.

Usage:
    # Run the full pipeline (REST + WebSocket + refresh)
    python run.py

    # Seed markets only (no streaming)
    python run.py --seed

    # Show DB stats
    python run.py --status

    # Find markets that moved recently
    python run.py --movers --hours 1 --min-move 0.05

    # Print summary for a specific market
    python run.py --summary <market_id>
"""

import argparse
import asyncio
import logging
import sys
import os

# Ensure parent dir is on path so `agents.predictions` resolves
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from predictions.pipeline import PolymarketPipeline
from predictions.storage import MarketDatabase
from predictions.queries import (
    print_market_summary,
    find_moving_markets,
    find_high_volume_markets,
    find_expiring_soon,
    calibration_data,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("predictions")


def parse_args():
    p = argparse.ArgumentParser(
        description="Nexxore Polymarket Data Pipeline"
    )

    mode = p.add_mutually_exclusive_group()
    mode.add_argument(
        "--run",
        action="store_true",
        default=True,
        help="Run the full pipeline (default)",
    )
    mode.add_argument(
        "--seed",
        action="store_true",
        help="Seed markets from API then exit",
    )
    mode.add_argument(
        "--status",
        action="store_true",
        help="Show database stats then exit",
    )
    mode.add_argument(
        "--movers",
        action="store_true",
        help="Find markets with recent price movement",
    )
    mode.add_argument(
        "--volume",
        action="store_true",
        help="Find highest-volume markets",
    )
    mode.add_argument(
        "--expiring",
        action="store_true",
        help="Find markets expiring soon",
    )
    mode.add_argument(
        "--calibration",
        action="store_true",
        help="Show calibration data for resolved markets",
    )
    mode.add_argument(
        "--summary",
        type=str,
        metavar="MARKET_ID",
        help="Show summary for a specific market",
    )

    # Pipeline options
    p.add_argument(
        "--db",
        type=str,
        default="polymarket.db",
        help="SQLite database path (default: polymarket.db)",
    )
    p.add_argument(
        "--min-liquidity",
        type=float,
        default=5000,
        help="Min liquidity to monitor a market (default: 5000)",
    )
    p.add_argument(
        "--snapshot-interval",
        type=int,
        default=60,
        help="REST snapshot interval in seconds (default: 60)",
    )
    p.add_argument(
        "--refresh-interval",
        type=int,
        default=300,
        help="Metadata refresh interval in seconds (default: 300)",
    )
    p.add_argument(
        "--rate-limit",
        type=float,
        default=3.0,
        help="API requests per second (default: 3.0)",
    )

    # Query options
    p.add_argument("--hours", type=int, default=1, help="Lookback hours for queries")
    p.add_argument("--min-move", type=float, default=0.05, help="Min price move for --movers")
    p.add_argument("--limit", type=int, default=20, help="Max results for queries")

    return p.parse_args()


def cmd_seed(args):
    pipeline = PolymarketPipeline(db_path=args.db, rate_limit=args.rate_limit)
    markets = pipeline.initialize_markets()
    print(f"\n✅ Seeded {len(markets)} markets into {args.db}")
    stats = pipeline.db.get_market_count()
    _print_stats(stats)


def cmd_status(args):
    db = MarketDatabase(args.db)
    stats = db.get_market_count()
    _print_stats(stats)


def cmd_movers(args):
    db = MarketDatabase(args.db)
    movers = find_moving_markets(
        db, hours=args.hours, min_move=args.min_move, limit=args.limit
    )

    if not movers:
        print("No significant movers found.")
        return

    print(f"\n🔀 Markets that moved ≥{args.min_move:.2f} in the last {args.hours}h:\n")
    for m in movers:
        q = (m["question"] or "")[:50]
        print(
            f"  {q:50s}  "
            f"{m['first_price']:.3f} → {m['latest_price']:.3f}  "
            f"({m['price_move']:+.3f})"
        )


def cmd_volume(args):
    db = MarketDatabase(args.db)
    markets = find_high_volume_markets(db, min_volume=0, limit=args.limit)

    if not markets:
        print("No markets found.")
        return

    print(f"\n📊 Top {args.limit} markets by volume:\n")
    for m in markets:
        q = (m["question"] or "")[:50]
        vol = m["volume"]
        liq = m["liquidity"]
        print(f"  {q:50s}  vol=${vol:,.0f}  liq=${liq:,.0f}")


def cmd_expiring(args):
    db = MarketDatabase(args.db)
    markets = find_expiring_soon(db, hours=args.hours, limit=args.limit)

    if not markets:
        print(f"No markets expiring in the next {args.hours}h.")
        return

    print(f"\n⏰ Markets expiring within {args.hours}h:\n")
    for m in markets:
        q = (m["question"] or "")[:50]
        print(f"  {q:50s}  expires: {m['end_date']}")


def cmd_calibration(args):
    db = MarketDatabase(args.db)
    data = calibration_data(db, bucket_size=0.1)

    if not data:
        print("No resolved markets for calibration.")
        return

    print("\n📈 Calibration (predicted vs actual resolution rate):\n")
    print(f"  {'Bucket':>12s}  {'Count':>6s}  {'Actual %':>8s}")
    print(f"  {'─' * 12}  {'─' * 6}  {'─' * 8}")
    for b in data:
        print(
            f"  {b['bucket']:>12s}  {b['count']:>6d}  "
            f"{b['actual_rate']:>7.1%}"
        )


def cmd_summary(args):
    db = MarketDatabase(args.db)
    print_market_summary(db, args.summary)


async def cmd_run(args):
    pipeline = PolymarketPipeline(
        db_path=args.db,
        min_liquidity=args.min_liquidity,
        snapshot_interval=args.snapshot_interval,
        refresh_interval=args.refresh_interval,
        rate_limit=args.rate_limit,
    )

    try:
        await pipeline.run()
    except KeyboardInterrupt:
        logger.info("Shutting down…")
        pipeline.ws.stop()


def _print_stats(stats: dict):
    print(f"\n📦 Database Stats:")
    print(f"  Total markets:    {stats['total_markets']:,}")
    print(f"  Active markets:   {stats['active_markets']:,}")
    print(f"  Resolved markets: {stats['resolved_markets']:,}")
    print(f"  Price snapshots:  {stats['price_snapshots']:,}")
    print(f"  Trades:           {stats['trades']:,}")


def main():
    args = parse_args()

    if args.seed:
        cmd_seed(args)
    elif args.status:
        cmd_status(args)
    elif args.movers:
        cmd_movers(args)
    elif args.volume:
        cmd_volume(args)
    elif args.expiring:
        cmd_expiring(args)
    elif args.calibration:
        cmd_calibration(args)
    elif args.summary:
        cmd_summary(args)
    else:
        asyncio.run(cmd_run(args))


if __name__ == "__main__":
    main()
