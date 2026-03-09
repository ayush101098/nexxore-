"""
Nexxore Market Data - SQLite Storage Layer
===========================================
Persistent storage for pair snapshots with time-series queries.
Uses aiosqlite for async SQLite operations.
"""

import asyncio
import logging
import os
import time
from typing import Any, Dict, List, Optional

import aiosqlite

from ..config import config
from ..models import PairData

logger = logging.getLogger("nexxore.market-data.storage")

# Schema for the snapshots table
SCHEMA = """
CREATE TABLE IF NOT EXISTS dex_pairs_snapshot (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pair_address TEXT NOT NULL,
    chain_id TEXT NOT NULL,
    dex_id TEXT,
    base_token_address TEXT NOT NULL,
    base_token_symbol TEXT NOT NULL,
    base_token_name TEXT,
    quote_token_symbol TEXT,
    price_usd REAL DEFAULT 0,
    price_change_5m REAL DEFAULT 0,
    price_change_1h REAL DEFAULT 0,
    price_change_6h REAL DEFAULT 0,
    price_change_24h REAL DEFAULT 0,
    volume_5m REAL DEFAULT 0,
    volume_1h REAL DEFAULT 0,
    volume_6h REAL DEFAULT 0,
    volume_24h REAL DEFAULT 0,
    txns_5m_buys INTEGER DEFAULT 0,
    txns_5m_sells INTEGER DEFAULT 0,
    txns_1h_buys INTEGER DEFAULT 0,
    txns_1h_sells INTEGER DEFAULT 0,
    liquidity_usd REAL DEFAULT 0,
    fdv REAL DEFAULT 0,
    market_cap REAL DEFAULT 0,
    boost_active INTEGER DEFAULT 0,
    pair_created_at INTEGER,
    timestamp REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_snapshot_pair ON dex_pairs_snapshot(pair_address);
CREATE INDEX IF NOT EXISTS idx_snapshot_chain ON dex_pairs_snapshot(chain_id);
CREATE INDEX IF NOT EXISTS idx_snapshot_token ON dex_pairs_snapshot(base_token_address);
CREATE INDEX IF NOT EXISTS idx_snapshot_timestamp ON dex_pairs_snapshot(timestamp);
CREATE INDEX IF NOT EXISTS idx_snapshot_chain_time ON dex_pairs_snapshot(chain_id, timestamp);

-- Latest known state per pair (materialized for fast lookups)
CREATE TABLE IF NOT EXISTS dex_pairs_latest (
    pair_address TEXT PRIMARY KEY,
    chain_id TEXT NOT NULL,
    dex_id TEXT,
    base_token_address TEXT NOT NULL,
    base_token_symbol TEXT NOT NULL,
    base_token_name TEXT,
    quote_token_symbol TEXT,
    price_usd REAL DEFAULT 0,
    price_change_5m REAL DEFAULT 0,
    price_change_1h REAL DEFAULT 0,
    price_change_24h REAL DEFAULT 0,
    volume_1h REAL DEFAULT 0,
    volume_24h REAL DEFAULT 0,
    liquidity_usd REAL DEFAULT 0,
    fdv REAL DEFAULT 0,
    market_cap REAL DEFAULT 0,
    boost_active INTEGER DEFAULT 0,
    prev_liquidity_usd REAL DEFAULT 0,
    prev_volume_1h REAL DEFAULT 0,
    prev_price_usd REAL DEFAULT 0,
    first_seen REAL,
    last_updated REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_latest_chain ON dex_pairs_latest(chain_id);
CREATE INDEX IF NOT EXISTS idx_latest_token ON dex_pairs_latest(base_token_address);
"""


