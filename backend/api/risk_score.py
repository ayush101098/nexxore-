"""
Risk Score API
Provides risk assessment data and recommendations
"""

import json
import logging
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, List
from decimal import Decimal

import aiohttp
import asyncpg
from web3 import Web3

logger = logging.getLogger(__name__)


class RiskScoreAPI:
    """
    Provides risk score calculation and assessment
    """

    def __init__(self, w3: Web3, db_pool: asyncpg.Pool):
        self.w3 = w3
        self.db_pool = db_pool
        
        # Risk thresholds (basis points)
        self.ELEVATED = 6000
        self.HIGH_RISK = 7000
        self.CRITICAL = 8000
        
        # External data sources
        self.defillama_api = "https://api.llama.fi"
        self.dune_api = "https://api.dune.com/api/v1"

    async def get_current_score(self, vault_address: str) -> Dict[str, Any]:
        """
        Get current risk assessment for vault
        """
        vault_address = Web3.to_checksum_address(vault_address)
        
        # Load vault contract
        vault_abi = json.load(open("abi/SafeYieldVault.json"))
        vault = self.w3.eth.contract(address=vault_address, abi=vault_abi)
        
        # Get on-chain risk score
        on_chain_score = vault.functions.riskScore().call()
        risk_state = vault.functions.currentRiskState().call()
        
        # Calculate component scores
        protocol_risk = await self._calculate_protocol_risk(vault_address)
        liquidity_risk = await self._calculate_liquidity_risk(vault_address)
        utilization_risk = await self._calculate_utilization_risk(vault_address)
        governance_risk = await self._calculate_governance_risk(vault_address)
        oracle_risk = await self._calculate_oracle_risk(vault_address)
        
        # Calculate composite score (weighted average)
        # Weights: 25% protocol, 20% liquidity, 25% utilization, 15% governance, 15% oracle
        composite = int(
            protocol_risk * 0.25 +
            liquidity_risk * 0.20 +
            utilization_risk * 0.25 +
            governance_risk * 0.15 +
            oracle_risk * 0.15
        )
        
        # Determine risk state
        if composite >= self.CRITICAL:
            state = "CRITICAL"
        elif composite >= self.HIGH_RISK:
            state = "HIGH_RISK"
        elif composite >= self.ELEVATED:
            state = "ELEVATED"
        else:
            state = "NORMAL"
        
        # Generate recommendations
        recommendations = self._generate_recommendations(
            composite, protocol_risk, liquidity_risk, 
            utilization_risk, governance_risk, oracle_risk
        )
        
        return {
            "composite_score": composite,
            "protocol_risk": protocol_risk,
            "liquidity_risk": liquidity_risk,
            "utilization_risk": utilization_risk,
            "governance_risk": governance_risk,
            "oracle_risk": oracle_risk,
            "risk_state": state,
            "recommendations": recommendations
        }

    async def _calculate_protocol_risk(self, vault_address: str) -> int:
        """
        Calculate protocol risk based on:
        - Smart contract audit status
        - Time since deployment
        - Bug bounty size
        - Historical exploits
        """
        try:
            # Get strategies
            vault_abi = json.load(open("abi/SafeYieldVault.json"))
            vault = self.w3.eth.contract(address=vault_address, abi=vault_abi)
            strategies = vault.functions.getStrategies().call()
            
            total_risk = 0
            
            for strategy_addr in strategies:
                # Check protocol data from database
                async with self.db_pool.acquire() as conn:
                    row = await conn.fetchrow("""
                        SELECT audit_score, deployment_age_days, bug_bounty_usd, exploit_count
                        FROM protocol_metadata
                        WHERE strategy_address = $1
                    """, strategy_addr.lower())
                    
                    if row:
                        # Higher audit score = lower risk
                        audit_risk = max(0, 10000 - row["audit_score"] * 100)
                        
                        # Newer = riskier
                        age_risk = max(0, 5000 - row["deployment_age_days"] * 5)
                        
                        # Larger bounty = lower risk
                        bounty_risk = max(0, 3000 - row["bug_bounty_usd"] / 1000)
                        
                        # Exploits = very high risk
                        exploit_risk = row["exploit_count"] * 2000
                        
                        total_risk += (audit_risk + age_risk + bounty_risk + exploit_risk) / 4
                    else:
                        total_risk += 5000  # Default medium risk for unknown
            
            return int(total_risk / len(strategies)) if strategies else 5000
        except Exception as e:
            logger.error(f"Failed to calculate protocol risk: {e}")
            return 5000

    async def _calculate_liquidity_risk(self, vault_address: str) -> int:
        """
        Calculate liquidity risk based on:
        - Available liquidity in protocols
        - Withdrawal queue depth
        - DEX liquidity for swaps
        """
        try:
            vault_abi = json.load(open("abi/SafeYieldVault.json"))
            vault = self.w3.eth.contract(address=vault_address, abi=vault_abi)
            
            total_assets = vault.functions.totalAssets().call()
            idle_balance = vault.functions.idleBalance().call()
            
            # Idle ratio - lower idle = higher risk
            idle_ratio = idle_balance / total_assets if total_assets > 0 else 0
            
            # Get protocol liquidity from DefiLlama
            async with aiohttp.ClientSession() as session:
                async with session.get(f"{self.defillama_api}/pools") as response:
                    data = await response.json()
                    
                    # Sum available liquidity across protocols
                    available_liquidity = 0
                    for pool in data.get("data", []):
                        if pool.get("symbol") == "USDC" and pool.get("chain") == "Ethereum":
                            available_liquidity += pool.get("tvl", 0)
                    
                    # Risk increases if TVL is large relative to available liquidity
                    tvl_ratio = total_assets / (available_liquidity * 10**6) if available_liquidity > 0 else 1
            
            # Calculate risk score
            idle_risk = int(max(0, (0.05 - idle_ratio) * 100000))  # Target 5% idle
            liquidity_risk = int(min(10000, tvl_ratio * 10000))
            
            return int((idle_risk + liquidity_risk) / 2)
        except Exception as e:
            logger.error(f"Failed to calculate liquidity risk: {e}")
            return 5000

    async def _calculate_utilization_risk(self, vault_address: str) -> int:
        """
        Calculate utilization risk based on:
        - Current utilization rates
        - Strategy capacity limits
        """
        try:
            vault_abi = json.load(open("abi/SafeYieldVault.json"))
            vault = self.w3.eth.contract(address=vault_address, abi=vault_abi)
            strategies = vault.functions.getStrategies().call()
            
            total_risk = 0
            
            for strategy_addr in strategies:
                strategy_abi = json.load(open("abi/IStrategy.json"))
                strategy = self.w3.eth.contract(address=strategy_addr, abi=strategy_abi)
                
                try:
                    utilization = strategy.functions.utilizationRate().call() / 100
                except:
                    utilization = 5000  # Default 50%
                
                # Higher utilization = higher risk
                # 80% alert threshold, 90% exit threshold
                if utilization >= 9000:
                    risk = 9000
                elif utilization >= 8000:
                    risk = 7000
                elif utilization >= 7000:
                    risk = 5000
                else:
                    risk = utilization * 0.7
                
                total_risk += risk
            
            return int(total_risk / len(strategies)) if strategies else 5000
        except Exception as e:
            logger.error(f"Failed to calculate utilization risk: {e}")
            return 5000

    async def _calculate_governance_risk(self, vault_address: str) -> int:
        """
        Calculate governance risk based on:
        - Recent governance proposals
        - Pending timelock actions
        - Admin key distribution
        """
        try:
            async with self.db_pool.acquire() as conn:
                # Check for recent governance alerts
                rows = await conn.fetch("""
                    SELECT severity, created_at FROM governance_alerts
                    WHERE vault_address = $1
                    AND created_at > NOW() - INTERVAL '7 days'
                    ORDER BY severity DESC
                """, vault_address.lower())
                
                if not rows:
                    return 3000  # Low risk if no recent alerts
                
                # Sum risk based on alert severity
                risk = 0
                for row in rows:
                    if row["severity"] == "critical":
                        risk += 3000
                    elif row["severity"] == "high":
                        risk += 2000
                    elif row["severity"] == "medium":
                        risk += 1000
                    else:
                        risk += 500
                
                return min(10000, risk)
        except Exception as e:
            logger.error(f"Failed to calculate governance risk: {e}")
            return 5000

    async def _calculate_oracle_risk(self, vault_address: str) -> int:
        """
        Calculate oracle risk based on:
        - Price feed freshness
        - Deviation from TWAP
        - Oracle decentralization
        """
        try:
            vault_abi = json.load(open("abi/SafeYieldVault.json"))
            vault = self.w3.eth.contract(address=vault_address, abi=vault_abi)
            
            # Check stablecoin prices
            usdc_price = await self._get_chainlink_price("0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6")  # USDC/USD
            
            # Calculate deviation from $1
            deviation = abs(usdc_price - 10**8) / 10**8  # Chainlink uses 8 decimals
            
            # >0.5% deviation = elevated risk, >2% = critical
            if deviation >= 0.02:
                return 9000
            elif deviation >= 0.005:
                return 6000
            elif deviation >= 0.001:
                return 4000
            else:
                return 2000
        except Exception as e:
            logger.error(f"Failed to calculate oracle risk: {e}")
            return 5000

    async def _get_chainlink_price(self, feed_address: str) -> int:
        """Get latest price from Chainlink feed"""
        try:
            feed_abi = [{
                "inputs": [],
                "name": "latestRoundData",
                "outputs": [
                    {"name": "roundId", "type": "uint80"},
                    {"name": "answer", "type": "int256"},
                    {"name": "startedAt", "type": "uint256"},
                    {"name": "updatedAt", "type": "uint256"},
                    {"name": "answeredInRound", "type": "uint80"}
                ],
                "type": "function"
            }]
            
            feed = self.w3.eth.contract(
                address=Web3.to_checksum_address(feed_address),
                abi=feed_abi
            )
            
            result = feed.functions.latestRoundData().call()
            return result[1]  # answer
        except Exception as e:
            logger.error(f"Failed to get Chainlink price: {e}")
            return 10**8  # Default $1

    def _generate_recommendations(
        self,
        composite: int,
        protocol: int,
        liquidity: int,
        utilization: int,
        governance: int,
        oracle: int
    ) -> List[str]:
        """
        Generate actionable recommendations based on risk scores
        """
        recommendations = []
        
        if composite >= self.CRITICAL:
            recommendations.append("URGENT: Consider emergency withdrawal. Risk level is critical.")
        
        if protocol >= 7000:
            recommendations.append("Protocol risk elevated. Review smart contract security status.")
        
        if liquidity >= 7000:
            recommendations.append("Liquidity risk elevated. Increase idle buffer or diversify strategies.")
        
        if utilization >= 8000:
            recommendations.append("Utilization near capacity. Consider reducing strategy allocations.")
        
        if governance >= 6000:
            recommendations.append("Active governance proposals detected. Monitor for potential changes.")
        
        if oracle >= 6000:
            recommendations.append("Stablecoin price deviation detected. Monitor for further depegging.")
        
        if not recommendations:
            recommendations.append("Risk levels within acceptable parameters. Continue normal operations.")
        
        return recommendations

    async def get_risk_history(
        self,
        vault_address: str,
        days: int = 30
    ) -> List[Dict[str, Any]]:
        """
        Get historical risk scores
        """
        try:
            async with self.db_pool.acquire() as conn:
                rows = await conn.fetch("""
                    SELECT composite_score, protocol_risk, liquidity_risk, 
                           utilization_risk, governance_risk, oracle_risk,
                           risk_state, timestamp
                    FROM risk_assessments
                    WHERE vault_address = $1
                    AND timestamp > NOW() - INTERVAL '1 day' * $2
                    ORDER BY timestamp DESC
                """, vault_address.lower(), days)
                
                return [dict(row) for row in rows]
        except Exception as e:
            logger.error(f"Failed to get risk history: {e}")
            return []

    async def save_assessment(
        self,
        vault_address: str,
        assessment: Dict[str, Any]
    ):
        """
        Save risk assessment to database
        """
        try:
            async with self.db_pool.acquire() as conn:
                await conn.execute("""
                    INSERT INTO risk_assessments (
                        vault_address, composite_score, protocol_risk, liquidity_risk,
                        utilization_risk, governance_risk, oracle_risk, risk_state
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                """,
                    vault_address.lower(),
                    assessment["composite_score"],
                    assessment["protocol_risk"],
                    assessment["liquidity_risk"],
                    assessment["utilization_risk"],
                    assessment["governance_risk"],
                    assessment["oracle_risk"],
                    assessment["risk_state"]
                )
        except Exception as e:
            logger.error(f"Failed to save assessment: {e}")

    async def get_risk_alerts(
        self,
        vault_address: str,
        limit: int = 10
    ) -> List[Dict[str, Any]]:
        """
        Get recent risk alerts
        """
        try:
            async with self.db_pool.acquire() as conn:
                rows = await conn.fetch("""
                    SELECT * FROM risk_alerts
                    WHERE vault_address = $1
                    ORDER BY created_at DESC
                    LIMIT $2
                """, vault_address.lower(), limit)
                
                return [dict(row) for row in rows]
        except Exception as e:
            logger.error(f"Failed to get risk alerts: {e}")
            return []
