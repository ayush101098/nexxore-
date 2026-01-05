"""
Research Bot API - FastAPI server for trade setups and ML predictions
"""

import asyncio
import logging
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
import asyncpg
import redis.asyncio as aioredis
import uvicorn

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


# ============== Pydantic Models ==============

class HealthResponse(BaseModel):
    status: str
    timestamp: str
    version: str
    database: str
    redis: str
    collectors: Dict[str, str] = {}


class SetupResponse(BaseModel):
    id: int
    symbol: str
    direction: str
    timeframe: str
    setup_type: str
    current_price: float
    entry_min: float
    entry_max: float
    invalidation: float
    target_1: Optional[float]
    target_2: Optional[float]
    confidence_score: float
    risk_reward_ratio: float
    quality_score: float
    regime: Optional[str]
    supporting_factors: Dict[str, Any]
    risk_factors: Dict[str, Any]
    created_at: str
    status: str


class SetupListResponse(BaseModel):
    setups: List[SetupResponse]
    count: int
    timestamp: str


class PredictionResponse(BaseModel):
    symbol: str
    timestamp: str
    predictions: Dict[str, Dict[str, Any]]
    features: Dict[str, float]
    regime: Optional[str]


class SymbolStats(BaseModel):
    symbol: str
    price: float
    change_24h: float
    volume_24h: float
    volatility: float
    regime: Optional[str]
    active_setups: int


class MarketOverview(BaseModel):
    total_setups: int
    bullish_setups: int
    bearish_setups: int
    avg_confidence: float
    market_regime: str
    top_symbols: List[SymbolStats]
    timestamp: str


# ============== App State ==============

class AppState:
    """Application state container"""
    db_pool: Optional[asyncpg.Pool] = None
    redis: Optional[aioredis.Redis] = None
    feature_engineer = None
    model_registry = None
    ensemble_predictor = None
    signal_generator = None
    collectors = {}
    
    # WebSocket connections
    ws_connections: List[WebSocket] = []


state = AppState()


# ============== Lifespan Management ==============

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage application lifecycle"""
    logger.info("Starting Research Bot API...")
    
    # Initialize database pool
    try:
        state.db_pool = await asyncpg.create_pool(
            host=os.getenv('DB_HOST', 'localhost'),
            port=int(os.getenv('DB_PORT', 5432)),
            user=os.getenv('DB_USER', 'research_bot'),
            password=os.getenv('DB_PASSWORD', 'research_bot_password'),
            database=os.getenv('DB_NAME', 'research_bot'),
            min_size=5,
            max_size=20
        )
        logger.info("Database pool created")
    except Exception as e:
        logger.error(f"Failed to create database pool: {e}")
        raise
    
    # Initialize Redis
    try:
        state.redis = aioredis.from_url(
            os.getenv('REDIS_URL', 'redis://localhost:6379'),
            encoding='utf-8',
            decode_responses=True
        )
        await state.redis.ping()
        logger.info("Redis connected")
    except Exception as e:
        logger.error(f"Failed to connect to Redis: {e}")
        raise
    
    # Initialize components (lazy loading for now)
    logger.info("Research Bot API ready")
    
    yield
    
    # Cleanup
    logger.info("Shutting down Research Bot API...")
    
    if state.db_pool:
        await state.db_pool.close()
    if state.redis:
        await state.redis.close()
    
    # Close WebSocket connections
    for ws in state.ws_connections:
        try:
            await ws.close()
        except:
            pass


# ============== FastAPI App ==============

app = FastAPI(
    title="Crypto Research Bot API",
    description="Autonomous crypto trading research analyst - ML-powered trade setups",
    version="1.0.0",
    lifespan=lifespan
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure appropriately for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============== Health & Status ==============

@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint"""
    db_status = "connected"
    redis_status = "connected"
    
    try:
        async with state.db_pool.acquire() as conn:
            await conn.execute("SELECT 1")
    except:
        db_status = "disconnected"
    
    try:
        await state.redis.ping()
    except:
        redis_status = "disconnected"
    
    return HealthResponse(
        status="healthy" if db_status == "connected" and redis_status == "connected" else "degraded",
        timestamp=datetime.now(timezone.utc).isoformat(),
        version="1.0.0",
        database=db_status,
        redis=redis_status,
        collectors={name: c.get_health().status.value for name, c in state.collectors.items()}
    )


