"""
Transaction Builder
Builds and encodes transactions for vault interactions
"""

import json
from typing import Optional, Dict, Any
from web3 import Web3
from eth_abi import encode


class TransactionBuilder:
    """
    Builds properly encoded transactions for vault deposit/withdraw
    """

    def __init__(self, w3: Web3, vault_address: str):
        self.w3 = w3
        self.vault_address = Web3.to_checksum_address(vault_address)
        self.vault_abi = json.load(open("abi/SafeYieldVault.json"))
        self.vault = w3.eth.contract(address=self.vault_address, abi=self.vault_abi)
        self.usdc_address = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"  # Mainnet USDC
        self.usdc_abi = [
            {
                "constant": False,
                "inputs": [
                    {"name": "spender", "type": "address"},
                    {"name": "amount", "type": "uint256"}
                ],
                "name": "approve",
                "outputs": [{"name": "", "type": "bool"}],
                "type": "function"
            },
            {
                "constant": True,
                "inputs": [
                    {"name": "owner", "type": "address"},
                    {"name": "spender", "type": "address"}
                ],
                "name": "allowance",
                "outputs": [{"name": "", "type": "uint256"}],
                "type": "function"
            }
        ]
        self.usdc = w3.eth.contract(address=self.usdc_address, abi=self.usdc_abi)

    async def build_deposit(
        self,
        amount: int,
        user: str,
        deadline: Optional[int] = None
    ) -> Dict[str, Any]:
        """
        Build deposit transaction
        Returns transaction dict ready for signing
        """
        user = Web3.to_checksum_address(user)
        
        # Check allowance first
        allowance = self.usdc.functions.allowance(user, self.vault_address).call()
        
        if allowance < amount:
            # Need approval transaction first
            return await self._build_approve_tx(user, amount)
        
        # Build deposit transaction
        # deposit(uint256 assets, address receiver)
        data = self.vault.encodeABI(
            fn_name="deposit",
            args=[amount, user]
        )
        
        # Estimate gas
        try:
            gas_estimate = self.vault.functions.deposit(amount, user).estimate_gas({
                "from": user
            })
            gas_estimate = int(gas_estimate * 1.2)  # 20% buffer
        except:
            gas_estimate = 200000  # Default
        
        gas_price = self._get_optimal_gas_price()
        
        return {
            "to": self.vault_address,
            "data": data,
            "value": 0,
            "gas": gas_estimate,
            "gasPrice": gas_price,
            "chainId": self.w3.eth.chain_id,
            "nonce": self.w3.eth.get_transaction_count(user)
        }

    async def _build_approve_tx(self, user: str, amount: int) -> Dict[str, Any]:
        """Build USDC approval transaction"""
        # Approve max for better UX
        max_amount = 2**256 - 1
        
        data = self.usdc.encodeABI(
            fn_name="approve",
            args=[self.vault_address, max_amount]
        )
        
        gas_price = self._get_optimal_gas_price()
        
        return {
            "to": self.usdc_address,
            "data": data,
            "value": 0,
            "gas": 60000,
            "gasPrice": gas_price,
            "chainId": self.w3.eth.chain_id,
            "nonce": self.w3.eth.get_transaction_count(user),
            "is_approval": True  # Flag to indicate this is approval
        }

    async def build_withdraw(
        self,
        shares: int,
        user: str,
        deadline: Optional[int] = None
    ) -> Dict[str, Any]:
        """
        Build withdraw (redeem) transaction
        Returns transaction dict ready for signing
        """
        user = Web3.to_checksum_address(user)
        
        # Build redeem transaction
        # redeem(uint256 shares, address receiver, address owner)
        data = self.vault.encodeABI(
            fn_name="redeem",
            args=[shares, user, user]
        )
        
        # Estimate gas
        try:
            gas_estimate = self.vault.functions.redeem(shares, user, user).estimate_gas({
                "from": user
            })
            gas_estimate = int(gas_estimate * 1.2)  # 20% buffer
        except:
            gas_estimate = 250000  # Default (higher for withdrawals)
        
        gas_price = self._get_optimal_gas_price()
        
        return {
            "to": self.vault_address,
            "data": data,
            "value": 0,
            "gas": gas_estimate,
            "gasPrice": gas_price,
            "chainId": self.w3.eth.chain_id,
            "nonce": self.w3.eth.get_transaction_count(user)
        }

    async def build_batch_deposit(
        self,
        amounts: list[int],
        users: list[str]
    ) -> list[Dict[str, Any]]:
        """Build multiple deposit transactions"""
        txs = []
        for amount, user in zip(amounts, users):
            tx = await self.build_deposit(amount, user)
            txs.append(tx)
        return txs

    async def build_permit_deposit(
        self,
        amount: int,
        user: str,
        deadline: int,
        v: int,
        r: bytes,
        s: bytes
    ) -> Dict[str, Any]:
        """
        Build deposit with permit (gasless approval)
        Uses EIP-2612 permit
        """
        user = Web3.to_checksum_address(user)
        
        # Build depositWithPermit transaction if vault supports it
        # depositWithPermit(uint256 assets, address receiver, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        try:
            data = self.vault.encodeABI(
                fn_name="depositWithPermit",
                args=[amount, user, deadline, v, r, s]
            )
        except:
            # Fallback if method doesn't exist
            raise ValueError("Vault does not support permit deposits")
        
        gas_estimate = 220000  # Slightly higher for permit
        gas_price = self._get_optimal_gas_price()
        
        return {
            "to": self.vault_address,
            "data": data,
            "value": 0,
            "gas": gas_estimate,
            "gasPrice": gas_price,
            "chainId": self.w3.eth.chain_id,
            "nonce": self.w3.eth.get_transaction_count(user)
        }

    def _get_optimal_gas_price(self) -> int:
        """Get optimal gas price based on network conditions"""
        try:
            # Try EIP-1559
            base_fee = self.w3.eth.get_block("latest")["baseFeePerGas"]
            priority_fee = self.w3.eth.max_priority_fee
            return base_fee + priority_fee
        except:
            # Fallback to legacy
            return self.w3.eth.gas_price

    async def build_multicall(
        self,
        calls: list[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """
        Build multicall transaction for batching multiple operations
        """
        multicall_address = "0xcA11bde05977b3631167028862bE2a173976CA11"  # Multicall3
        
        call_data = []
        for call in calls:
            call_data.append({
                "target": call["to"],
                "callData": call["data"],
                "allowFailure": False
            })
        
        multicall_abi = [{
            "inputs": [{"components": [
                {"name": "target", "type": "address"},
                {"name": "allowFailure", "type": "bool"},
                {"name": "callData", "type": "bytes"}
            ], "name": "calls", "type": "tuple[]"}],
            "name": "aggregate3",
            "outputs": [{"components": [
                {"name": "success", "type": "bool"},
                {"name": "returnData", "type": "bytes"}
            ], "type": "tuple[]"}],
            "type": "function"
        }]
        
        multicall = self.w3.eth.contract(address=multicall_address, abi=multicall_abi)
        
        formatted_calls = [
            (c["target"], False, c["callData"]) for c in call_data
        ]
        
        data = multicall.encodeABI(fn_name="aggregate3", args=[formatted_calls])
        
        return {
            "to": multicall_address,
            "data": data,
            "value": 0,
            "gas": sum(c.get("gas", 100000) for c in calls),
            "gasPrice": self._get_optimal_gas_price(),
            "chainId": self.w3.eth.chain_id
        }

    def encode_permit_data(
        self,
        owner: str,
        spender: str,
        value: int,
        nonce: int,
        deadline: int,
        chain_id: int,
        token_name: str = "USD Coin",
        token_version: str = "2"
    ) -> Dict[str, Any]:
        """
        Encode permit data for EIP-712 signing
        Returns the typed data structure for wallet signing
        """
        domain = {
            "name": token_name,
            "version": token_version,
            "chainId": chain_id,
            "verifyingContract": self.usdc_address
        }
        
        types = {
            "Permit": [
                {"name": "owner", "type": "address"},
                {"name": "spender", "type": "address"},
                {"name": "value", "type": "uint256"},
                {"name": "nonce", "type": "uint256"},
                {"name": "deadline", "type": "uint256"}
            ]
        }
        
        message = {
            "owner": owner,
            "spender": spender,
            "value": value,
            "nonce": nonce,
            "deadline": deadline
        }
        
        return {
            "types": types,
            "primaryType": "Permit",
            "domain": domain,
            "message": message
        }
