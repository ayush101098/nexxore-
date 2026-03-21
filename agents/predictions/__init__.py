"""
Nexxore Predictions Agent — Polymarket Data Pipeline

Complete infrastructure for ingesting, normalizing, storing,
and querying prediction market data from Polymarket.

Layers:
    1. REST API Client (api_client.py)
    2. Data Normalization (normalizer.py)
    3. Storage — SQLite (storage.py)
    4. WebSocket Feed (ws_feed.py)
    5. Pipeline Orchestrator (pipeline.py)
    6. Query Utilities (queries.py)
"""

from .api_client import PolymarketClient, RateLimiter
from .normalizer import Market, OutcomeToken, MarketNormalizer
from .storage import MarketDatabase
from .ws_feed import PolymarketWebSocket
from .pipeline import PolymarketPipeline

__all__ = [
    "PolymarketClient",
    "RateLimiter",
    "Market",
    "OutcomeToken",
    "MarketNormalizer",
    "MarketDatabase",
    "PolymarketWebSocket",
    "PolymarketPipeline",
]
