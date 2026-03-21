"""
Query Utilities — Analysis helpers for stored Polymarket data.

These functions work against a populated MarketDatabase and
are useful for ad-hoc analysis, dashboards, and signal generation.
"""

import logging
from typing import Dict, List, Optional, Any

from .storage import MarketDatabase

logger = logging.getLogger(__name__)


def market_summary(db: MarketDatabase, market_id: str) -> Dict[str, Any]:
    """
    Build a summary of a market's current state.

    Returns dict with latest prices, 24h range, and price change.
    """
    latest = db.get_latest_prices(market_id)
    history = db.get_price_history(market_id, hours=24)

    summary: Dict[str, Any] = {
        "market_id": market_id,
        "outcomes": [],
        "price_range_24h": None,
        "price_change_24h": None,
    }

    if not latest:
        return summary

    for row in latest:
        summary["outcomes"].append({
            "outcome": row["outcome"],
            "price": row["price"],
            "spread": row.get("spread"),
            "best_bid": row.get("best_bid"),
            "best_ask": row.get("best_ask"),
        })

    if history:
        yes_prices = [
            h["price"]
            for h in history
            if h["outcome"] and h["outcome"].lower() == "yes"
        ]
        if len(yes_prices) > 1:
            summary["price_range_24h"] = {
                "low": min(yes_prices),
                "high": max(yes_prices),
            }
            summary["price_change_24h"] = yes_prices[-1] - yes_prices[0]

    return summary


def print_market_summary(db: MarketDatabase, market_id: str):
    """Print a formatted market summary to stdout."""
    s = market_summary(db, market_id)

    print(f"\nMarket: {s['market_id']}")
    print("-" * 40)

    for o in s["outcomes"]:
        spread_str = (
            f"(spread: {o['spread']:.4f})" if o["spread"] is not None
            else "(spread: N/A)"
        )
        print(f"  {o['outcome']:>5}: {o['price']:.4f}  {spread_str}")

    if s["price_range_24h"]:
        r = s["price_range_24h"]
        print(
            f"\n  24h YES price range: {r['low']:.4f} — {r['high']:.4f}"
        )
    if s["price_change_24h"] is not None:
        print(f"  Price change: {s['price_change_24h']:+.4f}")


def find_moving_markets(
    db: MarketDatabase,
    hours: int = 1,
    min_move: float = 0.05,
    limit: int = 20,
) -> List[Dict[str, Any]]:
    """
    Find markets where YES price moved significantly recently.
    Useful for spotting where information is coming in.
    """
    with db.connection() as conn:
        rows = conn.execute(
            """
            WITH recent AS (
                SELECT
                    market_id,
                    outcome,
                    price,
                    snapshot_time,
                    ROW_NUMBER() OVER (
                        PARTITION BY market_id, outcome
                        ORDER BY snapshot_time DESC
                    ) AS rn_latest,
                    ROW_NUMBER() OVER (
                        PARTITION BY market_id, outcome
                        ORDER BY snapshot_time ASC
                    ) AS rn_earliest
                FROM price_snapshots
                WHERE snapshot_time > datetime('now', ?)
                  AND outcome = 'Yes'
            ),
            pivoted AS (
                SELECT
                    market_id,
                    MAX(CASE WHEN rn_latest  = 1 THEN price END) AS latest_price,
                    MAX(CASE WHEN rn_earliest = 1 THEN price END) AS first_price
                FROM recent
                GROUP BY market_id
            )
            SELECT
                p.market_id,
                m.question,
                p.first_price,
                p.latest_price,
                ABS(p.latest_price - p.first_price) AS price_move
            FROM pivoted p
            JOIN markets m ON p.market_id = m.market_id
            WHERE ABS(p.latest_price - p.first_price) >= ?
            ORDER BY price_move DESC
            LIMIT ?
            """,
            (f"-{hours} hours", min_move, limit),
        ).fetchall()

        return [dict(row) for row in rows]


