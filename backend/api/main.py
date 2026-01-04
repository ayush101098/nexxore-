"""
FastAPI Backend for SafeYield Vault
Provides REST API and WebSocket endpoints
"""

import os
import json
import logging
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any
from decimal import Decimal

from fastapi import FastAPI, HTTPException, Depends, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, Field
import asyncpg
from web3 import Web3
import jwt
from slowapi import Limiter
from slowapi.util import get_remote_address
from slowapi.middleware import SlowAPIMiddleware

from .transaction_builder import TransactionBuilder
from .apy_calculator import APYCalculator
from .risk_score import RiskScoreAPI

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Environment config
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://localhost/safeyield")
RPC_URL = os.getenv("RPC_URL", "https://eth-mainnet.g.alchemy.com/v2/your-key")
JWT_SECRET = os.getenv("JWT_SECRET", "your-secret-key")
VAULT_ADDRESS = os.getenv("VAULT_ADDRESS")

# Initialize FastAPI
app = FastAPI(
    title="SafeYield Vault API",
    description="DeFi Yield Vault with AI-powered risk management",
    version="1.0.0"
)

# Rate limiting
limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_middleware(SlowAPIMiddleware)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Security
security = HTTPBearer(auto_error=False)

# Database pool
db_pool: Optional[asyncpg.Pool] = None

# Web3 connection
w3: Optional[Web3] = None

# Connected WebSocket clients
ws_clients: List[WebSocket] = []


# ============= Pydantic Models =============

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int


class VaultInfo(BaseModel):
    address: str
    name: str
    symbol: str
    total_assets: str
    total_supply: str
    share_price: str
    risk_score: int
    risk_state: str
    idle_balance: str
    strategy_count: int


class StrategyInfo(BaseModel):
    address: str
    name: str
    allocation_percent: str
    current_balance: str
    target_allocation: str
    apy: str
    utilization_rate: str
    is_active: bool


class APYBreakdown(BaseModel):
    strategy: str
    base_apy: str
    reward_apy: str
    total_apy: str
    tvl_share: str


class VaultAPY(BaseModel):
    net_apy: str
    gross_apy: str
    fee_apy: str
    breakdown: List[APYBreakdown]
    last_updated: str


class DepositSimulation(BaseModel):
    assets: str
    expected_shares: str
    share_price: str
    gas_estimate: str
    gas_cost_usd: str
    slippage_estimate: str


class WithdrawSimulation(BaseModel):
    shares: str
    expected_assets: str
    share_price: str
    gas_estimate: str
    gas_cost_usd: str
    withdrawal_fee: str


class TransactionRequest(BaseModel):
    action: str  # "deposit" or "withdraw"
    amount: str
    user_address: str
    deadline: Optional[int] = None


class TransactionResponse(BaseModel):
    to: str
    data: str
    value: str
    gas_limit: str
    gas_price: str
    chain_id: int


class RiskScore(BaseModel):
    composite_score: int
    protocol_risk: int
    liquidity_risk: int
    utilization_risk: int
    governance_risk: int
    oracle_risk: int
    risk_state: str
    recommendations: List[str]


class UserPosition(BaseModel):
    address: str
    shares: str
    assets_value: str
    share_price: str
    deposited_total: str
    withdrawn_total: str
    pnl: str
    pnl_percent: str


# ============= Dependencies =============

async def get_db():
    async with db_pool.acquire() as conn:
        yield conn


async def verify_token(credentials: HTTPAuthorizationCredentials = Depends(security)):
    if not credentials:
        return None
    try:
        payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=["HS256"])
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


# ============= Startup/Shutdown =============

@app.on_event("startup")
async def startup():
    global db_pool, w3
    
    db_pool = await asyncpg.create_pool(DATABASE_URL)
    w3 = Web3(Web3.HTTPProvider(RPC_URL))
    
    logger.info("API server started")


@app.on_event("shutdown")
async def shutdown():
    if db_pool:
        await db_pool.close()
    logger.info("API server stopped")


# ============= Auth Endpoints =============

@app.post("/api/v1/auth/nonce")
@limiter.limit("10/minute")
async def get_nonce(address: str, request=None):
    """Get a nonce for wallet signature authentication"""
    import secrets
    nonce = secrets.token_hex(16)
    
    # Store nonce temporarily (in production use Redis with TTL)
    async with db_pool.acquire() as conn:
        await conn.execute("""
            INSERT INTO auth_nonces (address, nonce, expires_at)
            VALUES ($1, $2, NOW() + INTERVAL '5 minutes')
            ON CONFLICT (address) DO UPDATE SET nonce = $2, expires_at = NOW() + INTERVAL '5 minutes'
        """, address.lower(), nonce)
    
    return {"nonce": nonce, "message": f"Sign this message to authenticate: {nonce}"}


