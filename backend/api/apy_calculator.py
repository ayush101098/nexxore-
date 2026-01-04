"""
APY Calculator
Calculates yield for vault and individual strategies
"""

import asyncio
import json
import logging
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, List
from decimal import Decimal

import aiohttp
import asyncpg
from web3 import Web3

logger = logging.getLogger(__name__)


class APYCalculator:
    """
    Calculates APY for vault and strategies using multiple methods
    """

    def __init__(self, w3: Web3, db_pool: asyncpg.Pool):
        self.w3 = w3
        self.db_pool = db_pool
        
        # Protocol API endpoints
        self.aave_api = "https://api.aave.com/data/markets"
        self.compound_api = "https://api.compound.finance/api/v2/ctoken"
        self.defillama_api = "https://yields.llama.fi/pools"
        self.maker_api = "https://api.makerdao.com/v1/dsr"
        
        # Cache for API responses
        self._cache: Dict[str, Any] = {}
        self._cache_ttl = 300  # 5 minutes

    async def calculate_vault_apy(self, vault_address: str) -> Dict[str, Any]:
        """
        Calculate total vault APY including all strategies
        """
        vault_abi = json.load(open("abi/SafeYieldVault.json"))
        vault = self.w3.eth.contract(
            address=Web3.to_checksum_address(vault_address),
            abi=vault_abi
        )
        
        total_assets = vault.functions.totalAssets().call()
        strategies = vault.functions.getStrategies().call()
        
        breakdown = []
        weighted_apy = Decimal("0")
        
        for strategy_addr in strategies:
            strategy_apy = await self.get_strategy_apy(strategy_addr)
            allocation = vault.functions.strategyAllocations(strategy_addr).call()
            
            # Get strategy balance
            strategy_abi = json.load(open("abi/IStrategy.json"))
            strategy = self.w3.eth.contract(address=strategy_addr, abi=strategy_abi)
            balance = strategy.functions.totalAssets().call()
            
            tvl_share = Decimal(str(balance)) / Decimal(str(total_assets)) if total_assets > 0 else Decimal("0")
            weighted_apy += Decimal(str(strategy_apy)) * tvl_share
            
            breakdown.append({
                "strategy": strategy_addr,
                "base_apy": strategy_apy * 0.85,  # Estimate base vs rewards
                "reward_apy": strategy_apy * 0.15,
                "total_apy": strategy_apy,
                "tvl_share": float(tvl_share) * 100
            })
        
        # Vault fees
        performance_fee = vault.functions.performanceFeeBps().call() / 10000
        gross_apy = float(weighted_apy)
        fee_apy = gross_apy * performance_fee
        net_apy = gross_apy - fee_apy
        
        return {
            "net_apy": net_apy,
            "gross_apy": gross_apy,
            "fee_apy": fee_apy,
            "breakdown": breakdown
        }

    async def get_strategy_apy(self, strategy_address: str) -> float:
        """
        Get APY for a specific strategy
        Uses multiple data sources for accuracy
        """
        strategy_address = Web3.to_checksum_address(strategy_address)
        
        # Check cache first
        cache_key = f"strategy_apy_{strategy_address}"
        if cache_key in self._cache:
            cached = self._cache[cache_key]
            if datetime.utcnow() - cached["timestamp"] < timedelta(seconds=self._cache_ttl):
                return cached["value"]
        
        # Try to identify strategy type and get APY
        strategy_abi = json.load(open("abi/IStrategy.json"))
        strategy = self.w3.eth.contract(address=strategy_address, abi=strategy_abi)
        
        try:
            name = strategy.functions.name().call().lower()
        except:
            name = ""
        
        apy = 0.0
        
        if "aave" in name:
            apy = await self._get_aave_apy()
        elif "compound" in name:
            apy = await self._get_compound_apy()
        elif "maker" in name or "dsr" in name or "sdai" in name:
            apy = await self._get_maker_dsr_apy()
        elif "loop" in name:
            apy = await self._get_loop_strategy_apy(strategy_address)
        else:
            # Fallback to historical calculation
            apy = await self._calculate_historical_apy(strategy_address)
        
        # Cache result
        self._cache[cache_key] = {
            "value": apy,
            "timestamp": datetime.utcnow()
        }
        
        return apy

    async def _get_aave_apy(self) -> float:
        """Get current Aave v3 USDC supply APY"""
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(f"{self.defillama_api}") as response:
                    data = await response.json()
                    
                    # Find USDC pool on Aave v3 Ethereum
                    for pool in data.get("data", []):
                        if (pool.get("project") == "aave-v3" and 
                            pool.get("symbol") == "USDC" and
                            pool.get("chain") == "Ethereum"):
                            return pool.get("apy", 0) / 100  # Convert from percentage
                    
                    return 0.03  # Default 3%
        except Exception as e:
            logger.error(f"Failed to fetch Aave APY: {e}")
            return 0.03

    async def _get_compound_apy(self) -> float:
        """Get current Compound v3 USDC supply APY"""
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(f"{self.defillama_api}") as response:
                    data = await response.json()
                    
                    for pool in data.get("data", []):
                        if (pool.get("project") == "compound-v3" and 
                            pool.get("symbol") == "USDC" and
                            pool.get("chain") == "Ethereum"):
                            return pool.get("apy", 0) / 100
                    
                    return 0.025  # Default 2.5%
        except Exception as e:
            logger.error(f"Failed to fetch Compound APY: {e}")
            return 0.025

    async def _get_maker_dsr_apy(self) -> float:
        """Get current Maker DSR rate"""
        try:
            async with aiohttp.ClientSession() as session:
                # Try DefiLlama first
                async with session.get(f"{self.defillama_api}") as response:
                    data = await response.json()
                    
                    for pool in data.get("data", []):
                        if (pool.get("project") == "spark" and 
                            pool.get("symbol") == "sDAI"):
                            return pool.get("apy", 0) / 100
                    
                    return 0.05  # Default 5%
        except Exception as e:
            logger.error(f"Failed to fetch Maker DSR: {e}")
            return 0.05

    async def _get_loop_strategy_apy(self, strategy_address: str) -> float:
        """
        Calculate APY for looping strategy
        APY = (supply_apy - borrow_apy) * leverage
        """
        try:
            base_supply_apy = await self._get_aave_apy()
            
            # Get borrow rate from DefiLlama
            async with aiohttp.ClientSession() as session:
                async with session.get(f"{self.defillama_api}") as response:
                    data = await response.json()
                    
                    borrow_apy = 0.04  # Default
                    for pool in data.get("data", []):
                        if (pool.get("project") == "aave-v3" and 
                            pool.get("symbol") == "USDC" and
                            pool.get("chain") == "Ethereum"):
                            borrow_apy = pool.get("apyBorrow", 4) / 100
                            break
            
            # Read leverage from contract
            strategy_abi = json.load(open("abi/StableLoopStrategy.json"))
            strategy = self.w3.eth.contract(address=strategy_address, abi=strategy_abi)
            
            try:
                current_ltv = strategy.functions.currentLTV().call() / 10000
                # Effective leverage = 1 / (1 - LTV)
                leverage = 1 / (1 - current_ltv) if current_ltv < 1 else 1
            except:
                leverage = 1.5  # Default leverage
            
            # Net APY = supply_apy * leverage - borrow_apy * (leverage - 1)
            net_apy = base_supply_apy * leverage - borrow_apy * (leverage - 1)
            
            return max(net_apy, 0)
        except Exception as e:
            logger.error(f"Failed to calculate loop APY: {e}")
            return 0.04

    async def _calculate_historical_apy(self, strategy_address: str) -> float:
        """
        Calculate APY from historical share price changes
        """
        try:
            async with self.db_pool.acquire() as conn:
                # Get share prices from 7 days ago and now
                rows = await conn.fetch("""
                    SELECT share_price, timestamp
                    FROM strategy_snapshots
                    WHERE strategy_address = $1
                    AND timestamp > NOW() - INTERVAL '7 days'
                    ORDER BY timestamp ASC
                """, strategy_address.lower())
                
                if len(rows) < 2:
                    return 0.03  # Default if insufficient data
                
                oldest = rows[0]
                newest = rows[-1]
                
                price_change = (newest["share_price"] - oldest["share_price"]) / oldest["share_price"]
                days = (newest["timestamp"] - oldest["timestamp"]).total_seconds() / 86400
                
                # Annualize
                apy = (1 + price_change) ** (365 / days) - 1 if days > 0 else 0
                
                return max(apy, 0)
        except Exception as e:
            logger.error(f"Failed to calculate historical APY: {e}")
            return 0.03

    async def get_utilization(self, strategy_address: str) -> float:
        """
        Get utilization rate for a strategy
        """
        try:
            strategy_abi = json.load(open("abi/IStrategy.json"))
            strategy = self.w3.eth.contract(
                address=Web3.to_checksum_address(strategy_address),
                abi=strategy_abi
            )
            
            # Try to call utilizationRate if available
            try:
                return strategy.functions.utilizationRate().call() / 10000
            except:
                pass
            
            # Fallback: estimate from protocol data
            name = strategy.functions.name().call().lower()
            
            if "aave" in name:
                return await self._get_aave_utilization()
            elif "compound" in name:
                return await self._get_compound_utilization()
            
            return 0.5  # Default 50%
        except Exception as e:
            logger.error(f"Failed to get utilization: {e}")
            return 0.5

    async def _get_aave_utilization(self) -> float:
        """Get Aave USDC pool utilization"""
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(f"{self.defillama_api}") as response:
                    data = await response.json()
                    
                    for pool in data.get("data", []):
                        if (pool.get("project") == "aave-v3" and 
                            pool.get("symbol") == "USDC" and
                            pool.get("chain") == "Ethereum"):
                            return pool.get("utilization", 50) / 100
                    
                    return 0.5
        except:
            return 0.5

    async def _get_compound_utilization(self) -> float:
        """Get Compound USDC pool utilization"""
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(f"{self.defillama_api}") as response:
                    data = await response.json()
                    
                    for pool in data.get("data", []):
                        if (pool.get("project") == "compound-v3" and 
                            pool.get("symbol") == "USDC" and
                            pool.get("chain") == "Ethereum"):
                            return pool.get("utilization", 50) / 100
                    
                    return 0.5
        except:
            return 0.5

    async def snapshot_strategy(self, strategy_address: str):
        """
        Take a snapshot of strategy state for historical tracking
        """
        try:
            strategy_abi = json.load(open("abi/IStrategy.json"))
            strategy = self.w3.eth.contract(
                address=Web3.to_checksum_address(strategy_address),
                abi=strategy_abi
            )
            
            total_assets = strategy.functions.totalAssets().call()
            total_shares = strategy.functions.totalSupply().call()
            share_price = total_assets / total_shares if total_shares > 0 else 10**6
            
            async with self.db_pool.acquire() as conn:
                await conn.execute("""
                    INSERT INTO strategy_snapshots (strategy_address, total_assets, total_shares, share_price)
                    VALUES ($1, $2, $3, $4)
                """,
                    strategy_address.lower(),
                    total_assets,
                    total_shares,
                    share_price
                )
        except Exception as e:
            logger.error(f"Failed to snapshot strategy: {e}")

    async def get_7d_apy_change(self, vault_address: str) -> Dict[str, float]:
        """
        Get APY change over the past 7 days
        """
        try:
            async with self.db_pool.acquire() as conn:
                rows = await conn.fetch("""
                    SELECT apy, timestamp
                    FROM vault_apy_history
                    WHERE vault_address = $1
                    AND timestamp > NOW() - INTERVAL '7 days'
                    ORDER BY timestamp ASC
                """, vault_address.lower())
                
                if len(rows) < 2:
                    return {"change": 0, "trend": "stable"}
                
                oldest_apy = rows[0]["apy"]
                current_apy = rows[-1]["apy"]
                change = current_apy - oldest_apy
                
                trend = "up" if change > 0.1 else "down" if change < -0.1 else "stable"
                
                return {
                    "change": change,
                    "trend": trend,
                    "oldest": oldest_apy,
                    "current": current_apy
                }
        except Exception as e:
            logger.error(f"Failed to get APY change: {e}")
            return {"change": 0, "trend": "stable"}