@app.get("/status")
async def get_status():
    """Get detailed system status"""
    async with state.db_pool.acquire() as conn:
        # Data freshness
        freshness = await conn.fetch("""
            SELECT 
                'market_data' as source,
                MAX(timestamp) as last_update,
                COUNT(*) as record_count
            FROM market_data
            WHERE timestamp > NOW() - INTERVAL '1 hour'
            UNION ALL
            SELECT 
                'derivatives_data' as source,
                MAX(timestamp) as last_update,
                COUNT(*) as record_count
            FROM derivatives_data
            WHERE timestamp > NOW() - INTERVAL '1 hour'
        """)
        
        # Active setups count
        setups_count = await conn.fetchval("""
            SELECT COUNT(*) FROM trade_setups WHERE status = 'ACTIVE'
        """)
    
    return {
        "data_sources": [dict(r) for r in freshness],
        "active_setups": setups_count,
        "websocket_clients": len(state.ws_connections),
        "timestamp": datetime.now(timezone.utc).isoformat()
    }


# ============== Trade Setups ==============

@app.get("/api/v1/setups", response_model=SetupListResponse)
async def get_trade_setups(
    min_confidence: float = Query(0.5, ge=0, le=1),
    direction: Optional[str] = Query(None, regex="^(LONG|SHORT)$"),
    symbol: Optional[str] = None,
    limit: int = Query(20, ge=1, le=100)
):
    """Get active trade setups"""
    query = """
        SELECT * FROM trade_setups
        WHERE status = 'ACTIVE'
        AND confidence_score >= $1
    """
    params = [min_confidence]
    
    if direction:
        query += f" AND direction = ${len(params) + 1}"
        params.append(direction)
    
    if symbol:
        query += f" AND symbol = ${len(params) + 1}"
        params.append(symbol)
    
    query += f" ORDER BY quality_score DESC, confidence_score DESC LIMIT ${len(params) + 1}"
    params.append(limit)
    
    async with state.db_pool.acquire() as conn:
        rows = await conn.fetch(query, *params)
    
    setups = []
    for row in rows:
        setups.append(SetupResponse(
            id=row['id'],
            symbol=row['symbol'],
            direction=row['direction'],
            timeframe=row['timeframe'],
            setup_type=row['setup_type'],
            current_price=float(row['current_price']),
            entry_min=float(row['entry_min']),
            entry_max=float(row['entry_max']),
            invalidation=float(row['invalidation']),
            target_1=float(row['target_1']) if row['target_1'] else None,
            target_2=float(row['target_2']) if row['target_2'] else None,
            confidence_score=float(row['confidence_score']),
            risk_reward_ratio=float(row['risk_reward_ratio']),
            quality_score=float(row['quality_score']),
            regime=row['regime'],
            supporting_factors=row['supporting_factors'] or {},
            risk_factors=row['risk_factors'] or {},
            created_at=row['created_at'].isoformat(),
            status=row['status']
        ))
    
    return SetupListResponse(
        setups=setups,
        count=len(setups),
        timestamp=datetime.now(timezone.utc).isoformat()
    )


