"""
Nexxore Hyperliquid MCP Server
===============================
26 trading intelligence tools exposed via Model Context Protocol (stdio).

Categories
----------
  • Core Tools (5)           — trader profiles, cohort positions, top traders
  • Trader Analytics (5)     — risk-adjusted ranks, hidden gems, comparisons
  • Market Intelligence (6)  — L/S ratios, funding, liquidation zones
  • Real-Time Trade Flow (6) — whale feed, smart money, velocity
  • Unique Cohort Tools (4)  — money printer holdings, tier migration

Run
---
  python -m mcp_server.server
  DATABASE_URL=postgres://... python -m mcp_server.server
"""

from __future__ import annotations

import json
import logging
import os
from datetime import date, datetime
from typing import Any

import asyncpg
import httpx
from mcp.server.fastmcp import FastMCP

log = logging.getLogger("nexxore.mcp")


# ── Helpers ───────────────────────────────────────────────

def _sanitize(obj: Any) -> Any:
    """Make objects JSON-safe (datetimes, inf, NaN)."""
    if isinstance(obj, dict):
        return {k: _sanitize(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_sanitize(v) for v in obj]
    if isinstance(obj, (datetime, date)):
        return obj.isoformat()
    if isinstance(obj, float):
        if obj != obj:  # NaN
            return None
        if abs(obj) == float("inf"):
            return None
    return obj


def _j(data: Any) -> str:
    """Serialize data to indented JSON string."""
    return json.dumps(_sanitize(data), indent=2)


def _rows(records: list[asyncpg.Record]) -> list[dict]:
    """Convert asyncpg Records to list of dicts."""
    return [dict(r) for r in records]


# ── Database ──────────────────────────────────────────────

_DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://nexxore:nexxore_dev_2026@localhost:5433/nexxore_mcp",
)

_pool: asyncpg.Pool | None = None


async def _db() -> asyncpg.Pool:
    """Lazy-init asyncpg connection pool."""
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(_DATABASE_URL, min_size=2, max_size=10)
    return _pool


# ── MCP Server ────────────────────────────────────────────

mcp = FastMCP(
    "hyperliquid-mcp",
    instructions=(
        "Nexxore Hyperliquid trading intelligence server. "
        "Provides real-time trader analytics, cohort classification, "
        "market intelligence, and trade flow tools backed by TimescaleDB."
    ),
)

# Metric column whitelist (prevents SQL injection)
_METRIC_MAP = {
    "pnl": "wm.total_pnl",
    "win_rate": "wm.win_rate",
    "volume": "wm.total_volume",
    "profit_factor": "wm.profit_factor",
    "trade_count": "wm.trade_count",
}


# ╔═══════════════════════════════════════════════════════════╗
# ║  CORE TOOLS (1–5)                                        ║
# ╚═══════════════════════════════════════════════════════════╝


@mcp.tool()
async def pulse_trader_profile(wallet: str) -> str:
    """Returns full behavioral profile for a wallet including PnL tier,
    size tier, win rate, profit factor, and trade statistics.
    Useful for understanding a specific trader's performance and style."""
    pool = await _db()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT
                wc.wallet, wc.pnl_tier, wc.size_tier,
                wc.consistency, wc.style, wc.risk_profile,
                wm.total_pnl, wm.trade_count, wm.win_rate,
                wm.total_volume, wm.total_fees,
                wm.largest_win, wm.largest_loss,
                wm.profit_factor, wm.sharpe_ratio,
                wm.avg_trade_size, wm.avg_leverage,
                wm.unique_coins_traded,
                wm.active_since, wm.last_trade
            FROM trading.wallet_cohorts wc
            JOIN trading.wallet_metrics wm ON wc.wallet = wm.wallet
            WHERE wc.wallet = $1
            """,
            wallet.lower(),
        )
    if row is None:
        return _j({"error": "wallet not found"})
    return _j(dict(row))


@mcp.tool()
async def live_cohort_positions(coin: str, pnl_tier: str) -> str:
    """Returns current open positions for wallets in a specific PnL tier
    holding a given coin. Shows side, size, entry price, and unrealized PnL.
    Useful for seeing what the best (or worst) traders are doing right now."""
    pool = await _db()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT p.wallet, p.side, p.size, p.entry_price,
                   p.mark_price, p.unrealized_pnl, p.leverage
            FROM trading.positions p
            JOIN trading.wallet_cohorts wc ON p.wallet = wc.wallet
            WHERE p.coin = $1 AND wc.pnl_tier = $2
            ORDER BY ABS(p.unrealized_pnl) DESC
            """,
            coin.upper(),
            pnl_tier.lower(),
        )
    return _j(_rows(rows))