def find_high_volume_markets(
    db: MarketDatabase,
    min_volume: float = 100_000,
    limit: int = 20,
) -> List[Dict[str, Any]]:
    """Find markets with highest trading volume."""
    with db.connection() as conn:
        rows = conn.execute(
            """
            SELECT market_id, question, category, volume, liquidity,
                   active, resolved
            FROM markets
            WHERE volume >= ?
            ORDER BY volume DESC
            LIMIT ?
            """,
            (min_volume, limit),
        ).fetchall()

        return [dict(row) for row in rows]


def find_expiring_soon(
    db: MarketDatabase,
    hours: int = 48,
    limit: int = 20,
) -> List[Dict[str, Any]]:
    """Find active markets expiring within the next N hours."""
    with db.connection() as conn:
        rows = conn.execute(
            """
            SELECT market_id, question, category, volume, liquidity,
                   end_date
            FROM markets
            WHERE active = 1
              AND closed = 0
              AND end_date IS NOT NULL
              AND end_date <= datetime('now', ?)
              AND end_date > datetime('now')
            ORDER BY end_date ASC
            LIMIT ?
            """,
            (f"+{hours} hours", limit),
        ).fetchall()

        return [dict(row) for row in rows]


def price_volatility(
    db: MarketDatabase,
    market_id: str,
    hours: int = 24,
) -> Optional[Dict[str, float]]:
    """
    Calculate simple price volatility for the YES token
    over the last N hours.  Returns std dev, mean, and
    coefficient of variation.
    """
    history = db.get_price_history(market_id, hours=hours)
    yes_prices = [
        h["price"]
        for h in history
        if h["outcome"] and h["outcome"].lower() == "yes"
    ]

    if len(yes_prices) < 2:
        return None

    mean = sum(yes_prices) / len(yes_prices)
    variance = sum((p - mean) ** 2 for p in yes_prices) / len(yes_prices)
    std = variance ** 0.5

    return {
        "mean": mean,
        "std": std,
        "cv": std / mean if mean > 0 else 0,
        "samples": len(yes_prices),
    }


def calibration_data(
    db: MarketDatabase,
    bucket_size: float = 0.1,
) -> List[Dict[str, Any]]:
    """
    Generate calibration data for resolved markets.

    Groups resolved markets by their final YES price into buckets
    and computes the actual resolution rate per bucket.
    Useful for assessing whether market prices are well-calibrated.
    """
    with db.connection() as conn:
        rows = conn.execute(
            """
            SELECT
                ps.price AS final_price,
                CASE WHEN m.winner = 'Yes' THEN 1 ELSE 0 END AS resolved_yes
            FROM markets m
            JOIN (
                SELECT market_id, price,
                       ROW_NUMBER() OVER (
                           PARTITION BY market_id
                           ORDER BY snapshot_time DESC
                       ) AS rn
                FROM price_snapshots
                WHERE outcome = 'Yes'
            ) ps ON m.market_id = ps.market_id AND ps.rn = 1
            WHERE m.resolved = 1
              AND m.winner IS NOT NULL
            """,
        ).fetchall()

    if not rows:
        return []

    # Build buckets
    buckets: Dict[str, Dict] = {}
    for row in rows:
        price = row["final_price"]
        bucket_key = round(
            int(price / bucket_size) * bucket_size, 2
        )
        label = f"{bucket_key:.1f}–{bucket_key + bucket_size:.1f}"

        if label not in buckets:
            buckets[label] = {"bucket": label, "count": 0, "yes_count": 0}

        buckets[label]["count"] += 1
        buckets[label]["yes_count"] += row["resolved_yes"]

    result = []
    for b in sorted(buckets.values(), key=lambda x: x["bucket"]):
        b["actual_rate"] = (
            b["yes_count"] / b["count"] if b["count"] > 0 else 0
        )
        result.append(b)

    return result
