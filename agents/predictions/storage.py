"""
Layer 3 — SQLite Storage

Schema covers:
  • markets          — metadata, state, liquidity
  • outcome_tokens   — YES / NO token mapping per market
  • price_snapshots  — time-series price + bid/ask data
  • trades           — individual trade events
  • market_state_history — lifecycle state transitions

Uses WAL mode for better concurrent read/write performance.
"""

import sqlite3
import logging
from contextlib import contextmanager
from datetime import datetime
from typing import List, Dict, Any, Optional

from .normalizer import Market

logger = logging.getLogger(__name__)


class MarketDatabase:
    """
    SQLite storage for Polymarket data.
    Handles markets, price snapshots, and trade history.
    """

    def __init__(self, db_path: str = "polymarket.db"):
        self.db_path = db_path
        self._create_tables()

    # ── connection management ─────────────────────────────────

    @contextmanager
    def connection(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    # ── schema creation ───────────────────────────────────────

    def _create_tables(self):
        with self.connection() as conn:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS markets (
                    market_id         TEXT PRIMARY KEY,
                    condition_id      TEXT,
                    question          TEXT NOT NULL,
                    category          TEXT,
                    description       TEXT,
                    resolution_source TEXT,

                    active            INTEGER,
                    closed            INTEGER,
                    archived          INTEGER,
                    resolved          INTEGER,

                    volume            REAL DEFAULT 0,
                    liquidity         REAL DEFAULT 0,

                    end_date          TEXT,
                    winner            TEXT,

                    created_at        TEXT,
                    updated_at        TEXT
                );

                CREATE TABLE IF NOT EXISTS outcome_tokens (
                    token_id    TEXT PRIMARY KEY,
                    market_id   TEXT NOT NULL,
                    outcome     TEXT NOT NULL,

                    FOREIGN KEY (market_id) REFERENCES markets(market_id)
                );

                CREATE TABLE IF NOT EXISTS price_snapshots (
                    id              INTEGER PRIMARY KEY AUTOINCREMENT,
                    token_id        TEXT NOT NULL,
                    market_id       TEXT NOT NULL,
                    outcome         TEXT NOT NULL,

                    price           REAL NOT NULL,
                    best_bid        REAL,
                    best_ask        REAL,
                    spread          REAL,

                    snapshot_time   TEXT NOT NULL,
                    source          TEXT DEFAULT 'api'
                );

                CREATE TABLE IF NOT EXISTS trades (
                    trade_id    TEXT PRIMARY KEY,
                    market_id   TEXT NOT NULL,
                    token_id    TEXT NOT NULL,
                    outcome     TEXT NOT NULL,

                    side        TEXT NOT NULL,
                    price       REAL NOT NULL,
                    size        REAL NOT NULL,

                    trade_time  TEXT NOT NULL,

                    FOREIGN KEY (market_id) REFERENCES markets(market_id)
                );

                CREATE TABLE IF NOT EXISTS market_state_history (
                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                    market_id   TEXT NOT NULL,
                    old_state   TEXT,
                    new_state   TEXT NOT NULL,
                    changed_at  TEXT NOT NULL,

                    FOREIGN KEY (market_id) REFERENCES markets(market_id)
                );

                -- Indices for common query patterns
                CREATE INDEX IF NOT EXISTS idx_snapshots_token_time
                    ON price_snapshots(token_id, snapshot_time);

                CREATE INDEX IF NOT EXISTS idx_snapshots_market_time
                    ON price_snapshots(market_id, snapshot_time);

                CREATE INDEX IF NOT EXISTS idx_trades_market_time
                    ON trades(market_id, trade_time);

                CREATE INDEX IF NOT EXISTS idx_state_history_market
                    ON market_state_history(market_id, changed_at);

                -- Unique constraint to prevent duplicate snapshots on reconnect
                CREATE UNIQUE INDEX IF NOT EXISTS idx_snapshots_dedup
                    ON price_snapshots(token_id, snapshot_time, source);
            """)

    # ── market CRUD ───────────────────────────────────────────

    def upsert_market(self, market: Market):
        """Insert or update a market and its outcome tokens."""
        with self.connection() as conn:
            # Detect state transitions for lifecycle tracking
            existing = conn.execute(
                "SELECT active, closed, resolved FROM markets WHERE market_id = ?",
                (market.market_id,),
            ).fetchone()

            conn.execute(
                """
                INSERT INTO markets
                    (market_id, condition_id, question, category,
                     description, resolution_source, active, closed,
                     archived, resolved, volume, liquidity,
                     end_date, winner, created_at, updated_at)
                VALUES
                    (:market_id, :condition_id, :question, :category,
                     :description, :resolution_source, :active, :closed,
                     :archived, :resolved, :volume, :liquidity,
                     :end_date, :winner, :created_at, :updated_at)
                ON CONFLICT(market_id) DO UPDATE SET
                    active     = excluded.active,
                    closed     = excluded.closed,
                    resolved   = excluded.resolved,
                    volume     = excluded.volume,
                    liquidity  = excluded.liquidity,
                    winner     = excluded.winner,
                    updated_at = excluded.updated_at
                """,
                {
                    "market_id": market.market_id,
                    "condition_id": market.condition_id,
                    "question": market.question,
                    "category": market.category,
                    "description": market.description,
                    "resolution_source": market.resolution_source,
                    "active": int(market.active),
                    "closed": int(market.closed),
                    "archived": int(market.archived),
                    "resolved": int(market.resolved),
                    "volume": market.volume,
                    "liquidity": market.liquidity,
                    "end_date": (
                        market.end_date_iso.isoformat()
                        if market.end_date_iso
                        else None
                    ),
                    "winner": market.winner,
                    "created_at": market.created_at.isoformat(),
                    "updated_at": datetime.utcnow().isoformat(),
                },
            )

            # Record state transition if changed
            if existing:
                old_state = self._derive_state(
                    existing["active"], existing["closed"], existing["resolved"]
                )
                new_state = self._derive_state(
                    market.active, market.closed, market.resolved
                )
                if old_state != new_state:
                    conn.execute(
                        """
                        INSERT INTO market_state_history
                            (market_id, old_state, new_state, changed_at)
                        VALUES (?, ?, ?, ?)
                        """,
                        (
                            market.market_id,
                            old_state,
                            new_state,
                            datetime.utcnow().isoformat(),
                        ),
                    )

            # Upsert outcome tokens
            for token in market.tokens:
                conn.execute(
                    """
                    INSERT OR REPLACE INTO outcome_tokens
                        (token_id, market_id, outcome)
                    VALUES (?, ?, ?)
                    """,
                    (token.token_id, market.market_id, token.outcome),
                )

    # ── price snapshots ───────────────────────────────────────

    def record_price_snapshot(
        self,
        token_id: str,
        market_id: str,
        outcome: str,
        price: float,
        bid: Optional[float] = None,
        ask: Optional[float] = None,
        source: str = "api",
    ):
        """Record a price snapshot (idempotent via unique index)."""
        spread = (ask - bid) if (bid is not None and ask is not None) else None
        now = datetime.utcnow().isoformat()

        with self.connection() as conn:
            try:
                conn.execute(
                    """
                    INSERT INTO price_snapshots
                        (token_id, market_id, outcome, price,
                         best_bid, best_ask, spread, snapshot_time, source)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (token_id, market_id, outcome, price,
                     bid, ask, spread, now, source),
                )
            except sqlite3.IntegrityError:
                # Duplicate snapshot — ignore silently
                pass

    # ── trades ────────────────────────────────────────────────

    def record_trade(
        self,
        trade_id: str,
        market_id: str,
        token_id: str,
        outcome: str,
        side: str,
        price: float,
        size: float,
        trade_time: Optional[str] = None,
    ):
        """Record a trade event (idempotent via PRIMARY KEY)."""
        with self.connection() as conn:
            try:
                conn.execute(
                    """
                    INSERT INTO trades
                        (trade_id, market_id, token_id, outcome,
                         side, price, size, trade_time)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        trade_id,
                        market_id,
                        token_id,
                        outcome,
                        side,
                        price,
                        size,
                        trade_time or datetime.utcnow().isoformat(),
                    ),
                )
            except sqlite3.IntegrityError:
                # Duplicate trade — ignore
                pass

    # ── queries ───────────────────────────────────────────────

    def get_price_history(
        self, market_id: str, hours: int = 24
    ) -> List[Dict[str, Any]]:
        """Get price history for a market over the last N hours."""
        with self.connection() as conn:
            cutoff = datetime.utcnow().timestamp() - (hours * 3600)
            cutoff_str = datetime.utcfromtimestamp(cutoff).isoformat()

            rows = conn.execute(
                """
                SELECT
                    token_id, outcome, price,
                    best_bid, best_ask, spread,
                    snapshot_time
                FROM price_snapshots
                WHERE market_id = ?
                  AND snapshot_time > ?
                ORDER BY snapshot_time ASC
                """,
                (market_id, cutoff_str),
            ).fetchall()

            return [dict(row) for row in rows]

    def get_active_markets(
        self, min_liquidity: float = 1000
    ) -> List[Dict[str, Any]]:
        """Get active markets above a liquidity threshold."""
        with self.connection() as conn:
            rows = conn.execute(
                """
                SELECT
                    m.*,
                    t.token_id, t.outcome
                FROM markets m
                JOIN outcome_tokens t ON m.market_id = t.market_id
                WHERE m.active = 1
                  AND m.closed = 0
                  AND m.liquidity >= ?
                ORDER BY m.liquidity DESC
                """,
                (min_liquidity,),
            ).fetchall()

            return [dict(row) for row in rows]

    def get_latest_prices(self, market_id: str) -> List[Dict[str, Any]]:
        """Get most recent price for each outcome in a market."""
        with self.connection() as conn:
            rows = conn.execute(
                """
                SELECT ps.*
                FROM price_snapshots ps
                INNER JOIN (
                    SELECT token_id, MAX(snapshot_time) AS max_time
                    FROM price_snapshots
                    WHERE market_id = ?
                    GROUP BY token_id
                ) latest ON ps.token_id  = latest.token_id
                        AND ps.snapshot_time = latest.max_time
                WHERE ps.market_id = ?
                """,
                (market_id, market_id),
            ).fetchall()

            return [dict(row) for row in rows]

    def get_market_state_history(
        self, market_id: str
    ) -> List[Dict[str, Any]]:
        """Get lifecycle state transitions for a market."""
        with self.connection() as conn:
            rows = conn.execute(
                """
                SELECT old_state, new_state, changed_at
                FROM market_state_history
                WHERE market_id = ?
                ORDER BY changed_at ASC
                """,
                (market_id,),
            ).fetchall()
            return [dict(row) for row in rows]

    def get_market_count(self) -> Dict[str, int]:
        """Quick stats on stored markets."""
        with self.connection() as conn:
            total = conn.execute(
                "SELECT COUNT(*) FROM markets"
            ).fetchone()[0]
            active = conn.execute(
                "SELECT COUNT(*) FROM markets WHERE active = 1"
            ).fetchone()[0]
            resolved = conn.execute(
                "SELECT COUNT(*) FROM markets WHERE resolved = 1"
            ).fetchone()[0]
            snapshots = conn.execute(
                "SELECT COUNT(*) FROM price_snapshots"
            ).fetchone()[0]
            trades = conn.execute(
                "SELECT COUNT(*) FROM trades"
            ).fetchone()[0]

            return {
                "total_markets": total,
                "active_markets": active,
                "resolved_markets": resolved,
                "price_snapshots": snapshots,
                "trades": trades,
            }

    # ── helpers ───────────────────────────────────────────────

    @staticmethod
    def _derive_state(active: Any, closed: Any, resolved: Any) -> str:
        if resolved:
            return "resolved"
        if closed:
            return "closed"
        if active:
            return "active"
        return "archived"
