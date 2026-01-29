"""
Multi-Chain Adapter

Unified interface for Ethereum, Solana, and Hyperliquid.
"""

import logging
from typing import Dict, Any, Optional
from abc import ABC, abstractmethod

logger = logging.getLogger(__name__)


class ChainAdapter(ABC):
    """Base class for chain adapters."""
    
    @abstractmethod
    async def get_balance(self, address: str, token: str = None) -> float:
        pass
    
    @abstractmethod
    async def send_transaction(self, tx: Dict[str, Any]) -> str:
        pass
    
    @abstractmethod
    async def get_transaction_status(self, tx_hash: str) -> Dict[str, Any]:
        pass


class EthereumAdapter(ChainAdapter):
    """Ethereum chain adapter using Web3.py."""
    
    def __init__(self, config: Dict[str, Any]):
        self.rpc_url = config.get('eth_rpc_url')
        self.w3 = None
        
    async def initialize(self):
        from web3 import Web3
        self.w3 = Web3(Web3.HTTPProvider(self.rpc_url))
        logger.info(f"Ethereum adapter connected: {self.w3.is_connected()}")
        
    async def get_balance(self, address: str, token: str = None) -> float:
        """Get ETH or ERC20 balance."""
        if token is None:
            # Native ETH
            balance_wei = self.w3.eth.get_balance(address)
            return float(self.w3.from_wei(balance_wei, 'ether'))
        else:
            # ERC20 token
            # Would need token contract address
            pass
            
    async def send_transaction(self, tx: Dict[str, Any]) -> str:
        """Send transaction."""
        tx_hash = self.w3.eth.send_raw_transaction(tx['signed'])
        return tx_hash.hex()
        
    async def get_transaction_status(self, tx_hash: str) -> Dict[str, Any]:
        """Get transaction receipt."""
        receipt = self.w3.eth.get_transaction_receipt(tx_hash)
        return {
            'status': 'success' if receipt['status'] == 1 else 'failed',
            'block': receipt['blockNumber'],
            'gas_used': receipt['gasUsed']
        }
        
    # Vault-specific methods
    async def deposit_to_vault(
        self, 
        vault_address: str, 
        amount: float, 
        from_address: str,
        private_key: str
    ) -> str:
        """Deposit assets to ERC-4626 vault."""
        # Load vault ABI
        vault_abi = self._get_vault_abi()
        vault = self.w3.eth.contract(address=vault_address, abi=vault_abi)
        
        # Build transaction
        amount_wei = self.w3.to_wei(amount, 'ether')
        tx = vault.functions.deposit(amount_wei, from_address).build_transaction({
            'from': from_address,
            'gas': 200000,
            'nonce': self.w3.eth.get_transaction_count(from_address)
        })
        
        # Sign and send
        signed = self.w3.eth.account.sign_transaction(tx, private_key)
        return await self.send_transaction({'signed': signed.rawTransaction})
        
    async def withdraw_from_vault(
        self,
        vault_address: str,
        shares: float,
        from_address: str,
        private_key: str
    ) -> str:
        """Withdraw assets from ERC-4626 vault."""
        vault_abi = self._get_vault_abi()
        vault = self.w3.eth.contract(address=vault_address, abi=vault_abi)
        
        shares_wei = self.w3.to_wei(shares, 'ether')
        tx = vault.functions.redeem(shares_wei, from_address, from_address).build_transaction({
            'from': from_address,
            'gas': 200000,
            'nonce': self.w3.eth.get_transaction_count(from_address)
        })
        
        signed = self.w3.eth.account.sign_transaction(tx, private_key)
        return await self.send_transaction({'signed': signed.rawTransaction})
        
    def _get_vault_abi(self):
        """Load ERC-4626 vault ABI."""
        return [
            {"inputs": [{"name": "assets", "type": "uint256"}, {"name": "receiver", "type": "address"}], "name": "deposit", "outputs": [{"name": "shares", "type": "uint256"}], "stateMutability": "nonpayable", "type": "function"},
            {"inputs": [{"name": "shares", "type": "uint256"}, {"name": "receiver", "type": "address"}, {"name": "owner", "type": "address"}], "name": "redeem", "outputs": [{"name": "assets", "type": "uint256"}], "stateMutability": "nonpayable", "type": "function"},
            {"inputs": [], "name": "totalAssets", "outputs": [{"name": "", "type": "uint256"}], "stateMutability": "view", "type": "function"},
            {"inputs": [{"name": "owner", "type": "address"}], "name": "balanceOf", "outputs": [{"name": "", "type": "uint256"}], "stateMutability": "view", "type": "function"},
        ]


class SolanaAdapter(ChainAdapter):
    """Solana chain adapter using solana-py."""
    
    def __init__(self, config: Dict[str, Any]):
        self.rpc_url = config.get('solana_rpc_url', 'https://api.mainnet-beta.solana.com')
        self.client = None
        
    async def initialize(self):
        from solana.rpc.async_api import AsyncClient
        self.client = AsyncClient(self.rpc_url)
        logger.info("Solana adapter initialized")
        
    async def get_balance(self, address: str, token: str = None) -> float:
        """Get SOL or SPL token balance."""
        from solders.pubkey import Pubkey
        
        pubkey = Pubkey.from_string(address)
        
        if token is None:
            # Native SOL
            resp = await self.client.get_balance(pubkey)
            return resp.value / 1e9  # lamports to SOL
        else:
            # SPL Token - would need token account
            pass
            
    async def send_transaction(self, tx: Dict[str, Any]) -> str:
        """Send Solana transaction."""
        resp = await self.client.send_transaction(tx['transaction'])
        return str(resp.value)
        
    async def get_transaction_status(self, tx_hash: str) -> Dict[str, Any]:
        """Get transaction status."""
        from solders.signature import Signature
        
        sig = Signature.from_string(tx_hash)
        resp = await self.client.get_signature_statuses([sig])
        
        status = resp.value[0]
        return {
            'status': 'success' if status and status.err is None else 'failed',
            'slot': status.slot if status else None
        }


