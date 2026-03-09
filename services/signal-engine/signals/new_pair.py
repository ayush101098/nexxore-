"""
Nexxore Signal Engine - Signal 4: New Pair Detection
======================================================
Detects newly created pools with meaningful liquidity.

Trigger conditions:
- Pool age < 24 hours
- liquidity > $100k
- volume_1h > $5k

Signal strength scales with liquidity depth and early volume.
"""

import logging
import time
from typing import Optional

from ..config import engine_config
from ..models import PairSnapshot, Signal
from ..pipeline.data_pipeline import RollingWindow

logger = logging.getLogger("nexxore.signal-engine.signals.new_pair")


def detect_new_pair(
    snapshot: PairSnapshot,
    window: RollingWindow,
    first_seen_time: Optional[float] = None,
) -> Optional[Signal]:
    """Check if a pair is newly created with significant backing.
    
    Uses pair_created_at from Dexscreener or first_seen_time from
    our own tracking.
    """
    cfg = engine_config.thresholds
    
    # Determine pair age
    age_hours = None
    
    if snapshot.pair_created_at:
        age_ms = (time.time() * 1000) - snapshot.pair_created_at
        age_hours = age_ms / 3_600_000
    elif first_seen_time:
        age_hours = (time.time() - first_seen_time) / 3600
    
    # Must have age data and be within threshold
    if age_hours is None or age_hours > cfg.new_pair_max_age_hours:
        return None
    
    # Minimum liquidity filter
    if snapshot.liquidity_usd < cfg.new_pair_min_liquidity:
        return None
    
    # Minimum volume filter
    if snapshot.volume_1h < cfg.new_pair_min_volume_1h:
        return None
    
    # Calculate signal strength (0-100)
    
    # Liquidity depth: more liquidity = stronger backing
    liq_strength = min(snapshot.liquidity_usd / 1_000_000, 1.0) * 35
    
    # Early volume: high volume for a new pair = high interest
    vol_strength = min(snapshot.volume_1h / 100_000, 1.0) * 30
    
    # Freshness: newer pairs score higher
    freshness = max(0, 1 - (age_hours / cfg.new_pair_max_age_hours))
    freshness_strength = freshness * 20
    
    # Transaction activity bonus
    txns = snapshot.txns_1h_buys + snapshot.txns_1h_sells
    txn_strength = min(txns / 50.0, 1.0) * 15
    
    strength = liq_strength + vol_strength + freshness_strength + txn_strength
    
    logger.info(
        f"NEW PAIR: {snapshot.token_symbol} on {snapshot.chain_id} | "
        f"age={age_hours:.1f}h | liq=${snapshot.liquidity_usd:,.0f} | "
        f"vol_1h=${snapshot.volume_1h:,.0f} | strength={strength:.0f}"
    )
    
    return Signal(
        signal_type="new_pair",
        token_symbol=snapshot.token_symbol,
        token_address=snapshot.token_address,
        chain_id=snapshot.chain_id,
        pair_address=snapshot.pair_address,
        strength=round(strength, 1),
        metadata={
            "age_hours": round(age_hours, 2),
            "liquidity_usd": snapshot.liquidity_usd,
            "volume_1h": snapshot.volume_1h,
            "txns_1h": txns,
            "freshness_score": round(freshness, 3),
            "pair_created_at": snapshot.pair_created_at,
        },
        price_usd=snapshot.price_usd,
        volume_24h=snapshot.volume_24h,
        liquidity_usd=snapshot.liquidity_usd,
    )
