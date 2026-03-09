"""
Nexxore Signal Engine - Configuration
=======================================
Signal detection thresholds, scoring weights, API config.
"""

import os
from dataclasses import dataclass, field
from typing import List, Dict


@dataclass
class MarketDataConfig:
    """Connection to the market-data service."""
    base_url: str = os.getenv("MARKET_DATA_URL", "http://localhost:3860")
    poll_interval: int = int(os.getenv("SIGNAL_POLL_INTERVAL", "10"))  # seconds
    timeout: int = 10


@dataclass
class SignalThresholds:
    """Thresholds for alpha signal detection."""
    
    # Signal 1: Momentum Spike
    momentum_price_change_5m: float = 5.0    # >5% in 5 min
    momentum_volume_multiplier: float = 2.0   # volume_5m > 2x avg
    momentum_min_liquidity: float = 500_000   # min $500k liquidity
    
    # Signal 2: Liquidity Inflow
    liquidity_increase_pct: float = 20.0      # >20% increase
    liquidity_window_minutes: float = 10.0     # within 10 minutes
    liquidity_min_base: float = 50_000         # min $50k liquidity
    
    # Signal 3: Volume Breakout
    volume_breakout_multiplier: float = 3.0   # volume_1h > 3x 24h_avg
    volume_min_24h: float = 10_000             # min $10k 24h volume
    volume_min_txns_1h: int = 20               # min 20 txns in 1h
    
    # Signal 4: New Pair Detection
    new_pair_max_age_hours: float = 24.0      # max 24h old
    new_pair_min_liquidity: float = 100_000   # min $100k liquidity
    new_pair_min_volume_1h: float = 5_000      # min $5k 1h volume


@dataclass
class ScoringWeights:
    """Weights for composite signal scoring (must sum to 100)."""
    momentum: float = 40.0    # 0-40 points
    volume: float = 30.0      # 0-30 points
    liquidity: float = 20.0   # 0-20 points
    new_pair: float = 10.0    # 0-10 points
    
    # Classification thresholds
    strong_trade: float = 70.0   # score > 70 = strong trade
    watchlist: float = 50.0      # score 50-70 = watchlist
    # score < 50 = ignore


@dataclass
class PipelineConfig:
    """Data pipeline configuration."""
    # Rolling window sizes
    window_5m: int = 300       # 5 minutes in seconds
    window_15m: int = 900
    window_1h: int = 3600
    window_24h: int = 86400
    
    # Buffer size (max snapshots to keep per pair)
    max_buffer_size: int = 500
    
    # Min data points before generating signals
    min_data_points: int = 3


@dataclass 
class WebSocketConfig:
    """WebSocket live feed configuration."""
    heartbeat_interval: int = 30  # seconds
    max_connections: int = 100
    broadcast_interval: int = 5   # seconds between broadcasts


@dataclass
class EngineConfig:
    """Main signal engine configuration."""
    host: str = os.getenv("SIGNAL_ENGINE_HOST", "0.0.0.0")
    port: int = int(os.getenv("SIGNAL_ENGINE_PORT", "3861"))
    debug: bool = os.getenv("DEBUG", "false").lower() == "true"
    log_level: str = os.getenv("LOG_LEVEL", "INFO")
    
    market_data: MarketDataConfig = field(default_factory=MarketDataConfig)
    thresholds: SignalThresholds = field(default_factory=SignalThresholds)
    scoring: ScoringWeights = field(default_factory=ScoringWeights)
    pipeline: PipelineConfig = field(default_factory=PipelineConfig)
    websocket: WebSocketConfig = field(default_factory=WebSocketConfig)


# Global config
engine_config = EngineConfig()
