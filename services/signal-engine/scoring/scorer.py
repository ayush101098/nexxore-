"""
Nexxore Signal Engine - Signal Scoring System
===============================================
Combines all 4 alpha signals into a composite 0-100 score per token.

Scoring weights:
- Momentum:  0-40 points (40%)
- Volume:    0-30 points (30%)
- Liquidity: 0-20 points (20%)
- New Pair:  0-10 points (10%)

Classification:
- >70: Strong Trade
- 50-70: Watchlist
- <50: Ignore
"""

import logging
import time
from collections import defaultdict
from typing import Any, Callable, Dict, List, Optional

from ..config import engine_config
from ..models import PairSnapshot, ScoredToken, Signal, SignalEvent
from ..pipeline.data_pipeline import DataPipeline, RollingWindow, pipeline
from ..signals.momentum import detect_momentum_spike
from ..signals.liquidity import detect_liquidity_inflow
from ..signals.volume import detect_volume_breakout
from ..signals.new_pair import detect_new_pair

logger = logging.getLogger("nexxore.signal-engine.scoring")


class SignalScorer:
    """Aggregates signals and produces composite scores for each token.
    
    Maintains a running scoreboard of all active tokens, updating
    scores as new data arrives from the pipeline.
    """
    
    def __init__(self):
        self._scored_tokens: Dict[str, ScoredToken] = {}
        self._active_signals: Dict[str, List[Signal]] = defaultdict(list)
        self._event_subscribers: List[Callable] = []
        self._signal_count = 0
        self._last_update: float = 0
        
        # Register as pipeline subscriber
        pipeline.subscribe(self._on_new_data)
    
    def subscribe_events(self, callback: Callable):
        """Register for signal events (async callback)."""
        self._event_subscribers.append(callback)
    
    async def _emit_event(self, event: SignalEvent):
        """Emit signal event to subscribers."""
        for sub in self._event_subscribers:
            try:
                await sub(event)
            except Exception as e:
                logger.error(f"Event subscriber error: {e}")
    
    async def _on_new_data(
        self,
        pair_address: str,
        snapshot: PairSnapshot,
        window: RollingWindow,
        is_new: bool,
    ):
        """Called by pipeline when new data arrives for a pair.
        
        Runs all 4 signal detectors and updates the composite score.
        """
        signals: List[Signal] = []
        
        # Signal 1: Momentum Spike
        momentum = detect_momentum_spike(snapshot, window)
        if momentum:
            signals.append(momentum)
        
        # Signal 2: Liquidity Inflow
        liquidity = detect_liquidity_inflow(snapshot, window)
        if liquidity:
            signals.append(liquidity)
        
        # Signal 3: Volume Breakout
        volume = detect_volume_breakout(snapshot, window)
        if volume:
            signals.append(volume)
        
        # Signal 4: New Pair Detection
        first_seen = pipeline._first_seen.get(pair_address)
        new_pair = detect_new_pair(snapshot, window, first_seen_time=first_seen)
        if new_pair:
            signals.append(new_pair)
        
        # Update signal count
        self._signal_count += len(signals)
        
        # Store active signals for this pair
        self._active_signals[pair_address] = signals
        
        # Calculate composite score
        scored = self._compute_score(snapshot, signals)
        self._scored_tokens[pair_address] = scored
        self._last_update = time.time()
        
        # Emit events for significant signals
        if scored.total_score >= engine_config.scoring.watchlist:
            for signal in signals:
                await self._emit_event(SignalEvent(
                    event_type="signal_generated",
                    signal=signal,
                    scored_token=scored,
                ))
    
    def _compute_score(self, snapshot: PairSnapshot, signals: List[Signal]) -> ScoredToken:
        """Compute weighted composite score from individual signals."""
        weights = engine_config.scoring
        
        # Map signal types to their scores (scaled to weight)
        momentum_score = 0.0
        volume_score = 0.0
        liquidity_score = 0.0
        new_pair_score = 0.0
        
        for signal in signals:
            # Scale signal strength (0-100) to weight range
            normalized = signal.strength / 100.0
            
            if signal.signal_type == "momentum_spike":
                momentum_score = normalized * weights.momentum
            elif signal.signal_type == "volume_breakout":
                volume_score = normalized * weights.volume
            elif signal.signal_type == "liquidity_inflow":
                liquidity_score = normalized * weights.liquidity
            elif signal.signal_type == "new_pair":
                new_pair_score = normalized * weights.new_pair
        
        total = momentum_score + volume_score + liquidity_score + new_pair_score
        
        # Classification
        if total >= weights.strong_trade:
            classification = "strong_trade"
        elif total >= weights.watchlist:
            classification = "watchlist"
        else:
            classification = "ignore"
        
        return ScoredToken(
            token_symbol=snapshot.token_symbol,
            token_address=snapshot.token_address,
            chain_id=snapshot.chain_id,
            pair_address=snapshot.pair_address,
            total_score=round(total, 1),
            classification=classification,
            momentum_score=round(momentum_score, 1),
            volume_score=round(volume_score, 1),
            liquidity_score=round(liquidity_score, 1),
            new_pair_score=round(new_pair_score, 1),
            signals=signals,
            signal_count=len(signals),
            price_usd=snapshot.price_usd,
            price_change_5m=snapshot.price_change_5m,
            price_change_1h=snapshot.price_change_1h,
            price_change_24h=snapshot.price_change_24h,
            volume_1h=snapshot.volume_1h,
            volume_24h=snapshot.volume_24h,
            liquidity_usd=snapshot.liquidity_usd,
            fdv=snapshot.fdv,
            url=snapshot.url,
        )
    
    def get_top_signals(self, limit: int = 20, min_score: float = 0) -> List[ScoredToken]:
        """Get top scored tokens, sorted by total_score descending."""
        tokens = [
            t for t in self._scored_tokens.values()
            if t.total_score >= min_score
        ]
        tokens.sort(key=lambda t: t.total_score, reverse=True)
        return tokens[:limit]
    
    def get_strong_trades(self, limit: int = 10) -> List[ScoredToken]:
        """Get tokens classified as strong trades (score > 70)."""
        return self.get_top_signals(limit=limit, min_score=engine_config.scoring.strong_trade)
    
    def get_watchlist(self, limit: int = 20) -> List[ScoredToken]:
        """Get tokens on the watchlist (score 50-70)."""
        tokens = [
            t for t in self._scored_tokens.values()
            if engine_config.scoring.watchlist <= t.total_score < engine_config.scoring.strong_trade
        ]
        tokens.sort(key=lambda t: t.total_score, reverse=True)
        return tokens[:limit]
    
    def get_token_score(self, token_address: str) -> Optional[ScoredToken]:
        """Get score for a specific token (search across all pairs)."""
        for scored in self._scored_tokens.values():
            if scored.token_address == token_address:
                return scored
        return None
    
    def get_by_chain(self, chain_id: str, limit: int = 20) -> List[ScoredToken]:
        """Get top signals for a specific chain."""
        tokens = [
            t for t in self._scored_tokens.values()
            if t.chain_id == chain_id and t.total_score > 0
        ]
        tokens.sort(key=lambda t: t.total_score, reverse=True)
        return tokens[:limit]
    
    def get_stats(self) -> Dict[str, Any]:
        """Scorer statistics."""
        total = len(self._scored_tokens)
        strong = sum(1 for t in self._scored_tokens.values() if t.classification == "strong_trade")
        watchlist = sum(1 for t in self._scored_tokens.values() if t.classification == "watchlist")
        
        return {
            "total_scored": total,
            "strong_trades": strong,
            "watchlist": watchlist,
            "ignored": total - strong - watchlist,
            "total_signals_generated": self._signal_count,
            "last_update": self._last_update,
            "event_subscribers": len(self._event_subscribers),
        }


# Global scorer instance
scorer = SignalScorer()
