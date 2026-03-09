"""
Nexxore Market Data Service - Data Models
==========================================
Normalized data models for Dexscreener pair data.
"""

from dataclasses import dataclass, field, asdict
from datetime import datetime
from typing import Optional, Dict, Any, List
import time


@dataclass
class PairData:
    """Normalized DEX pair data - the core data model.
    
    Maps Dexscreener's raw API response to a flat, queryable structure
    used across market-data service and signal-engine.
    """
    pair_address: str
    chain_id: str
    dex_id: str
    url: str
    
    # Token info
    base_token_address: str
    base_token_name: str
    base_token_symbol: str
    quote_token_address: str
    quote_token_name: str
    quote_token_symbol: str
    
    # Price
    price_usd: float = 0.0
    price_native: str = "0"
    
    # Price changes
    price_change_5m: float = 0.0
    price_change_1h: float = 0.0
    price_change_6h: float = 0.0
    price_change_24h: float = 0.0
    
    # Volume
    volume_5m: float = 0.0
    volume_1h: float = 0.0
    volume_6h: float = 0.0
    volume_24h: float = 0.0
    
    # Transactions
    txns_5m_buys: int = 0
    txns_5m_sells: int = 0
    txns_1h_buys: int = 0
    txns_1h_sells: int = 0
    txns_24h_buys: int = 0
    txns_24h_sells: int = 0
    
    # Liquidity
    liquidity_usd: float = 0.0
    liquidity_base: float = 0.0
    liquidity_quote: float = 0.0
    
    # Market metrics
    fdv: float = 0.0
    market_cap: float = 0.0
    
    # Metadata
    pair_created_at: Optional[int] = None
    labels: List[str] = field(default_factory=list)
    boost_active: int = 0
    
    # Timestamp
    timestamp: float = field(default_factory=time.time)
    
    @classmethod
    def from_dexscreener(cls, raw: Dict[str, Any]) -> "PairData":
        """Parse raw Dexscreener API response into normalized PairData."""
        base = raw.get("baseToken", {})
        quote = raw.get("quoteToken", {})
        txns = raw.get("txns", {})
        volume = raw.get("volume", {})
        price_change = raw.get("priceChange", {})
        liquidity = raw.get("liquidity", {}) or {}
        boosts = raw.get("boosts", {}) or {}
        
        # Parse transactions per timeframe
        txns_m5 = txns.get("m5", {})
        txns_h1 = txns.get("h1", {})
        txns_h24 = txns.get("h24", {})
        
        return cls(
            pair_address=raw.get("pairAddress", ""),
            chain_id=raw.get("chainId", ""),
            dex_id=raw.get("dexId", ""),
            url=raw.get("url", ""),
            base_token_address=base.get("address", ""),
            base_token_name=base.get("name", ""),
            base_token_symbol=base.get("symbol", ""),
            quote_token_address=quote.get("address", ""),
            quote_token_name=quote.get("name", ""),
            quote_token_symbol=quote.get("symbol", ""),
            price_usd=_safe_float(raw.get("priceUsd")),
            price_native=raw.get("priceNative", "0"),
            price_change_5m=_safe_float(price_change.get("m5")),
            price_change_1h=_safe_float(price_change.get("h1")),
            price_change_6h=_safe_float(price_change.get("h6")),
            price_change_24h=_safe_float(price_change.get("h24")),
            volume_5m=_safe_float(volume.get("m5")),
            volume_1h=_safe_float(volume.get("h1")),
            volume_6h=_safe_float(volume.get("h6")),
            volume_24h=_safe_float(volume.get("h24")),
            txns_5m_buys=_safe_int(txns_m5.get("buys")),
            txns_5m_sells=_safe_int(txns_m5.get("sells")),
            txns_1h_buys=_safe_int(txns_h1.get("buys")),
            txns_1h_sells=_safe_int(txns_h1.get("sells")),
            txns_24h_buys=_safe_int(txns_h24.get("buys")),
            txns_24h_sells=_safe_int(txns_h24.get("sells")),
            liquidity_usd=_safe_float(liquidity.get("usd")),
            liquidity_base=_safe_float(liquidity.get("base")),
            liquidity_quote=_safe_float(liquidity.get("quote")),
            fdv=_safe_float(raw.get("fdv")),
            market_cap=_safe_float(raw.get("marketCap")),
            pair_created_at=raw.get("pairCreatedAt"),
            labels=raw.get("labels", []) or [],
            boost_active=_safe_int(boosts.get("active")),
            timestamp=time.time(),
        )
    
    def to_dict(self) -> Dict[str, Any]:
        """Serialize to dictionary."""
        return asdict(self)
    
    @property
    def txns_5m(self) -> int:
        return self.txns_5m_buys + self.txns_5m_sells
    
    @property
    def txns_1h(self) -> int:
        return self.txns_1h_buys + self.txns_1h_sells
    
    @property
    def txns_24h(self) -> int:
        return self.txns_24h_buys + self.txns_24h_sells
    
    @property
    def buy_pressure_5m(self) -> float:
        total = self.txns_5m
        return self.txns_5m_buys / total if total > 0 else 0.5
    
    @property 
    def buy_pressure_1h(self) -> float:
        total = self.txns_1h
        return self.txns_1h_buys / total if total > 0 else 0.5
    
    @property
    def age_hours(self) -> Optional[float]:
        if self.pair_created_at:
            return (time.time() * 1000 - self.pair_created_at) / 3_600_000
        return None


@dataclass
class MarketEvent:
    """Event emitted by the poller when market conditions change."""
    event_type: str    # pair_update, volume_spike, liquidity_change, price_surge, new_pair
    pair: PairData
    metadata: Dict[str, Any] = field(default_factory=dict)
    timestamp: float = field(default_factory=time.time)
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "event_type": self.event_type,
            "pair": self.pair.to_dict(),
            "metadata": self.metadata,
            "timestamp": self.timestamp,
        }


@dataclass
class TopMover:
    """Aggregated top mover entry for API responses."""
    token_symbol: str
    token_address: str
    chain_id: str
    price_usd: float
    price_change_5m: float
    price_change_1h: float
    price_change_24h: float
    volume_24h: float
    liquidity_usd: float
    fdv: float
    pair_address: str
    url: str
    boost_active: int = 0
    
    @classmethod
    def from_pair(cls, pair: PairData) -> "TopMover":
        return cls(
            token_symbol=pair.base_token_symbol,
            token_address=pair.base_token_address,
            chain_id=pair.chain_id,
            price_usd=pair.price_usd,
            price_change_5m=pair.price_change_5m,
            price_change_1h=pair.price_change_1h,
            price_change_24h=pair.price_change_24h,
            volume_24h=pair.volume_24h,
            liquidity_usd=pair.liquidity_usd,
            fdv=pair.fdv,
            pair_address=pair.pair_address,
            url=pair.url,
            boost_active=pair.boost_active,
        )
    
    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


def _safe_float(val: Any) -> float:
    """Safely convert to float, handling None and string values."""
    if val is None:
        return 0.0
    try:
        return float(val)
    except (ValueError, TypeError):
        return 0.0


def _safe_int(val: Any) -> int:
    """Safely convert to int."""
    if val is None:
        return 0
    try:
        return int(val)
    except (ValueError, TypeError):
        return 0