@app.post("/api/v1/auth/verify", response_model=TokenResponse)
@limiter.limit("10/minute")
async def verify_signature(address: str, signature: str, request=None):
    """Verify wallet signature and return JWT"""
    async with db_pool.acquire() as conn:
        row = await conn.fetchrow("""
            SELECT nonce FROM auth_nonces
            WHERE address = $1 AND expires_at > NOW()
        """, address.lower())
        
        if not row:
            raise HTTPException(status_code=400, detail="Invalid or expired nonce")
        
        nonce = row["nonce"]
        
        # Verify signature
        try:
            message = f"Sign this message to authenticate: {nonce}"
            from eth_account.messages import encode_defunct
            msg = encode_defunct(text=message)
            recovered = w3.eth.account.recover_message(msg, signature=signature)
            
            if recovered.lower() != address.lower():
                raise HTTPException(status_code=401, detail="Invalid signature")
        except Exception as e:
            raise HTTPException(status_code=401, detail=f"Signature verification failed: {e}")
        
        # Delete used nonce
        await conn.execute("DELETE FROM auth_nonces WHERE address = $1", address.lower())
    
    # Generate JWT
    token = jwt.encode({
        "address": address.lower(),
        "exp": datetime.utcnow() + timedelta(hours=24),
        "iat": datetime.utcnow()
    }, JWT_SECRET, algorithm="HS256")
    
    return TokenResponse(access_token=token, expires_in=86400)


# ============= Vault Endpoints =============

@app.get("/api/v1/vault/info", response_model=VaultInfo)
@limiter.limit("100/minute")
async def get_vault_info(request=None):
    """Get current vault information"""
    try:
        # Load vault ABI
        vault_abi = json.load(open("abi/SafeYieldVault.json"))
        vault = w3.eth.contract(address=VAULT_ADDRESS, abi=vault_abi)
        
        total_assets = vault.functions.totalAssets().call()
        total_supply = vault.functions.totalSupply().call()
        share_price = vault.functions.convertToAssets(10**6).call() if total_supply > 0 else 10**6
        risk_score = vault.functions.riskScore().call()
        risk_state = ["NORMAL", "ELEVATED", "HIGH_RISK", "CRITICAL"][vault.functions.currentRiskState().call()]
        idle = vault.functions.idleBalance().call()
        
        strategies = vault.functions.getStrategies().call()
        
        return VaultInfo(
            address=VAULT_ADDRESS,
            name=vault.functions.name().call(),
            symbol=vault.functions.symbol().call(),
            total_assets=str(total_assets),
            total_supply=str(total_supply),
            share_price=str(share_price),
            risk_score=risk_score,
            risk_state=risk_state,
            idle_balance=str(idle),
            strategy_count=len(strategies)
        )
    except Exception as e:
        logger.error(f"Failed to get vault info: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/v1/vault/strategies", response_model=List[StrategyInfo])
@limiter.limit("100/minute")
async def get_strategies(request=None):
    """Get all strategy information"""
    try:
        vault_abi = json.load(open("abi/SafeYieldVault.json"))
        strategy_abi = json.load(open("abi/IStrategy.json"))
        vault = w3.eth.contract(address=VAULT_ADDRESS, abi=vault_abi)
        
        strategy_addresses = vault.functions.getStrategies().call()
        total_assets = vault.functions.totalAssets().call()
        
        strategies = []
        for addr in strategy_addresses:
            strategy = w3.eth.contract(address=addr, abi=strategy_abi)
            allocation = vault.functions.strategyAllocations(addr).call()
            
            balance = strategy.functions.totalAssets().call()
            target = allocation[0]  # targetAllocation
            is_active = allocation[2]  # isActive
            
            # Calculate APY from calculator
            apy_calc = APYCalculator(w3, db_pool)
            apy = await apy_calc.get_strategy_apy(addr)
            
            strategies.append(StrategyInfo(
                address=addr,
                name=strategy.functions.name().call() if hasattr(strategy.functions, 'name') else "Unknown",
                allocation_percent=str(round(balance / total_assets * 10000, 2) if total_assets > 0 else 0),
                current_balance=str(balance),
                target_allocation=str(target),
                apy=str(round(apy, 2)),
                utilization_rate=str(await apy_calc.get_utilization(addr)),
                is_active=is_active
            ))
        
        return strategies
    except Exception as e:
        logger.error(f"Failed to get strategies: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/v1/vault/apy", response_model=VaultAPY)