@mcp.tool()
async def top_traders(metric: str = "pnl", limit: int = 20) -> str:
    """Returns top N traders ranked by a metric: 'pnl', 'win_rate',
    'volume', 'profit_factor', or 'trade_count'.
    Includes tier assignments and key stats for each trader."""
    col = _METRIC_MAP.get(metric)
    if col is None:
        return _j({"error": f"Unknown metric '{metric}'. Use: {list(_METRIC_MAP)}"})
    pool = await _db()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            f"""
            SELECT wm.wallet, wm.total_pnl, wm.trade_count,
                   wm.win_rate, wm.total_volume, wm.profit_factor,
                   wc.pnl_tier, wc.size_tier
            FROM trading.wallet_metrics wm
            LEFT JOIN trading.wallet_cohorts wc ON wm.wallet = wc.wallet
            WHERE wm.trade_count >= 5
            ORDER BY {col} DESC NULLS LAST
            LIMIT $1
            """,
            min(limit, 100),
        )
    return _j(_rows(rows))


@mcp.tool()
async def live_cohort_bias(coin: str) -> str:
    """For each PnL tier, counts longs vs shorts and sums notional
    from open positions. Reveals whether smart money is bullish or
    bearish on a coin relative to weaker traders."""
    pool = await _db()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT
                wc.pnl_tier,
                COUNT(*) FILTER (WHERE p.side = 'long')  AS longs,
                COUNT(*) FILTER (WHERE p.side = 'short') AS shorts,
                COALESCE(SUM(p.size * p.entry_price)
                    FILTER (WHERE p.side = 'long'), 0)   AS long_notional,
                COALESCE(SUM(p.size * p.entry_price)
                    FILTER (WHERE p.side = 'short'), 0)  AS short_notional
            FROM trading.positions p
            JOIN trading.wallet_cohorts wc ON p.wallet = wc.wallet
            WHERE p.coin = $1
            GROUP BY wc.pnl_tier
            ORDER BY wc.pnl_tier
            """,
            coin.upper(),
        )
    return _j({
        r["pnl_tier"]: {
            "longs": r["longs"],
            "shorts": r["shorts"],
            "long_notional": r["long_notional"],
            "short_notional": r["short_notional"],
        }
        for r in rows
    })


@mcp.tool()
async def recent_large_trades(
    coin: str,
    min_notional: float = 10000,
    limit: int = 50,
) -> str:
    """Returns fills above a notional threshold in the last 24 hours,
    newest first. Useful for spotting large directional moves and
    institutional-sized activity."""
    pool = await _db()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT f.wallet, f.coin, f.side, f.price, f.size,
                   f.notional, f.direction, f.closed_pnl, f.time
            FROM trading.fills f
            WHERE f.coin = $1
              AND f.notional >= $2
              AND f.time > NOW() - INTERVAL '24 hours'
            ORDER BY f.time DESC
            LIMIT $3
            """,
            coin.upper(),
            min_notional,
            min(limit, 200),
        )
    return _j(_rows(rows))


# ╔═══════════════════════════════════════════════════════════╗
# ║  TRADER ANALYTICS (6–10)                                  ║
# ╚═══════════════════════════════════════════════════════════╝


