"""
Nexxore Signal Engine - Data Models
=====================================
Signal, score, and event data structures.
"""

from dataclasses import dataclass, field, asdict
from typing import Any, Dict, List, Optional
import time


@dataclass
class Signal:
    """A single alpha signal detection."""
    signal_type: str     # momentum_spike, liquidity_inflow, volume_breakout, new_pair
    token_symbol: str
    token_address: str
    chain_id: str
    pair_address: str
    
    # Signal-specific data
    strength: float = 0.0     # Raw signal strength (0-100)
    metadata: Dict[str, Any] = field(default_factory=dict)
    
    # Context
    price_usd: float = 0.0
    volume_24h: float = 0.0
    liquidity_usd: float = 0.0
    
    timestamp: float = field(default_factory=time.time)
    
    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class ScoredToken:
    """A token with composite alpha score from all signals."""
    token_symbol: str
    token_address: str
    chain_id: str
    pair_address: str
    
    # Composite score
    total_score: float = 0.0
    classification: str = "ignore"   # strong_trade, watchlist, ignore
    
    # Individual signal scores (0 to max weight)
    momentum_score: float = 0.0
    volume_score: float = 0.0
    liquidity_score: float = 0.0
    new_pair_score: float = 0.0
    
    # Active signals
    signals: List[Signal] = field(default_factory=list)
    signal_count: int = 0
    
    # Market data
    price_usd: float = 0.0
    price_change_5m: float = 0.0
    price_change_1h: float = 0.0
    price_change_24h: float = 0.0
    volume_1h: float = 0.0
    volume_24h: float = 0.0
    liquidity_usd: float = 0.0
    fdv: float = 0.0
    
    # Metadata
    url: str = ""
    timestamp: float = field(default_factory=time.time)
    
    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["signals"] = [s.to_dict() if hasattr(s, "to_dict") else s for s in self.signals]
        return d


@dataclass
class SignalEvent:
    """Event emitted when a signal is generated."""
    event_type: str = "signal_generated"
    signal: Optional[Signal] = None
    scored_token: Optional[ScoredToken] = None
    timestamp: float = field(default_factory=time.time)
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "event_type": self.event_type,
            "signal": self.signal.to_dict() if self.signal else None,
            "scored_token": self.scored_token.to_dict() if self.scored_token else None,
            "timestamp": self.timestamp,
        }


@dataclass
class PairSnapshot:
    """Lightweight snapshot for rolling window buffers."""
    pair_address: str
    chain_id: str
    token_symbol: str
    token_address: str
    price_usd: float
    volume_5m: float
    volume_1h: float
    volume_24h: float
    liquidity_usd: float
    fdv: float
    price_change_5m: float
    price_change_1h: float
    price_change_24h: float
    txns_5m_buys: int = 0
    txns_5m_sells: int = 0
    txns_1h_buys: int = 0
    txns_1h_sells: int = 0
    boost_active: int = 0
    pair_created_at: Optional[int] = None
    url: str = ""
    timestamp: float = field(default_factory=time.time)
    
    @classmethod
    def from_market_data(cls, data: Dict[str, Any]) -> "PairSnapshot":
        """Create from market-data service response."""
        return cls(
            pair_address=data.get("pair_address", ""),
            chain_id=data.get("chain_id", ""),
            token_symbol=data.get("base_token_symbol", ""),
            token_address=data.get("base_token_address", ""),
            price_usd=float(data.get("price_usd", 0)),
            volume_5m=float(data.get("volume_5m", 0)),
            volume_1h=float(data.get("volume_1h", 0)),
            volume_24h=float(data.get("volume_24h", 0)),
            liquidity_usd=float(data.get("liquidity_usd", 0)),
            fdv=float(data.get("fdv", 0)),
            price_change_5m=float(data.get("price_change_5m", 0)),
            price_change_1h=float(data.get("price_change_1h", 0)),
            price_change_24h=float(data.get("price_change_24h", 0)),
            txns_5m_buys=int(data.get("txns_5m_buys", 0)),
            txns_5m_sells=int(data.get("txns_5m_sells", 0)),
            txns_1h_buys=int(data.get("txns_1h_buys", 0)),
            txns_1h_sells=int(data.get("txns_1h_sells", 0)),
            boost_active=int(data.get("boost_active", 0)),
            pair_created_at=data.get("pair_created_at"),
            url=data.get("url", ""),
            timestamp=float(data.get("timestamp", time.time())),
        )