@app.get("/api/v1/setups/{setup_id}", response_model=SetupResponse)
async def get_setup_by_id(setup_id: int):
    """Get a specific trade setup"""
    async with state.db_pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM trade_setups WHERE id = $1", setup_id
        )
    
    if not row:
        raise HTTPException(status_code=404, detail="Setup not found")
    
    return SetupResponse(
        id=row['id'],
        symbol=row['symbol'],
        direction=row['direction'],
        timeframe=row['timeframe'],
        setup_type=row['setup_type'],
        current_price=float(row['current_price']),
        entry_min=float(row['entry_min']),
        entry_max=float(row['entry_max']),
        invalidation=float(row['invalidation']),
        target_1=float(row['target_1']) if row['target_1'] else None,
        target_2=float(row['target_2']) if row['target_2'] else None,
        confidence_score=float(row['confidence_score']),
        risk_reward_ratio=float(row['risk_reward_ratio']),
        quality_score=float(row['quality_score']),
        regime=row['regime'],
        supporting_factors=row['supporting_factors'] or {},
        risk_factors=row['risk_factors'] or {},
        created_at=row['created_at'].isoformat(),
        status=row['status']
    )


# ============== Predictions ==============

@app.get("/api/v1/predictions/{symbol}", response_model=PredictionResponse)
async def get_predictions(symbol: str, timeframe: str = "1h"):
    """Get ML predictions for a symbol"""
    # Get latest features
    async with state.db_pool.acquire() as conn:
        features_row = await conn.fetch("""
            SELECT feature_name, feature_value
            FROM feature_store
            WHERE symbol = $1 AND timeframe = $2
            AND timestamp = (
                SELECT MAX(timestamp) FROM feature_store
                WHERE symbol = $1 AND timeframe = $2
            )
        """, symbol, timeframe)
        
        # Get latest predictions
        predictions_rows = await conn.fetch("""
            SELECT model_name, prediction_type, prediction_value, 
                   prediction_class, confidence, probability_distribution
            FROM model_predictions
            WHERE symbol = $1 AND timeframe = $2
            AND timestamp = (
                SELECT MAX(timestamp) FROM model_predictions
                WHERE symbol = $1 AND timeframe = $2
            )
        """, symbol, timeframe)
    
    if not features_row:
        raise HTTPException(status_code=404, detail=f"No features found for {symbol}")
    
    features = {row['feature_name']: float(row['feature_value']) for row in features_row}
    
    predictions = {}
    for row in predictions_rows:
        predictions[row['model_name']] = {
            'type': row['prediction_type'],
            'value': float(row['prediction_value']),
            'class': row['prediction_class'],
            'confidence': float(row['confidence']),
            'probabilities': row['probability_distribution'] or {}
        }
    
    return PredictionResponse(
        symbol=symbol,
        timestamp=datetime.now(timezone.utc).isoformat(),
        predictions=predictions,
        features=features,
        regime=features.get('regime')
    )


# ============== Market Overview ==============

