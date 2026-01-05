"""
Collectors Package - Data ingestion pipeline for research bot
"""

from .base_collector import (
    BaseCollector,
    FetchResult,
    CollectorHealth,
    CollectorStatus,
    RateLimiter,
    RetryConfig,
    collector_registry
)
from .market_data_collector import MarketDataCollector
from .derivatives_collector import DerivativesCollector, CoinglassCollector
from .onchain_collector import OnChainCollector
from .social_collector import SocialCollector
from .news_collector import NewsCollector

__all__ = [
    # Base classes
    'BaseCollector',
    'FetchResult',
    'CollectorHealth',
    'CollectorStatus',
    'RateLimiter',
    'RetryConfig',
    'collector_registry',
    
    # Collectors
    'MarketDataCollector',
    'DerivativesCollector',
    'CoinglassCollector',
    'OnChainCollector',
    'SocialCollector',
    'NewsCollector',
]
