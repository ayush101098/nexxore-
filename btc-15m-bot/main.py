#!/usr/bin/env python3
"""
═══════════════════════════════════════════════════════════════
  Nexxore BTC 15-Minute Trading Bot
  NautilusTrader Architecture — 7-Phase System
═══════════════════════════════════════════════════════════════

  Phase 1: Data Sources       → 4 channels (eyes & ears)
  Phase 2: Ingestion Layer    → Pipeline (plumbing)
  Phase 3: Nautilus Core      → Engine (heart)
  Phase 4: Strategy Brain     → Decisions (brain)
  Phase 5: Execution Layer    → Polymarket trades (hands)
  Phase 6: Monitoring         → Dashboard (control panel)
  Phase 7: Learning Engine    → Adaptation (memory)

  Usage:
    python main.py                  # Start bot (paper mode)
    python main.py --live           # Start bot (live mode)
    python main.py --test           # Run one scan cycle
    python main.py --backtest       # Run backtest on history
    python main.py --report         # Show performance report
"""

import asyncio
import signal
import sys
from datetime import datetime, timezone
from loguru import logger

# Configure logging
logger.remove()
logger.add(
    sys.stderr,
    format="<green>{time:HH:mm:ss}</green> | <level>{level: <7}</level> | <cyan>{message}</cyan>",
    level="INFO",
)
logger.add(
    "logs/bot_{time:YYYY-MM-DD}.log",
    rotation="1 day",
    retention="30 days",
    level="DEBUG",
)

import config as cfg
from phase2_ingestion import DataIngestionPipeline
from phase3_nautilus import NautilusEngineFactory, ChannelSignalData
from phase4_strategy import StrategyBrain
from phase5_execution import ExecutionLayer
from phase6_monitoring import MonitoringDashboard
from phase7_learning import LearningEngine


