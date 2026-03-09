"""
Nexxore Signal Engine - FastAPI Routes
========================================
Signal API endpoints for querying top signals, individual token scores,
chain-specific data, and service statistics.
"""

import logging
import time
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from ..config import engine_config
from ..pipeline.data_pipeline import pipeline
from ..scoring.scorer import scorer

logger = logging.getLogger("nexxore.signal-engine.api")

router = APIRouter(prefix="/api/v1", tags=["Signal Engine"])


# ─── Health & Stats ────────────────────────────────────────────────

@router.get("/health")
async def health():
    """Service health check."""
    return {
        "status": "ok",
        "service": "nexxore-signal-engine",
        "timestamp": time.time(),
    }


@router.get("/stats")
async def stats():
    """Detailed service statistics."""
    return {
        "pipeline": pipeline.get_stats(),
        "scorer": scorer.get_stats(),
        "config": {
            "thresholds": {
                "momentum_price_5m": engine_config.thresholds.momentum_price_change_5m,
                "momentum_vol_mult": engine_config.thresholds.momentum_volume_multiplier,
                "liquidity_increase_pct": engine_config.thresholds.liquidity_increase_pct,
                "volume_breakout_mult": engine_config.thresholds.volume_breakout_multiplier,
                "new_pair_max_age_h": engine_config.thresholds.new_pair_max_age_hours,
            },
            "scoring_weights": {
                "momentum": engine_config.scoring.momentum,
                "volume": engine_config.scoring.volume,
                "liquidity": engine_config.scoring.liquidity,
                "new_pair": engine_config.scoring.new_pair,
            },
        },
    }


# ─── Signal Endpoints ──────────────────────────────────────────────

@router.get("/signals/top")
async def get_top_signals(
    limit: int = Query(default=20, ge=1, le=100),
    min_score: float = Query(default=0, ge=0, le=100),
    chain: Optional[str] = Query(default=None),
):
    """Get top scored tokens across all chains.
    
    Returns tokens sorted by composite alpha score (0-100).
    Each token includes signal breakdown, classification, and market data.
    """
    if chain:
        tokens = scorer.get_by_chain(chain, limit=limit)
        tokens = [t for t in tokens if t.total_score >= min_score]
    else:
        tokens = scorer.get_top_signals(limit=limit, min_score=min_score)
    
    return {
        "count": len(tokens),
        "chain_filter": chain,
        "min_score": min_score,
        "tokens": [t.to_dict() for t in tokens],
        "timestamp": time.time(),
    }


@router.get("/signals/strong-trades")
async def get_strong_trades(
    limit: int = Query(default=10, ge=1, le=50),
):
    """Get tokens classified as strong trades (score > 70).
    
    These tokens have triggered multiple alpha signals with high confidence.
    """
    tokens = scorer.get_strong_trades(limit=limit)
    return {
        "count": len(tokens),
        "threshold": engine_config.scoring.strong_trade,
        "tokens": [t.to_dict() for t in tokens],
    }


@router.get("/signals/watchlist")
async def get_watchlist(
    limit: int = Query(default=20, ge=1, le=100),
):
    """Get tokens on the watchlist (score 50-70).
    
    These tokens show some alpha signals but need monitoring.
    """
    tokens = scorer.get_watchlist(limit=limit)
    return {
        "count": len(tokens),
        "threshold_range": [engine_config.scoring.watchlist, engine_config.scoring.strong_trade],
        "tokens": [t.to_dict() for t in tokens],
    }


@router.get("/signals/{token_address}")
async def get_token_signals(token_address: str):
    """Get detailed signal score for a specific token.
    
    Returns the full signal breakdown including individual signal
    strengths, classification, and metadata.
    """
    scored = scorer.get_token_score(token_address)
    
    if not scored:
        raise HTTPException(
            status_code=404,
            detail=f"No signals found for token: {token_address}"
        )
    
    return {
        "token": scored.to_dict(),
        "classification_guide": {
            "strong_trade": f"score >= {engine_config.scoring.strong_trade}",
            "watchlist": f"score >= {engine_config.scoring.watchlist}",
            "ignore": f"score < {engine_config.scoring.watchlist}",
        },
    }


@router.get("/signals/chain/{chain_id}")
async def get_chain_signals(
    chain_id: str,
    limit: int = Query(default=20, ge=1, le=100),
):
    """Get top signals for a specific chain."""
    tokens = scorer.get_by_chain(chain_id, limit=limit)
    
    return {
        "chain": chain_id,
        "count": len(tokens),
        "tokens": [t.to_dict() for t in tokens],
    }