@mcp.tool()
async def rank_traders_by_risk_adjusted(limit: int = 20) -> str:
    """Ranks traders by a risk-adjusted score: win_rate × profit_factor.
    Rewards consistency alongside profitability. Filters to wallets
    with ≥ 20 trades to avoid noise from small sample sizes."""
    pool = await _db()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT wm.wallet, wm.win_rate, wm.profit_factor,
                   ROUND((wm.win_rate * wm.profit_factor)::numeric, 2)
                       AS risk_adj_score,
                   wm.total_pnl, wm.trade_count, wm.total_volume,
                   wc.pnl_tier, wc.size_tier
            FROM trading.wallet_metrics wm
            LEFT JOIN trading.wallet_cohorts wc ON wm.wallet = wc.wallet
            WHERE wm.trade_count >= 20
              AND wm.profit_factor IS NOT NULL
              AND wm.profit_factor < 1000
            ORDER BY wm.win_rate * wm.profit_factor DESC
            LIMIT $1
            """,
            min(limit, 100),
        )
    return _j(_rows(rows))


@mcp.tool()
async def find_hidden_gems(limit: int = 50) -> str:
    """Discovers skilled but unknown traders: high win rate (>60%),
    significant experience (100+ trades), but NOT in the money_printer
    tier. These wallets may be future alpha sources worth watching."""
    pool = await _db()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT wm.wallet, wm.win_rate, wm.trade_count,
                   wm.total_pnl, wm.profit_factor, wm.total_volume,
                   wc.pnl_tier, wc.size_tier
            FROM trading.wallet_metrics wm
            JOIN trading.wallet_cohorts wc ON wm.wallet = wc.wallet
            WHERE wm.win_rate > 60
              AND wm.trade_count > 100
              AND wc.pnl_tier != 'money_printer'
            ORDER BY wm.win_rate DESC, wm.profit_factor DESC
            LIMIT $1
            """,
            min(limit, 200),
        )
    return _j(_rows(rows))


@mcp.tool()
async def wallet_trade_history(
    wallet: str,
    limit: int = 50,
    coin: str | None = None,
) -> str:
    """Returns recent fills for a wallet, optionally filtered by coin.
    Shows price, size, direction (open/close), and realized PnL for
    each trade. Useful for detailed trade-by-trade analysis."""
    pool = await _db()
    async with pool.acquire() as conn:
        if coin:
            rows = await conn.fetch(
                """
                SELECT coin, side, price, size, notional, direction,
                       closed_pnl, fee, time
                FROM trading.fills
                WHERE wallet = $1 AND coin = $2
                ORDER BY time DESC
                LIMIT $3
                """,
                wallet.lower(),
                coin.upper(),
                min(limit, 500),
            )
        else:
            rows = await conn.fetch(
                """
                SELECT coin, side, price, size, notional, direction,
                       closed_pnl, fee, time
                FROM trading.fills
                WHERE wallet = $1
                ORDER BY time DESC
                LIMIT $2
                """,
                wallet.lower(),
                min(limit, 500),
            )
    return _j(_rows(rows))


@mcp.tool()
async def cohort_summary() -> str:
    """Overview of the entire classified wallet universe.
    Returns count of wallets per PnL tier and size tier.
    Useful for understanding the population distribution of traders."""
    pool = await _db()
    async with pool.acquire() as conn:
        pnl = await conn.fetch(
            """
            SELECT pnl_tier, COUNT(*) AS count
            FROM trading.wallet_cohorts
            GROUP BY pnl_tier ORDER BY count DESC
            """
        )
        size = await conn.fetch(
            """
            SELECT size_tier, COUNT(*) AS count
            FROM trading.wallet_cohorts
            GROUP BY size_tier ORDER BY count DESC
            """
        )
        total = await conn.fetchval(
            "SELECT COUNT(*) FROM trading.wallet_cohorts"
        )
    return _j({
        "total_classified": total or 0,
        "pnl_tiers": {r["pnl_tier"]: r["count"] for r in pnl},
        "size_tiers": {r["size_tier"]: r["count"] for r in size},
    })


