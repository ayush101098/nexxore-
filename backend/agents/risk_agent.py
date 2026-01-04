"""
Risk Agent Service
Uses Claude claude-sonnet-4 to analyze vault risk and submit emergency actions
"""

import asyncio
import json
import logging
from dataclasses import dataclass, asdict
from datetime import datetime
from typing import Optional, List, Dict, Any
from decimal import Decimal

import anthropic
from web3 import Web3
from web3.contract import Contract
import asyncpg

logger = logging.getLogger(__name__)


@dataclass
class RiskAnalysis:
    """Structured risk analysis result"""
    timestamp: datetime
    composite_score: int  # 0-10000 basis points
    protocol_risk: int
    liquidity_risk: int
    utilization_risk: int
    governance_risk: int
    oracle_risk: int
    risk_level: str  # NORMAL, ELEVATED, HIGH, CRITICAL
    recommended_action: str
    action_urgency: str  # LOW, MEDIUM, HIGH, CRITICAL
    reasoning: str
    strategy_risks: Dict[str, int]
    alerts: List[str]
    should_emergency_unwind: bool
    unwind_strategies: List[str]


@dataclass
class VaultData:
    """On-chain vault data for analysis"""
    tvl: Decimal
    allocations: Dict[str, Decimal]
    utilization_rates: Dict[str, Decimal]
    strategy_apys: Dict[str, Decimal]
    current_risk_score: int
    idle_buffer: Decimal
    last_rebalance: datetime
    pending_withdrawals: Decimal


RISK_AGENT_PROMPT = """You are the Risk Agent for SafeYieldVault, a DeFi yield aggregator. Your role is to:

1. Analyze on-chain data and assess risk across 5 dimensions:
   - Protocol Risk (25%): Smart contract security, audit status, TVL concentration
   - Liquidity Risk (20%): Withdrawal availability, slippage potential
   - Utilization Risk (25%): Pool utilization rates, capacity constraints
   - Governance Risk (15%): Recent governance changes, admin key risks
   - Oracle Risk (15%): Price feed reliability, staleness

2. Provide risk scores from 0-10000 basis points (0-100%)

3. Thresholds:
   - NORMAL: 0-5999 (operations continue normally)
   - ELEVATED: 6000-6999 (increase monitoring)
   - HIGH_RISK: 7000-7999 (restrict deposits, prepare for unwind)
   - CRITICAL: 8000+ (emergency unwind required)

4. Recommend specific actions based on risk level

You must respond with valid JSON in this exact format:
{
    "composite_score": <int 0-10000>,
    "protocol_risk": <int 0-10000>,
    "liquidity_risk": <int 0-10000>,
    "utilization_risk": <int 0-10000>,
    "governance_risk": <int 0-10000>,
    "oracle_risk": <int 0-10000>,
    "risk_level": "<NORMAL|ELEVATED|HIGH_RISK|CRITICAL>",
    "recommended_action": "<specific action>",
    "action_urgency": "<LOW|MEDIUM|HIGH|CRITICAL>",
    "reasoning": "<detailed explanation>",
    "strategy_risks": {"<strategy_name>": <risk_score>, ...},
    "alerts": ["<alert1>", "<alert2>", ...],
    "should_emergency_unwind": <true|false>,
    "unwind_strategies": ["<strategy1>", ...]
}"""


