"""
Execution Agent Service
Proposes and executes rebalancing operations between strategies
"""

import asyncio
import json
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any
from decimal import Decimal

import aiohttp
from web3 import Web3
import asyncpg

logger = logging.getLogger(__name__)


@dataclass
class RebalanceProposal:
    """Proposed rebalance operation"""
    from_strategy: str
    to_strategy: str
    amount: Decimal
    percentage_of_tvl: Decimal
    reason: str
    expected_apy_improvement: Decimal
    gas_estimate: int
    gas_price_gwei: Decimal


@dataclass
class StrategyAllocation:
    """Current strategy allocation"""
    address: str
    name: str
    current_allocation: Decimal  # basis points
    target_allocation: Decimal
    max_allocation: Decimal
    total_deposited: Decimal
    current_apy: Decimal
    utilization: Decimal


class ExecutionAgent:
    """
    Execution Agent that proposes and executes rebalancing operations
    """

    # Constants
    REBALANCE_COOLDOWN = timedelta(days=7)
    MAX_SINGLE_REBALANCE_BPS = 1500  # 15% of TVL
    MIN_IDLE_BUFFER_BPS = 500  # 5%
    BASIS_POINTS = 10000

    def __init__(
        self,
        web3_provider: str,
        vault_address: str,
        vault_abi: List[Dict],
        db_url: str,
        private_key: str,
        flashbots_url: str = "https://relay.flashbots.net"
    ):
        self.w3 = Web3(Web3.HTTPProvider(web3_provider))
        
        self.vault = self.w3.eth.contract(
            address=Web3.to_checksum_address(vault_address),
            abi=vault_abi
        )
        
        self.db_url = db_url
        self.account = self.w3.eth.account.from_key(private_key)
        self.flashbots_url = flashbots_url
        self.db_pool: Optional[asyncpg.Pool] = None

    async def initialize(self):
        """Initialize database connection pool"""
        self.db_pool = await asyncpg.create_pool(self.db_url)
        await self._ensure_tables()

    async def _ensure_tables(self):
        """Create tables if they don't exist"""
        async with self.db_pool.acquire() as conn:
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS rebalance_proposals (
                    id SERIAL PRIMARY KEY,
                    timestamp TIMESTAMPTZ DEFAULT NOW(),
                    from_strategy VARCHAR(100),
                    to_strategy VARCHAR(100),
                    amount DECIMAL,
                    percentage_of_tvl DECIMAL,
                    reason TEXT,
                    expected_apy_improvement DECIMAL,
                    gas_estimate INT,
                    gas_price_gwei DECIMAL,
                    proposal_id INT,
                    status VARCHAR(20) DEFAULT 'proposed',
                    tx_hash VARCHAR(66),
                    executed_at TIMESTAMPTZ
                )
            """)

    async def can_rebalance(self) -> tuple[bool, Optional[str]]:
        """Check if rebalance is allowed based on cooldown"""
        last_rebalance = self.vault.functions.lastRebalanceTime().call()
        last_dt = datetime.fromtimestamp(last_rebalance)
        
        if datetime.utcnow() < last_dt + self.REBALANCE_COOLDOWN:
            time_remaining = (last_dt + self.REBALANCE_COOLDOWN) - datetime.utcnow()
            return False, f"Cooldown active. {time_remaining.days}d {time_remaining.seconds // 3600}h remaining"
        
        return True, None

    async def get_current_allocations(self) -> List[StrategyAllocation]:
        """Fetch current strategy allocations from vault"""
        strategy_count = self.vault.functions.strategyCount().call()
        allocations = []
        
        for i in range(strategy_count):
            strat = self.vault.functions.strategies(i).call()
            # strat tuple: (address, name, allocation, maxAllocation, targetAllocation, isActive, totalDeposited, lastHarvestTime)
            
            allocations.append(StrategyAllocation(
                address=strat[0],
                name=strat[1],
                current_allocation=Decimal(strat[2]) / self.BASIS_POINTS,
                target_allocation=Decimal(strat[4]) / self.BASIS_POINTS,
                max_allocation=Decimal(strat[3]) / self.BASIS_POINTS,
                total_deposited=Decimal(strat[6]) / Decimal(10**6),  # USDC decimals
                current_apy=Decimal("0.05"),  # Would fetch from strategy
                utilization=Decimal("0.75")  # Would fetch from strategy
            ))
        
        return allocations

    async def get_optimal_gas_price(self) -> Decimal:
        """Get optimal gas price from EthGasStation API"""
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(
                    "https://api.ethgasstation.info/api/ethgasAPI.json"
                ) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        # Use "fast" gas price, divide by 10 to get gwei
                        return Decimal(data.get("fast", 500)) / 10
        except Exception as e:
            logger.warning(f"Failed to fetch gas price: {e}")
        
        # Fallback to on-chain gas price
        return Decimal(self.w3.eth.gas_price) / Decimal(10**9)

    async def calculate_optimal_allocation(
        self,
        allocations: List[StrategyAllocation]
    ) -> Dict[str, Decimal]:
        """Calculate optimal allocation based on APY and risk"""
        total_weight = Decimal(0)
        weights = {}
        
        for alloc in allocations:
            # Weight based on APY and inverse utilization (prefer less utilized)
            apy_factor = alloc.current_apy
            util_factor = Decimal(1) - alloc.utilization
            weight = apy_factor * util_factor
            
            # Cap at max allocation
            weights[alloc.name] = min(weight, alloc.max_allocation)
            total_weight += weights[alloc.name]
        
        # Normalize to leave idle buffer
        available = Decimal(1) - (Decimal(self.MIN_IDLE_BUFFER_BPS) / self.BASIS_POINTS)
        
        optimal = {}
        for name, weight in weights.items():
            if total_weight > 0:
                optimal[name] = (weight / total_weight) * available
            else:
                optimal[name] = available / len(weights)
        
        return optimal

    async def propose_rebalance(self) -> Optional[RebalanceProposal]:
        """
        Propose a rebalancing operation based on current vs optimal allocation
        """
        # Check cooldown
        can_rebal, reason = await self.can_rebalance()
        if not can_rebal:
            logger.info(f"Cannot rebalance: {reason}")
            return None

        # Get current allocations
        allocations = await self.get_current_allocations()
        
        # Calculate optimal
        optimal = await self.calculate_optimal_allocation(allocations)
        
        # Find largest deviation
        max_deviation = Decimal(0)
        from_strat = None
        to_strat = None
        
        for alloc in allocations:
            current = alloc.current_allocation
            target = optimal.get(alloc.name, Decimal(0))
            deviation = current - target
            
            if deviation > max_deviation:
                max_deviation = deviation
                from_strat = alloc
            elif deviation < -max_deviation:
                to_strat = alloc
        
        if not from_strat or not to_strat:
            logger.info("No rebalancing needed")
            return None
        
        # Check if deviation is significant (> 2%)
        if max_deviation < Decimal("0.02"):
            logger.info(f"Deviation too small: {max_deviation:.2%}")
            return None

        # Get TVL
        tvl = Decimal(self.vault.functions.totalAssets().call()) / Decimal(10**6)
        
        # Calculate amount (limited by max single rebalance)
        max_amount = tvl * Decimal(self.MAX_SINGLE_REBALANCE_BPS) / self.BASIS_POINTS
        amount = min(from_strat.total_deposited * max_deviation, max_amount)
        
        # Verify target allocation doesn't exceed max
        target_new_alloc = (to_strat.total_deposited + amount) / tvl
        if target_new_alloc > to_strat.max_allocation:
            amount = (to_strat.max_allocation * tvl) - to_strat.total_deposited
        
        if amount <= 0:
            return None

        # Get gas estimate
        gas_price = await self.get_optimal_gas_price()
        gas_estimate = 500000  # Estimate, would simulate actual tx

        # Calculate expected APY improvement
        apy_diff = to_strat.current_apy - from_strat.current_apy
        expected_improvement = apy_diff * (amount / tvl)

        proposal = RebalanceProposal(
            from_strategy=from_strat.name,
            to_strategy=to_strat.name,
            amount=amount,
            percentage_of_tvl=(amount / tvl) * 100,
            reason=f"Moving from {from_strat.name} ({from_strat.current_apy:.2%} APY) to {to_strat.name} ({to_strat.current_apy:.2%} APY)",
            expected_apy_improvement=expected_improvement,
            gas_estimate=gas_estimate,
            gas_price_gwei=gas_price
        )

        # Log proposal
        await self._log_proposal(proposal)

        return proposal

    async def _log_proposal(self, proposal: RebalanceProposal) -> int:
        """Log proposal to database and return ID"""
        async with self.db_pool.acquire() as conn:
            row = await conn.fetchrow("""
                INSERT INTO rebalance_proposals (
                    from_strategy, to_strategy, amount,
                    percentage_of_tvl, reason, expected_apy_improvement,
                    gas_estimate, gas_price_gwei
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                RETURNING id
            """,
                proposal.from_strategy,
                proposal.to_strategy,
                proposal.amount,
                proposal.percentage_of_tvl,
                proposal.reason,
                proposal.expected_apy_improvement,
                proposal.gas_estimate,
                proposal.gas_price_gwei
            )
            return row['id']

    async def submit_proposal_onchain(
        self,
        proposal: RebalanceProposal
    ) -> Optional[int]:
        """Submit rebalance proposal to vault contract"""
        try:
            # Get strategy addresses
            allocations = await self.get_current_allocations()
            from_addr = next(
                (a.address for a in allocations if a.name == proposal.from_strategy),
                None
            )
            to_addr = next(
                (a.address for a in allocations if a.name == proposal.to_strategy),
                None
            )
            
            if not from_addr or not to_addr:
                logger.error("Strategy addresses not found")
                return None

            # Convert amount to wei (USDC has 6 decimals)
            amount_wei = int(proposal.amount * Decimal(10**6))

            nonce = self.w3.eth.get_transaction_count(self.account.address)
            
            tx = self.vault.functions.proposeRebalance(
                from_addr,
                to_addr,
                amount_wei
            ).build_transaction({
                'from': self.account.address,
                'nonce': nonce,
                'gas': proposal.gas_estimate,
                'maxFeePerGas': int(proposal.gas_price_gwei * 10**9 * 2),
                'maxPriorityFeePerGas': int(2 * 10**9)
            })

            # Sign transaction
            signed = self.account.sign_transaction(tx)
            
            # Submit via Flashbots to prevent MEV
            tx_hash = await self._submit_via_flashbots(signed.rawTransaction)
            
            if tx_hash:
                receipt = self.w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)
                
                # Extract proposal ID from event logs
                proposal_id = self._extract_proposal_id(receipt)
                
                # Update database
                await self._update_proposal_status(
                    proposal,
                    "submitted",
                    tx_hash.hex(),
                    proposal_id
                )
                
                logger.info(f"Proposal submitted: {proposal_id}, tx: {tx_hash.hex()}")
                return proposal_id
            
        except Exception as e:
            logger.error(f"Failed to submit proposal: {e}")
            return None

    async def _submit_via_flashbots(self, raw_tx: bytes) -> Optional[bytes]:
        """Submit transaction via Flashbots to prevent MEV"""
        try:
            async with aiohttp.ClientSession() as session:
                # Sign bundle
                message = Web3.keccak(raw_tx)
                signature = self.account.sign_message(message)
                
                payload = {
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "eth_sendPrivateTransaction",
                    "params": [{
                        "tx": raw_tx.hex(),
                        "maxBlockNumber": hex(self.w3.eth.block_number + 10)
                    }]
                }
                
                headers = {
                    "X-Flashbots-Signature": f"{self.account.address}:{signature.signature.hex()}"
                }
                
                async with session.post(
                    self.flashbots_url,
                    json=payload,
                    headers=headers
                ) as resp:
                    if resp.status == 200:
                        result = await resp.json()
                        if "result" in result:
                            return bytes.fromhex(result["result"][2:])
                    
                    # Fallback to regular submission
                    logger.warning("Flashbots submission failed, using regular tx")
                    return self.w3.eth.send_raw_transaction(raw_tx)
                    
        except Exception as e:
            logger.error(f"Flashbots submission error: {e}")
            # Fallback
            return self.w3.eth.send_raw_transaction(raw_tx)

    def _extract_proposal_id(self, receipt) -> Optional[int]:
        """Extract proposal ID from RebalanceProposed event"""
        for log in receipt.logs:
            try:
                event = self.vault.events.RebalanceProposed().process_log(log)
                return event.args.proposalId
            except:
                continue
        return None

    async def _update_proposal_status(
        self,
        proposal: RebalanceProposal,
        status: str,
        tx_hash: str,
        proposal_id: int = None
    ):
        """Update proposal status in database"""
        async with self.db_pool.acquire() as conn:
            await conn.execute("""
                UPDATE rebalance_proposals
                SET status = $1, tx_hash = $2, proposal_id = $3
                WHERE from_strategy = $4 AND to_strategy = $5
                AND status = 'proposed'
                ORDER BY timestamp DESC LIMIT 1
            """,
                status, tx_hash, proposal_id,
                proposal.from_strategy, proposal.to_strategy
            )

    async def execute_approved_proposal(self, proposal_id: int) -> bool:
        """Execute an approved rebalance proposal"""
        try:
            # Verify proposal is approved on-chain
            proposal = self.vault.functions.rebalanceProposals(proposal_id).call()
            
            if not proposal[5]:  # approved flag
                logger.warning(f"Proposal {proposal_id} not approved")
                return False
            
            if proposal[4]:  # executed flag
                logger.warning(f"Proposal {proposal_id} already executed")
                return False

            # Check idle buffer after execution
            tvl = self.vault.functions.totalAssets().call()
            idle = self.w3.eth.get_balance(self.vault.address)  # Simplified
            idle_ratio = Decimal(idle) / Decimal(tvl) if tvl > 0 else Decimal(0)
            
            if idle_ratio * self.BASIS_POINTS < self.MIN_IDLE_BUFFER_BPS:
                logger.warning("Insufficient idle buffer after rebalance")
                return False

            # Build and submit execution transaction
            nonce = self.w3.eth.get_transaction_count(self.account.address)
            gas_price = await self.get_optimal_gas_price()
            
            tx = self.vault.functions.executeRebalance(
                proposal_id
            ).build_transaction({
                'from': self.account.address,
                'nonce': nonce,
                'gas': 600000,
                'maxFeePerGas': int(gas_price * 10**9 * 2),
                'maxPriorityFeePerGas': int(2 * 10**9)
            })

            signed = self.account.sign_transaction(tx)
            tx_hash = await self._submit_via_flashbots(signed.rawTransaction)
            
            receipt = self.w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)
            
            if receipt.status == 1:
                logger.info(f"Rebalance executed: {tx_hash.hex()}")
                
                # Update database
                async with self.db_pool.acquire() as conn:
                    await conn.execute("""
                        UPDATE rebalance_proposals
                        SET status = 'executed', executed_at = NOW()
                        WHERE proposal_id = $1
                    """, proposal_id)
                
                return True
            else:
                logger.error(f"Rebalance execution failed: {tx_hash.hex()}")
                return False

        except Exception as e:
            logger.error(f"Execute rebalance failed: {e}")
            return False

    async def set_target_allocations(
        self,
        targets: Dict[str, Decimal]
    ) -> bool:
        """Set target allocations for all strategies"""
        try:
            allocations = await self.get_current_allocations()
            
            addresses = []
            allocation_bps = []
            
            for alloc in allocations:
                if alloc.name in targets:
                    addresses.append(alloc.address)
                    allocation_bps.append(int(targets[alloc.name] * self.BASIS_POINTS))
            
            nonce = self.w3.eth.get_transaction_count(self.account.address)
            gas_price = await self.get_optimal_gas_price()
            
            tx = self.vault.functions.setTargetAllocations(
                addresses,
                allocation_bps
            ).build_transaction({
                'from': self.account.address,
                'nonce': nonce,
                'gas': 300000,
                'maxFeePerGas': int(gas_price * 10**9),
                'maxPriorityFeePerGas': int(1 * 10**9)
            })

            signed = self.account.sign_transaction(tx)
            tx_hash = self.w3.eth.send_raw_transaction(signed.rawTransaction)
            
            receipt = self.w3.eth.wait_for_transaction_receipt(tx_hash, timeout=60)
            
            logger.info(f"Target allocations set: {receipt.status}")
            return receipt.status == 1

        except Exception as e:
            logger.error(f"Set target allocations failed: {e}")
            return False

    async def close(self):
        """Clean up resources"""
        if self.db_pool:
            await self.db_pool.close()