@app.get("/api/v1/market/overview", response_model=MarketOverview)
async def get_market_overview():
    """Get market overview with top setups"""
    async with state.db_pool.acquire() as conn:
        # Setup statistics
        stats = await conn.fetchrow("""
            SELECT 
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE direction = 'LONG') as bullish,
                COUNT(*) FILTER (WHERE direction = 'SHORT') as bearish,
                AVG(confidence_score) as avg_confidence
            FROM trade_setups
            WHERE status = 'ACTIVE'
        """)
        
        # Top symbols with stats
        top_symbols = await conn.fetch("""
            WITH latest_prices AS (
                SELECT DISTINCT ON (symbol)
                    symbol, close as price, timestamp
                FROM market_data
                WHERE timeframe = '1m'
                ORDER BY symbol, timestamp DESC
            ),
            daily_changes AS (
                SELECT DISTINCT ON (symbol)
                    symbol,
                    (close - first_value(close) OVER (PARTITION BY symbol ORDER BY timestamp)) / 
                    first_value(close) OVER (PARTITION BY symbol ORDER BY timestamp) * 100 as change_24h
                FROM market_data
                WHERE timeframe = '1h' AND timestamp > NOW() - INTERVAL '24 hours'
            ),
            setup_counts AS (
                SELECT symbol, COUNT(*) as active_setups
                FROM trade_setups
                WHERE status = 'ACTIVE'
                GROUP BY symbol
            )
            SELECT 
                p.symbol,
                p.price,
                COALESCE(d.change_24h, 0) as change_24h,
                0 as volume_24h,
                0 as volatility,
                COALESCE(s.active_setups, 0) as active_setups
            FROM latest_prices p
            LEFT JOIN daily_changes d ON p.symbol = d.symbol
            LEFT JOIN setup_counts s ON p.symbol = s.symbol
            ORDER BY COALESCE(s.active_setups, 0) DESC
            LIMIT 10
        """)
    
    return MarketOverview(
        total_setups=stats['total'] or 0,
        bullish_setups=stats['bullish'] or 0,
        bearish_setups=stats['bearish'] or 0,
        avg_confidence=float(stats['avg_confidence'] or 0),
        market_regime="mixed",  # TODO: Calculate from feature_store
        top_symbols=[
            SymbolStats(
                symbol=row['symbol'],
                price=float(row['price']) if row['price'] else 0,
                change_24h=float(row['change_24h']) if row['change_24h'] else 0,
                volume_24h=float(row['volume_24h']) if row['volume_24h'] else 0,
                volatility=float(row['volatility']) if row['volatility'] else 0,
                regime=None,
                active_setups=row['active_setups']
            )
            for row in top_symbols
        ],
        timestamp=datetime.now(timezone.utc).isoformat()
    )


# ============== Symbol Universe ==============

@app.get("/api/v1/symbols")
async def get_symbols():
    """Get all tracked symbols"""
    async with state.db_pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT symbol, category, sector, is_active
            FROM symbol_universe
            WHERE is_active = true
            ORDER BY symbol
        """)
    
    return {
        "symbols": [dict(r) for r in rows],
        "count": len(rows)
    }


# ============== Data Quality ==============

@app.get("/api/v1/data/quality")
async def get_data_quality():
    """Get data quality metrics"""
    async with state.db_pool.acquire() as conn:
        quality = await conn.fetch("""
            SELECT 
                source,
                COUNT(*) as total_records,
                SUM(records_stored) as total_stored,
                AVG(fetch_duration_ms) as avg_fetch_time,
                COUNT(*) FILTER (WHERE status = 'success') as success_count,
                COUNT(*) FILTER (WHERE status = 'failed') as failed_count
            FROM data_quality_logs
            WHERE timestamp > NOW() - INTERVAL '1 hour'
            GROUP BY source
        """)
    
    return {
        "quality_metrics": [dict(r) for r in quality],
        "timestamp": datetime.now(timezone.utc).isoformat()
    }


# ============== WebSocket ==============

@app.websocket("/ws/setups")
async def websocket_setups(websocket: WebSocket):
    """WebSocket for real-time setup updates"""
    await websocket.accept()
    state.ws_connections.append(websocket)
    
    try:
        # Send initial data
        setups = await get_trade_setups()
        await websocket.send_json({
            "type": "initial",
            "data": setups.dict()
        })
        
        # Keep connection alive and send updates
        while True:
            # Check for new setups periodically
            await asyncio.sleep(30)
            
            new_setups = await get_trade_setups()
            await websocket.send_json({
                "type": "update",
                "data": new_setups.dict()
            })
            
    except WebSocketDisconnect:
        state.ws_connections.remove(websocket)
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        if websocket in state.ws_connections:
            state.ws_connections.remove(websocket)


# ============== Utility Functions ==============

async def broadcast_setup_update(setup: Dict):
    """Broadcast new setup to all WebSocket clients"""
    for ws in state.ws_connections:
        try:
            await ws.send_json({
                "type": "new_setup",
                "data": setup
            })
        except:
            pass


# ============== Main ==============

if __name__ == "__main__":
    uvicorn.run(
        "api:app",
        host="0.0.0.0",
        port=8001,
        reload=os.getenv('DEBUG', 'false').lower() == 'true',
        workers=1
    )
