"""
PHASE 3 — Nautilus Core: The Engine Room
NautilusTrader integration — the professional trading framework backbone.

This handles:
  • Event-driven architecture (bars, ticks, custom events)
  • Custom data type for our 4-channel signal
  • Backtest engine configuration
  • Live engine configuration
  • Instrument definitions
"""

import asyncio
from decimal import Decimal
from datetime import datetime, timezone
from loguru import logger

# ═══════════════════════════════════════════════════════════════
#  NAUTILUS IMPORTS (graceful fallback if not installed)
# ═══════════════════════════════════════════════════════════════
try:
    from nautilus_trader.config import (
        TradingNodeConfig,
        LiveExecEngineConfig,
        LiveRiskEngineConfig,
        LiveDataEngineConfig,
        BacktestEngineConfig,
        BacktestRunConfig,
        BacktestVenueConfig,
        BacktestDataConfig,
        ImportableStrategyConfig,
    )
    from nautilus_trader.model.identifiers import (
        InstrumentId,
        Symbol,
        Venue,
        TraderId,
        AccountId,
    )
    from nautilus_trader.model.objects import Price, Quantity, Money
    from nautilus_trader.model.currencies import USD, USDT
    from nautilus_trader.model.enums import (
        AccountType,
        OmsType,
        OrderSide,
        TimeInForce,
        PositionSide,
    )
    from nautilus_trader.model.instruments import CurrencyPair
    from nautilus_trader.model.data import Bar, BarType, BarSpecification, BarAggregation
    from nautilus_trader.backtest.engine import BacktestEngine
    from nautilus_trader.backtest.node import BacktestNode
    from nautilus_trader.live.node import TradingNode
    from nautilus_trader.trading.strategy import Strategy
    from nautilus_trader.core.datetime import dt_to_unix_nanos

    NAUTILUS_AVAILABLE = True
    logger.info("✅ NautilusTrader loaded successfully")

except ImportError:
    NAUTILUS_AVAILABLE = False
    logger.warning("⚠️  NautilusTrader not installed — running in standalone mode")
    logger.warning("   Install: pip install nautilus_trader")


# ═══════════════════════════════════════════════════════════════
#  CUSTOM DATA TYPE: Multi-Channel Signal
# ═══════════════════════════════════════════════════════════════

class ChannelSignalData:
    """
    Custom data type that wraps our 4-channel aggregated signal.
    Compatible with NautilusTrader's event system.
    """

    def __init__(
        self,
        composite_score: float,
        direction: str,
        confidence: float,
        consensus: float,
        channel_scores: dict,
        timestamp: datetime = None,
    ):
        self.composite_score = composite_score
        self.direction = direction
        self.confidence = confidence
        self.consensus = consensus
        self.channel_scores = channel_scores
        self.timestamp = timestamp or datetime.now(timezone.utc)

    @property
    def is_actionable(self) -> bool:
        return self.direction != "neutral"

    @property
    def is_long(self) -> bool:
        return self.direction == "long"

    @property
    def is_short(self) -> bool:
        return self.direction == "short"

    def __repr__(self):
        return (
            f"ChannelSignalData(score={self.composite_score:.1f}, "
            f"dir={self.direction}, conf={self.confidence:.1f}%)"
        )


# ═══════════════════════════════════════════════════════════════
#  ENGINE FACTORY
# ═══════════════════════════════════════════════════════════════

