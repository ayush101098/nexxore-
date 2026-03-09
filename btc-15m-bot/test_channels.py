#!/usr/bin/env python3
"""
Quick test — runs one cycle to verify all 4 channels pull data correctly.
Usage: python test_channels.py
"""

import asyncio
import sys
import json
sys.path.insert(0, ".")

from loguru import logger
logger.remove()
logger.add(sys.stderr, format="<green>{time:HH:mm:ss}</green> | <level>{level: <7}</level> | <cyan>{message}</cyan>", level="INFO")

import config as cfg


async def test_channel(name, channel):
    """Test a single channel."""
    logger.info(f"\n{'─'*50}")
    logger.info(f"Testing: {name}")
    logger.info(f"{'─'*50}")

    try:
        result = await channel.get_score()
        logger.info(f"  Score:     {result['score']}")
        logger.info(f"  Direction: {result['direction']}")
        logger.info(f"  Details:")
        for key, val in result.get("details", {}).items():
            if isinstance(val, dict):
                logger.info(f"    {key}: score={val.get('score', '?')}, {val.get('detail', '')}")
            else:
                logger.info(f"    {key}: {val}")
        return result
    except Exception as e:
        logger.error(f"  ERROR: {e}")
        return None
    finally:
        await channel.close()


async def test_pipeline():
    """Test the full ingestion pipeline."""
    from phase2_ingestion import DataIngestionPipeline

    logger.info(f"\n{'═'*50}")
    logger.info(f"Testing Full Pipeline")
    logger.info(f"{'═'*50}")

    pipeline = DataIngestionPipeline(cfg)
    try:
        signal = await pipeline.ingest()
        logger.info(f"\n  COMPOSITE SCORE:  {signal['composite_score']}")
        logger.info(f"  DIRECTION:        {signal['direction']}")
        logger.info(f"  CONFIDENCE:       {signal['confidence']}%")
        logger.info(f"  CONSENSUS:        {signal['consensus']:.0%}")
        logger.info(f"  ACTIONABLE:       {signal['actionable']}")
        logger.info(f"  THRESHOLD:        {signal['threshold']}")

        logger.info(f"\n  Channel Breakdown:")
        for name, ch in signal.get("channels", {}).items():
            logger.info(f"    {name}: {ch.get('score', '?')}/100 ({ch.get('direction', '?')})")

        return signal
    finally:
        await pipeline.close()


async def test_strategy(signal, price):
    """Test strategy decision with a signal."""
    from phase4_strategy import StrategyBrain

    logger.info(f"\n{'═'*50}")
    logger.info(f"Testing Strategy Brain @ ${price:,.2f}")
    logger.info(f"{'═'*50}")

    brain = StrategyBrain(cfg)
    decision = await brain.evaluate(signal, price)

    logger.info(f"  Action:     {decision['action']}")
    logger.info(f"  Direction:  {decision.get('direction', 'N/A')}")
    logger.info(f"  Size:       ${decision.get('size_usd', 0):.2f}")
    logger.info(f"  Entry:      ${decision.get('entry_price', 0):,.2f}")
    logger.info(f"  Stop Loss:  ${decision.get('stop_loss', 0):,.2f}" if decision.get("stop_loss") else "")
    logger.info(f"  Take Profit:${decision.get('take_profit', 0):,.2f}" if decision.get("take_profit") else "")
    logger.info(f"  Reasons:")
    for r in decision.get("reasons", []):
        logger.info(f"    → {r}")

    return decision


async def main():
    logger.info("═══════════════════════════════════════════")
    logger.info("  ⚡ Nexxore BTC 15m Bot — Channel Tests")
    logger.info("═══════════════════════════════════════════")

    # Test individual channels
    from phase1_data import (
        LiquidityWhaleChannel,
        MacroSentimentChannel,
        SupplyDemandChannel,
        DerivativesChannel,
    )

    results = {}
    for name, ChannelClass in [
        ("Liquidity & Whale", LiquidityWhaleChannel),
        ("Macro Sentiment", MacroSentimentChannel),
        ("Supply & Demand", SupplyDemandChannel),
        ("Derivatives", DerivativesChannel),
    ]:
        result = await test_channel(name, ChannelClass(cfg))
        if result:
            results[name] = result

    # Test full pipeline
    signal = await test_pipeline()

    # Get BTC price and test strategy
    import aiohttp
    async with aiohttp.ClientSession() as session:
        async with session.get("https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT") as resp:
            data = await resp.json()
            price = float(data["price"])

    if signal:
        await test_strategy(signal, price)

    # Summary
    logger.info(f"\n{'═'*50}")
    logger.info(f"  ✅ ALL TESTS COMPLETE")
    logger.info(f"{'═'*50}")
    logger.info(f"  Channels tested: {len(results)}/4")
    logger.info(f"  Pipeline: {'✅' if signal else '❌'}")
    logger.info(f"  BTC Price: ${price:,.2f}")
    logger.info(f"{'═'*50}")


if __name__ == "__main__":
    asyncio.run(main())