class MarketDatabase:
    """Async SQLite database for market data persistence."""
    
    def __init__(self):
        self.db_path = config.storage.db_path
        self._db: Optional[aiosqlite.Connection] = None
        self._lock = asyncio.Lock()
    
    async def connect(self):
        """Initialize database connection and create schema."""
        os.makedirs(os.path.dirname(self.db_path) or ".", exist_ok=True)
        self._db = await aiosqlite.connect(self.db_path)
        self._db.row_factory = aiosqlite.Row
        
        # Enable WAL mode for better concurrent read performance
        await self._db.execute("PRAGMA journal_mode=WAL")
        await self._db.execute("PRAGMA synchronous=NORMAL")
        
        # Create schema
        await self._db.executescript(SCHEMA)
        await self._db.commit()
        
        logger.info(f"Storage: Connected to SQLite at {self.db_path}")
    
    async def close(self):
        """Close database connection."""
        if self._db:
            await self._db.close()
    
    async def store_snapshot(self, pair: PairData):
        """Store a single pair snapshot."""
        async with self._lock:
            await self._db.execute(
                """INSERT INTO dex_pairs_snapshot 
                (pair_address, chain_id, dex_id, base_token_address, base_token_symbol,
                 base_token_name, quote_token_symbol, price_usd, price_change_5m,
                 price_change_1h, price_change_6h, price_change_24h,
                 volume_5m, volume_1h, volume_6h, volume_24h,
                 txns_5m_buys, txns_5m_sells, txns_1h_buys, txns_1h_sells,
                 liquidity_usd, fdv, market_cap, boost_active, pair_created_at, timestamp)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    pair.pair_address, pair.chain_id, pair.dex_id,
                    pair.base_token_address, pair.base_token_symbol,
                    pair.base_token_name, pair.quote_token_symbol,
                    pair.price_usd, pair.price_change_5m,
                    pair.price_change_1h, pair.price_change_6h, pair.price_change_24h,
                    pair.volume_5m, pair.volume_1h, pair.volume_6h, pair.volume_24h,
                    pair.txns_5m_buys, pair.txns_5m_sells,
                    pair.txns_1h_buys, pair.txns_1h_sells,
                    pair.liquidity_usd, pair.fdv, pair.market_cap,
                    pair.boost_active, pair.pair_created_at, pair.timestamp,
                )
            )
            await self._db.commit()
    
    async def store_snapshots_batch(self, pairs: List[PairData]):
        """Store multiple snapshots in a single transaction."""
        if not pairs:
            return
        
        async with self._lock:
            rows = [
                (
                    p.pair_address, p.chain_id, p.dex_id,
                    p.base_token_address, p.base_token_symbol,
                    p.base_token_name, p.quote_token_symbol,
                    p.price_usd, p.price_change_5m,
                    p.price_change_1h, p.price_change_6h, p.price_change_24h,
                    p.volume_5m, p.volume_1h, p.volume_6h, p.volume_24h,
                    p.txns_5m_buys, p.txns_5m_sells,
                    p.txns_1h_buys, p.txns_1h_sells,
                    p.liquidity_usd, p.fdv, p.market_cap,
                    p.boost_active, p.pair_created_at, p.timestamp,
                )
                for p in pairs
            ]
            
            await self._db.executemany(
                """INSERT INTO dex_pairs_snapshot 
                (pair_address, chain_id, dex_id, base_token_address, base_token_symbol,
                 base_token_name, quote_token_symbol, price_usd, price_change_5m,
                 price_change_1h, price_change_6h, price_change_24h,
                 volume_5m, volume_1h, volume_6h, volume_24h,
                 txns_5m_buys, txns_5m_sells, txns_1h_buys, txns_1h_sells,
                 liquidity_usd, fdv, market_cap, boost_active, pair_created_at, timestamp)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                rows,
            )
            
            # Update latest state table
            for p in pairs:
                await self._db.execute(
                    """INSERT INTO dex_pairs_latest 
                    (pair_address, chain_id, dex_id, base_token_address, base_token_symbol,
                     base_token_name, quote_token_symbol, price_usd, price_change_5m,
                     price_change_1h, price_change_24h, volume_1h, volume_24h,
                     liquidity_usd, fdv, market_cap, boost_active,
                     prev_liquidity_usd, prev_volume_1h, prev_price_usd,
                     first_seen, last_updated)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?)
                    ON CONFLICT(pair_address) DO UPDATE SET
                        price_usd=excluded.price_usd,
                        price_change_5m=excluded.price_change_5m,
                        price_change_1h=excluded.price_change_1h,
                        price_change_24h=excluded.price_change_24h,
                        volume_1h=excluded.volume_1h,
                        volume_24h=excluded.volume_24h,
                        prev_liquidity_usd=dex_pairs_latest.liquidity_usd,
                        prev_volume_1h=dex_pairs_latest.volume_1h,
                        prev_price_usd=dex_pairs_latest.price_usd,
                        liquidity_usd=excluded.liquidity_usd,
                        fdv=excluded.fdv,
                        market_cap=excluded.market_cap,
                        boost_active=excluded.boost_active,
                        last_updated=excluded.last_updated""",
                    (
                        p.pair_address, p.chain_id, p.dex_id,
                        p.base_token_address, p.base_token_symbol,
                        p.base_token_name, p.quote_token_symbol,
                        p.price_usd, p.price_change_5m,
                        p.price_change_1h, p.price_change_24h,
                        p.volume_1h, p.volume_24h,
                        p.liquidity_usd, p.fdv, p.market_cap,
                        p.boost_active, p.timestamp, p.timestamp,
                    )
                )
            
            await self._db.commit()
            logger.debug(f"Stored {len(pairs)} snapshots")
    
    async def get_latest_pairs(self, chain_id: Optional[str] = None, limit: int = 50) -> List[Dict]:
        """Get latest known state for pairs."""
        if chain_id:
            cursor = await self._db.execute(
                """SELECT * FROM dex_pairs_latest 
                WHERE chain_id = ? ORDER BY volume_24h DESC LIMIT ?""",
                (chain_id, limit)
            )
        else:
            cursor = await self._db.execute(
                "SELECT * FROM dex_pairs_latest ORDER BY volume_24h DESC LIMIT ?",
                (limit,)
            )
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]
    
    async def get_pair_history(
        self, pair_address: str, hours: int = 24, limit: int = 1000
    ) -> List[Dict]:
        """Get historical snapshots for a pair."""
        since = time.time() - (hours * 3600)
        cursor = await self._db.execute(
            """SELECT * FROM dex_pairs_snapshot 
            WHERE pair_address = ? AND timestamp >= ?
            ORDER BY timestamp DESC LIMIT ?""",
            (pair_address, since, limit)
        )
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]
    
    async def get_token_latest(self, chain_id: str, token_address: str) -> Optional[Dict]:
        """Get latest data for a specific token."""
        cursor = await self._db.execute(
            """SELECT * FROM dex_pairs_latest 
            WHERE chain_id = ? AND base_token_address = ?
            ORDER BY volume_24h DESC LIMIT 1""",
            (chain_id, token_address)
        )
        row = await cursor.fetchone()
        return dict(row) if row else None
    
    async def get_new_pairs(self, max_age_hours: float = 24, limit: int = 50) -> List[Dict]:
        """Get recently discovered pairs."""
        cursor = await self._db.execute(
            """SELECT * FROM dex_pairs_latest 
            WHERE first_seen >= ? AND liquidity_usd > 0
            ORDER BY first_seen DESC LIMIT ?""",
            (time.time() - max_age_hours * 3600, limit)
        )
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]
    
    async def get_liquidity_changes(self, min_pct: float = 20.0, limit: int = 50) -> List[Dict]:
        """Get pairs with significant liquidity changes."""
        cursor = await self._db.execute(
            """SELECT *, 
                CASE WHEN prev_liquidity_usd > 0 
                    THEN ((liquidity_usd - prev_liquidity_usd) / prev_liquidity_usd * 100)
                    ELSE 0 END as liquidity_change_pct
            FROM dex_pairs_latest 
            WHERE prev_liquidity_usd > 0 
              AND ABS((liquidity_usd - prev_liquidity_usd) / prev_liquidity_usd * 100) >= ?
            ORDER BY ABS((liquidity_usd - prev_liquidity_usd) / prev_liquidity_usd * 100) DESC
            LIMIT ?""",
            (min_pct, limit)
        )
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]
    
    async def cleanup_old_snapshots(self):
        """Remove snapshots older than retention period."""
        cutoff = time.time() - (config.storage.snapshot_retention_hours * 3600)
        async with self._lock:
            result = await self._db.execute(
                "DELETE FROM dex_pairs_snapshot WHERE timestamp < ?", (cutoff,)
            )
            await self._db.commit()
            deleted = result.rowcount
            if deleted:
                logger.info(f"Cleaned up {deleted} old snapshots")
    
    async def get_stats(self) -> Dict[str, Any]:
        """Database statistics."""
        cursor = await self._db.execute("SELECT COUNT(*) as cnt FROM dex_pairs_snapshot")
        snapshots = (await cursor.fetchone())["cnt"]
        
        cursor = await self._db.execute("SELECT COUNT(*) as cnt FROM dex_pairs_latest")
        pairs = (await cursor.fetchone())["cnt"]
        
        cursor = await self._db.execute(
            "SELECT COUNT(DISTINCT chain_id) as cnt FROM dex_pairs_latest"
        )
        chains = (await cursor.fetchone())["cnt"]
        
        return {
            "total_snapshots": snapshots,
            "tracked_pairs": pairs,
            "tracked_chains": chains,
            "db_path": self.db_path,
        }


# Global database instance
db = MarketDatabase()
