"""
Vault API Routes

REST endpoints for all vault operations.
"""

from fastapi import APIRouter, HTTPException, Depends, Query
from pydantic import BaseModel, Field
from typing import Optional, List
from decimal import Decimal

router = APIRouter(prefix="/vaults", tags=["Vaults"])


# ==================== REQUEST/RESPONSE MODELS ====================

class DepositRequest(BaseModel):
    """Request to deposit into a vault."""
    vault_address: str = Field(..., description="Vault contract address")
    amount: str = Field(..., description="Amount to deposit (human readable)")
    receiver: Optional[str] = Field(None, description="Receiver address (defaults to sender)")
    
class WithdrawRequest(BaseModel):
    """Request to withdraw from a vault."""
    vault_address: str = Field(..., description="Vault contract address")
    amount: str = Field(..., description="Amount to withdraw (human readable)")
    receiver: Optional[str] = Field(None, description="Receiver address (defaults to sender)")

class RedeemRequest(BaseModel):
    """Request to redeem shares from a vault."""
    vault_address: str = Field(..., description="Vault contract address")
    shares: str = Field(..., description="Shares to redeem (human readable)")
    receiver: Optional[str] = Field(None, description="Receiver address (defaults to sender)")

class MintNUSDRequest(BaseModel):
    """Request to mint nUSD against collateral."""
    collateral_token: Optional[str] = Field(None, description="Collateral token address (None for ETH)")
    amount: str = Field(..., description="nUSD amount to mint")

class RedeemNUSDRequest(BaseModel):
    """Request to redeem nUSD for collateral."""
    collateral_token: Optional[str] = Field(None, description="Collateral token address (None for ETH)")
    amount: str = Field(..., description="nUSD amount to redeem")

class DepositCollateralRequest(BaseModel):
    """Request to deposit collateral."""
    token: Optional[str] = Field(None, description="Token address (None for ETH)")
    amount: str = Field(..., description="Amount to deposit")

class TransactionResponse(BaseModel):
    """Unsigned transaction response."""
    to: str
    data: str
    value: str
    gas: int
    nonce: int
    chain_id: int

class VaultInfoResponse(BaseModel):
    """Vault information response."""
    address: str
    name: str
    symbol: str
    decimals: int
    asset: str
    total_assets: str
    total_supply: str
    share_price: float
    idle_balance: str
    deployed_balance: str
    utilization_rate: float
    strategy_count: int
    strategies: List[dict]

class UserPositionResponse(BaseModel):
    """User vault position response."""
    vault_address: str
    shares: str
    assets: str
    share_price: float
    pnl: str
    pnl_percent: float

class CollateralPositionResponse(BaseModel):
    """User collateral position response."""
    collateral_token: str
    collateral_amount: str
    nusd_debt: str
    ltv: float
    max_mintable: str
    liquidation_price: float
    is_liquidatable: bool


# ==================== VAULT ENDPOINTS ====================

