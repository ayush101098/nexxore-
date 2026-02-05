"""
═══════════════════════════════════════════════════════════════════════════════
PRED AGENT - Main Entry Point & API Gateway
═══════════════════════════════════════════════════════════════════════════════
FastAPI server integrating all prediction agent components
"""

import os
import asyncio
import logging
from datetime import datetime
from typing import Dict, List, Optional
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, Query, Body
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import uvicorn

# Import our components
from intelligence.consensus_engine import AIConsensusEngine, ConsensusResult
from market.fair_value import FairValueCalculator, MarketData, EdgeAnalysis, TradingSignal
from market.arbitrage_scanner import ArbitrageScanner, ArbitrageOpportunity, create_mock_opportunities
from market.news_impact import NewsImpactEngine, MarketEvent, NewsImpact, AlertSignal
from execution.risk_engine import ExecutionEngine, Order, RiskLimits

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════════════════════
# PYDANTIC MODELS FOR API
# ═══════════════════════════════════════════════════════════════════════════════

class PredictionRequest(BaseModel):
    question: str = Field(..., description="The prediction market question")
    context: str = Field("", description="Additional context for analysis")
    market_price: Optional[float] = Field(None, description="Current market price (0-1)")
    platform: Optional[str] = Field("polymarket", description="Trading platform")


class PredictionResponse(BaseModel):
    question: str
    fair_value: float
    market_price: Optional[float]
    edge: Optional[float]
    edge_percent: Optional[float]
    recommendation: str
    confidence: float
    dispersion: float
    model_weights: Dict[str, float]
    timestamp: str


class EdgeRequest(BaseModel):
    event_id: str
    question: str
    yes_price: float = Field(..., ge=0.01, le=0.99)
    platform: str = "polymarket"
    volume_24h: float = 10000
    liquidity: float = 50000
    time_to_resolution_hours: int = 168


class EdgeResponse(BaseModel):
    event_id: str
    fair_value: float
    market_price: float
    edge: float
    edge_percent: float
    expected_value: float
    kelly_fraction: float
    recommended_size: float
    recommended_side: str
    signal_strength: Optional[str]
    stop_loss: Optional[float]
    take_profit: Optional[float]


class ArbitrageResponse(BaseModel):
    opportunities: List[Dict]
    total_opportunity_value: float
    scan_timestamp: str


class OrderRequest(BaseModel):
    event_id: str
    platform: str
    side: str = Field(..., pattern="^(YES|NO)$")
    size_usd: float = Field(..., gt=0)
    price: float = Field(..., ge=0.01, le=0.99)
    order_type: str = "MARKET"
    stop_loss: Optional[float] = None
    take_profit: Optional[float] = None


class OrderResponse(BaseModel):
    order_id: str
    status: str
    rejection_reason: Optional[str]
    executed_price: Optional[float]
    message: str


class PortfolioResponse(BaseModel):
    equity: float
    exposure: float
    exposure_pct: float
    daily_pnl: float
    daily_pnl_pct: float
    current_drawdown: float
    position_count: int
    positions: List[Dict]
    circuit_breaker_active: bool


# ═══════════════════════════════════════════════════════════════════════════════
# GLOBAL STATE
# ═══════════════════════════════════════════════════════════════════════════════

class AppState:
    """Global application state"""
    
    def __init__(self):
        self.consensus_engine: Optional[AIConsensusEngine] = None
        self.fair_value_calc: Optional[FairValueCalculator] = None
        self.arbitrage_scanner: Optional[ArbitrageScanner] = None
        self.news_engine: Optional[NewsImpactEngine] = None
        self.execution_engine: Optional[ExecutionEngine] = None
        
        # WebSocket connections for real-time updates
        self.ws_connections: List[WebSocket] = []


state = AppState()


