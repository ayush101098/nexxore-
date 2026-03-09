"""
PHASE 2 — Ingestion Layer: The Plumbing System
Brings data from all 4 channels → normalizes → aggregates into one unified signal.

This is the pipe that connects your data sources (Phase 1) to your strategy brain (Phase 4).
"""

import asyncio
from datetime import datetime, timezone
from loguru import logger

from phase1_data import (
    LiquidityWhaleChannel,
    MacroSentimentChannel,
    SupplyDemandChannel,
    DerivativesChannel,
)


class DataIngestionPipeline:
    """
    Aggregates all 4 channels into a single composite signal.
    Each channel returns 0–100. We weight them and produce a final score + direction.
    """

    def __init__(self, config):
        self.config = config
        self.weights = config.CHANNEL_WEIGHTS

        # Initialize all 4 channels
        self.channels = {
            "liquidity_whale": LiquidityWhaleChannel(config),
            "macro_sentiment": MacroSentimentChannel(config),
            "supply_demand": SupplyDemandChannel(config),
            "derivatives": DerivativesChannel(config),
        }

        # Signal history for trend detection
        self._history = []
        self._max_history = 100

    async def close(self):
        """Cleanup all channel sessions."""
        for ch in self.channels.values():
            await ch.close()

    # ─── MAIN PIPELINE ──────────────────────────────────────

    async def ingest(self) -> dict:
        """
        Run all 4 channels in parallel → normalize → aggregate.
        Returns the unified signal object.
        """
        logger.info("⚡ Ingestion pipeline running...")

        # Fire all 4 channels simultaneously
        channel_tasks = {
            name: ch.get_score()
            for name, ch in self.channels.items()
        }

        results = {}
        gathered = await asyncio.gather(
            *channel_tasks.values(),
            return_exceptions=True,
        )

        for name, result in zip(channel_tasks.keys(), gathered):
            if isinstance(result, Exception):
                logger.error(f"Channel {name} failed: {result}")
                results[name] = {"score": 50, "direction": "neutral", "channel": name, "details": {"error": str(result)}}
            else:
                results[name] = result
                logger.info(f"  📡 {name}: score={result['score']}, direction={result['direction']}")

        # ── Weighted composite ──────────────────────────────
        composite_score = 0
        for name, weight in self.weights.items():
            score = results.get(name, {}).get("score", 50)
            composite_score += score * weight

        # ── Direction consensus ─────────────────────────────
        directions = [r.get("direction", "neutral") for r in results.values()]
        long_votes = sum(1 for d in directions if d == "long")
        short_votes = sum(1 for d in directions if d == "short")
        total_votes = len(directions)

        if composite_score >= self.config.SIGNAL_THRESHOLD:
            direction = "long"
            confidence = composite_score
        elif composite_score <= (100 - self.config.SIGNAL_THRESHOLD):
            direction = "short"
            confidence = 100 - composite_score
        else:
            direction = "neutral"
            confidence = 50

        # ── Consensus bonus ─────────────────────────────────
        # If 3/4 or 4/4 channels agree → boost confidence
        consensus = max(long_votes, short_votes) / total_votes
        if consensus >= 0.75:
            confidence = min(100, confidence + 5)

        # ── Signal trend (is confidence building?) ──────────
        trend = self._calculate_trend(composite_score)

        # ── Build unified signal ────────────────────────────
        signal = {
            "composite_score": round(composite_score, 1),
            "direction": direction,
            "confidence": round(confidence, 1),
            "consensus": round(consensus, 2),
            "trend": trend,
            "long_votes": long_votes,
            "short_votes": short_votes,
            "threshold": self.config.SIGNAL_THRESHOLD,
            "actionable": direction != "neutral",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "channels": results,
        }

        # Save to history
        self._history.append({
            "score": composite_score,
            "direction": direction,
            "ts": datetime.now(timezone.utc),
        })
        if len(self._history) > self._max_history:
            self._history = self._history[-self._max_history:]

        logger.info(
            f"  🎯 COMPOSITE: score={composite_score:.1f}, "
            f"direction={direction}, confidence={confidence:.1f}%, "
            f"consensus={consensus:.0%}, actionable={signal['actionable']}"
        )

        return signal

    # ─── HELPERS ─────────────────────────────────────────────

    def _calculate_trend(self, current_score: float) -> str:
        """Is the signal strengthening or weakening?"""
        if len(self._history) < 3:
            return "insufficient_data"

        recent_scores = [h["score"] for h in self._history[-3:]]
        avg_recent = sum(recent_scores) / len(recent_scores)

        if current_score > avg_recent + 3:
            return "strengthening"
        elif current_score < avg_recent - 3:
            return "weakening"
        else:
            return "stable"

    def get_history(self) -> list:
        """Return signal history for learning engine."""
        return list(self._history)

    def get_latest_channels(self) -> dict:
        """Return the most recent channel scores for the dashboard."""
        if self._history:
            return self._history[-1]
        return {}
