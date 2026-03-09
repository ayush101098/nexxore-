"""
PHASE 7 — Learning Engine: Gets Smarter Over Time
Analyzes past performance and adapts parameters.

Features:
  • Track which channels are most predictive
  • Adjust channel weights based on historical accuracy
  • Detect regime changes (trending vs ranging market)
  • Backtest new parameter combinations
  • Generate performance reports
"""

import json
import numpy as np
from pathlib import Path
from datetime import datetime, timezone, timedelta
from loguru import logger


class LearningEngine:
    """
    Looks at past trades, identifies what worked, adapts.
    Not a black-box ML model — transparent statistical learning.
    """

    def __init__(self, config):
        self.config = config
        self.data_dir = config.DATA_DIR
        self.data_dir.mkdir(exist_ok=True)

        # Track channel accuracy
        self.channel_accuracy = {
            "liquidity_whale": {"correct": 0, "total": 0, "accuracy": 0.5},
            "macro_sentiment": {"correct": 0, "total": 0, "accuracy": 0.5},
            "supply_demand": {"correct": 0, "total": 0, "accuracy": 0.5},
            "derivatives": {"correct": 0, "total": 0, "accuracy": 0.5},
        }

        # Trade outcome tracking
        self.trade_outcomes = []
        self.regime_history = []

        # Load saved state
        self._load_state()

    # ─── RECORD OUTCOME ─────────────────────────────────────

    def record_trade_outcome(self, signal: dict, pnl: float, direction: str):
        """
        After a trade closes, record which channels predicted correctly.
        This feeds the weight adaptation system.
        """
        won = pnl > 0
        channels = signal.get("channels", {})

        for name, ch_data in channels.items():
            ch_direction = ch_data.get("direction", "neutral")
            if ch_direction == "neutral":
                continue

            self.channel_accuracy[name]["total"] += 1

            # Channel was "correct" if its direction matched the winning side
            if won and ch_direction == direction:
                self.channel_accuracy[name]["correct"] += 1
            elif not won and ch_direction != direction:
                self.channel_accuracy[name]["correct"] += 1

            total = self.channel_accuracy[name]["total"]
            correct = self.channel_accuracy[name]["correct"]
            self.channel_accuracy[name]["accuracy"] = correct / total if total > 0 else 0.5

        self.trade_outcomes.append({
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "direction": direction,
            "pnl": pnl,
            "won": won,
            "composite_score": signal.get("composite_score", 50),
            "channel_scores": {
                name: ch.get("score", 50)
                for name, ch in channels.items()
            },
        })

        self._save_state()
        logger.info(f"📚 Recorded outcome: {'WIN' if won else 'LOSS'}, PnL=${pnl:+.2f}")

    # ─── ADAPT WEIGHTS ──────────────────────────────────────

    def get_adapted_weights(self) -> dict:
        """
        Suggest new channel weights based on historical accuracy.
        More accurate channels get more weight.
        Uses exponential weighting so recent performance matters more.
        """
        min_trades = 10  # Need at least 10 trades before adapting
        total_trades = sum(ch["total"] for ch in self.channel_accuracy.values())

        if total_trades < min_trades:
            logger.info(f"📚 Not enough trades ({total_trades}/{min_trades}) — using default weights")
            return self.config.CHANNEL_WEIGHTS

        # Calculate accuracy-weighted scores
        accuracies = {}
        for name, data in self.channel_accuracy.items():
            # Bayesian smoothing: assume 50% prior with 5 virtual trades
            smoothed = (data["correct"] + 2.5) / (data["total"] + 5)
            accuracies[name] = smoothed

        # Normalize to sum to 1.0
        total_acc = sum(accuracies.values())
        if total_acc > 0:
            adapted = {name: round(acc / total_acc, 3) for name, acc in accuracies.items()}
        else:
            adapted = self.config.CHANNEL_WEIGHTS

        logger.info(f"📚 Adapted weights: {adapted}")
        return adapted

    # ─── REGIME DETECTION ───────────────────────────────────

    def detect_regime(self, recent_signals: list) -> str:
        """
        Detect market regime from recent signal patterns.
        Returns: 'trending_up', 'trending_down', 'ranging', 'volatile'
        """
        if len(recent_signals) < 5:
            return "insufficient_data"

        scores = [s.get("composite_score", 50) for s in recent_signals[-20:]]
        directions = [s.get("direction", "neutral") for s in recent_signals[-20:]]

        avg_score = np.mean(scores)
        score_std = np.std(scores)
        long_pct = sum(1 for d in directions if d == "long") / len(directions)
        short_pct = sum(1 for d in directions if d == "short") / len(directions)

        # High volatility in scores = volatile regime
        if score_std > 15:
            regime = "volatile"
        # Consistently long signals
        elif long_pct > 0.7 and avg_score > 60:
            regime = "trending_up"
        # Consistently short signals
        elif short_pct > 0.7 and avg_score < 40:
            regime = "trending_down"
        # Mixed signals = ranging
        else:
            regime = "ranging"

        self.regime_history.append({
            "regime": regime,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "avg_score": round(avg_score, 1),
            "score_std": round(score_std, 1),
        })

        return regime

    # ─── PARAMETER SUGGESTIONS ──────────────────────────────

    def suggest_parameters(self) -> dict:
        """
        Based on recent performance, suggest parameter adjustments.
        """
        suggestions = {}

        if len(self.trade_outcomes) < 10:
            return {"message": "Need more trades for suggestions"}

        recent = self.trade_outcomes[-50:]
        wins = sum(1 for t in recent if t["won"])
        win_rate = wins / len(recent)

        # Win rate too low → tighten threshold
        if win_rate < 0.45:
            current_threshold = self.config.SIGNAL_THRESHOLD
            suggestions["signal_threshold"] = {
                "current": current_threshold,
                "suggested": min(85, current_threshold + 5),
                "reason": f"Win rate {win_rate:.0%} too low — increase threshold to filter weak signals",
            }

        # Win rate very high → could loosen threshold for more trades
        if win_rate > 0.70 and len(recent) > 20:
            current_threshold = self.config.SIGNAL_THRESHOLD
            suggestions["signal_threshold"] = {
                "current": current_threshold,
                "suggested": max(60, current_threshold - 3),
                "reason": f"Win rate {win_rate:.0%} strong — could lower threshold for more opportunities",
            }

        # Check if position sizes are appropriate
        avg_pnl = np.mean([t["pnl"] for t in recent])
        max_loss = min(t["pnl"] for t in recent)
        if abs(max_loss) > self.config.MAX_POSITION_SIZE_USD * 0.5:
            suggestions["max_position_size"] = {
                "current": self.config.MAX_POSITION_SIZE_USD,
                "suggested": self.config.MAX_POSITION_SIZE_USD * 0.7,
                "reason": f"Max single loss ${max_loss:.2f} too large — reduce position size",
            }

        # Channel weight suggestions
        suggestions["channel_weights"] = {
            "current": self.config.CHANNEL_WEIGHTS,
            "suggested": self.get_adapted_weights(),
            "channel_accuracy": self.channel_accuracy,
        }

        return suggestions

    # ─── PERFORMANCE REPORT ─────────────────────────────────

    def generate_report(self) -> dict:
        """Generate comprehensive performance report."""
        if not self.trade_outcomes:
            return {"message": "No trades recorded"}

        outcomes = self.trade_outcomes
        pnls = [t["pnl"] for t in outcomes]
        wins = [t for t in outcomes if t["won"]]
        losses = [t for t in outcomes if not t["won"]]

        # Sharpe ratio (annualized, assuming 15-min intervals)
        if len(pnls) > 1 and np.std(pnls) > 0:
            sharpe = np.mean(pnls) / np.std(pnls) * np.sqrt(365 * 24 * 4)  # 4 trades/hour potential
        else:
            sharpe = 0

        # Profit factor
        gross_profit = sum(t["pnl"] for t in wins) if wins else 0
        gross_loss = abs(sum(t["pnl"] for t in losses)) if losses else 1

        # Streaks
        current_streak = 0
        max_win_streak = 0
        max_loss_streak = 0
        temp_streak = 0

        for t in outcomes:
            if t["won"]:
                if temp_streak > 0:
                    temp_streak += 1
                else:
                    temp_streak = 1
                max_win_streak = max(max_win_streak, temp_streak)
            else:
                if temp_streak < 0:
                    temp_streak -= 1
                else:
                    temp_streak = -1
                max_loss_streak = max(max_loss_streak, abs(temp_streak))

        return {
            "total_trades": len(outcomes),
            "wins": len(wins),
            "losses": len(losses),
            "win_rate": len(wins) / len(outcomes) if outcomes else 0,
            "total_pnl": round(sum(pnls), 2),
            "avg_pnl": round(np.mean(pnls), 2),
            "best_trade": round(max(pnls), 2) if pnls else 0,
            "worst_trade": round(min(pnls), 2) if pnls else 0,
            "profit_factor": round(gross_profit / gross_loss, 2) if gross_loss > 0 else 0,
            "sharpe_ratio": round(sharpe, 2),
            "max_win_streak": max_win_streak,
            "max_loss_streak": max_loss_streak,
            "channel_accuracy": self.channel_accuracy,
            "adapted_weights": self.get_adapted_weights(),
            "current_regime": self.regime_history[-1] if self.regime_history else None,
            "suggestions": self.suggest_parameters(),
        }

    # ─── PERSISTENCE ────────────────────────────────────────

    def _save_state(self):
        """Save learning state to disk."""
        state = {
            "channel_accuracy": self.channel_accuracy,
            "trade_outcomes": self.trade_outcomes[-200:],  # Keep last 200
            "regime_history": self.regime_history[-50:],
            "saved_at": datetime.now(timezone.utc).isoformat(),
        }
        path = self.data_dir / "learning_state.json"
        with open(path, "w") as f:
            json.dump(state, f, indent=2, default=str)

    def _load_state(self):
        """Load learning state from disk."""
        path = self.data_dir / "learning_state.json"
        if path.exists():
            try:
                with open(path) as f:
                    state = json.load(f)
                self.channel_accuracy = state.get("channel_accuracy", self.channel_accuracy)
                self.trade_outcomes = state.get("trade_outcomes", [])
                self.regime_history = state.get("regime_history", [])
                logger.info(f"📚 Loaded learning state: {len(self.trade_outcomes)} outcomes, {len(self.regime_history)} regimes")
            except Exception as e:
                logger.warning(f"Failed to load learning state: {e}")
