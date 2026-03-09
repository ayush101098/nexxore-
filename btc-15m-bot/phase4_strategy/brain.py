"""
PHASE 4 — Strategy Brain: The Intelligence
This is where the bot THINKS about data and DECIDES what to do.

Decision flow:
  1. Receive aggregated signal from Phase 2
  2. Apply 70% threshold — only trade when confident
  3. Calculate position size using modified Kelly criterion
  4. Determine entry, stop-loss, take-profit levels
  5. Pass decision to Phase 5 (execution)
"""

import asyncio
import time
from datetime import datetime, timezone, timedelta
from loguru import logger

from phase3_nautilus import ChannelSignalData


class StrategyBrain:
    """
    BTC 15-Minute Up/Down Strategy.
    If signals > 70% in one direction → take position.
    """

    def __init__(self, config):
        self.config = config
        self.position = None  # current open position
        self.daily_trades = 0
        self.daily_pnl = 0.0
        self.last_trade_time = None
        self.capital = config.INITIAL_CAPITAL
        self.peak_capital = config.INITIAL_CAPITAL
        self.trade_log = []
        self._cooldown_until = 0  # timestamp

    # ─── MAIN DECISION ──────────────────────────────────────

    async def evaluate(self, signal: dict, current_price: float) -> dict:
        """
        Core decision function. Takes aggregated signal → returns trade decision.

        Returns:
          { action: 'buy'|'sell'|'hold', direction: 'long'|'short',
            size_usd: float, confidence: float, reasons: [...] }
        """
        decision = {
            "action": "hold",
            "direction": None,
            "size_usd": 0,
            "confidence": 0,
            "entry_price": current_price,
            "stop_loss": None,
            "take_profit": None,
            "reasons": [],
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

        # ── Pre-flight checks ───────────────────────────────
        if not self._preflight_checks(decision):
            return decision

        # ── Check if signal is actionable (>70% threshold) ──
        score = signal.get("composite_score", 50)
        direction = signal.get("direction", "neutral")
        confidence = signal.get("confidence", 50)
        consensus = signal.get("consensus", 0)

        if direction == "neutral":
            decision["reasons"].append(f"Score {score:.1f} below threshold {self.config.SIGNAL_THRESHOLD}")
            return decision

        if score < self.config.SIGNAL_THRESHOLD and score > (100 - self.config.SIGNAL_THRESHOLD):
            decision["reasons"].append(f"Score {score:.1f} in neutral zone")
            return decision

        # ── Check if we already have a position ─────────────
        if self.position:
            return self._manage_existing_position(signal, current_price, decision)

        # ── Calculate position size (Quarter-Kelly) ─────────
        size_usd = self._calculate_position_size(confidence, consensus)
        if size_usd < 10:
            decision["reasons"].append(f"Position size ${size_usd:.2f} too small")
            return decision

        # ── Set entry, SL, TP ───────────────────────────────
        sl, tp = self._calculate_levels(direction, current_price, confidence)

        # ── Build trade decision ────────────────────────────
        decision["action"] = "buy" if direction == "long" else "sell"
        decision["direction"] = direction
        decision["size_usd"] = round(size_usd, 2)
        decision["confidence"] = round(confidence, 1)
        decision["entry_price"] = current_price
        decision["stop_loss"] = round(sl, 2)
        decision["take_profit"] = round(tp, 2)
        decision["reasons"] = [
            f"Score={score:.1f} > threshold={self.config.SIGNAL_THRESHOLD}",
            f"Direction={direction}, consensus={consensus:.0%}",
            f"Channels: {signal.get('long_votes', 0)}L / {signal.get('short_votes', 0)}S",
            f"Trend: {signal.get('trend', 'n/a')}",
            f"Size: ${size_usd:.2f} ({size_usd/self.capital*100:.1f}% of capital)",
        ]

        # ── Channel breakdown ───────────────────────────────
        channels = signal.get("channels", {})
        for name, ch in channels.items():
            ch_score = ch.get("score", 50)
            ch_dir = ch.get("direction", "neutral")
            decision["reasons"].append(f"  {name}: {ch_score:.0f}/100 ({ch_dir})")

        logger.info(
            f"🧠 DECISION: {decision['action'].upper()} {direction.upper()} "
            f"${size_usd:.2f} @ ${current_price:,.2f} "
            f"| SL=${sl:,.2f} TP=${tp:,.2f} | conf={confidence:.1f}%"
        )

        return decision

    # ─── POSITION SIZING ────────────────────────────────────

    def _calculate_position_size(self, confidence: float, consensus: float) -> float:
        """
        Modified Quarter-Kelly criterion.
        f* = (p*b - q) / b, then take 25% of that.
        p = estimated win probability (confidence / 100)
        b = reward/risk ratio (estimated at 1.5 for 15m)
        q = 1 - p
        """
        p = confidence / 100
        q = 1 - p
        b = 1.5  # target R:R

        kelly = (p * b - q) / b if b > 0 else 0
        quarter_kelly = kelly * self.config.KELLY_FRACTION

        # Scale by capital
        raw_size = self.capital * max(quarter_kelly, 0)

        # Cap at max position size
        size = min(raw_size, self.config.MAX_POSITION_SIZE_USD)

        # Consensus multiplier: 4/4 channels → 1.2x, 3/4 → 1.0x, 2/4 → 0.7x
        if consensus >= 1.0:
            size *= 1.2
        elif consensus >= 0.75:
            size *= 1.0
        elif consensus >= 0.5:
            size *= 0.7
        else:
            size *= 0.4

        # Ensure we leave a buffer
        max_allowed = self.capital * 0.15  # never risk more than 15% on one trade
        size = min(size, max_allowed)

        return max(size, 0)

    # ─── ENTRY / SL / TP ───────────────────────────────────

    def _calculate_levels(self, direction: str, price: float, confidence: float) -> tuple:
        """
        Calculate stop-loss and take-profit for a 15-minute BTC trade.
        Tighter levels for lower timeframes.
        """
        # For 15m BTC: typical move is 0.2-0.5%
        # SL: 0.3% from entry, TP: 0.5% (1.67 R:R minimum)
        # Scale TP with confidence

        base_sl_pct = 0.003  # 0.3%
        base_tp_pct = 0.005  # 0.5%

        # Higher confidence → wider TP target
        tp_multiplier = 1.0 + (confidence - 70) / 100  # 70%→1.0, 90%→1.2

        if direction == "long":
            sl = price * (1 - base_sl_pct)
            tp = price * (1 + base_tp_pct * tp_multiplier)
        else:
            sl = price * (1 + base_sl_pct)
            tp = price * (1 - base_tp_pct * tp_multiplier)

        return sl, tp

    # ─── POSITION MANAGEMENT ────────────────────────────────

    def _manage_existing_position(self, signal: dict, current_price: float, decision: dict) -> dict:
        """If we have an open position, decide whether to hold, close, or adjust."""
        pos = self.position
        direction = pos["direction"]
        entry = pos["entry_price"]
        sl = pos["stop_loss"]
        tp = pos["take_profit"]

        # Check stop-loss hit
        if direction == "long" and current_price <= sl:
            return self._close_position_decision(current_price, "stop_loss_hit", decision)
        elif direction == "short" and current_price >= sl:
            return self._close_position_decision(current_price, "stop_loss_hit", decision)

        # Check take-profit hit
        if direction == "long" and current_price >= tp:
            return self._close_position_decision(current_price, "take_profit_hit", decision)
        elif direction == "short" and current_price <= tp:
            return self._close_position_decision(current_price, "take_profit_hit", decision)

        # Check signal reversal (strong opposing signal)
        new_direction = signal.get("direction", "neutral")
        new_score = signal.get("composite_score", 50)

        if direction == "long" and new_direction == "short" and new_score <= 25:
            return self._close_position_decision(current_price, "signal_reversal", decision)
        elif direction == "short" and new_direction == "long" and new_score >= 75:
            return self._close_position_decision(current_price, "signal_reversal", decision)

        # Check max hold time (30 minutes for 15m bot)
        if pos.get("opened_at"):
            hold_time = (datetime.now(timezone.utc) - pos["opened_at"]).total_seconds()
            if hold_time > 1800:  # 30 min max hold
                return self._close_position_decision(current_price, "max_hold_time", decision)

        # Move stop to breakeven if in profit
        if direction == "long":
            pnl_pct = (current_price - entry) / entry
        else:
            pnl_pct = (entry - current_price) / entry

        if pnl_pct > 0.002:  # 0.2% in profit → move SL to entry
            self.position["stop_loss"] = entry
            decision["reasons"].append("Moved SL to breakeven")

        decision["action"] = "hold"
        decision["reasons"].append(f"Holding {direction} @ ${entry:,.2f}, PnL={pnl_pct*100:+.2f}%")
        return decision

    def _close_position_decision(self, current_price: float, reason: str, decision: dict) -> dict:
        """Generate a close-position decision."""
        pos = self.position
        direction = pos["direction"]
        entry = pos["entry_price"]

        if direction == "long":
            pnl_pct = (current_price - entry) / entry
        else:
            pnl_pct = (entry - current_price) / entry

        pnl_usd = pos["size_usd"] * pnl_pct

        decision["action"] = "close"
        decision["direction"] = direction
        decision["size_usd"] = pos["size_usd"]
        decision["pnl_usd"] = round(pnl_usd, 2)
        decision["pnl_pct"] = round(pnl_pct * 100, 2)
        decision["reasons"] = [f"Closing {direction}: {reason}, PnL=${pnl_usd:+.2f} ({pnl_pct*100:+.2f}%)"]

        logger.info(
            f"🔒 CLOSE {direction.upper()}: {reason} | "
            f"PnL=${pnl_usd:+.2f} ({pnl_pct*100:+.2f}%)"
        )

        return decision

    # ─── PRE-FLIGHT CHECKS ──────────────────────────────────

    def _preflight_checks(self, decision: dict) -> bool:
        """Safety checks before trading."""
        # Cooldown check
        if time.time() < self._cooldown_until:
            decision["reasons"].append("In cooldown period")
            return False

        # Daily trade limit
        if self.daily_trades >= self.config.MAX_DAILY_TRADES:
            decision["reasons"].append(f"Daily trade limit ({self.config.MAX_DAILY_TRADES}) reached")
            return False

        # Daily loss limit
        if self.daily_pnl <= -self.config.MAX_DAILY_LOSS_USD:
            decision["reasons"].append(f"Daily loss limit (${self.config.MAX_DAILY_LOSS_USD}) reached")
            return False

        # Max drawdown check
        dd = (self.peak_capital - self.capital) / self.peak_capital * 100
        if dd > 15:
            decision["reasons"].append(f"Max drawdown ({dd:.1f}%) exceeded")
            return False

        return True

    # ─── STATE MANAGEMENT ───────────────────────────────────

    def open_position(self, direction: str, size_usd: float, entry_price: float, sl: float, tp: float):
        """Record a new position."""
        self.position = {
            "direction": direction,
            "size_usd": size_usd,
            "entry_price": entry_price,
            "stop_loss": sl,
            "take_profit": tp,
            "opened_at": datetime.now(timezone.utc),
        }
        self.daily_trades += 1
        self.last_trade_time = datetime.now(timezone.utc)
        logger.info(f"📈 Position opened: {direction} ${size_usd:.2f} @ ${entry_price:,.2f}")

    def close_position(self, pnl_usd: float):
        """Record position close and update capital."""
        self.capital += pnl_usd
        self.daily_pnl += pnl_usd
        self.peak_capital = max(self.peak_capital, self.capital)

        self.trade_log.append({
            **self.position,
            "pnl_usd": pnl_usd,
            "closed_at": datetime.now(timezone.utc),
        })

        # Cooldown after loss
        if pnl_usd < 0:
            self._cooldown_until = time.time() + 120  # 2 min cooldown after loss

        self.position = None
        logger.info(f"💰 Position closed: PnL=${pnl_usd:+.2f}, Capital=${self.capital:,.2f}")

    def reset_daily(self):
        """Reset daily counters (call at midnight UTC)."""
        self.daily_trades = 0
        self.daily_pnl = 0.0
        logger.info("🔄 Daily counters reset")

    def get_stats(self) -> dict:
        """Return strategy statistics."""
        total = len(self.trade_log)
        wins = sum(1 for t in self.trade_log if t["pnl_usd"] > 0)
        losses = total - wins
        total_pnl = sum(t["pnl_usd"] for t in self.trade_log)

        return {
            "total_trades": total,
            "wins": wins,
            "losses": losses,
            "win_rate": wins / total if total > 0 else 0,
            "total_pnl": round(total_pnl, 2),
            "capital": round(self.capital, 2),
            "peak_capital": round(self.peak_capital, 2),
            "drawdown": round((self.peak_capital - self.capital) / self.peak_capital * 100, 2),
            "daily_trades": self.daily_trades,
            "daily_pnl": round(self.daily_pnl, 2),
            "has_position": self.position is not None,
            "position": self.position,
        }