@mcp.tool()
async def compare_wallets(wallet_a: str, wallet_b: str) -> str:
    """Side-by-side stats comparison of two wallets.
    Returns metrics and tier assignments for both, making it easy
    to compare trading performance and style."""
    pool = await _db()
    results: dict[str, Any] = {}
    async with pool.acquire() as conn:
        for label, addr in [("wallet_a", wallet_a), ("wallet_b", wallet_b)]:
            row = await conn.fetchrow(
                """
                SELECT wm.wallet, wm.total_pnl, wm.trade_count,
                       wm.win_rate, wm.total_volume, wm.profit_factor,
                       wm.largest_win, wm.largest_loss,
                       wm.avg_trade_size, wm.avg_leverage,
                       wc.pnl_tier, wc.size_tier
                FROM trading.wallet_metrics wm
                LEFT JOIN trading.wallet_cohorts wc ON wm.wallet = wc.wallet
                WHERE wm.wallet = $1
                """,
                addr.lower(),
            )
            results[label] = dict(row) if row else {"error": f"{addr} not found"}
    return _j(results)


# ╔═══════════════════════════════════════════════════════════╗
# ║  MARKET INTELLIGENCE (11–16)                              ║
# ╚═══════════════════════════════════════════════════════════╝


@mcp.tool()
async def long_short_ratio(coin: str) -> str:
    """For a given coin, counts total longs vs shorts and sums notional
    in the positions table. Returns ratio, counts, and notionals.
    A quick gauge of overall market positioning."""
    pool = await _db()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT
                COUNT(*) FILTER (WHERE side = 'long')  AS longs,
                COUNT(*) FILTER (WHERE side = 'short') AS shorts,
                COALESCE(SUM(size * entry_price)
                    FILTER (WHERE side = 'long'), 0)   AS long_notional,
                COALESCE(SUM(size * entry_price)
                    FILTER (WHERE side = 'short'), 0)  AS short_notional
            FROM trading.positions
            WHERE coin = $1
            """,
            coin.upper(),
        )
    d = dict(row) if row else {}
    longs = d.get("longs") or 0
    shorts = d.get("shorts") or 0
    d["ratio"] = round(longs / shorts, 3) if shorts > 0 else None
    d["coin"] = coin.upper()
    return _j(d)


@mcp.tool()
async def top_coins_by_volume(limit: int = 20) -> str:
    """Ranks coins by total traded notional in the last 24 hours.
    Shows trade count and buy/sell volume breakdown.
    Useful for identifying the most active markets."""
    pool = await _db()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT
                coin,
                COUNT(*) AS trades,
                ROUND(SUM(notional)::numeric, 2) AS total_volume,
                ROUND(SUM(notional) FILTER
                    (WHERE side IN ('B', 'Buy'))::numeric, 2) AS buy_volume,
                ROUND(SUM(notional) FILTER
                    (WHERE side IN ('A', 'Sell'))::numeric, 2) AS sell_volume
            FROM trading.fills
            WHERE time > NOW() - INTERVAL '24 hours'
            GROUP BY coin
            ORDER BY SUM(notional) DESC
            LIMIT $1
            """,
            min(limit, 100),
        )
    return _j(_rows(rows))


