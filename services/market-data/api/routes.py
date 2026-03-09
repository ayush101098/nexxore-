"""
Nexxore Market Data - FastAPI Routes
======================================
Internal API endpoints for pair data, top movers, search, and health.
Consumed by the signal-engine and frontend dashboard.
"""

import logging
import time
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query

from ..cache.redis_cache import cache, cached_data
from ..config import config
from ..dexscreener.client import DexscreenerClient
from ..models import PairData, TopMover
from ..poller.worker import poller
from ..storage.database import db

logger = logging.getLogger("nexxore.market-data.api")

router = APIRouter(prefix="/api/v1", tags=["Market Data"])


# ─── Health & Stats ────────────────────────────────────────────────

@router.get("/health")
async def health():
    """Service health check."""
    return {
        "status": "ok",
        "service": "nexxore-market-data",
        "timestamp": time.time(),
        "uptime": time.time() - _start_time,
    }


@router.get("/stats")
async def stats():
    """Detailed service statistics."""
    db_stats = await db.get_stats()
    return {
        "poller": poller.get_stats(),
        "cache": cache.stats(),
        "database": db_stats,
        "config": {
            "poll_interval": config.poller.poll_interval,
            "chains": config.poller.default_chains,
        },
    }


# ─── Top Movers ───────────────────────────────────────────────────

@router.get("/pairs/top-movers/{chain}")
async def get_top_movers(
    chain: str,
    limit: int = Query(default=30, ge=1, le=100),
):
    """Get top movers for a specific chain.
    
    Returns pairs sorted by 24h volume, including price changes,
    liquidity, and transaction data.
    """
    if chain not in config.poller.default_chains and chain != "all":
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported chain: {chain}. Supported: {config.poller.default_chains}"
        )
    
    # Try database first (latest state)
    chain_filter = None if chain == "all" else chain
    pairs = await db.get_latest_pairs(chain_id=chain_filter, limit=limit)
    
    if pairs:
        return {
            "chain": chain,
            "count": len(pairs),
            "pairs": pairs,
            "source": "database",
        }
    
    # Fallback: live fetch from Dexscreener
    async with DexscreenerClient() as client:
        chains_list = config.poller.default_chains if chain == "all" else [chain]
        live_pairs = await client.get_top_movers(chains=chains_list, limit=limit)
        movers = [TopMover.from_pair(p).to_dict() for p in live_pairs]
    
    return {
        "chain": chain,
        "count": len(movers),
        "pairs": movers,
        "source": "live",
    }


@router.get("/pairs/top-movers")
async def get_all_top_movers(limit: int = Query(default=50, ge=1, le=200)):
    """Get top movers across all tracked chains."""
    pairs = await db.get_latest_pairs(limit=limit)
    return {
        "chain": "all",
        "count": len(pairs),
        "pairs": pairs,
    }


# ─── Pair Data ─────────────────────────────────────────────────────

@router.get("/pairs/{chain}/{token}")
async def get_token_pairs(
    chain: str,
    token: str,
    limit: int = Query(default=10, ge=1, le=50),
):
    """Get all pairs/pools for a token on a specific chain.
    
    Args:
        chain: Chain ID (solana, base, ethereum, etc.)
        token: Token address
    """
    # Check database first
    db_data = await db.get_token_latest(chain, token)
    
    # Always fetch live for freshness
    async with DexscreenerClient() as client:
        pairs = await client.get_token_pairs(chain, token)
    
    if not pairs and not db_data:
        raise HTTPException(status_code=404, detail=f"Token not found: {chain}/{token}")
    
    return {
        "chain": chain,
        "token": token,
        "count": len(pairs),
        "pairs": [p.to_dict() for p in pairs[:limit]],
        "cached_state": db_data,
    }


@router.get("/pairs/info/{pair_address}")
async def get_pair_info(
    pair_address: str,
    chain: str = Query(default="solana"),
):
    """Get detailed info for a specific pair by address."""
    async with DexscreenerClient() as client:
        pair = await client.get_pair(chain, pair_address)
    
    if not pair:
        raise HTTPException(status_code=404, detail=f"Pair not found: {pair_address}")
    
    # Also get history from DB
    history = await db.get_pair_history(pair_address, hours=24, limit=100)
    
    return {
        "pair": pair.to_dict(),
        "history_24h": history,
        "history_count": len(history),
    }


# ─── Search ────────────────────────────────────────────────────────

@router.get("/search")
async def search_pairs(
    q: str = Query(..., min_length=1, max_length=200),
    limit: int = Query(default=20, ge=1, le=50),
):
    """Search Dexscreener for tokens by name, symbol, or address."""
    async with DexscreenerClient() as client:
        pairs = await client.search_pairs(q, limit=limit)
    
    return {
        "query": q,
        "count": len(pairs),
        "pairs": [p.to_dict() for p in pairs],
    }


# ─── New Pairs & Events ───────────────────────────────────────────

@router.get("/pairs/new")
async def get_new_pairs(
    max_age_hours: float = Query(default=24, ge=1, le=168),
    limit: int = Query(default=30, ge=1, le=100),
):
    """Get recently discovered pairs with minimum liquidity."""
    pairs = await db.get_new_pairs(max_age_hours=max_age_hours, limit=limit)
    return {
        "max_age_hours": max_age_hours,
        "count": len(pairs),
        "pairs": pairs,
    }


@router.get("/pairs/liquidity-changes")
async def get_liquidity_changes(
    min_pct: float = Query(default=20.0, ge=5, le=100),
    limit: int = Query(default=30, ge=1, le=100),
):
    """Get pairs with significant liquidity changes."""
    pairs = await db.get_liquidity_changes(min_pct=min_pct, limit=limit)
    return {
        "min_change_pct": min_pct,
        "count": len(pairs),
        "pairs": pairs,
    }


@router.get("/pairs/history/{pair_address}")
async def get_pair_history(
    pair_address: str,
    hours: int = Query(default=24, ge=1, le=168),
    limit: int = Query(default=500, ge=1, le=2000),
):
    """Get historical snapshots for a pair."""
    history = await db.get_pair_history(pair_address, hours=hours, limit=limit)
    if not history:
        raise HTTPException(status_code=404, detail=f"No history for pair: {pair_address}")
    return {
        "pair_address": pair_address,
        "hours": hours,
        "count": len(history),
        "snapshots": history,
    }


# Module-level start time for uptime tracking
_start_time = time.time()