@limiter.limit("100/minute")
async def get_vault_apy(request=None):
    """Get detailed APY breakdown"""
    try:
        apy_calc = APYCalculator(w3, db_pool)
        apy_data = await apy_calc.calculate_vault_apy(VAULT_ADDRESS)
        
        return VaultAPY(
            net_apy=str(round(apy_data["net_apy"], 2)),
            gross_apy=str(round(apy_data["gross_apy"], 2)),
            fee_apy=str(round(apy_data["fee_apy"], 2)),
            breakdown=[
                APYBreakdown(
                    strategy=b["strategy"],
                    base_apy=str(round(b["base_apy"], 2)),
                    reward_apy=str(round(b["reward_apy"], 2)),
                    total_apy=str(round(b["total_apy"], 2)),
                    tvl_share=str(round(b["tvl_share"], 2))
                ) for b in apy_data["breakdown"]
            ],
            last_updated=datetime.utcnow().isoformat()
        )
    except Exception as e:
        logger.error(f"Failed to calculate APY: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============= Simulation Endpoints =============

@app.post("/api/v1/simulate/deposit", response_model=DepositSimulation)
@limiter.limit("50/minute")
async def simulate_deposit(amount: str, request=None):
    """Simulate a deposit"""
    try:
        vault_abi = json.load(open("abi/SafeYieldVault.json"))
        vault = w3.eth.contract(address=VAULT_ADDRESS, abi=vault_abi)
        
        amount_wei = int(amount)
        
        # Preview deposit
        expected_shares = vault.functions.previewDeposit(amount_wei).call()
        share_price = vault.functions.convertToAssets(10**6).call()
        
        # Estimate gas
        gas_estimate = 150000  # Base estimate for deposit
        gas_price = w3.eth.gas_price
        gas_cost_wei = gas_estimate * gas_price
        
        # Get ETH price for USD conversion
        eth_price = 2500  # TODO: Fetch from oracle
        gas_cost_usd = (gas_cost_wei / 10**18) * eth_price
        
        return DepositSimulation(
            assets=amount,
            expected_shares=str(expected_shares),
            share_price=str(share_price),
            gas_estimate=str(gas_estimate),
            gas_cost_usd=str(round(gas_cost_usd, 2)),
            slippage_estimate="0.01"  # 0.01%
        )
    except Exception as e:
        logger.error(f"Failed to simulate deposit: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/v1/simulate/withdraw", response_model=WithdrawSimulation)
@limiter.limit("50/minute")
async def simulate_withdraw(shares: str, request=None):
    """Simulate a withdrawal"""
    try:
        vault_abi = json.load(open("abi/SafeYieldVault.json"))
        vault = w3.eth.contract(address=VAULT_ADDRESS, abi=vault_abi)
        
        shares_wei = int(shares)
        
        # Preview withdraw
        expected_assets = vault.functions.previewRedeem(shares_wei).call()
        share_price = vault.functions.convertToAssets(10**6).call()
        
        # Calculate withdrawal fee
        withdrawal_fee_bp = vault.functions.withdrawalFeeBps().call()
        fee = expected_assets * withdrawal_fee_bp // 10000
        
        # Estimate gas
        gas_estimate = 200000  # Base estimate for withdraw
        gas_price = w3.eth.gas_price
        gas_cost_wei = gas_estimate * gas_price
        
        eth_price = 2500
        gas_cost_usd = (gas_cost_wei / 10**18) * eth_price
        
        return WithdrawSimulation(
            shares=shares,
            expected_assets=str(expected_assets),
            share_price=str(share_price),
            gas_estimate=str(gas_estimate),
            gas_cost_usd=str(round(gas_cost_usd, 2)),
            withdrawal_fee=str(fee)
        )
    except Exception as e:
        logger.error(f"Failed to simulate withdraw: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============= Transaction Building =============

@app.post("/api/v1/transactions/build", response_model=TransactionResponse)
@limiter.limit("30/minute")
async def build_transaction(tx_request: TransactionRequest, request=None):
    """Build a transaction for deposit or withdraw"""
    try:
        tx_builder = TransactionBuilder(w3, VAULT_ADDRESS)
        
        if tx_request.action == "deposit":
            tx = await tx_builder.build_deposit(
                amount=int(tx_request.amount),
                user=tx_request.user_address,
                deadline=tx_request.deadline
            )
        elif tx_request.action == "withdraw":
            tx = await tx_builder.build_withdraw(
                shares=int(tx_request.amount),
                user=tx_request.user_address,
                deadline=tx_request.deadline
            )
        else:
            raise HTTPException(status_code=400, detail="Invalid action")
        
        return TransactionResponse(
            to=tx["to"],
            data=tx["data"],
            value=str(tx["value"]),
            gas_limit=str(tx["gas"]),
            gas_price=str(tx["gasPrice"]),
            chain_id=tx["chainId"]
        )
    except Exception as e:
        logger.error(f"Failed to build transaction: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============= Risk Score Endpoints =============

@app.get("/api/v1/risk/score", response_model=RiskScore)
@limiter.limit("100/minute")
async def get_risk_score(request=None):
    """Get current risk assessment"""
    try:
        risk_api = RiskScoreAPI(w3, db_pool)
        score = await risk_api.get_current_score(VAULT_ADDRESS)
        
        return RiskScore(**score)
    except Exception as e:
        logger.error(f"Failed to get risk score: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/v1/risk/history")
@limiter.limit("50/minute")
async def get_risk_history(
    days: int = Query(default=7, le=30),
    request=None
):
    """Get historical risk scores"""
    try:
        async with db_pool.acquire() as conn:
            rows = await conn.fetch("""
                SELECT * FROM risk_assessments
                WHERE vault_address = $1
                AND timestamp > NOW() - INTERVAL '1 day' * $2
                ORDER BY timestamp DESC
            """, VAULT_ADDRESS.lower(), days)
            
            return [dict(row) for row in rows]
    except Exception as e:
        logger.error(f"Failed to get risk history: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============= User Endpoints =============

@app.get("/api/v1/user/position", response_model=UserPosition)
@limiter.limit("100/minute")
async def get_user_position(
    address: str,
    user: Optional[dict] = Depends(verify_token),
    request=None
):
    """Get user's vault position"""
    try:
        vault_abi = json.load(open("abi/SafeYieldVault.json"))
        vault = w3.eth.contract(address=VAULT_ADDRESS, abi=vault_abi)
        
        shares = vault.functions.balanceOf(address).call()
        assets_value = vault.functions.convertToAssets(shares).call() if shares > 0 else 0
        share_price = vault.functions.convertToAssets(10**6).call()
        
        # Get historical data
        async with db_pool.acquire() as conn:
            row = await conn.fetchrow("""
                SELECT total_deposited, total_withdrawn FROM user_positions
                WHERE user_address = $1
            """, address.lower())
        
        deposited = float(row["total_deposited"]) * 10**6 if row else 0
        withdrawn = float(row["total_withdrawn"]) * 10**6 if row else 0
        
        pnl = assets_value + withdrawn - deposited
        pnl_percent = (pnl / deposited * 100) if deposited > 0 else 0
        
        return UserPosition(
            address=address,
            shares=str(shares),
            assets_value=str(assets_value),
            share_price=str(share_price),
            deposited_total=str(int(deposited)),
            withdrawn_total=str(int(withdrawn)),
            pnl=str(int(pnl)),
            pnl_percent=str(round(pnl_percent, 2))
        )
    except Exception as e:
        logger.error(f"Failed to get user position: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/v1/user/transactions")
@limiter.limit("50/minute")
async def get_user_transactions(
    address: str,
    limit: int = Query(default=50, le=200),
    user: Optional[dict] = Depends(verify_token),
    request=None
):
    """Get user's transaction history"""
    try:
        async with db_pool.acquire() as conn:
            rows = await conn.fetch("""
                SELECT * FROM vault_events
                WHERE (args->>'sender' = $1 OR args->>'owner' = $1)
                AND event_type IN ('Deposit', 'Withdraw')
                ORDER BY timestamp DESC
                LIMIT $2
            """, address.lower(), limit)
            
            return [dict(row) for row in rows]
    except Exception as e:
        logger.error(f"Failed to get user transactions: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============= WebSocket Endpoint =============

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """Real-time vault updates via WebSocket"""
    await websocket.accept()
    ws_clients.append(websocket)
    
    try:
        while True:
            # Keep connection alive and handle client messages
            data = await websocket.receive_text()
            message = json.loads(data)
            
            if message.get("type") == "subscribe":
                # Handle subscription requests
                await websocket.send_json({
                    "type": "subscribed",
                    "channel": message.get("channel", "vault")
                })
                
            elif message.get("type") == "ping":
                await websocket.send_json({"type": "pong"})
                
    except WebSocketDisconnect:
        ws_clients.remove(websocket)
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        if websocket in ws_clients:
            ws_clients.remove(websocket)


async def broadcast_update(update_type: str, data: dict):
    """Broadcast update to all WebSocket clients"""
    message = json.dumps({
        "type": update_type,
        "data": data,
        "timestamp": datetime.utcnow().isoformat()
    })
    
    disconnected = []
    for client in ws_clients:
        try:
            await client.send_text(message)
        except:
            disconnected.append(client)
    
    for client in disconnected:
        ws_clients.remove(client)


# ============= Health Check =============

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat(),
        "version": "1.0.0"
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