@mcp.tool()
async def funding_rate_snapshot() -> str:
    """Live funding rates for all Hyperliquid perps, fetched directly
    from the Hyperliquid REST API. Returns coin, funding rate,
    open interest, mark price, and 24h volume per asset."""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                "https://api.hyperliquid.xyz/info",
                json={"type": "metaAndAssetCtxs"},
            )
            resp.raise_for_status()
            data = resp.json()

        meta_list = data[0]["universe"]
        ctx_list = data[1]

        result = []
        for meta, ctx in zip(meta_list, ctx_list):
            result.append({
                "coin": meta["name"],
                "funding_rate": ctx.get("funding", "0"),
                "open_interest": ctx.get("openInterest", "0"),
                "mark_price": ctx.get("markPx", "0"),
                "premium": ctx.get("premium", "0"),
                "day_volume": ctx.get("dayNtlVlm", "0"),
            })
        return _j(result)
    except Exception as exc:
        return _j({"error": f"Failed to fetch funding rates: {exc}"})


@mcp.tool()
async def liquidation_zones(coin: str, buckets: int = 20) -> str:
    """Identifies price levels where open positions cluster, signaling
    potential liquidation cascades. Groups positions by liquidation price
    into buckets and sums notional at risk per zone."""
    pool = await _db()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            WITH bounds AS (
                SELECT MIN(liquidation_price) AS lo,
                       MAX(liquidation_price) AS hi
                FROM trading.positions
                WHERE coin = $1
                  AND liquidation_price IS NOT NULL
                  AND size > 0
            )
            SELECT
                ROUND(MIN(p.liquidation_price)::numeric, 2) AS zone_low,
                ROUND(MAX(p.liquidation_price)::numeric, 2) AS zone_high,
                p.side,
                COUNT(*)                                     AS positions,
                ROUND(SUM(p.size)::numeric, 4)               AS total_size,
                ROUND(SUM(p.size * p.entry_price)::numeric, 2)
                    AS notional_at_risk
            FROM trading.positions p, bounds b
            WHERE p.coin = $1
              AND p.liquidation_price IS NOT NULL
              AND p.size > 0
              AND b.hi > b.lo
            GROUP BY
                width_bucket(p.liquidation_price, b.lo, b.hi + 0.01, $2),
                p.side
            HAVING COUNT(*) >= 2
            ORDER BY notional_at_risk DESC
            """,
            coin.upper(),
            min(buckets, 50),
        )
    return _j(_rows(rows))


@mcp.tool()
async def open_interest_by_tier(coin: str) -> str:
    """Breaks down open interest for a coin by trader PnL tier.
    Shows how much of the open interest is held by money printers
    versus losing traders — reveals which side the smart money is on."""
    pool = await _db()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT
                wc.pnl_tier,
                p.side,
                COUNT(*)                                        AS positions,
                ROUND(SUM(p.size)::numeric, 4)                  AS total_size,
                ROUND(SUM(p.size * p.entry_price)::numeric, 2)  AS notional
            FROM trading.positions p
            JOIN trading.wallet_cohorts wc ON p.wallet = wc.wallet
            WHERE p.coin = $1
            GROUP BY wc.pnl_tier, p.side
            ORDER BY wc.pnl_tier, p.side
            """,
            coin.upper(),
        )
    return _j(_rows(rows))