class NexxoreBot:
    """
    Main orchestrator — ties all 7 phases together.
    Runs on a 15-minute loop: scan → decide → execute → learn.
    """

    def __init__(self):
        self.running = False
        self.cycle_count = 0

        # Initialize all phases
        logger.info("═══════════════════════════════════════════")
        logger.info("  ⚡ Nexxore BTC 15m Bot — Initializing")
        logger.info("═══════════════════════════════════════════")

        self.pipeline = DataIngestionPipeline(cfg)       # Phase 1+2
        self.engine = NautilusEngineFactory(cfg)          # Phase 3
        self.strategy = StrategyBrain(cfg)                # Phase 4
        self.executor = ExecutionLayer(cfg)               # Phase 5
        self.dashboard = MonitoringDashboard(             # Phase 6
            cfg, self.strategy, self.pipeline, self.executor
        )
        self.learner = LearningEngine(cfg)                # Phase 7

        logger.info(f"  Mode: {cfg.MODE.upper()}")
        logger.info(f"  Capital: ${cfg.INITIAL_CAPITAL:,.2f}")
        logger.info(f"  Threshold: {cfg.SIGNAL_THRESHOLD}%")
        logger.info(f"  Scan interval: {cfg.SCAN_INTERVAL_SECONDS}s")
        logger.info("═══════════════════════════════════════════")

    async def start(self):
        """Start the bot."""
        await self.executor.initialize()

        # Find BTC market on Polymarket
        market = await self.executor.find_btc_market()
        if market:
            logger.info(f"🎯 BTC Market: {market.get('title') or market.get('question', 'Found')}")
        else:
            logger.warning("⚠️  No BTC 15-min market found — will retry each cycle")

        self.running = True

        # Start dashboard in background
        dashboard_task = asyncio.create_task(self.dashboard.start())

        # Main trading loop
        logger.info("🟢 Bot started — entering main loop")
        try:
            while self.running:
                await self._run_cycle()
                await asyncio.sleep(cfg.SCAN_INTERVAL_SECONDS)
        except asyncio.CancelledError:
            logger.info("Bot cancelled")
        finally:
            await self.shutdown()

    async def _run_cycle(self):
        """One complete scan → decide → execute cycle."""
        self.cycle_count += 1
        logger.info(f"\n{'─'*50}")
        logger.info(f"🔄 Cycle #{self.cycle_count} — {datetime.now(timezone.utc).strftime('%H:%M:%S UTC')}")
        logger.info(f"{'─'*50}")

        try:
            # ── PHASE 1+2: Gather & aggregate signal ────────
            signal_data = await self.pipeline.ingest()
            self.dashboard.record_signal(signal_data)

            # ── PHASE 7: Check regime & adapt weights ───────
            history = self.pipeline.get_history()
            regime = self.learner.detect_regime(
                [{"composite_score": h["score"], "direction": h["direction"]} for h in history]
            )
            logger.info(f"📊 Market regime: {regime}")

            # Adapt weights if we have enough data
            adapted_weights = self.learner.get_adapted_weights()
            if adapted_weights != cfg.CHANNEL_WEIGHTS:
                logger.info(f"📚 Using adapted weights: {adapted_weights}")

            # ── PHASE 5: Get current price ──────────────────
            btc_price = await self.executor.get_btc_price()
            if btc_price == 0:
                logger.error("❌ Cannot get BTC price — skipping cycle")
                return

            logger.info(f"💲 BTC Price: ${btc_price:,.2f}")

            # ── PHASE 4: Strategy decision ──────────────────
            decision = await self.strategy.evaluate(signal_data, btc_price)
            logger.info(f"🧠 Decision: {decision['action'].upper()} | Reasons:")
            for reason in decision.get("reasons", []):
                logger.info(f"   → {reason}")

            # ── PHASE 5: Execute ────────────────────────────
            if decision["action"] in ("buy", "sell"):
                result = await self.executor.execute(decision)
                logger.info(f"✅ Execution: {result.get('status', 'unknown')}")

                if result.get("status") == "filled":
                    self.strategy.open_position(
                        direction=decision["direction"],
                        size_usd=decision["size_usd"],
                        entry_price=btc_price,
                        sl=decision["stop_loss"],
                        tp=decision["take_profit"],
                    )

            elif decision["action"] == "close":
                result = await self.executor.execute(decision)
                pnl = decision.get("pnl_usd", 0)
                self.strategy.close_position(pnl)

                # ── PHASE 7: Learn from outcome ─────────────
                self.learner.record_trade_outcome(signal_data, pnl, decision["direction"])

            elif decision["action"] == "hold":
                logger.info("⏸️  Holding — no action needed")

            # ── Daily reset check ───────────────────────────
            now = datetime.now(timezone.utc)
            if now.hour == 0 and now.minute < 15:
                self.strategy.reset_daily()

        except Exception as e:
            logger.error(f"❌ Cycle error: {e}")
            import traceback
            logger.debug(traceback.format_exc())

    async def run_single_test(self):
        """Run one cycle for testing."""
        await self.executor.initialize()
        await self._run_cycle()
        await self.shutdown()

    async def run_backtest(self):
        """Run backtest using standalone engine."""
        engine = self.engine.create_backtest_engine()
        logger.info("🔬 Backtest engine created — running...")

        # Collect historical signals (simulate 24h of data)
        signals = []
        prices = []

        # Fetch historical candles
        import aiohttp
        async with aiohttp.ClientSession() as session:
            url = f"{cfg.BINANCE_REST}/api/v3/klines"
            params = {"symbol": "BTCUSDT", "interval": "15m", "limit": 96}
            async with session.get(url, params=params) as resp:
                if resp.status == 200:
                    klines = await resp.json()
                    for k in klines:
                        prices.append({
                            "open": float(k[1]),
                            "high": float(k[2]),
                            "low": float(k[3]),
                            "close": float(k[4]),
                            "volume": float(k[5]),
                        })

        # Run pipeline for each candle (simplified — uses current data)
        for i in range(min(10, len(prices))):
            signal = await self.pipeline.ingest()
            signals.append(signal)
            await asyncio.sleep(0.5)

        # Backtest
        if hasattr(engine, 'run'):
            result = engine.run(signals, prices[:len(signals)])
            logger.info(f"\n{'═'*50}")
            logger.info(f"  📊 BACKTEST RESULTS")
            logger.info(f"{'═'*50}")
            logger.info(f"  Trades:     {result['total_trades']}")
            logger.info(f"  Win Rate:   {result['win_rate']:.1%}")
            logger.info(f"  PnL:        ${result['pnl']:+.2f} ({result['pnl_pct']:+.1f}%)")
            logger.info(f"  Max DD:     {result['max_drawdown']:.1f}%")
            logger.info(f"  Final Cap:  ${result['final_capital']:,.2f}")
            logger.info(f"{'═'*50}")
        else:
            logger.info("Backtest engine does not support run() — use NautilusTrader for full backtest")

        await self.pipeline.close()

    def show_report(self):
        """Display learning engine report."""
        report = self.learner.generate_report()
        logger.info(f"\n{'═'*50}")
        logger.info(f"  📊 PERFORMANCE REPORT")
        logger.info(f"{'═'*50}")
        for key, value in report.items():
            if isinstance(value, dict):
                logger.info(f"  {key}:")
                for k, v in value.items():
                    logger.info(f"    {k}: {v}")
            else:
                logger.info(f"  {key}: {value}")
        logger.info(f"{'═'*50}")

    async def shutdown(self):
        """Cleanup."""
        self.running = False
        await self.pipeline.close()
        await self.executor.close()
        logger.info("🔴 Bot shutdown complete")


# ═══════════════════════════════════════════════════════════════
#  ENTRY POINT
# ═══════════════════════════════════════════════════════════════

async def main():
    bot = NexxoreBot()

    # Handle CLI args
    if "--live" in sys.argv:
        cfg.MODE = "live"
        logger.warning("🔴 LIVE MODE — Real money at risk!")

    if "--test" in sys.argv:
        await bot.run_single_test()
    elif "--backtest" in sys.argv:
        await bot.run_backtest()
    elif "--report" in sys.argv:
        bot.show_report()
    else:
        # Normal operation — handle graceful shutdown
        loop = asyncio.get_event_loop()

        def handle_signal(sig):
            logger.info(f"Received {sig.name} — shutting down...")
            bot.running = False

        for s in (signal.SIGINT, signal.SIGTERM):
            loop.add_signal_handler(s, handle_signal, s)

        await bot.start()


if __name__ == "__main__":
    asyncio.run(main())