@router.get("/{vault_address}", response_model=VaultInfoResponse)
async def get_vault_info(vault_address: str):
    """
    Get comprehensive vault information.
    
    Returns vault stats, share price, strategies, and utilization.
    """
    from ..services.vault_service import get_vault_service
    
    try:
        service = await get_vault_service()
        info = await service.get_vault_info(vault_address)
        
        return VaultInfoResponse(
            address=info['address'],
            name=info['name'],
            symbol=info['symbol'],
            decimals=info['decimals'],
            asset=info['asset'],
            total_assets=str(info['total_assets']),
            total_supply=str(info['total_supply']),
            share_price=info['share_price'],
            idle_balance=str(info['idle_balance']),
            deployed_balance=str(info['deployed_balance']),
            utilization_rate=info['utilization_rate'],
            strategy_count=info['strategy_count'],
            strategies=info['strategies']
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{vault_address}/position/{user_address}", response_model=UserPositionResponse)
async def get_user_position(vault_address: str, user_address: str):
    """
    Get user's position in a vault.
    
    Returns shares, assets, and PnL.
    """
    from ..services.vault_service import get_vault_service
    
    try:
        service = await get_vault_service()
        position = await service.get_user_position(vault_address, user_address)
        
        return UserPositionResponse(
            vault_address=position.vault_address,
            shares=str(position.shares),
            assets=str(position.assets),
            share_price=position.share_price,
            pnl=str(position.pnl),
            pnl_percent=position.pnl_percent
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{vault_address}/deposit", response_model=TransactionResponse)
async def build_deposit_transaction(
    vault_address: str,
    request: DepositRequest,
    sender: str = Query(..., description="Sender wallet address")
):
    """
    Build deposit transaction for a vault.
    
    Returns unsigned transaction to be signed by user's wallet.
    """
    from ..services.vault_service import get_vault_service
    
    try:
        service = await get_vault_service()
        
        # Parse amount to wei
        amount_wei = service.parse_amount(request.amount)
        receiver = request.receiver or sender
        
        tx = service.build_deposit_tx(vault_address, amount_wei, receiver, sender)
        
        return TransactionResponse(
            to=tx['to'],
            data=tx['data'].hex() if isinstance(tx['data'], bytes) else tx['data'],
            value=str(tx.get('value', 0)),
            gas=tx['gas'],
            nonce=tx['nonce'],
            chain_id=tx.get('chainId', 1)
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{vault_address}/withdraw", response_model=TransactionResponse)
async def build_withdraw_transaction(
    vault_address: str,
    request: WithdrawRequest,
    sender: str = Query(..., description="Sender wallet address")
):
    """
    Build withdraw transaction for a vault.
    
    Returns unsigned transaction to be signed by user's wallet.
    """
    from ..services.vault_service import get_vault_service
    
    try:
        service = await get_vault_service()
        
        amount_wei = service.parse_amount(request.amount)
        receiver = request.receiver or sender
        
        tx = service.build_withdraw_tx(vault_address, amount_wei, receiver, sender)
        
        return TransactionResponse(
            to=tx['to'],
            data=tx['data'].hex() if isinstance(tx['data'], bytes) else tx['data'],
            value=str(tx.get('value', 0)),
            gas=tx['gas'],
            nonce=tx['nonce'],
            chain_id=tx.get('chainId', 1)
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{vault_address}/redeem", response_model=TransactionResponse)
async def build_redeem_transaction(
    vault_address: str,
    request: RedeemRequest,
    sender: str = Query(..., description="Sender wallet address")
):
    """
    Build redeem transaction (burn shares for assets).
    
    Returns unsigned transaction to be signed by user's wallet.
    """
    from ..services.vault_service import get_vault_service
    
    try:
        service = await get_vault_service()
        
        shares_wei = service.parse_amount(request.shares)
        receiver = request.receiver or sender
        
        tx = service.build_redeem_tx(vault_address, shares_wei, receiver, sender)
        
        return TransactionResponse(
            to=tx['to'],
            data=tx['data'].hex() if isinstance(tx['data'], bytes) else tx['data'],
            value=str(tx.get('value', 0)),
            gas=tx['gas'],
            nonce=tx['nonce'],
            chain_id=tx.get('chainId', 1)
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ==================== nUSD ENDPOINTS ====================

@router.get("/nusd/position/{user_address}", response_model=CollateralPositionResponse)
async def get_collateral_position(
    user_address: str,
    collateral_token: Optional[str] = Query(None, description="Collateral token (None for ETH)")
):
    """
    Get user's collateral position for nUSD.
    
    Returns collateral, debt, LTV, and liquidation info.
    """
    from ..services.vault_service import get_vault_service
    
    try:
        service = await get_vault_service()
        position = await service.get_collateral_position(user_address, collateral_token)
        
        return CollateralPositionResponse(
            collateral_token=position.collateral_token,
            collateral_amount=str(position.collateral_amount),
            nusd_debt=str(position.nusd_debt),
            ltv=position.ltv,
            max_mintable=str(position.max_mintable),
            liquidation_price=position.liquidation_price,
            is_liquidatable=position.is_liquidatable
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/nusd/deposit-collateral", response_model=TransactionResponse)
async def build_deposit_collateral_transaction(
    request: DepositCollateralRequest,
    sender: str = Query(..., description="Sender wallet address")
):
    """
    Build transaction to deposit collateral.
    
    For ETH: sends ETH value
    For ERC20: requires prior approval
    """
    from ..services.vault_service import get_vault_service
    
    try:
        service = await get_vault_service()
        
        amount_wei = service.parse_amount(request.amount)
        
        if request.token is None:
            # ETH deposit
            tx = service.build_deposit_eth_collateral_tx(amount_wei, sender)
        else:
            # ERC20 deposit (would need separate approval tx)
            raise HTTPException(status_code=400, detail="ERC20 collateral not yet supported")
        
        return TransactionResponse(
            to=tx['to'],
            data=tx['data'].hex() if isinstance(tx['data'], bytes) else tx['data'],
            value=str(tx.get('value', 0)),
            gas=tx['gas'],
            nonce=tx['nonce'],
            chain_id=tx.get('chainId', 1)
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/nusd/mint", response_model=TransactionResponse)
async def build_mint_nusd_transaction(
    request: MintNUSDRequest,
    sender: str = Query(..., description="Sender wallet address")
):
    """
    Build transaction to mint nUSD against collateral.
    
    User must have sufficient collateral deposited.
    """
    from ..services.vault_service import get_vault_service
    
    try:
        service = await get_vault_service()
        
        amount_wei = service.parse_amount(request.amount)
        
        tx = service.build_mint_nusd_tx(request.collateral_token, amount_wei, sender)
        
        return TransactionResponse(
            to=tx['to'],
            data=tx['data'].hex() if isinstance(tx['data'], bytes) else tx['data'],
            value=str(tx.get('value', 0)),
            gas=tx['gas'],
            nonce=tx['nonce'],
            chain_id=tx.get('chainId', 1)
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/nusd/redeem", response_model=TransactionResponse)
async def build_redeem_nusd_transaction(
    request: RedeemNUSDRequest,
    sender: str = Query(..., description="Sender wallet address")
):
    """
    Build transaction to redeem nUSD for collateral.
    
    Burns nUSD and returns proportional collateral.
    """
    from ..services.vault_service import get_vault_service
    
    try:
        service = await get_vault_service()
        
        amount_wei = service.parse_amount(request.amount)
        
        tx = service.build_redeem_nusd_tx(request.collateral_token, amount_wei, sender)
        
        return TransactionResponse(
            to=tx['to'],
            data=tx['data'].hex() if isinstance(tx['data'], bytes) else tx['data'],
            value=str(tx.get('value', 0)),
            gas=tx['gas'],
            nonce=tx['nonce'],
            chain_id=tx.get('chainId', 1)
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ==================== PREVIEW ENDPOINTS ====================

@router.get("/{vault_address}/preview/deposit")
async def preview_deposit(
    vault_address: str,
    amount: str = Query(..., description="Amount to deposit")
):
    """
    Preview deposit: how many shares will be received.
    """
    from ..services.vault_service import get_vault_service
    
    try:
        service = await get_vault_service()
        vault = service.get_vault_contract(vault_address)
        
        amount_wei = service.parse_amount(amount)
        shares = vault.functions.convertToShares(amount_wei).call()
        
        return {
            "deposit_amount": amount,
            "shares_to_receive": service.format_amount(shares),
            "current_share_price": vault.functions.totalAssets().call() / max(vault.functions.totalSupply().call(), 1)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{vault_address}/preview/withdraw")
async def preview_withdraw(
    vault_address: str,
    amount: str = Query(..., description="Amount to withdraw")
):
    """
    Preview withdraw: how many shares will be burned.
    """
    from ..services.vault_service import get_vault_service
    
    try:
        service = await get_vault_service()
        vault = service.get_vault_contract(vault_address)
        
        amount_wei = service.parse_amount(amount)
        shares_needed = vault.functions.convertToShares(amount_wei).call()
        
        return {
            "withdraw_amount": amount,
            "shares_to_burn": service.format_amount(shares_needed),
            "current_share_price": vault.functions.totalAssets().call() / max(vault.functions.totalSupply().call(), 1)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/nusd/preview/mint")
async def preview_mint_nusd(
    user_address: str = Query(..., description="User address"),
    collateral_token: Optional[str] = Query(None, description="Collateral token"),
    amount: str = Query(..., description="nUSD amount to mint")
):
    """
    Preview nUSD mint: check if user has sufficient collateral.
    """
    from ..services.vault_service import get_vault_service
    
    try:
        service = await get_vault_service()
        position = await service.get_collateral_position(user_address, collateral_token)
        
        amount_wei = service.parse_amount(amount)
        
        can_mint = amount_wei <= position.max_mintable
        new_ltv = ((position.nusd_debt + amount_wei) / position.collateral_amount * 100) if position.collateral_amount > 0 else 0
        
        return {
            "requested_amount": amount,
            "max_mintable": service.format_amount(position.max_mintable),
            "can_mint": can_mint,
            "current_ltv": position.ltv,
            "new_ltv": new_ltv,
            "collateral_amount": service.format_amount(position.collateral_amount)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
