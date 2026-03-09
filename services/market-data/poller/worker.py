"""
Nexxore Market Data - Background Polling Worker
=================================================
Continuously polls Dexscreener for market data updates,
stores snapshots, and emits market events for the signal engine.
"""

import asyncio
import logging
import time
from typing import Any, Callable, Dict, List, Optional

from ..config import config
from ..dexscreener.client import DexscreenerClient
from ..models import MarketEvent, PairData
from ..storage.database import db

logger = logging.getLogger("nexxore.market-data.poller")


class MarketPoller:
    """Background worker that polls Dexscreener at configured intervals.
    
    Responsibilities:
    1. Discover top movers from boosts/profiles
    2. Fetch pair data for tracked tokens
    3. Store snapshots to SQLite
    4. Detect and emit market events (volume spikes, liquidity changes, etc.)
    5. Publish events to subscribers (signal engine, WebSocket)
    """
    
    def __init__(self):
        self._running = False
        self._client: Optional[DexscreenerClient] = None
        self._subscribers: List[Callable] = []
        self._last_poll: float = 0
        self._poll_count: int = 0
        self._event_count: int = 0
        
        # Track previous state for change detection
        self._prev_state: Dict[str, Dict[str, float]] = {}
    
    def subscribe(self, callback: Callable):
        """Register an event subscriber (async callback)."""
        self._subscribers.append(callback)
    
    async def _emit_event(self, event: MarketEvent):
        """Emit event to all subscribers."""
        self._event_count += 1
        for subscriber in self._subscribers:
            try:
                await subscriber(event)
            except Exception as e:
                logger.error(f"Event subscriber error: {e}")
    
    async def _detect_events(self, pairs: List[PairData]):
        """Analyze pairs for significant market events."""
        cfg = config.poller
        
        for pair in pairs:
            key = pair.pair_address
            prev = self._prev_state.get(key, {})
            
            # Always emit pair update
            await self._emit_event(MarketEvent(
                event_type="pair_update",
                pair=pair,
            ))
            
            if not prev:
                # New pair detected
                if pair.liquidity_usd > 100_000:
                    await self._emit_event(MarketEvent(
                        event_type="new_pair",
                        pair=pair,
                        metadata={"liquidity_usd": pair.liquidity_usd},
                    ))
            else:
                # Volume spike detection
                prev_vol = prev.get("volume_1h", 0)
                if prev_vol > 0 and pair.volume_1h > prev_vol * cfg.volume_spike_multiplier:
                    await self._emit_event(MarketEvent(
                        event_type="volume_spike",
                        pair=pair,
                        metadata={
                            "prev_volume_1h": prev_vol,
                            "current_volume_1h": pair.volume_1h,
                            "multiplier": round(pair.volume_1h / prev_vol, 2),
                        },
                    ))
                
                # Liquidity change detection
                prev_liq = prev.get("liquidity_usd", 0)
                if prev_liq > 0:
                    liq_change = ((pair.liquidity_usd - prev_liq) / prev_liq) * 100
                    if abs(liq_change) >= cfg.liquidity_change_pct:
                        await self._emit_event(MarketEvent(
                            event_type="liquidity_change",
                            pair=pair,
                            metadata={
                                "prev_liquidity_usd": prev_liq,
                                "current_liquidity_usd": pair.liquidity_usd,
                                "change_pct": round(liq_change, 2),
                            },
                        ))
                
                # Price surge detection
                if abs(pair.price_change_5m) >= cfg.price_surge_pct:
                    await self._emit_event(MarketEvent(
                        event_type="price_surge",
                        pair=pair,
                        metadata={
                            "price_change_5m": pair.price_change_5m,
                            "direction": "up" if pair.price_change_5m > 0 else "down",
                        },
                    ))
            
            # Update previous state
            self._prev_state[key] = {
                "volume_1h": pair.volume_1h,
                "liquidity_usd": pair.liquidity_usd,
                "price_usd": pair.price_usd,
                "timestamp": pair.timestamp,
            }
    
    async def _poll_cycle(self):
        """Execute one poll cycle."""
        try:
            # Fetch top movers from Dexscreener
            pairs = await self._client.get_top_movers(
                chains=config.poller.default_chains,
                limit=config.poller.top_movers_limit,
            )
            
            if pairs:
                # Store snapshots
                await db.store_snapshots_batch(pairs)
                
                # Detect and emit events
                await self._detect_events(pairs)
                
                self._poll_count += 1
                self._last_poll = time.time()
                
                logger.info(
                    f"Poll #{self._poll_count}: {len(pairs)} pairs updated, "
                    f"{self._event_count} total events emitted"
                )
            else:
                logger.warning("Poll returned no pairs")
                
        except Exception as e:
            logger.error(f"Poll cycle error: {e}", exc_info=True)
    
    async def start(self):
        """Start the polling loop."""
        self._running = True
        self._client = DexscreenerClient()
        
        async with self._client:
            logger.info(
                f"Poller started: interval={config.poller.poll_interval}s, "
                f"chains={config.poller.default_chains}"
            )
            
            while self._running:
                await self._poll_cycle()
                await asyncio.sleep(config.poller.poll_interval)
        
        logger.info("Poller stopped")
    
    async def stop(self):
        """Stop the polling loop."""
        self._running = False
    
    async def poll_once(self) -> List[PairData]:
        """Execute a single poll cycle and return pairs (for testing)."""
        self._client = DexscreenerClient()
        async with self._client:
            pairs = await self._client.get_top_movers(
                chains=config.poller.default_chains,
                limit=config.poller.top_movers_limit,
            )
            if pairs:
                await db.store_snapshots_batch(pairs)
            return pairs
    
    def get_stats(self) -> Dict[str, Any]:
        """Poller statistics."""
        return {
            "running": self._running,
            "poll_count": self._poll_count,
            "event_count": self._event_count,
            "last_poll": self._last_poll,
            "interval_seconds": config.poller.poll_interval,
            "tracked_pairs": len(self._prev_state),
            "subscribers": len(self._subscribers),
        }


# Global poller instance
poller = MarketPoller()
