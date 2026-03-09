"""
Nexxore Market Data Service - Configuration
============================================
Dexscreener API integration config, cache TTLs, polling intervals.
"""

import os
from dataclasses import dataclass, field
from typing import List


@dataclass
class DexscreenerConfig:
    """Dexscreener API configuration."""
    base_url: str = "https://api.dexscreener.com"
    
    # Rate limits (requests per minute)
    slow_rpm: int = 60     # profiles, boosts, orders
    fast_rpm: int = 300    # search, pairs, token-pairs
    
    # Endpoints
    endpoints: dict = field(default_factory=lambda: {
        "token_profiles_latest": "/token-profiles/latest/v1",
        "token_boosts_latest": "/token-boosts/latest/v1",
        "token_boosts_top": "/token-boosts/top/v1",
        "pairs": "/latest/dex/pairs/{chain_id}/{pair_address}",
        "search": "/latest/dex/search",
        "token_pairs": "/token-pairs/v1/{chain_id}/{token_address}",
        "tokens": "/tokens/v1/{chain_id}/{token_addresses}",
        "orders": "/orders/v1/{chain_id}/{token_address}",
    })
    
    # Timeout
    request_timeout: int = 15
    max_retries: int = 3


@dataclass
class CacheConfig:
    """Redis cache configuration with per-data-type TTLs."""
    redis_url: str = os.getenv("REDIS_URL", "redis://localhost:6379/0")
    enabled: bool = os.getenv("CACHE_ENABLED", "true").lower() == "true"
    
    # TTLs in seconds (tuned per Dexscreener data freshness)
    ttl_top_movers: int = 10       # Hot tokens change fast
    ttl_pair_info: int = 30        # Individual pair data
    ttl_token_pairs: int = 300     # Token pools (5 min)
    ttl_search: int = 60           # Search results
    ttl_boosts: int = 30           # Boost data
    ttl_profiles: int = 120        # Token profiles (2 min)
    
    # Key prefixes
    prefix: str = "nexxore:market:"


@dataclass
class StorageConfig:
    """Database storage configuration."""
    db_url: str = os.getenv("DATABASE_URL", "sqlite:///data/market_data.db")
    db_path: str = os.getenv("DB_PATH", "data/market_data.db")
    
    # Retention
    snapshot_retention_hours: int = 168  # 7 days
    max_snapshots_per_pair: int = 10080  # 7 days at 1-min intervals


@dataclass
class PollerConfig:
    """Background polling worker configuration."""
    poll_interval: int = int(os.getenv("POLL_INTERVAL", "10"))  # seconds
    
    # Chains to monitor
    default_chains: List[str] = field(default_factory=lambda: [
        "solana", "base", "ethereum", "bsc", "arbitrum"
    ])
    
    # Per-scan limits
    top_movers_limit: int = 50
    boosted_limit: int = 30
    
    # Event thresholds
    volume_spike_multiplier: float = 2.0    # 2x avg = spike
    liquidity_change_pct: float = 20.0      # 20% change = alert
    price_surge_pct: float = 5.0            # 5% in 5 min = surge


@dataclass
class ServiceConfig:
    """Main service configuration."""
    host: str = os.getenv("MARKET_DATA_HOST", "0.0.0.0")
    port: int = int(os.getenv("MARKET_DATA_PORT", "3860"))
    debug: bool = os.getenv("DEBUG", "false").lower() == "true"
    log_level: str = os.getenv("LOG_LEVEL", "INFO")
    
    dexscreener: DexscreenerConfig = field(default_factory=DexscreenerConfig)
    cache: CacheConfig = field(default_factory=CacheConfig)
    storage: StorageConfig = field(default_factory=StorageConfig)
    poller: PollerConfig = field(default_factory=PollerConfig)


# Global config instance
config = ServiceConfig()
