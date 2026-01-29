"""
Vault Service - Complete Backend for Nexxore Vaults

Handles all vault operations:
- Deposit/Withdraw
- nUSD mint/redeem  
- Strategy management
- Position tracking
"""

import os
import logging
from typing import Dict, Any, List, Optional
from decimal import Decimal
from datetime import datetime
from dataclasses import dataclass
from enum import Enum

from web3 import Web3
from web3.contract import Contract
from eth_account import Account

logger = logging.getLogger(__name__)


class VaultType(Enum):
    SAFE_YIELD = "safe_yield"
    PERPS = "perps"
    DELTA_NEUTRAL = "delta_neutral"
    CUSTOM = "custom"


@dataclass
class VaultPosition:
    """User position in a vault"""
    vault_address: str
    shares: int
    assets: int
    share_price: float
    pnl: float
    pnl_percent: float
    deposited_at: datetime


@dataclass
class CollateralPosition:
    """User collateral position for nUSD"""
    collateral_token: str
    collateral_amount: int
    nusd_debt: int
    ltv: float
    max_mintable: int
    liquidation_price: float
    is_liquidatable: bool


class VaultService:
    """
    Complete vault service for Nexxore protocol.
    
    Handles:
    - ERC-4626 vault operations
    - nUSD collateral management
    - Strategy allocation
    - Position tracking
    """
    
    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.w3: Optional[Web3] = None
        
        # Contract instances
        self.vault_factory: Optional[Contract] = None
        self.collateral_manager: Optional[Contract] = None
        self.nusd: Optional[Contract] = None
        self.strategy_router: Optional[Contract] = None
        
        # Contract addresses
        self.addresses = {
            'vault_factory': config.get('vault_factory_address'),
            'collateral_manager': config.get('collateral_manager_address'),
            'nusd': config.get('nusd_address'),
            'strategy_router': config.get('strategy_router_address'),
        }
        
    async def initialize(self):
        """Initialize Web3 and load contracts."""
        rpc_url = self.config.get('eth_rpc_url')
        self.w3 = Web3(Web3.HTTPProvider(rpc_url))
        
        if not self.w3.is_connected():
            raise ConnectionError("Failed to connect to Ethereum RPC")
            
        # Load contract ABIs and create instances
        self._load_contracts()
        
        logger.info("Vault service initialized")
        
    def _load_contracts(self):
        """Load contract ABIs and create contract instances."""
        # BaseVault ABI (ERC-4626)
        vault_abi = [
            # ERC-4626 standard
            {"inputs": [{"name": "assets", "type": "uint256"}, {"name": "receiver", "type": "address"}], "name": "deposit", "outputs": [{"name": "shares", "type": "uint256"}], "stateMutability": "nonpayable", "type": "function"},
            {"inputs": [{"name": "shares", "type": "uint256"}, {"name": "receiver", "type": "address"}, {"name": "owner", "type": "address"}], "name": "redeem", "outputs": [{"name": "assets", "type": "uint256"}], "stateMutability": "nonpayable", "type": "function"},
            {"inputs": [{"name": "assets", "type": "uint256"}, {"name": "receiver", "type": "address"}, {"name": "owner", "type": "address"}], "name": "withdraw", "outputs": [{"name": "shares", "type": "uint256"}], "stateMutability": "nonpayable", "type": "function"},
            {"inputs": [], "name": "totalAssets", "outputs": [{"name": "", "type": "uint256"}], "stateMutability": "view", "type": "function"},
            {"inputs": [], "name": "totalSupply", "outputs": [{"name": "", "type": "uint256"}], "stateMutability": "view", "type": "function"},
            {"inputs": [{"name": "owner", "type": "address"}], "name": "balanceOf", "outputs": [{"name": "", "type": "uint256"}], "stateMutability": "view", "type": "function"},
            {"inputs": [{"name": "assets", "type": "uint256"}], "name": "convertToShares", "outputs": [{"name": "", "type": "uint256"}], "stateMutability": "view", "type": "function"},
            {"inputs": [{"name": "shares", "type": "uint256"}], "name": "convertToAssets", "outputs": [{"name": "", "type": "uint256"}], "stateMutability": "view", "type": "function"},
            {"inputs": [], "name": "asset", "outputs": [{"name": "", "type": "address"}], "stateMutability": "view", "type": "function"},
            {"inputs": [], "name": "name", "outputs": [{"name": "", "type": "string"}], "stateMutability": "view", "type": "function"},
            {"inputs": [], "name": "symbol", "outputs": [{"name": "", "type": "string"}], "stateMutability": "view", "type": "function"},
            {"inputs": [], "name": "decimals", "outputs": [{"name": "", "type": "uint8"}], "stateMutability": "view", "type": "function"},
            # Strategy functions
            {"inputs": [], "name": "getStrategies", "outputs": [{"name": "", "type": "address[]"}], "stateMutability": "view", "type": "function"},
            {"inputs": [{"name": "strategy", "type": "address"}], "name": "getStrategyInfo", "outputs": [{"name": "weight", "type": "uint256"}, {"name": "allocation", "type": "uint256"}, {"name": "targetAllocation", "type": "uint256"}], "stateMutability": "view", "type": "function"},
            {"inputs": [], "name": "idleBalance", "outputs": [{"name": "", "type": "uint256"}], "stateMutability": "view", "type": "function"},
        ]
        
        # CollateralManager ABI
        collateral_abi = [
            {"inputs": [], "name": "depositETH", "outputs": [], "stateMutability": "payable", "type": "function"},
            {"inputs": [{"name": "token", "type": "address"}, {"name": "amount", "type": "uint256"}], "name": "depositToken", "outputs": [], "stateMutability": "nonpayable", "type": "function"},
            {"inputs": [{"name": "token", "type": "address"}, {"name": "amount", "type": "uint256"}], "name": "withdrawCollateral", "outputs": [], "stateMutability": "nonpayable", "type": "function"},
            {"inputs": [{"name": "collateralToken", "type": "address"}, {"name": "nUSDAmount", "type": "uint256"}], "name": "mintNUSD", "outputs": [], "stateMutability": "nonpayable", "type": "function"},
            {"inputs": [{"name": "collateralToken", "type": "address"}, {"name": "nUSDAmount", "type": "uint256"}], "name": "redeemNUSD", "outputs": [], "stateMutability": "nonpayable", "type": "function"},
            {"inputs": [{"name": "user", "type": "address"}, {"name": "collateralToken", "type": "address"}], "name": "getPosition", "outputs": [
                {"name": "collateralAmount", "type": "uint256"},
                {"name": "nUSDDebt", "type": "uint256"},
                {"name": "collateralValueUSD", "type": "uint256"},
                {"name": "currentLTV", "type": "uint256"},
                {"name": "maxMintable", "type": "uint256"},
                {"name": "isLiquidatable", "type": "bool"}
            ], "stateMutability": "view", "type": "function"},
            {"inputs": [{"name": "token", "type": "address"}], "name": "getCollateralPrice", "outputs": [{"name": "", "type": "uint256"}], "stateMutability": "view", "type": "function"},
            {"inputs": [], "name": "maxLTV", "outputs": [{"name": "", "type": "uint256"}], "stateMutability": "view", "type": "function"},
            {"inputs": [], "name": "liquidationThreshold", "outputs": [{"name": "", "type": "uint256"}], "stateMutability": "view", "type": "function"},
        ]
        
        # nUSD ABI
        nusd_abi = [
            {"inputs": [{"name": "owner", "type": "address"}], "name": "balanceOf", "outputs": [{"name": "", "type": "uint256"}], "stateMutability": "view", "type": "function"},
            {"inputs": [], "name": "totalSupply", "outputs": [{"name": "", "type": "uint256"}], "stateMutability": "view", "type": "function"},
            {"inputs": [{"name": "spender", "type": "address"}, {"name": "amount", "type": "uint256"}], "name": "approve", "outputs": [{"name": "", "type": "bool"}], "stateMutability": "nonpayable", "type": "function"},
        ]
        
        self.vault_abi = vault_abi
        self.collateral_abi = collateral_abi
        self.nusd_abi = nusd_abi
        
        # Create contract instances if addresses provided
        if self.addresses['collateral_manager']:
            self.collateral_manager = self.w3.eth.contract(
                address=self.addresses['collateral_manager'],
                abi=collateral_abi
            )
            
        if self.addresses['nusd']:
            self.nusd = self.w3.eth.contract(
                address=self.addresses['nusd'],
                abi=nusd_abi
            )

    # ==================== VAULT OPERATIONS ====================
    
    def get_vault_contract(self, vault_address: str) -> Contract:
        """Get vault contract instance."""
        return self.w3.eth.contract(
            address=Web3.to_checksum_address(vault_address),
            abi=self.vault_abi
        )
    
    async def get_vault_info(self, vault_address: str) -> Dict[str, Any]:
        """Get comprehensive vault information."""
        vault = self.get_vault_contract(vault_address)
        
        total_assets = vault.functions.totalAssets().call()
        total_supply = vault.functions.totalSupply().call()
        asset_address = vault.functions.asset().call()
        name = vault.functions.name().call()
        symbol = vault.functions.symbol().call()
        decimals = vault.functions.decimals().call()
        idle_balance = vault.functions.idleBalance().call()
        
        # Calculate share price
        share_price = total_assets / total_supply if total_supply > 0 else 1.0
        
        # Get strategies
        strategies = vault.functions.getStrategies().call()
        strategy_info = []
        
        for strategy in strategies:
            weight, allocation, target = vault.functions.getStrategyInfo(strategy).call()
            strategy_info.append({
                'address': strategy,
                'weight': weight / 100,  # Convert BPS to %
                'allocation': allocation,
                'target_allocation': target,
                'utilization': (allocation / target * 100) if target > 0 else 0
            })
        
        return {
            'address': vault_address,
            'name': name,
            'symbol': symbol,
            'decimals': decimals,
            'asset': asset_address,
            'total_assets': total_assets,
            'total_supply': total_supply,
            'share_price': share_price,
            'idle_balance': idle_balance,
            'deployed_balance': total_assets - idle_balance,
            'utilization_rate': ((total_assets - idle_balance) / total_assets * 100) if total_assets > 0 else 0,
            'strategies': strategy_info,
            'strategy_count': len(strategies)
        }
    
    async def get_user_position(self, vault_address: str, user_address: str) -> VaultPosition:
        """Get user's position in a vault."""
        vault = self.get_vault_contract(vault_address)
        
        shares = vault.functions.balanceOf(user_address).call()
        assets = vault.functions.convertToAssets(shares).call() if shares > 0 else 0
        total_assets = vault.functions.totalAssets().call()
        total_supply = vault.functions.totalSupply().call()
        
        share_price = total_assets / total_supply if total_supply > 0 else 1.0
        
        # PnL calculation would need historical data
        # For now, return current position
        return VaultPosition(
            vault_address=vault_address,
            shares=shares,
            assets=assets,
            share_price=share_price,
            pnl=0,  # Would calculate from deposit history
            pnl_percent=0,
            deposited_at=datetime.utcnow()
        )
    
    def build_deposit_tx(
        self,
        vault_address: str,
        amount: int,
        receiver: str,
        sender: str
    ) -> Dict[str, Any]:
        """Build deposit transaction."""
        vault = self.get_vault_contract(vault_address)
        
        tx = vault.functions.deposit(amount, receiver).build_transaction({
            'from': sender,
            'gas': 250000,
            'nonce': self.w3.eth.get_transaction_count(sender),
            'maxFeePerGas': self.w3.eth.gas_price * 2,
            'maxPriorityFeePerGas': self.w3.to_wei(2, 'gwei')
        })
        
        return tx
    
    def build_withdraw_tx(
        self,
        vault_address: str,
        assets: int,
        receiver: str,
        owner: str
    ) -> Dict[str, Any]:
        """Build withdraw transaction."""
        vault = self.get_vault_contract(vault_address)
        
        tx = vault.functions.withdraw(assets, receiver, owner).build_transaction({
            'from': owner,
            'gas': 300000,
            'nonce': self.w3.eth.get_transaction_count(owner),
            'maxFeePerGas': self.w3.eth.gas_price * 2,
            'maxPriorityFeePerGas': self.w3.to_wei(2, 'gwei')
        })
        
        return tx
    
    def build_redeem_tx(
        self,
        vault_address: str,
        shares: int,
        receiver: str,
        owner: str
    ) -> Dict[str, Any]:
        """Build redeem transaction (burn shares for assets)."""
        vault = self.get_vault_contract(vault_address)
        
        tx = vault.functions.redeem(shares, receiver, owner).build_transaction({
            'from': owner,
            'gas': 300000,
            'nonce': self.w3.eth.get_transaction_count(owner),
            'maxFeePerGas': self.w3.eth.gas_price * 2,
            'maxPriorityFeePerGas': self.w3.to_wei(2, 'gwei')
        })
        
        return tx

    # ==================== nUSD COLLATERAL OPERATIONS ====================
    
    async def get_collateral_position(
        self,
        user_address: str,
        collateral_token: str = None
    ) -> CollateralPosition:
        """Get user's collateral position for nUSD."""
        if not self.collateral_manager:
            raise ValueError("CollateralManager not configured")
            
        # address(0) for ETH
        token_address = collateral_token or "0x0000000000000000000000000000000000000000"
        
        position = self.collateral_manager.functions.getPosition(
            user_address,
            token_address
        ).call()
        
        collateral_amount, nusd_debt, collateral_value_usd, current_ltv, max_mintable, is_liquidatable = position
        
        # Calculate liquidation price
        if collateral_amount > 0 and nusd_debt > 0:
            liquidation_threshold = self.collateral_manager.functions.liquidationThreshold().call()
            # liquidation_price = (nusd_debt * 10000) / (collateral_amount * liquidation_threshold)
            current_price = self.collateral_manager.functions.getCollateralPrice(token_address).call()
            liquidation_price = (nusd_debt * 10000 * 1e18) / (collateral_amount * liquidation_threshold)
        else:
            liquidation_price = 0
            
        return CollateralPosition(
            collateral_token=collateral_token or "ETH",
            collateral_amount=collateral_amount,
            nusd_debt=nusd_debt,
            ltv=current_ltv / 100,  # Convert BPS to %
            max_mintable=max_mintable,
            liquidation_price=liquidation_price / 1e18,
            is_liquidatable=is_liquidatable
        )
    
    def build_deposit_eth_collateral_tx(
        self,
        amount_wei: int,
        sender: str
    ) -> Dict[str, Any]:
        """Build transaction to deposit ETH as collateral."""
        if not self.collateral_manager:
            raise ValueError("CollateralManager not configured")
            
        tx = self.collateral_manager.functions.depositETH().build_transaction({
            'from': sender,
            'value': amount_wei,
            'gas': 150000,
            'nonce': self.w3.eth.get_transaction_count(sender),
            'maxFeePerGas': self.w3.eth.gas_price * 2,
            'maxPriorityFeePerGas': self.w3.to_wei(2, 'gwei')
        })
        
        return tx
    
    def build_mint_nusd_tx(
        self,
        collateral_token: str,
        nusd_amount: int,
        sender: str
    ) -> Dict[str, Any]:
        """Build transaction to mint nUSD against collateral."""
        if not self.collateral_manager:
            raise ValueError("CollateralManager not configured")
            
        token_address = collateral_token if collateral_token else "0x0000000000000000000000000000000000000000"
        
        tx = self.collateral_manager.functions.mintNUSD(
            token_address,
            nusd_amount
        ).build_transaction({
            'from': sender,
            'gas': 200000,
            'nonce': self.w3.eth.get_transaction_count(sender),
            'maxFeePerGas': self.w3.eth.gas_price * 2,
            'maxPriorityFeePerGas': self.w3.to_wei(2, 'gwei')
        })
        
        return tx
    
    def build_redeem_nusd_tx(
        self,
        collateral_token: str,
        nusd_amount: int,
        sender: str
    ) -> Dict[str, Any]:
        """Build transaction to redeem nUSD for collateral."""
        if not self.collateral_manager:
            raise ValueError("CollateralManager not configured")
            
        token_address = collateral_token if collateral_token else "0x0000000000000000000000000000000000000000"
        
        tx = self.collateral_manager.functions.redeemNUSD(
            token_address,
            nusd_amount
        ).build_transaction({
            'from': sender,
            'gas': 300000,
            'nonce': self.w3.eth.get_transaction_count(sender),
            'maxFeePerGas': self.w3.eth.gas_price * 2,
            'maxPriorityFeePerGas': self.w3.to_wei(2, 'gwei')
        })
        
        return tx

    # ==================== TRANSACTION EXECUTION ====================
    
    async def send_transaction(
        self,
        tx: Dict[str, Any],
        private_key: str
    ) -> str:
        """Sign and send a transaction."""
        signed = self.w3.eth.account.sign_transaction(tx, private_key)
        tx_hash = self.w3.eth.send_raw_transaction(signed.rawTransaction)
        return tx_hash.hex()
    
    async def wait_for_receipt(
        self,
        tx_hash: str,
        timeout: int = 120
    ) -> Dict[str, Any]:
        """Wait for transaction receipt."""
        receipt = self.w3.eth.wait_for_transaction_receipt(tx_hash, timeout=timeout)
        
        return {
            'status': 'success' if receipt['status'] == 1 else 'failed',
            'block_number': receipt['blockNumber'],
            'gas_used': receipt['gasUsed'],
            'transaction_hash': tx_hash
        }

    # ==================== HELPER METHODS ====================
    
    def format_amount(self, amount: int, decimals: int = 18) -> str:
        """Format wei amount to human readable."""
        return str(Decimal(amount) / Decimal(10 ** decimals))
    
    def parse_amount(self, amount: str, decimals: int = 18) -> int:
        """Parse human readable amount to wei."""
        return int(Decimal(amount) * Decimal(10 ** decimals))


# Singleton instance
_vault_service: Optional[VaultService] = None


async def get_vault_service(config: Dict[str, Any] = None) -> VaultService:
    """Get or create vault service singleton."""
    global _vault_service
    
    if _vault_service is None:
        _vault_service = VaultService(config or {})
        await _vault_service.initialize()
        
    return _vault_service
