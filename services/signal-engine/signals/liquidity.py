"""
Nexxore Signal Engine - Signal 2: Liquidity Inflow
====================================================
Detects significant liquidity additions to a pool.

Trigger conditions:
- liquidity increase > 20% within 10 minutes
- base liquidity > $50k

Signal strength scales with inflow magnitude and speed.
"""

import logging
from typing import Optional

from ..config import engine_config
from ..models import PairSnapshot, Signal
from ..pipeline.data_pipeline import RollingWindow

logger = logging.getLogger("nexxore.signal-engine.signals.liquidity")


def detect_liquidity_inflow(
    snapshot: PairSnapshot,
    window: RollingWindow,
) -> Optional[Signal]:
    """Check if a pair is experiencing significant liquidity inflow.
    
    Compares current liquidity against rolling average to detect
    sudden capital injections into the pool.
    """
    cfg = engine_config.thresholds
    
    # Minimum liquidity filter
    if snapshot.liquidity_usd < cfg.liquidity_min_base:
        return None
    
    # Need historical data for comparison
    window_seconds = int(cfg.liquidity_window_minutes * 60)
    snaps = window.get_window(window_seconds)
    
    if len(snaps) < 2:
        return None
    
    # Get oldest snapshot in window for comparison
    oldest = snaps[0]
    
    if oldest.liquidity_usd <= 0:
        return None
    
    # Calculate liquidity change
    liq_change_pct = ((snapshot.liquidity_usd - oldest.liquidity_usd) / oldest.liquidity_usd) * 100
    
    # Only detect positive inflows above threshold
    if liq_change_pct < cfg.liquidity_increase_pct:
        return None
    
    # Calculate signal strength (0-100)
    # Scale: 20% increase = base, 100%+ = max
    inflow_strength = min(liq_change_pct / 100.0, 1.0) * 50
    
    # Size factor: larger pools get higher strength
    size_strength = min(snapshot.liquidity_usd / 2_000_000, 1.0) * 30
    
    # Speed factor: faster inflows score higher
    time_delta = snapshot.timestamp - oldest.timestamp
    speed_factor = max(0, 1 - (time_delta / (cfg.liquidity_window_minutes * 60 * 2)))
    speed_strength = speed_factor * 20
    
    strength = inflow_strength + size_strength + speed_strength
    
    absolute_inflow = snapshot.liquidity_usd - oldest.liquidity_usd
    
    logger.info(
        f"LIQUIDITY INFLOW: {snapshot.token_symbol} on {snapshot.chain_id} | "
        f"+{liq_change_pct:.1f}% (${absolute_inflow:,.0f}) | strength={strength:.0f}"
    )
    
    return Signal(
        signal_type="liquidity_inflow",
        token_symbol=snapshot.token_symbol,
        token_address=snapshot.token_address,
        chain_id=snapshot.chain_id,
        pair_address=snapshot.pair_address,
        strength=round(strength, 1),
        metadata={
            "liquidity_change_pct": round(liq_change_pct, 2),
            "absolute_inflow_usd": round(absolute_inflow, 2),
            "prev_liquidity_usd": round(oldest.liquidity_usd, 2),
            "current_liquidity_usd": round(snapshot.liquidity_usd, 2),
            "window_seconds": window_seconds,
            "data_points": len(snaps),
        },
        price_usd=snapshot.price_usd,
        volume_24h=snapshot.volume_24h,
        liquidity_usd=snapshot.liquidity_usd,
    )