class RiskAgent:
    """
    Risk Agent that analyzes vault data and triggers emergency actions
    """

    def __init__(
        self,
        anthropic_api_key: str,
        web3_provider: str,
        vault_address: str,
        vault_abi: List[Dict],
        risk_oracle_address: str,
        risk_oracle_abi: List[Dict],
        db_url: str,
        private_key: str
    ):
        self.client = anthropic.Anthropic(api_key=anthropic_api_key)
        self.w3 = Web3(Web3.HTTPProvider(web3_provider))
        
        self.vault = self.w3.eth.contract(
            address=Web3.to_checksum_address(vault_address),
            abi=vault_abi
        )
        self.risk_oracle = self.w3.eth.contract(
            address=Web3.to_checksum_address(risk_oracle_address),
            abi=risk_oracle_abi
        )
        
        self.db_url = db_url
        self.account = self.w3.eth.account.from_key(private_key)
        self.db_pool: Optional[asyncpg.Pool] = None

    async def initialize(self):
        """Initialize database connection pool"""
        self.db_pool = await asyncpg.create_pool(self.db_url)
        await self._ensure_tables()

    async def _ensure_tables(self):
        """Create tables if they don't exist"""
        async with self.db_pool.acquire() as conn:
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS risk_analyses (
                    id SERIAL PRIMARY KEY,
                    timestamp TIMESTAMPTZ DEFAULT NOW(),
                    composite_score INT,
                    protocol_risk INT,
                    liquidity_risk INT,
                    utilization_risk INT,
                    governance_risk INT,
                    oracle_risk INT,
                    risk_level VARCHAR(20),
                    recommended_action TEXT,
                    action_urgency VARCHAR(20),
                    reasoning TEXT,
                    strategy_risks JSONB,
                    alerts JSONB,
                    should_emergency_unwind BOOLEAN,
                    unwind_strategies JSONB,
                    action_taken TEXT,
                    tx_hash VARCHAR(66)
                )
            """)

    async def fetch_vault_data(self) -> VaultData:
        """Fetch current on-chain vault data"""
        # Get TVL
        tvl = self.vault.functions.totalAssets().call()
        
        # Get strategies
        strategy_count = self.vault.functions.strategyCount().call()
        strategies = []
        for i in range(strategy_count):
            strategies.append(self.vault.functions.strategies(i).call())
        
        # Build allocations and utilization rates
        allocations = {}
        utilization_rates = {}
        strategy_apys = {}
        
        for strat in strategies:
            name = strat[1]  # Strategy name
            allocation = Decimal(strat[2]) / 10000  # Convert from basis points
            allocations[name] = allocation
            
            # Get utilization from strategy contract (simplified)
            strategy_addr = strat[0]
            # Would call strategy.utilizationRate() here
            utilization_rates[name] = Decimal("0.75")  # Placeholder
            strategy_apys[name] = Decimal("0.05")  # Placeholder
        
        # Get current risk score
        current_risk = self.vault.functions.vaultRiskScore().call()
        
        # Get idle buffer
        idle = self.w3.eth.get_balance(self.vault.address)  # Simplified
        idle_buffer = Decimal(idle) / Decimal(tvl) if tvl > 0 else Decimal(0)
        
        # Last rebalance
        last_rebalance_ts = self.vault.functions.lastRebalanceTime().call()
        
        return VaultData(
            tvl=Decimal(tvl) / Decimal(10**6),  # Assume USDC 6 decimals
            allocations=allocations,
            utilization_rates=utilization_rates,
            strategy_apys=strategy_apys,
            current_risk_score=current_risk,
            idle_buffer=idle_buffer,
            last_rebalance=datetime.fromtimestamp(last_rebalance_ts),
            pending_withdrawals=Decimal(0)  # Would fetch from events
        )

    async def analyze_risk(self, vault_data: Optional[VaultData] = None) -> RiskAnalysis:
        """
        Analyze vault risk using Claude claude-sonnet-4
        """
        if vault_data is None:
            vault_data = await self.fetch_vault_data()
        
        # Prepare context for Claude
        context = f"""
Current Vault State:
- TVL: ${vault_data.tvl:,.2f}
- Current Risk Score: {vault_data.current_risk_score / 100}%
- Idle Buffer: {vault_data.idle_buffer * 100:.2f}%
- Last Rebalance: {vault_data.last_rebalance.isoformat()}

Strategy Allocations:
{json.dumps({k: float(v) for k, v in vault_data.allocations.items()}, indent=2)}

Utilization Rates:
{json.dumps({k: float(v) for k, v in vault_data.utilization_rates.items()}, indent=2)}

Strategy APYs:
{json.dumps({k: float(v) for k, v in vault_data.strategy_apys.items()}, indent=2)}

Pending Withdrawals: ${vault_data.pending_withdrawals:,.2f}

