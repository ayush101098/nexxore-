"""
Cohort engine entry point.

Usage:
    python -m cohorts.run                  # Run scheduler (continuous)
    python -m cohorts.run --once           # Single classification cycle
    python -m cohorts.run --wallet 0x...   # Classify single wallet
    python -m cohorts.run --summary        # Show cohort summary
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys

import asyncpg

# Add parent to path for config import
sys.path.insert(0, str(__import__("pathlib").Path(__file__).parent.parent))
from ingestion.config import Config

from .metrics import WalletMetricsComputer
from .classifier import CohortClassifier
from .scheduler import CohortScheduler

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("nexxore.cohorts")


async def run_scheduler(config: Config) -> None:
    """Run the cohort scheduler continuously."""
    pool = await asyncpg.create_pool(config.database_url, min_size=2, max_size=10)

    scheduler = CohortScheduler(
        pool=pool,
        interval=config.cohort_recompute_interval,
        min_trades=config.cohort_min_trades,
    )

    log.info("Starting cohort scheduler")
    try:
        await scheduler.start()
    finally:
        await pool.close()


async def run_once(config: Config) -> None:
    """Run a single classification cycle."""
    pool = await asyncpg.create_pool(config.database_url, min_size=2, max_size=5)

    scheduler = CohortScheduler(
        pool=pool,
        min_trades=config.cohort_min_trades,
    )

    result = await scheduler.run_once()

    print("\n╔══════════════════════════════════════╗")
    print("║   Cohort Classification Result       ║")
    print("╚══════════════════════════════════════╝\n")
    print(f"  Wallets computed:    {result['wallets_computed']:>8,}")
    print(f"  Wallets classified:  {result['wallets_classified']:>8,}")
    print(f"  Elapsed:             {result['elapsed_seconds']:>7.1f}s")
    print()

    summary = result.get("summary", {})
    if summary.get("pnl_tiers"):
        print("  PnL Tiers:")
        for tier, count in summary["pnl_tiers"].items():
            print(f"    {tier:<20s} {count:>8,}")

    if summary.get("size_tiers"):
        print("\n  Size Tiers:")
        for tier, count in summary["size_tiers"].items():
            print(f"    {tier:<20s} {count:>8,}")

    print()
    await pool.close()


async def classify_single(config: Config, wallet: str) -> None:
    """Classify a single wallet."""
    pool = await asyncpg.create_pool(config.database_url, min_size=1, max_size=3)

    # Compute metrics first
    computer = WalletMetricsComputer(pool)
    metrics = await computer.compute_wallet(wallet)

    if not metrics:
        print(f"\nNo fills found for wallet {wallet}")
        await pool.close()
        return

    # Classify
    classifier = CohortClassifier(pool)
    cohort = await classifier.classify_wallet(wallet)

    print(f"\n  Wallet:        {wallet}")
    print(f"  PnL Tier:      {cohort['pnl_tier']}")
    print(f"  Size Tier:     {cohort['size_tier']}")
    print(f"  Consistency:   {cohort['consistency']}")
    print(f"  Style:         {cohort['style']}")
    print(f"  Risk Profile:  {cohort['risk_profile']}")
    print(f"\n  Total PnL:     ${metrics['total_pnl']:,.2f}")
    print(f"  Trade Count:   {metrics['trade_count']:,}")
    print(f"  Win Rate:      {metrics['win_rate']:.1f}%")
    print(f"  Total Volume:  ${metrics['total_volume']:,.0f}")
    print(f"  Profit Factor: {metrics['profit_factor']:.2f}")
    print()

    await pool.close()


async def show_summary(config: Config) -> None:
    """Show cohort summary statistics."""
    pool = await asyncpg.create_pool(config.database_url, min_size=1, max_size=3)

    classifier = CohortClassifier(pool)
    summary = await classifier.get_cohort_summary()

    print("\n╔══════════════════════════════════════╗")
    print("║   Cohort Summary                     ║")
    print("╚══════════════════════════════════════╝\n")
    print(f"  Total Classified: {summary['total_classified']:,}")

    if summary.get("pnl_tiers"):
        print("\n  PnL Tiers:")
        for tier, count in summary["pnl_tiers"].items():
            pct = count / max(summary["total_classified"], 1) * 100
            bar = "█" * int(pct / 2)
            print(f"    {tier:<20s} {count:>8,}  ({pct:5.1f}%) {bar}")

    if summary.get("size_tiers"):
        print("\n  Size Tiers:")
        for tier, count in summary["size_tiers"].items():
            pct = count / max(summary["total_classified"], 1) * 100
            bar = "█" * int(pct / 2)
            print(f"    {tier:<20s} {count:>8,}  ({pct:5.1f}%) {bar}")

    print()
    await pool.close()


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Nexxore MCP Server — Cohort Classification Engine"
    )
    parser.add_argument(
        "--once", action="store_true", help="Single classification cycle"
    )
    parser.add_argument(
        "--wallet", type=str, help="Classify a single wallet address"
    )
    parser.add_argument(
        "--summary", action="store_true", help="Show cohort summary"
    )

    args = parser.parse_args()
    config = Config()

    if args.wallet:
        asyncio.run(classify_single(config, args.wallet))
    elif args.once:
        asyncio.run(run_once(config))
    elif args.summary:
        asyncio.run(show_summary(config))
    else:
        asyncio.run(run_scheduler(config))


if __name__ == "__main__":
    main()