class HyperliquidAdapter(ChainAdapter):
    """Hyperliquid API adapter (no smart contracts)."""
    
    def __init__(self, config: Dict[str, Any]):
        self.api_url = "https://api.hyperliquid.xyz"
        self.api_key = config.get('hyperliquid_api_key')
        self.session = None
        
    async def initialize(self):
        import aiohttp
        self.session = aiohttp.ClientSession()
        logger.info("Hyperliquid adapter initialized")
        
    async def close(self):
        if self.session:
            await self.session.close()
            
    async def get_balance(self, address: str, token: str = None) -> float:
        """Get account balance on Hyperliquid."""
        payload = {
            "type": "clearinghouseState",
            "user": address
        }
        
        async with self.session.post(f"{self.api_url}/info", json=payload) as resp:
            data = await resp.json()
            
        return float(data.get('marginSummary', {}).get('accountValue', 0))
        
    async def send_transaction(self, tx: Dict[str, Any]) -> str:
        """Place order on Hyperliquid."""
        # Hyperliquid uses signed API requests, not blockchain transactions
        async with self.session.post(f"{self.api_url}/exchange", json=tx) as resp:
            data = await resp.json()
            
        return data.get('response', {}).get('data', {}).get('statuses', [{}])[0].get('resting', {}).get('oid', '')
        
    async def get_transaction_status(self, tx_hash: str) -> Dict[str, Any]:
        """Get order status."""
        # Order ID lookup
        return {'status': 'filled', 'order_id': tx_hash}
        
    # Hyperliquid-specific methods
    async def place_perp_order(
        self,
        address: str,
        coin: str,
        is_buy: bool,
        size: float,
        price: float = None,
        leverage: int = 1
    ) -> Dict[str, Any]:
        """Place perpetual order."""
        order = {
            "type": "order",
            "orders": [{
                "a": self._get_asset_index(coin),
                "b": is_buy,
                "p": str(price) if price else None,
                "s": str(size),
                "r": False,  # reduce only
                "t": {"limit": {"tif": "Gtc"}} if price else {"market": {}}
            }],
            "grouping": "na"
        }
        
        return await self.send_transaction(order)
        
    async def get_funding_rate(self, coin: str) -> float:
        """Get current funding rate."""
        payload = {"type": "metaAndAssetCtxs"}
        
        async with self.session.post(f"{self.api_url}/info", json=payload) as resp:
            data = await resp.json()
            
        # Find coin in response
        if isinstance(data, list) and len(data) > 1:
            universe = data[0].get('universe', [])
            ctxs = data[1]
            
            for i, item in enumerate(universe):
                if item['name'] == coin:
                    return float(ctxs[i].get('funding', 0))
                    
        return 0.0
        
    async def get_open_interest(self, coin: str) -> float:
        """Get open interest for coin."""
        payload = {"type": "metaAndAssetCtxs"}
        
        async with self.session.post(f"{self.api_url}/info", json=payload) as resp:
            data = await resp.json()
            
        if isinstance(data, list) and len(data) > 1:
            universe = data[0].get('universe', [])
            ctxs = data[1]
            
            for i, item in enumerate(universe):
                if item['name'] == coin:
                    return float(ctxs[i].get('openInterest', 0))
                    
        return 0.0
        
    def _get_asset_index(self, coin: str) -> int:
        """Map coin to Hyperliquid asset index."""
        # Simplified mapping
        coins = ['BTC', 'ETH', 'SOL', 'ARB', 'DOGE']
        return coins.index(coin) if coin in coins else 0


class MultiChainAdapter:
    """
    Unified multi-chain adapter.
    
    Provides single interface for all supported chains.
    """
    
    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.ethereum = EthereumAdapter(config)
        self.solana = SolanaAdapter(config)
        self.hyperliquid = HyperliquidAdapter(config)
        
    async def initialize(self):
        """Initialize all chain adapters."""
        await self.ethereum.initialize()
        await self.solana.initialize()
        await self.hyperliquid.initialize()
        logger.info("Multi-chain adapter initialized")
        
    async def close(self):
        """Cleanup all adapters."""
        await self.hyperliquid.close()
        
    def get_adapter(self, chain: str) -> ChainAdapter:
        """Get adapter for specific chain."""
        adapters = {
            'ethereum': self.ethereum,
            'eth': self.ethereum,
            'solana': self.solana,
            'sol': self.solana,
            'hyperliquid': self.hyperliquid,
            'hl': self.hyperliquid
        }
        return adapters.get(chain.lower())
        
    async def get_total_balance(self, address: str) -> Dict[str, float]:
        """Get balances across all chains."""
        return {
            'ethereum': await self.ethereum.get_balance(address),
            'solana': await self.solana.get_balance(address),
            'hyperliquid': await self.hyperliquid.get_balance(address)
        }


# Singleton
_multi_chain: Optional[MultiChainAdapter] = None


async def get_multi_chain_adapter(config: Dict[str, Any] = None) -> MultiChainAdapter:
    """Get or create multi-chain adapter singleton."""
    global _multi_chain
    
    if _multi_chain is None:
        _multi_chain = MultiChainAdapter(config or {})
        await _multi_chain.initialize()
        
    return _multi_chain