@mcp.tool()
async def market_activity_pulse(coin: str) -> str:
    """Trade count and volume over the last 1 minute, 5 minutes, and
    1 hour for a coin. Gives a quick sense of current market activity
    and momentum."""
    pool = await _db()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT
                COUNT(*) FILTER
                    (WHERE time > NOW() - INTERVAL '1 minute')  AS trades_1m,
                COALESCE(SUM(notional) FILTER
                    (WHERE time > NOW() - INTERVAL '1 minute'), 0)
                    AS volume_1m,
                COUNT(*) FILTER
                    (WHERE time > NOW() - INTERVAL '5 minutes') AS trades_5m,
                COALESCE(SUM(notional) FILTER
                    (WHERE time > NOW() - INTERVAL '5 minutes'), 0)
                    AS volume_5m,
                COUNT(*) FILTER
                    (WHERE time > NOW() - INTERVAL '1 hour')    AS trades_1h,
                COALESCE(SUM(notional) FILTER
                    (WHERE time > NOW() - INTERVAL '1 hour'), 0)
                    AS volume_1h
            FROM trading.fills
            WHERE coin = $1
              AND time > NOW() - INTERVAL '1 hour'
            """,
            coin.upper(),
        )
    d = dict(row) if row else {}
    d["coin"] = coin.upper()
    return _j(d)


# ╔═══════════════════════════════════════════════════════════╗
# ║  REAL-TIME TRADE FLOW (17–22)                             ║
# ╚═══════════════════════════════════════════════════════════╝


@mcp.tool()
async def largest_trades_today(
    limit: int = 20,
    coin: str | None = None,
) -> str:
    """Top N fills by notional in the last 24 hours, optionally filtered
    by coin. Highlights the biggest single trades on the exchange —
    useful for spotting institutional activity."""
    pool = await _db()
    async with pool.acquire() as conn:
        if coin:
            rows = await conn.fetch(
                """
                SELECT wallet, coin, side, price, size, notional,
                       direction, closed_pnl, time
                FROM trading.fills
                WHERE time > NOW() - INTERVAL '24 hours'
                  AND coin = $2
                ORDER BY notional DESC
                LIMIT $1
                """,
                min(limit, 200),
                coin.upper(),
            )
        else:
            rows = await conn.fetch(
                """
                SELECT wallet, coin, side, price, size, notional,
                       direction, closed_pnl, time
                FROM trading.fills
                WHERE time > NOW() - INTERVAL '24 hours'
                ORDER BY notional DESC
                LIMIT $1
                """,
                min(limit, 200),
            )
    return _j(_rows(rows))


@mcp.tool()
async def whale_activity_feed(
    coin: str | None = None,
    limit: int = 50,
) -> str:
    """Recent fills from leviathan and whale-tier wallets in the last
    hour. These large traders often move markets — tracking their
    activity in real time can signal upcoming price action."""
    pool = await _db()
    async with pool.acquire() as conn:
        if coin:
            rows = await conn.fetch(
                """
                SELECT f.wallet, f.coin, f.side, f.price, f.size,
                       f.notional, f.direction, f.time,
                       wc.pnl_tier, wc.size_tier
                FROM trading.fills f
                JOIN trading.wallet_cohorts wc ON f.wallet = wc.wallet
                WHERE wc.size_tier IN ('leviathan', 'whale')
                  AND f.time > NOW() - INTERVAL '1 hour'
                  AND f.coin = $2
                ORDER BY f.time DESC
                LIMIT $1
                """,
                min(limit, 200),
                coin.upper(),
            )
        else:
            rows = await conn.fetch(
                """
                SELECT f.wallet, f.coin, f.side, f.price, f.size,
                       f.notional, f.direction, f.time,
                       wc.pnl_tier, wc.size_tier
                FROM trading.fills f
                JOIN trading.wallet_cohorts wc ON f.wallet = wc.wallet
                WHERE wc.size_tier IN ('leviathan', 'whale')
                  AND f.time > NOW() - INTERVAL '1 hour'
                ORDER BY f.time DESC
                LIMIT $1
                """,
                min(limit, 200),
            )
    return _j(_rows(rows))


@mcp.tool()
async def position_opened(coin: str, limit: int = 50) -> str:
    """Recent position opens (Open Long / Open Short) for a coin in
    the last 24 hours, sorted by notional size. Shows who is entering
    new directional bets and how large they are."""
    pool = await _db()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT f.wallet, f.coin, f.side, f.direction,
                   f.price, f.size, f.notional, f.time,
                   wc.pnl_tier, wc.size_tier
            FROM trading.fills f
            LEFT JOIN trading.wallet_cohorts wc ON f.wallet = wc.wallet
            WHERE f.coin = $1
              AND f.direction IN ('Open Long', 'Open Short')
              AND f.time > NOW() - INTERVAL '24 hours'
            ORDER BY f.notional DESC
            LIMIT $2
            """,
            coin.upper(),
            min(limit, 200),
        )
    return _j(_rows(rows))


