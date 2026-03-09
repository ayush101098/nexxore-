"""
Nexxore Signal Engine - Main Entry Point
==========================================
FastAPI application with data pipeline, signal scoring,
and WebSocket live feed. Consumes market-data service.

Usage:
    python -m services.signal-engine.main
    # or
    uvicorn services.signal_engine.main:app --port 3861
"""

import asyncio
import logging
import sys
import os

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from .api.routes import router
from .config import engine_config
from .pipeline.data_pipeline import pipeline
from .scoring.scorer import scorer
from .streaming.websocket import ws_manager

# ─── Logging Setup ──────────────────────────────────────────────────

logging.basicConfig(
    level=getattr(logging, engine_config.log_level),
    format="%(asctime)s | %(name)s | %(levelname)s | %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("nexxore.signal-engine")


# ─── Application Lifecycle ──────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup/shutdown lifecycle."""
    logger.info("=" * 60)
    logger.info("  Nexxore Signal Engine - Starting")
    logger.info("=" * 60)
    
    # Start WebSocket manager
    await ws_manager.start()
    logger.info("[OK] WebSocket manager started")
    
    # Start data pipeline (polls market-data service)
    pipeline_task = asyncio.create_task(pipeline.start())
    logger.info(f"[OK] Data pipeline started (polling {engine_config.market_data.base_url})")
    
    logger.info(f"[OK] Signal engine ready on http://{engine_config.host}:{engine_config.port}")
    logger.info(f"[OK] WebSocket: ws://{engine_config.host}:{engine_config.port}/ws/signals/live")
    logger.info(f"[OK] Scoring: momentum={engine_config.scoring.momentum}, volume={engine_config.scoring.volume}, liquidity={engine_config.scoring.liquidity}, new_pair={engine_config.scoring.new_pair}")
    logger.info("=" * 60)
    
    yield
    
    # Shutdown
    logger.info("Shutting down...")
    await pipeline.stop()
    pipeline_task.cancel()
    await ws_manager.stop()
    logger.info("Shutdown complete")


# ─── FastAPI App ────────────────────────────────────────────────────

app = FastAPI(
    title="Nexxore Signal Engine",
    description=(
        "Market Intelligence Agent that analyzes Dexscreener data to produce "
        "alpha trading signals. Detects momentum spikes, liquidity inflows, "
        "volume breakouts, and new pair opportunities."
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


# ─── WebSocket Endpoint ─────────────────────────────────────────────

@app.websocket("/ws/signals/live")
async def websocket_endpoint(websocket: WebSocket):
    """Live signal feed via WebSocket.
    
    Broadcasts:
    - signals_update: periodic top signals summary (every 5s)
    - signal_event: real-time signal detections
    - heartbeat: keep-alive pings (every 30s)
    """
    connected = await ws_manager.connect(websocket)
    if not connected:
        return
    
    try:
        while True:
            # Keep connection alive, handle client messages
            data = await websocket.receive_text()
            
            # Handle client commands
            if data == "ping":
                await websocket.send_json({"type": "pong", "timestamp": __import__("time").time()})
            elif data == "top":
                top = scorer.get_top_signals(limit=10)
                await websocket.send_json({
                    "type": "top_signals",
                    "tokens": [t.to_dict() for t in top],
                })
            elif data == "stats":
                await websocket.send_json({
                    "type": "stats",
                    "pipeline": pipeline.get_stats(),
                    "scorer": scorer.get_stats(),
                    "websocket": ws_manager.get_stats(),
                })
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)
    except Exception:
        ws_manager.disconnect(websocket)


# ─── Root Endpoint ──────────────────────────────────────────────────

@app.get("/")
async def root():
    return {
        "service": "nexxore-signal-engine",
        "version": "1.0.0",
        "description": "Market Intelligence Agent - Alpha Signal Detection",
        "docs": "/docs",
        "endpoints": {
            "health": "/api/v1/health",
            "stats": "/api/v1/stats",
            "top_signals": "/api/v1/signals/top",
            "strong_trades": "/api/v1/signals/strong-trades",
            "watchlist": "/api/v1/signals/watchlist",
            "token_signals": "/api/v1/signals/{token_address}",
            "chain_signals": "/api/v1/signals/chain/{chain_id}",
            "websocket": "ws://host:port/ws/signals/live",
        },
        "signal_types": [
            "momentum_spike - Price + volume acceleration",
            "liquidity_inflow - Pool capital injection",
            "volume_breakout - Volume exceeds historical average",
            "new_pair - New pool with meaningful backing",
        ],
        "scoring": {
            "momentum": "0-40 points",
            "volume": "0-30 points",
            "liquidity": "0-20 points",
            "new_pair": "0-10 points",
            "total": "0-100 points",
            "classification": ">70 strong_trade, 50-70 watchlist, <50 ignore",
        },
    }


# ─── Direct Run ─────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "services.signal-engine.main:app",
        host=engine_config.host,
        port=engine_config.port,
        reload=engine_config.debug,
        log_level=engine_config.log_level.lower(),
    )
