"""
Nexxore Market Data Service - Main Entry Point
================================================
FastAPI application with background polling worker, cache init,
and database setup. Single command to launch everything.

Usage:
    python -m services.market-data.main
    # or
    uvicorn services.market_data.main:app --port 3860
"""

import asyncio
import logging
import sys
import os

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api.routes import router
from .cache.redis_cache import cache
from .config import config
from .poller.worker import poller
from .storage.database import db

# ─── Logging Setup ──────────────────────────────────────────────────

logging.basicConfig(
    level=getattr(logging, config.log_level),
    format="%(asctime)s | %(name)s | %(levelname)s | %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("nexxore.market-data")


# ─── Application Lifecycle ──────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup/shutdown lifecycle for the FastAPI app."""
    # Startup
    logger.info("=" * 60)
    logger.info("  Nexxore Market Data Service - Starting")
    logger.info("=" * 60)
    
    # Initialize database
    await db.connect()
    logger.info("[OK] Database connected")
    
    # Initialize cache
    await cache.connect()
    logger.info(f"[OK] Cache initialized ({cache.stats()['backend']})")
    
    # Start background poller
    poller_task = asyncio.create_task(poller.start())
    logger.info(f"[OK] Poller started (interval: {config.poller.poll_interval}s)")
    
    # Schedule periodic cleanup
    cleanup_task = asyncio.create_task(_periodic_cleanup())
    
    logger.info(f"[OK] Service ready on http://{config.host}:{config.port}")
    logger.info(f"[OK] Tracking chains: {config.poller.default_chains}")
    logger.info("=" * 60)
    
    yield
    
    # Shutdown
    logger.info("Shutting down...")
    await poller.stop()
    poller_task.cancel()
    cleanup_task.cancel()
    await cache.close()
    await db.close()
    logger.info("Shutdown complete")


async def _periodic_cleanup():
    """Periodically clean up old snapshots."""
    while True:
        await asyncio.sleep(3600)  # Every hour
        try:
            await db.cleanup_old_snapshots()
        except Exception as e:
            logger.error(f"Cleanup error: {e}")


# ─── FastAPI App ────────────────────────────────────────────────────

app = FastAPI(
    title="Nexxore Market Data Service",
    description=(
        "Dexscreener integration service providing real-time DEX pair data, "
        "top movers, volume tracking, and market events for Nexxore agents."
    ),
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API routes
app.include_router(router)


# ─── Root Endpoint ──────────────────────────────────────────────────

@app.get("/")
async def root():
    return {
        "service": "nexxore-market-data",
        "version": "1.0.0",
        "docs": "/docs",
        "endpoints": {
            "health": "/api/v1/health",
            "stats": "/api/v1/stats",
            "top_movers": "/api/v1/pairs/top-movers/{chain}",
            "token_pairs": "/api/v1/pairs/{chain}/{token}",
            "pair_info": "/api/v1/pairs/info/{pair_address}",
            "search": "/api/v1/search?q=...",
            "new_pairs": "/api/v1/pairs/new",
            "liquidity_changes": "/api/v1/pairs/liquidity-changes",
            "history": "/api/v1/pairs/history/{pair_address}",
        },
    }


# ─── Direct Run ─────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "services.market-data.main:app",
        host=config.host,
        port=config.port,
        reload=config.debug,
        log_level=config.log_level.lower(),
    )
