"""
Configuration for the ingestion layer.
Loads from .env or environment variables.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

# Load .env from mcp-server root
_env_path = Path(__file__).resolve().parent.parent / ".env"
if _env_path.exists():
    load_dotenv(_env_path)
else:
    # Try .env.example as fallback for defaults
    _example = Path(__file__).resolve().parent.parent / ".env.example"
    if _example.exists():
        load_dotenv(_example)


@dataclass
class Config:
    """Centralised configuration for all ingestion components."""

    # ── Database ──────────────────────────────────────────
    database_url: str = field(
        default_factory=lambda: os.getenv(
            "DATABASE_URL",
            "postgresql://nexxore:nexxore_dev_2026@localhost:5433/nexxore_mcp",
        )
    )

    # ── Hyperliquid endpoints ─────────────────────────────
    ws_url: str = field(
        default_factory=lambda: os.getenv(
            "HYPERLIQUID_WS_URL", "wss://api.hyperliquid.xyz/ws"
        )
    )
    rest_url: str = field(
        default_factory=lambda: os.getenv(
            "HYPERLIQUID_REST_URL", "https://api.hyperliquid.xyz/info"
        )
    )

    # ── Ingestion tuning ──────────────────────────────────
    coins: str = field(
        default_factory=lambda: os.getenv("INGEST_COINS", "all")
    )
    batch_size: int = field(
        default_factory=lambda: int(os.getenv("INGEST_BATCH_SIZE", "500"))
    )
    flush_interval: float = field(
        default_factory=lambda: float(os.getenv("INGEST_FLUSH_INTERVAL", "2"))
    )

    # ── Fill indexer ──────────────────────────────────────
    wallet_index_batch: int = field(
        default_factory=lambda: int(os.getenv("WALLET_INDEX_BATCH", "100"))
    )
    fill_index_interval: float = field(
        default_factory=lambda: float(os.getenv("FILL_INDEX_INTERVAL", "60"))
    )

    # ── Cohort engine ─────────────────────────────────────
    cohort_recompute_interval: float = field(
        default_factory=lambda: float(
            os.getenv("COHORT_RECOMPUTE_INTERVAL", "300")
        )
    )
    cohort_min_trades: int = field(
        default_factory=lambda: int(os.getenv("COHORT_MIN_TRADES", "10"))
    )

    @property
    def coin_list(self) -> list[str] | None:
        """Return explicit coin list or None for 'all' (dynamic from API)."""
        if self.coins.lower() == "all":
            return None
        return [c.strip().upper() for c in self.coins.split(",") if c.strip()]

    def __repr__(self) -> str:
        return (
            f"Config(db='{self.database_url[:30]}…', "
            f"coins={self.coins}, batch={self.batch_size}, "
            f"flush={self.flush_interval}s)"
        )