@mcp.tool()
async def position_closed(coin: str, limit: int = 50) -> str:
    """Recent position closes for a coin in the last 24 hours, sorted
    by absolute realized PnL. Shows who is exiting trades and whether
    they won or lost — useful for spotting capitulation or profit-taking."""
    pool = await _db()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT f.wallet, f.coin, f.side, f.direction,
                   f.price, f.size, f.notional, f.closed_pnl, f.time,
                   wc.pnl_tier, wc.size_tier
            FROM trading.fills f
            LEFT JOIN trading.wallet_cohorts wc ON f.wallet = wc.wallet
            WHERE f.coin = $1
              AND f.direction IN ('Close Long', 'Close Short')
              AND f.time > NOW() - INTERVAL '24 hours'
            ORDER BY ABS(f.closed_pnl) DESC
            LIMIT $2
            """,
            coin.upper(),
            min(limit, 200),
        )
    return _j(_rows(rows))


@mcp.tool()
async def smart_money_flow(coin: str) -> str:
    """Net notional flow (buys − sells) from money_printer-tier wallets
    over the last 1 hour, 4 hours, and 24 hours. Positive = smart money
    buying, negative = smart money selling. A leading directional signal."""
    pool = await _db()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT
                COALESCE(SUM(
                    CASE WHEN f.time > NOW() - INTERVAL '1 hour' THEN
                        CASE WHEN f.side IN ('B','Buy') THEN f.notional
                             ELSE -f.notional END
                    END
                ), 0) AS net_1h,
                COALESCE(SUM(
                    CASE WHEN f.time > NOW() - INTERVAL '4 hours' THEN
                        CASE WHEN f.side IN ('B','Buy') THEN f.notional
                             ELSE -f.notional END
                    END
                ), 0) AS net_4h,
                COALESCE(SUM(
                    CASE WHEN f.side IN ('B','Buy') THEN f.notional
                         ELSE -f.notional END
                ), 0) AS net_24h
            FROM trading.fills f
            JOIN trading.wallet_cohorts wc ON f.wallet = wc.wallet
            WHERE wc.pnl_tier = 'money_printer'
              AND f.coin = $1
              AND f.time > NOW() - INTERVAL '24 hours'
            """,
            coin.upper(),
        )
    d = dict(row) if row else {"net_1h": 0, "net_4h": 0, "net_24h": 0}
    d["coin"] = coin.upper()
    d["signal"] = (
        "bullish" if (d.get("net_1h") or 0) > 0
        else "bearish" if (d.get("net_1h") or 0) < 0
        else "neutral"
    )
    return _j(d)


@mcp.tool()
async def trade_velocity(coin: str) -> str:
    """Trades per minute for a coin over the last 10 minutes.
    Reveals whether trading activity is accelerating or decelerating
    — useful for detecting breakout conditions or fading momentum."""
    pool = await _db()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT
                date_trunc('minute', time)               AS minute,
                COUNT(*)                                 AS trades,
                ROUND(SUM(notional)::numeric, 2)         AS volume
            FROM trading.fills
            WHERE coin = $1
              AND time > NOW() - INTERVAL '10 minutes'
            GROUP BY date_trunc('minute', time)
            ORDER BY minute DESC
            """,
            coin.upper(),
        )
    return _j(_rows(rows))


# ╔═══════════════════════════════════════════════════════════╗
# ║  UNIQUE COHORT TOOLS (23–26)                              ║
# ╚═══════════════════════════════════════════════════════════╝


@mcp.tool()
async def money_printer_holdings() -> str:
    """Current open positions held by money_printer-tier wallets.
    These are the most profitable traders on the platform — seeing
    what they hold is a high-conviction directional signal."""
    pool = await _db()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT p.wallet, p.coin, p.side, p.size,
                   p.entry_price, p.mark_price,
                   p.unrealized_pnl, p.leverage
            FROM trading.positions p
            JOIN trading.wallet_cohorts wc ON p.wallet = wc.wallet
            WHERE wc.pnl_tier = 'money_printer'
            ORDER BY ABS(p.size * p.entry_price) DESC
            """
        )
    return _j(_rows(rows))


