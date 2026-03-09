"""
Nexxore Signal Engine - Signal 1: Momentum Spike
==================================================
Detects tokens with sudden price + volume acceleration.

Trigger conditions:
- price_change_5m > 5%
- volume_5m > 2x rolling average
- liquidity > $500k (filter out illiquid)

Signal strength scales from 0-100 based on how far above thresholds.
"""

import logging
from typing import Optional

from ..config import engine_config
from ..models import PairSnapshot, Signal
from ..pipeline.data_pipeline import RollingWindow

logger = logging.getLogger("nexxore.signal-engine.signals.momentum")


def detect_momentum_spike(
    snapshot: PairSnapshot,
    window: RollingWindow,
) -> Optional[Signal]:
    """Check if a token is experiencing a momentum spike.
    
    Returns Signal if all conditions met, None otherwise.
    """
    cfg = engine_config.thresholds
    
    # Condition 1: Price change > threshold
    if abs(snapshot.price_change_5m) < cfg.momentum_price_change_5m:
        return None
    
    # Condition 2: Minimum liquidity
    if snapshot.liquidity_usd < cfg.momentum_min_liquidity:
        return None
    
    # Condition 3: Volume multiplier vs rolling average
    avg_vol = window.avg_volume_5m(window_seconds=900)  # 15-min rolling avg
    if avg_vol > 0:
        vol_ratio = snapshot.volume_5m / avg_vol
        if vol_ratio < cfg.momentum_volume_multiplier:
            return None
    else:
        vol_ratio = 1.0
        # If no historical data, still allow if volume is non-trivial
        if snapshot.volume_5m < 1000:
            return None
    
    # Calculate signal strength (0-100)
    # Scale based on how far above each threshold
    price_strength = min(abs(snapshot.price_change_5m) / 20.0, 1.0) * 40
    volume_strength = min(vol_ratio / 5.0, 1.0) * 35
    liquidity_strength = min(snapshot.liquidity_usd / 5_000_000, 1.0) * 25
    
    strength = price_strength + volume_strength + liquidity_strength
    
    direction = "bullish" if snapshot.price_change_5m > 0 else "bearish"
    
    logger.info(
        f"MOMENTUM SPIKE: {snapshot.token_symbol} on {snapshot.chain_id} | "
        f"price_5m={snapshot.price_change_5m:+.1f}% | "
        f"vol_ratio={vol_ratio:.1f}x | strength={strength:.0f}"
    )
    
    return Signal(
        signal_type="momentum_spike",
        token_symbol=snapshot.token_symbol,
        token_address=snapshot.token_address,
        chain_id=snapshot.chain_id,
        pair_address=snapshot.pair_address,
        strength=round(strength, 1),
        metadata={
            "price_change_5m": snapshot.price_change_5m,
            "volume_5m": snapshot.volume_5m,
            "avg_volume_5m": round(avg_vol, 2),
            "volume_ratio": round(vol_ratio, 2),
            "direction": direction,
            "price_strength": round(price_strength, 1),
            "volume_strength": round(volume_strength, 1),
            "liquidity_strength": round(liquidity_strength, 1),
        },
        price_usd=snapshot.price_usd,
        volume_24h=snapshot.volume_24h,
        liquidity_usd=snapshot.liquidity_usd,
    )