class NautilusEngineFactory:
    """Creates and configures NautilusTrader engines for backtest or live."""

    def __init__(self, config):
        self.config = config

    # ─── INSTRUMENT ─────────────────────────────────────────

    @staticmethod
    def btc_usdt_instrument():
        """Define the BTC/USDT instrument for NautilusTrader."""
        if not NAUTILUS_AVAILABLE:
            return {
                "symbol": "BTCUSDT",
                "venue": "BINANCE",
                "base": "BTC",
                "quote": "USDT",
                "price_precision": 2,
                "size_precision": 5,
                "min_quantity": 0.00001,
                "tick_size": 0.01,
            }

        instrument_id = InstrumentId(Symbol("BTCUSDT"), Venue("BINANCE"))
        return instrument_id

    # ─── BACKTEST ENGINE ────────────────────────────────────

    def create_backtest_engine(self, data_path: str = None):
        """
        Create a NautilusTrader backtest engine for BTC 15m strategy.
        Can replay historical data with our signal overlays.
        """
        if not NAUTILUS_AVAILABLE:
            logger.warning("NautilusTrader not available — using standalone backtest")
            return StandaloneBacktestEngine(self.config)

        venue_config = BacktestVenueConfig(
            name="BINANCE",
            oms_type=OmsType.NETTING,
            account_type=AccountType.MARGIN,
            base_currency=None,
            starting_balances=["10000 USDT"],
        )

        engine_config = BacktestEngineConfig(
            trader_id=TraderId("NEXXORE-BTC15M"),
        )

        engine = BacktestEngine(config=engine_config)
        engine.add_venue(
            venue=Venue("BINANCE"),
            oms_type=OmsType.NETTING,
            account_type=AccountType.MARGIN,
            starting_balances=[Money(Decimal("10000"), USDT)],
        )

        logger.info("🏗️  NautilusTrader backtest engine created")
        return engine

    # ─── LIVE ENGINE ────────────────────────────────────────

    def create_live_config(self):
        """
        Create live trading node config.
        In our case, we don't connect Nautilus directly to an exchange —
        we use it as the strategy engine and execute on Polymarket via Phase 5.
        """
        if not NAUTILUS_AVAILABLE:
            logger.warning("NautilusTrader not available — using standalone live engine")
            return StandaloneLiveEngine(self.config)

        config = TradingNodeConfig(
            trader_id="NEXXORE-BTC15M-001",
            data_engine=LiveDataEngineConfig(
                time_bars_build_with_no_updates=True,
                time_bars_timestamp_on_close=True,
            ),
            risk_engine=LiveRiskEngineConfig(
                max_order_submit_rate="20/00:00:01",
                max_notional_per_order={"USDT": Decimal("1000")},
            ),
            exec_engine=LiveExecEngineConfig(
                reconciliation=True,
            ),
        )

        logger.info("🏗️  NautilusTrader live config created")
        return config


# ═══════════════════════════════════════════════════════════════
#  STANDALONE ENGINES (when NautilusTrader isn't installed)
# ═══════════════════════════════════════════════════════════════

class StandaloneBacktestEngine:
    """Minimal backtest engine that works without NautilusTrader."""

    def __init__(self, config):
        self.config = config
        self.trades = []
        self.equity_curve = []
        self.capital = config.INITIAL_CAPITAL

    def run(self, signals: list, prices: list) -> dict:
        """
        Simple backtest: replay signals and prices.
        signals = [{ direction, confidence, timestamp }, ...]
        prices = [{ open, high, low, close, timestamp }, ...]
        """
        capital = self.capital
        peak = capital
        max_dd = 0
        wins = 0
        losses = 0

        for i, (signal, price) in enumerate(zip(signals, prices)):
            if not signal.get("actionable"):
                continue

            direction = signal["direction"]
            entry = price["close"]
            confidence = signal["confidence"]

            # Position size: confidence-scaled, capped
            size_pct = min(confidence / 100 * 0.1, self.config.MAX_POSITION_SIZE_USD / capital)
            position_size = capital * size_pct

            # Simulate next candle outcome
            if i + 1 < len(prices):
                next_price = prices[i + 1]
                if direction == "long":
                    pnl_pct = (next_price["close"] - entry) / entry
                else:
                    pnl_pct = (entry - next_price["close"]) / entry

                pnl_usd = position_size * pnl_pct
                capital += pnl_usd

                if pnl_usd > 0:
                    wins += 1
                else:
                    losses += 1

                self.trades.append({
                    "entry": entry,
                    "exit": next_price["close"],
                    "direction": direction,
                    "pnl": pnl_usd,
                    "capital_after": capital,
                })

                peak = max(peak, capital)
                dd = (peak - capital) / peak
                max_dd = max(max_dd, dd)

                self.equity_curve.append(capital)

        total = wins + losses
        return {
            "total_trades": total,
            "wins": wins,
            "losses": losses,
            "win_rate": wins / total if total > 0 else 0,
            "final_capital": round(capital, 2),
            "pnl": round(capital - self.config.INITIAL_CAPITAL, 2),
            "pnl_pct": round((capital - self.config.INITIAL_CAPITAL) / self.config.INITIAL_CAPITAL * 100, 2),
            "max_drawdown": round(max_dd * 100, 2),
            "equity_curve": self.equity_curve,
            "trades": self.trades,
        }


class StandaloneLiveEngine:
    """Minimal live engine wrapper for standalone mode."""

    def __init__(self, config):
        self.config = config
        self.running = False

    def start(self):
        self.running = True
        logger.info("🟢 Standalone live engine started")

    def stop(self):
        self.running = False
        logger.info("🔴 Standalone live engine stopped")