# ═══════════════════════════════════════════════════════════════════════════════
# LIFESPAN MANAGEMENT
# ═══════════════════════════════════════════════════════════════════════════════

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize components on startup, cleanup on shutdown"""
    
    logger.info("🚀 Starting PRED Agent...")
    
    # Initialize components
    state.consensus_engine = AIConsensusEngine(use_mock=True)  # Use mock for demo
    state.fair_value_calc = FairValueCalculator(bankroll=10000, risk_tolerance=0.5)
    state.arbitrage_scanner = ArbitrageScanner()
    state.news_engine = NewsImpactEngine()
    
    # Initialize execution engine
    state.execution_engine = ExecutionEngine(
        initial_capital=10000,
        risk_limits=RiskLimits(
            max_drawdown_pct=0.15,
            max_daily_loss_pct=0.05,
            max_position_size_pct=0.10,
            max_total_exposure_pct=0.50
        )
    )
    await state.execution_engine.start()
    
    logger.info("✅ All components initialized")
    
    yield
    
    # Cleanup
    logger.info("🛑 Shutting down PRED Agent...")
    await state.execution_engine.stop()
    logger.info("✅ Shutdown complete")


# ═══════════════════════════════════════════════════════════════════════════════
# FASTAPI APP
# ═══════════════════════════════════════════════════════════════════════════════

app = FastAPI(
    title="PRED Agent API",
    description="""
    🎯 **Prediction Market Intelligence System**
    
    A comprehensive toolkit for prediction market analysis and trading:
    
    - **Intelligence Engine**: 6-model AI consensus with dynamic weighting
    - **Fair Value Calculator**: Edge detection and Kelly bet sizing
    - **Arbitrage Scanner**: Cross-platform price discovery
    - **News Impact Engine**: Real-time sentiment analysis
    - **Execution Engine**: Risk-managed order processing
    """,
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


# ═══════════════════════════════════════════════════════════════════════════════
# HEALTH & INFO ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════════

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "timestamp": datetime.now().isoformat(),
        "components": {
            "consensus_engine": state.consensus_engine is not None,
            "fair_value_calc": state.fair_value_calc is not None,
            "arbitrage_scanner": state.arbitrage_scanner is not None,
            "news_engine": state.news_engine is not None,
            "execution_engine": state.execution_engine is not None
        }
    }


@app.get("/")
async def root():
    """API information"""
    return {
        "name": "PRED Agent",
        "version": "1.0.0",
        "description": "Prediction Market Intelligence System",
        "endpoints": {
            "consensus": "/api/v1/predict",
            "edge": "/api/v1/edge",
            "arbitrage": "/api/v1/arbitrage",
            "news": "/api/v1/news/scan",
            "portfolio": "/api/v1/portfolio",
            "orders": "/api/v1/orders"
        }
    }


# ═══════════════════════════════════════════════════════════════════════════════
# INTELLIGENCE ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════════

@app.post("/api/v1/predict", response_model=PredictionResponse)
async def get_prediction(request: PredictionRequest):
    """
    Get AI consensus prediction for a question
    
    Uses 6-model ensemble with dynamic weighting based on historical Brier scores.
    """
    try:
        result = await state.consensus_engine.get_consensus(
            question=request.question,
            context=request.context
        )
        
        # Calculate fair value with adjustment
        fair_value = state.fair_value_calc.calculate_fair_value(
            result.fair_probability,
            result.confidence_score,
            result.dispersion_metric
        )
        
        response = {
            "question": request.question,
            "fair_value": fair_value,
            "market_price": request.market_price,
            "edge": None,
            "edge_percent": None,
            "recommendation": result.recommendation,
            "confidence": result.confidence_score,
            "dispersion": result.dispersion_metric,
            "model_weights": result.model_weights,
            "timestamp": datetime.now().isoformat()
        }
        
        # Calculate edge if market price provided
        if request.market_price:
            edge, edge_pct, _ = state.fair_value_calc.calculate_edge(fair_value, request.market_price)
            response["edge"] = round(edge, 4)
            response["edge_percent"] = round(edge_pct * 100, 2)
        
        return response
        
    except Exception as e:
        logger.error(f"Prediction error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/v1/edge", response_model=EdgeResponse)
async def calculate_edge(request: EdgeRequest):
    """
    Calculate fair value and edge for a specific market
    
    Returns:
    - Fair value estimate
    - Edge vs market
    - Kelly-optimal bet size
    - Trading signal with stop loss / take profit
    """
    try:
        # Get consensus for the question
        result = await state.consensus_engine.get_consensus(request.question, "")
        
        fair_value = state.fair_value_calc.calculate_fair_value(
            result.fair_probability,
            result.confidence_score,
            result.dispersion_metric
        )
        
        # Create market data
        market_data = MarketData(
            event_id=request.event_id,
            question=request.question,
            yes_price=request.yes_price,
            no_price=1 - request.yes_price,
            volume_24h=request.volume_24h,
            liquidity=request.liquidity,
            platform=request.platform,
            last_update=datetime.now()
        )
        
        # Analyze edge
        analysis = state.fair_value_calc.analyze_edge(
            fair_value=fair_value,
            market_data=market_data,
            consensus_confidence=result.confidence_score,
            model_dispersion=result.dispersion_metric,
            time_to_resolution=request.time_to_resolution_hours
        )
        
        # Generate signal
        signal = state.fair_value_calc.generate_signal(analysis, market_data)
        
        return {
            "event_id": request.event_id,
            "fair_value": analysis.fair_value,
            "market_price": analysis.market_price,
            "edge": analysis.edge,
            "edge_percent": analysis.edge_percent,
            "expected_value": analysis.expected_value,
            "kelly_fraction": analysis.kelly_fraction,
            "recommended_size": analysis.recommended_size,
            "recommended_side": analysis.recommended_side.value,
            "signal_strength": signal.signal_strength if signal else None,
            "stop_loss": signal.stop_loss if signal else None,
            "take_profit": signal.take_profit if signal else None
        }
        
    except Exception as e:
        logger.error(f"Edge calculation error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ═══════════════════════════════════════════════════════════════════════════════
# ARBITRAGE ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════════

@app.get("/api/v1/arbitrage", response_model=ArbitrageResponse)
async def scan_arbitrage():
    """
    Scan for cross-platform arbitrage opportunities
    
    Compares prices across Polymarket, Kalshi, Manifold, and others.
    """
    try:
        # Use mock data for demo (in production, would call real APIs)
        opportunities = create_mock_opportunities()
        
        total_value = sum(
            o.max_size * o.net_spread for o in opportunities
        )
        
        return {
            "opportunities": [
                {
                    "canonical_id": o.canonical_id,
                    "question": o.question,
                    "buy_platform": o.buy_platform.value,
                    "buy_price": o.buy_price,
                    "sell_platform": o.sell_platform.value,
                    "sell_price": o.sell_price,
                    "gross_spread": o.gross_spread,
                    "net_spread": o.net_spread,
                    "estimated_profit_pct": o.estimated_profit_pct,
                    "max_size": o.max_size,
                    "confidence": o.confidence,
                    "expires_in_hours": o.expires_in_hours
                }
                for o in opportunities
            ],
            "total_opportunity_value": round(total_value, 2),
            "scan_timestamp": datetime.now().isoformat()
        }
        
    except Exception as e:
        logger.error(f"Arbitrage scan error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ═══════════════════════════════════════════════════════════════════════════════
# NEWS ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════════

@app.post("/api/v1/news/track")
async def track_event(event: Dict = Body(...)):
    """Add an event to track for news impacts"""
    try:
        market_event = MarketEvent(
            event_id=event['event_id'],
            question=event['question'],
            keywords=event.get('keywords', []),
            current_probability=event.get('current_probability', 0.5),
            last_update=datetime.now()
        )
        state.news_engine.track_event(market_event)
        return {"status": "success", "message": f"Now tracking event: {event['event_id']}"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/v1/news/scan")
async def scan_news():
    """
    Scan news for impacts on tracked events
    
    Returns news articles and their expected impact on market probabilities.
    """
    try:
        # Add some default tracked events if none exist
        if not state.news_engine.events:
            default_events = [
                MarketEvent("btc150k", "Will Bitcoin reach $150,000 before July 2026?", 
                           ["bitcoin", "btc", "crypto"], 0.45, datetime.now()),
                MarketEvent("fedcut", "Will the Fed cut rates in January 2025?",
                           ["fed", "interest rate", "fomc"], 0.35, datetime.now()),
            ]
            for event in default_events:
                state.news_engine.track_event(event)
        
        impacts = await state.news_engine.scan_for_impacts()
        alerts = state.news_engine.generate_alerts(impacts)
        
        return {
            "impacts": [
                {
                    "event_id": i.event_id,
                    "impact_level": i.impact_level.value,
                    "direction": i.sentiment_direction.value,
                    "probability_shift": i.probability_shift,
                    "confidence": i.confidence,
                    "reasoning": i.reasoning
                }
                for i in impacts
            ],
            "alerts": [
                {
                    "event_id": a.event_id,
                    "urgency": a.urgency,
                    "impact_level": a.impact_level.value,
                    "direction": a.direction.value,
                    "probability_shift": a.probability_shift,
                    "action_required": a.action_required
                }
                for a in alerts
            ],
            "scan_timestamp": datetime.now().isoformat()
        }
        
    except Exception as e:
        logger.error(f"News scan error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ═══════════════════════════════════════════════════════════════════════════════
# EXECUTION ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════════

@app.get("/api/v1/portfolio", response_model=PortfolioResponse)
async def get_portfolio():
    """Get current portfolio status and positions"""
    status = state.execution_engine.get_status()
    
    return {
        "equity": status['portfolio']['equity'],
        "exposure": status['portfolio']['exposure'],
        "exposure_pct": status['portfolio']['exposure_pct'],
        "daily_pnl": status['portfolio']['daily_pnl'],
        "daily_pnl_pct": status['portfolio']['daily_pnl_pct'],
        "current_drawdown": status['portfolio']['current_drawdown'],
        "position_count": status['portfolio']['position_count'],
        "positions": status['positions'],
        "circuit_breaker_active": status['risk']['circuit_breaker']
    }


@app.post("/api/v1/orders", response_model=OrderResponse)
async def submit_order(request: OrderRequest):
    """
    Submit a trade order for risk-checked execution
    
    Order goes through:
    1. Position size limits
    2. Drawdown checks
    3. Daily loss limits
    4. Correlation risk analysis
    5. Circuit breaker status
    """
    try:
        order = Order(
            order_id=f"ORD-{datetime.now().strftime('%Y%m%d%H%M%S')}",
            event_id=request.event_id,
            platform=request.platform,
            side=request.side,
            size_usd=request.size_usd,
            price=request.price,
            order_type=request.order_type,
            stop_loss=request.stop_loss,
            take_profit=request.take_profit
        )
        
        await state.execution_engine.submit_order(order)
        
        # Wait briefly for processing
        await asyncio.sleep(0.2)
        
        return {
            "order_id": order.order_id,
            "status": order.status.value,
            "rejection_reason": order.rejection_reason.value if order.rejection_reason else None,
            "executed_price": order.executed_price,
            "message": f"Order {order.status.value}" + (f": {order.rejection_reason.value}" if order.rejection_reason else "")
        }
        
    except Exception as e:
        logger.error(f"Order submission error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ═══════════════════════════════════════════════════════════════════════════════
# WEBSOCKET FOR REAL-TIME UPDATES
# ═══════════════════════════════════════════════════════════════════════════════

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """
    WebSocket connection for real-time updates
    
    Streams:
    - Price updates
    - News alerts
    - Arbitrage opportunities
    - Portfolio changes
    """
    await websocket.accept()
    state.ws_connections.append(websocket)
    
    try:
        while True:
            # Receive messages from client
            data = await websocket.receive_text()
            
            # Echo back for now (implement proper handling)
            await websocket.send_json({
                "type": "ack",
                "message": f"Received: {data}",
                "timestamp": datetime.now().isoformat()
            })
            
    except WebSocketDisconnect:
        state.ws_connections.remove(websocket)


# ═══════════════════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    
    print("""
    ╔═══════════════════════════════════════════════════════════════════════╗
    ║                                                                       ║
    ║   🎯 PRED AGENT - Prediction Market Intelligence System              ║
    ║                                                                       ║
    ║   Components:                                                         ║
    ║   ├── Intelligence Engine (6-model AI consensus)                     ║
    ║   ├── Fair Value Calculator (Kelly sizing)                           ║
    ║   ├── Arbitrage Scanner (cross-platform)                             ║
    ║   ├── News Impact Engine (sentiment analysis)                        ║
    ║   └── Execution Engine (risk management)                             ║
    ║                                                                       ║
    ╚═══════════════════════════════════════════════════════════════════════╝
    """)
    
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=port,
        reload=True,
        log_level="info"
    )