@mcp.tool()
async def giga_rekt_activity(limit: int = 50) -> str:
    """Recent trades by giga_rekt-tier wallets (biggest losers).
    Often used as a contrarian indicator — if the worst traders
    are all going long, it may be time to short, and vice versa."""
    pool = await _db()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT f.wallet, f.coin, f.side, f.price, f.size,
                   f.notional, f.direction, f.time
            FROM trading.fills f
            JOIN trading.wallet_cohorts wc ON f.wallet = wc.wallet
            WHERE wc.pnl_tier = 'giga_rekt'
              AND f.time > NOW() - INTERVAL '24 hours'
            ORDER BY f.time DESC
            LIMIT $1
            """,
            min(limit, 200),
        )
    return _j(_rows(rows))


@mcp.tool()
async def tier_migration(days: int = 7) -> str:
    """Wallets that changed PnL tier in the last N days.
    Shows previous and current tier — useful for spotting wallets
    on a hot streak (upgrading) or in a drawdown (downgrading).
    Requires the prev_pnl_tier column (see storage/migrations/)."""
    pool = await _db()
    async with pool.acquire() as conn:
        # Guard: check if column exists before querying
        col_exists = await conn.fetchval(
            """
            SELECT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'trading'
                  AND table_name = 'wallet_cohorts'
                  AND column_name = 'prev_pnl_tier'
            )
            """
        )
        if not col_exists:
            return _j({
                "error": (
                    "prev_pnl_tier column missing. Run migration: "
                    "ALTER TABLE trading.wallet_cohorts "
                    "ADD COLUMN prev_pnl_tier TEXT;"
                )
            })

        rows = await conn.fetch(
            """
            SELECT wc.wallet, wc.prev_pnl_tier, wc.pnl_tier,
                   wc.size_tier, wc.updated_at,
                   wm.total_pnl, wm.win_rate, wm.trade_count
            FROM trading.wallet_cohorts wc
            LEFT JOIN trading.wallet_metrics wm ON wc.wallet = wm.wallet
            WHERE wc.prev_pnl_tier IS NOT NULL
              AND wc.prev_pnl_tier != wc.pnl_tier
              AND wc.updated_at > NOW() - $1 * INTERVAL '1 day'
            ORDER BY wc.updated_at DESC
            """,
            days,
        )
    return _j(_rows(rows))


@mcp.tool()
async def cohort_consensus(coin: str) -> str:
    """For each PnL tier, shows what percentage of wallets are long
    vs short on a coin. Reveals whether consensus or divergence exists
    between skill levels — divergence is often a stronger signal."""
    pool = await _db()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT
                wc.pnl_tier,
                COUNT(*)                                            AS total,
                COUNT(*) FILTER (WHERE p.side = 'long')             AS longs,
                COUNT(*) FILTER (WHERE p.side = 'short')            AS shorts,
                ROUND(100.0 * COUNT(*) FILTER (WHERE p.side = 'long')
                    / NULLIF(COUNT(*), 0), 1)                       AS pct_long,
                ROUND(100.0 * COUNT(*) FILTER (WHERE p.side = 'short')
                    / NULLIF(COUNT(*), 0), 1)                       AS pct_short
            FROM trading.positions p
            JOIN trading.wallet_cohorts wc ON p.wallet = wc.wallet
            WHERE p.coin = $1
            GROUP BY wc.pnl_tier
            ORDER BY wc.pnl_tier
            """,
            coin.upper(),
        )
    return _j(_rows(rows))


# ── Entry point ───────────────────────────────────────────

if __name__ == "__main__":
    mcp.run()
