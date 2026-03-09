"""
Nexxore Signal Engine - Data Pipeline
=======================================
Pulls market data from the market-data service API, maintains 
rolling windows (5m, 15m, 1h, 24h), and feeds data to signal detectors.
"""

import asyncio
import logging
import time
from collections import defaultdict, deque
from typing import Any, Callable, Dict, List, Optional

import httpx

from ..config import engine_config
from ..models import PairSnapshot

logger = logging.getLogger("nexxore.signal-engine.pipeline")


class RollingWindow:
    """Maintains a time-based rolling window of snapshots for a single pair."""
    
    def __init__(self, max_size: int = 500):
        self.snapshots: deque = deque(maxlen=max_size)
    
    def add(self, snapshot: PairSnapshot):
        self.snapshots.append(snapshot)
    
    def get_window(self, seconds: int) -> List[PairSnapshot]:
        """Get snapshots within the last N seconds."""
        cutoff = time.time() - seconds
        return [s for s in self.snapshots if s.timestamp >= cutoff]
    
    def get_latest(self) -> Optional[PairSnapshot]:
        return self.snapshots[-1] if self.snapshots else None
    
    def get_previous(self) -> Optional[PairSnapshot]:
        return self.snapshots[-2] if len(self.snapshots) >= 2 else None
    
    @property
    def count(self) -> int:
        return len(self.snapshots)
    
    def avg_volume_1h(self, window_seconds: int = 3600) -> float:
        """Average volume_1h over the window."""
        snaps = self.get_window(window_seconds)
        if not snaps:
            return 0.0
        return sum(s.volume_1h for s in snaps) / len(snaps)
    
    def avg_liquidity(self, window_seconds: int = 3600) -> float:
        """Average liquidity over the window."""
        snaps = self.get_window(window_seconds)
        if not snaps:
            return 0.0
        return sum(s.liquidity_usd for s in snaps) / len(snaps)
    
    def avg_volume_5m(self, window_seconds: int = 900) -> float:
        """Average 5m volume over window."""
        snaps = self.get_window(window_seconds)
        if not snaps:
            return 0.0
        return sum(s.volume_5m for s in snaps) / len(snaps)


class DataPipeline:
    """Pulls data from market-data service and maintains rolling windows.
    
    Architecture:
    1. Poll market-data API every N seconds
    2. Maintain rolling windows per pair
    3. Feed new data to registered signal detectors
    4. Track first-seen timestamps for new pair detection
    """
    
    def __init__(self):
        self._windows: Dict[str, RollingWindow] = defaultdict(
            lambda: RollingWindow(max_size=engine_config.pipeline.max_buffer_size)
        )
        self._first_seen: Dict[str, float] = {}
        self._subscribers: List[Callable] = []
        self._running = False
        self._poll_count = 0
        self._last_poll: float = 0
        self._total_pairs_seen = 0
        self._client: Optional[httpx.AsyncClient] = None
    
    def subscribe(self, callback: Callable):
        """Register a callback for new data (async function)."""
        self._subscribers.append(callback)
    
    async def _notify_subscribers(self, pair_address: str, snapshot: PairSnapshot, is_new: bool):
        """Notify all subscribers of new data."""
        window = self._windows[pair_address]
        for callback in self._subscribers:
            try:
                await callback(pair_address, snapshot, window, is_new)
            except Exception as e:
                logger.error(f"Subscriber error: {e}")
    
    async def _fetch_market_data(self) -> List[Dict[str, Any]]:
        """Fetch latest pairs from market-data service."""
        try:
            url = f"{engine_config.market_data.base_url}/api/v1/pairs/top-movers"
            response = await self._client.get(url, params={"limit": 100})
            response.raise_for_status()
            data = response.json()
            return data.get("pairs", [])
        except httpx.ConnectError:
            logger.warning("Cannot connect to market-data service - is it running?")
            return []
        except Exception as e:
            logger.error(f"Failed to fetch market data: {e}")
            return []
    
    async def _process_pairs(self, pairs: List[Dict[str, Any]]):
        """Process incoming pair data into rolling windows."""
        for pair_data in pairs:
            try:
                snapshot = PairSnapshot.from_market_data(pair_data)
                pair_key = snapshot.pair_address
                
                if not pair_key:
                    continue
                
                # Track first seen
                is_new = pair_key not in self._first_seen
                if is_new:
                    self._first_seen[pair_key] = time.time()
                    self._total_pairs_seen += 1
                
                # Add to rolling window
                self._windows[pair_key].add(snapshot)
                
                # Notify subscribers
                await self._notify_subscribers(pair_key, snapshot, is_new)
                
            except Exception as e:
                logger.debug(f"Error processing pair: {e}")
    
    async def _poll_cycle(self):
        """Execute one poll cycle."""
        pairs = await self._fetch_market_data()
        
        if pairs:
            await self._process_pairs(pairs)
            self._poll_count += 1
            self._last_poll = time.time()
            logger.info(f"Pipeline poll #{self._poll_count}: {len(pairs)} pairs ingested")
    
    async def start(self):
        """Start the pipeline polling loop."""
        self._running = True
        self._client = httpx.AsyncClient(timeout=engine_config.market_data.timeout)
        
        logger.info(
            f"Pipeline started: polling {engine_config.market_data.base_url} "
            f"every {engine_config.market_data.poll_interval}s"
        )
        
        try:
            while self._running:
                await self._poll_cycle()
                await asyncio.sleep(engine_config.market_data.poll_interval)
        finally:
            await self._client.aclose()
    
    async def stop(self):
        """Stop the pipeline."""
        self._running = False
    
    def get_window(self, pair_address: str) -> RollingWindow:
        """Get rolling window for a pair."""
        return self._windows[pair_address]
    
    def get_all_latest(self) -> Dict[str, PairSnapshot]:
        """Get the latest snapshot for every tracked pair."""
        result = {}
        for pair_addr, window in self._windows.items():
            latest = window.get_latest()
            if latest:
                result[pair_addr] = latest
        return result
    
    def is_new_pair(self, pair_address: str, max_age_hours: float = 24.0) -> bool:
        """Check if a pair was first seen recently."""
        first = self._first_seen.get(pair_address)
        if first is None:
            return False
        return (time.time() - first) < (max_age_hours * 3600)
    
    def get_stats(self) -> Dict[str, Any]:
        """Pipeline statistics."""
        return {
            "running": self._running,
            "poll_count": self._poll_count,
            "last_poll": self._last_poll,
            "tracked_pairs": len(self._windows),
            "total_pairs_seen": self._total_pairs_seen,
            "subscribers": len(self._subscribers),
        }


# Global pipeline instance
pipeline = DataPipeline()
