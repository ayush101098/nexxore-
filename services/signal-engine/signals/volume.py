"""
Nexxore Signal Engine - Signal 3: Volume Breakout
===================================================
Detects tokens where trading volume breaks above historical average.

Trigger conditions:
- volume_1h > 3x 24h average hourly volume
- min 24h volume > $10k
- min 20 transactions in 1h

Signal strength scales with the volume breakout multiplier.
"""

import logging
from typing import Optional

from ..config import engine_config
from ..models import PairSnapshot, Signal
from ..pipeline.data_pipeline import RollingWindow

logger = logging.getLogger("nexxore.signal-engine.signals.volume")


def detect_volume_breakout(
    snapshot: PairSnapshot,
    window: RollingWindow,
) -> Optional[Signal]:
    """Check if a token's volume is breaking out above historical average.
    
    Compares current 1h volume against 24h average hourly volume.
    """
    cfg = engine_config.thresholds
    
    # Minimum volume filter
    if snapshot.volume_24h < cfg.volume_min_24h:
        return None
    
    # Minimum transaction count
    txns_1h = snapshot.txns_1h_buys + snapshot.txns_1h_sells
    if txns_1h < cfg.volume_min_txns_1h:
        return None
    
    # Calculate average hourly volume from 24h data
    avg_hourly_volume = snapshot.volume_24h / 24.0
    
    if avg_hourly_volume <= 0:
        return None
    
    # Volume breakout ratio
    vol_ratio = snapshot.volume_1h / avg_hourly_volume
    
    if vol_ratio < cfg.volume_breakout_multiplier:
        return None
    
    # Also check against rolling window average if available
    rolling_avg = window.avg_volume_1h(window_seconds=engine_config.pipeline.window_1h)
    rolling_ratio = snapshot.volume_1h / rolling_avg if rolling_avg > 0 else vol_ratio
    
    # Use the higher ratio for strength calculation
    effective_ratio = max(vol_ratio, rolling_ratio)
    
    # Calculate signal strength (0-100)
    # 3x = base, 10x+ = max
    ratio_strength = min((effective_ratio - 1) / 9.0, 1.0) * 45
    
    # Transaction velocity bonus
    txn_strength = min(txns_1h / 200.0, 1.0) * 25
    
    # Buy pressure bonus (higher buy ratio = stronger signal)
    total_txns = snapshot.txns_1h_buys + snapshot.txns_1h_sells
    buy_ratio = snapshot.txns_1h_buys / total_txns if total_txns > 0 else 0.5
    pressure_strength = buy_ratio * 30
    
    strength = ratio_strength + txn_strength + pressure_strength
    
    logger.info(
        f"VOLUME BREAKOUT: {snapshot.token_symbol} on {snapshot.chain_id} | "
        f"{vol_ratio:.1f}x avg | vol_1h=${snapshot.volume_1h:,.0f} | "
        f"txns={txns_1h} | strength={strength:.0f}"
    )
    
    return Signal(
        signal_type="volume_breakout",
        token_symbol=snapshot.token_symbol,
        token_address=snapshot.token_address,
        chain_id=snapshot.chain_id,
        pair_address=snapshot.pair_address,
        strength=round(strength, 1),
        metadata={
            "volume_1h": snapshot.volume_1h,
            "avg_hourly_volume": round(avg_hourly_volume, 2),
            "volume_ratio": round(vol_ratio, 2),
            "rolling_ratio": round(rolling_ratio, 2),
            "txns_1h": txns_1h,
            "buy_ratio": round(buy_ratio, 3),
            "buys_1h": snapshot.txns_1h_buys,
            "sells_1h": snapshot.txns_1h_sells,
        },
        price_usd=snapshot.price_usd,
        volume_24h=snapshot.volume_24h,
        liquidity_usd=snapshot.liquidity_usd,
    )