Analyze this data and provide a comprehensive risk assessment.
"""

        # Call Claude
        message = self.client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=2000,
            system=RISK_AGENT_PROMPT,
            messages=[
                {"role": "user", "content": context}
            ]
        )

        # Parse response
        response_text = message.content[0].text
        
        # Extract JSON from response
        try:
            # Try to find JSON in response
            json_start = response_text.find('{')
            json_end = response_text.rfind('}') + 1
            json_str = response_text[json_start:json_end]
            result = json.loads(json_str)
        except (json.JSONDecodeError, ValueError) as e:
            logger.error(f"Failed to parse Claude response: {e}")
            # Return default high-risk response on parse failure
            result = {
                "composite_score": 7000,
                "protocol_risk": 7000,
                "liquidity_risk": 7000,
                "utilization_risk": 7000,
                "governance_risk": 7000,
                "oracle_risk": 7000,
                "risk_level": "HIGH_RISK",
                "recommended_action": "Manual review required - parse failure",
                "action_urgency": "HIGH",
                "reasoning": f"Failed to parse AI response: {str(e)}",
                "strategy_risks": {},
                "alerts": ["Parse failure - manual review required"],
                "should_emergency_unwind": False,
                "unwind_strategies": []
            }

        analysis = RiskAnalysis(
            timestamp=datetime.utcnow(),
            composite_score=result["composite_score"],
            protocol_risk=result["protocol_risk"],
            liquidity_risk=result["liquidity_risk"],
            utilization_risk=result["utilization_risk"],
            governance_risk=result["governance_risk"],
            oracle_risk=result["oracle_risk"],
            risk_level=result["risk_level"],
            recommended_action=result["recommended_action"],
            action_urgency=result["action_urgency"],
            reasoning=result["reasoning"],
            strategy_risks=result["strategy_risks"],
            alerts=result["alerts"],
            should_emergency_unwind=result["should_emergency_unwind"],
            unwind_strategies=result.get("unwind_strategies", [])
        )

        # Log to database
        await self._log_analysis(analysis)

        # Check if emergency action needed
        if analysis.composite_score >= 8000 or analysis.should_emergency_unwind:
            await self._execute_emergency_unwind(analysis)

        return analysis

    async def _log_analysis(self, analysis: RiskAnalysis, action_taken: str = None, tx_hash: str = None):
        """Log analysis to PostgreSQL"""
        async with self.db_pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO risk_analyses (
                    composite_score, protocol_risk, liquidity_risk,
                    utilization_risk, governance_risk, oracle_risk,
                    risk_level, recommended_action, action_urgency,
                    reasoning, strategy_risks, alerts,
                    should_emergency_unwind, unwind_strategies,
                    action_taken, tx_hash
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
            """,
                analysis.composite_score,
                analysis.protocol_risk,
                analysis.liquidity_risk,
                analysis.utilization_risk,
                analysis.governance_risk,
                analysis.oracle_risk,
                analysis.risk_level,
                analysis.recommended_action,
                analysis.action_urgency,
                analysis.reasoning,
                json.dumps(analysis.strategy_risks),
                json.dumps(analysis.alerts),
                analysis.should_emergency_unwind,
                json.dumps(analysis.unwind_strategies),
                action_taken,
                tx_hash
            )

    async def _execute_emergency_unwind(self, analysis: RiskAnalysis):
        """Execute emergency unwind transaction"""
        logger.warning(f"Executing emergency unwind! Risk: {analysis.composite_score}")
        
        for strategy_name in analysis.unwind_strategies:
            try:
                # Get strategy address
                strategy_count = self.vault.functions.strategyCount().call()
                strategy_addr = None
                
                for i in range(strategy_count):
                    strat = self.vault.functions.strategies(i).call()
                    if strat[1] == strategy_name:
                        strategy_addr = strat[0]
                        break
                
                if not strategy_addr:
                    logger.error(f"Strategy not found: {strategy_name}")
                    continue

                # Build transaction
                nonce = self.w3.eth.get_transaction_count(self.account.address)
                
                tx = self.vault.functions.emergencyUnwind(
                    strategy_addr,
                    f"Risk Agent: {analysis.risk_level} - {analysis.reasoning[:100]}"
                ).build_transaction({
                    'from': self.account.address,
                    'nonce': nonce,
                    'gas': 500000,
                    'maxFeePerGas': self.w3.eth.gas_price * 2,
                    'maxPriorityFeePerGas': self.w3.to_wei(2, 'gwei')
                })

                # Sign and send
                signed = self.account.sign_transaction(tx)
                tx_hash = self.w3.eth.send_raw_transaction(signed.rawTransaction)
                
                logger.info(f"Emergency unwind tx sent: {tx_hash.hex()}")
                
                # Wait for receipt
                receipt = self.w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)
                
                # Log result
                await self._log_analysis(
                    analysis,
                    action_taken=f"Emergency unwind {strategy_name}",
                    tx_hash=tx_hash.hex()
                )
                
                logger.info(f"Emergency unwind completed: {receipt.status}")
                
            except Exception as e:
                logger.error(f"Emergency unwind failed for {strategy_name}: {e}")

    async def update_risk_oracle(self, analysis: RiskAnalysis):
        """Update on-chain risk oracle with analysis results"""
        try:
            nonce = self.w3.eth.get_transaction_count(self.account.address)
            
            tx = self.risk_oracle.functions.updateRiskMetrics(
                analysis.protocol_risk,
                analysis.liquidity_risk,
                analysis.utilization_risk,
                analysis.governance_risk,
                analysis.oracle_risk
            ).build_transaction({
                'from': self.account.address,
                'nonce': nonce,
                'gas': 200000,
                'maxFeePerGas': self.w3.eth.gas_price,
                'maxPriorityFeePerGas': self.w3.to_wei(1, 'gwei')
            })

            signed = self.account.sign_transaction(tx)
            tx_hash = self.w3.eth.send_raw_transaction(signed.rawTransaction)
            
            logger.info(f"Risk oracle update tx: {tx_hash.hex()}")
            
            receipt = self.w3.eth.wait_for_transaction_receipt(tx_hash, timeout=60)
            logger.info(f"Risk oracle updated: {receipt.status}")
            
        except Exception as e:
            logger.error(f"Failed to update risk oracle: {e}")

    async def close(self):
        """Clean up resources"""
        if self.db_pool:
            await self.db_pool.close()
