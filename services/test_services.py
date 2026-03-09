"""
Nexxore Services - Test Script
================================
Quick validation that both services can import and basic models work.

Run: python services/test_services.py
"""

import sys
import os
import time
import json

# Add project root
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

def test_market_data_models():
    """Test market-data service models."""
    print("\n=== Testing Market Data Models ===")
    
    from services_market_data.models import PairData, TopMover, MarketEvent
    
    # Test PairData.from_dexscreener with realistic data
    raw = {
        "chainId": "solana",
        "dexId": "raydium",
        "pairAddress": "58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2",
        "url": "https://dexscreener.com/solana/58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2",
        "baseToken": {
            "address": "So11111111111111111111111111111111111111112",
            "name": "Wrapped SOL",
            "symbol": "SOL",
        },
        "quoteToken": {
            "address": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
            "name": "USD Coin",
            "symbol": "USDC",
        },
        "priceNative": "1.00",
        "priceUsd": "168.42",
        "txns": {
            "m5": {"buys": 145, "sells": 98},
            "h1": {"buys": 2340, "sells": 1890},
            "h24": {"buys": 45000, "sells": 41000},
        },
        "volume": {"m5": 234567, "h1": 4567890, "h6": 28000000, "h24": 112000000},
        "priceChange": {"m5": 1.2, "h1": 3.5, "h6": -0.8, "h24": 5.2},
        "liquidity": {"usd": 89000000, "base": 265000, "quote": 44500000},
        "fdv": 82000000000,
        "marketCap": 73000000000,
        "pairCreatedAt": 1640000000000,
        "boosts": {"active": 3},
    }
    
    pair = PairData.from_dexscreener(raw)
    assert pair.chain_id == "solana"
    assert pair.base_token_symbol == "SOL"
    assert pair.price_usd == 168.42
    assert pair.volume_24h == 112000000
    assert pair.liquidity_usd == 89000000
    assert pair.txns_5m == 243
    assert pair.buy_pressure_5m > 0.5
    
    # Test serialization
    d = pair.to_dict()
    assert isinstance(d, dict)
    assert d["chain_id"] == "solana"
    
    # Test TopMover
    mover = TopMover.from_pair(pair)
    assert mover.token_symbol == "SOL"
    assert mover.volume_24h == 112000000
    
    # Test MarketEvent
    event = MarketEvent(event_type="volume_spike", pair=pair, metadata={"multiplier": 3.5})
    ed = event.to_dict()
    assert ed["event_type"] == "volume_spike"
    
    print("  [PASS] PairData.from_dexscreener")
    print("  [PASS] PairData.to_dict")
    print("  [PASS] TopMover.from_pair")
    print("  [PASS] MarketEvent")
    print(f"  [PASS] Properties: txns_5m={pair.txns_5m}, buy_pressure={pair.buy_pressure_5m:.2f}")


def test_signal_engine_models():
    """Test signal engine models."""
    print("\n=== Testing Signal Engine Models ===")
    
    from services_signal_engine.models import Signal, ScoredToken, PairSnapshot
    
    # Test Signal
    signal = Signal(
        signal_type="momentum_spike",
        token_symbol="SOL",
        token_address="So11111111111111111111111111111111111111112",
        chain_id="solana",
        pair_address="58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2",
        strength=78.5,
        metadata={"price_change_5m": 8.2, "volume_ratio": 3.5},
        price_usd=168.42,
    )
    assert signal.signal_type == "momentum_spike"
    assert signal.strength == 78.5
    
    sd = signal.to_dict()
    assert isinstance(sd, dict)
    
    # Test ScoredToken
    scored = ScoredToken(
        token_symbol="SOL",
        token_address="So11111111111111111111111111111111111111112",
        chain_id="solana",
        pair_address="58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2",
        total_score=82.5,
        classification="strong_trade",
        momentum_score=35.0,
        volume_score=25.0,
        liquidity_score=15.0,
        new_pair_score=7.5,
        signals=[signal],
    )
    assert scored.total_score == 82.5
    assert scored.classification == "strong_trade"
    
    # Test PairSnapshot.from_market_data
    snap = PairSnapshot.from_market_data({
        "pair_address": "test123",
        "chain_id": "solana",
        "base_token_symbol": "TEST",
        "base_token_address": "addr123",
        "price_usd": 1.23,
        "volume_5m": 50000,
        "volume_1h": 500000,
        "volume_24h": 5000000,
        "liquidity_usd": 1000000,
    })
    assert snap.pair_address == "test123"
    assert snap.volume_1h == 500000
    
    print("  [PASS] Signal creation + serialization")
    print("  [PASS] ScoredToken creation + classification")
    print("  [PASS] PairSnapshot.from_market_data")


def test_config():
    """Test configuration loading."""
    print("\n=== Testing Configuration ===")
    
    from services_market_data.config import config
    assert config.dexscreener.base_url == "https://api.dexscreener.com"
    assert config.cache.ttl_top_movers == 10
    assert config.poller.poll_interval == 10
    print("  [PASS] Market data config")
    
    from services_signal_engine.config import engine_config
    assert engine_config.thresholds.momentum_price_change_5m == 5.0
    assert engine_config.scoring.momentum == 40.0
    assert engine_config.scoring.volume == 30.0
    assert engine_config.scoring.liquidity == 20.0
    assert engine_config.scoring.new_pair == 10.0
    print("  [PASS] Signal engine config")
    print(f"  [PASS] Scoring weights sum = {engine_config.scoring.momentum + engine_config.scoring.volume + engine_config.scoring.liquidity + engine_config.scoring.new_pair}")


def test_signal_detectors():
    """Test signal detection logic with synthetic data."""
    print("\n=== Testing Signal Detectors ===")
    
    from services_signal_engine.models import PairSnapshot
    from services_signal_engine.pipeline.data_pipeline import RollingWindow
    from services_signal_engine.signals.momentum import detect_momentum_spike
    from services_signal_engine.signals.volume import detect_volume_breakout
    from services_signal_engine.signals.new_pair import detect_new_pair
    
    # Create a rolling window with history
    window = RollingWindow()
    
    # Add some historical snapshots
    for i in range(5):
        window.add(PairSnapshot(
            pair_address="pair1",
            chain_id="solana",
            token_symbol="TEST",
            token_address="addr1",
            price_usd=100.0 + i,
            volume_5m=10000,
            volume_1h=200000,
            volume_24h=5000000,
            liquidity_usd=1000000,
            fdv=50000000,
            price_change_5m=1.0,
            price_change_1h=2.0,
            price_change_24h=5.0,
            timestamp=time.time() - (5 - i) * 60,
        ))
    
    # Test momentum spike - should trigger
    spike_snapshot = PairSnapshot(
        pair_address="pair1",
        chain_id="solana",
        token_symbol="TEST",
        token_address="addr1",
        price_usd=115.0,
        volume_5m=50000,      # 5x average
        volume_1h=600000,
        volume_24h=5000000,
        liquidity_usd=1000000,
        fdv=50000000,
        price_change_5m=12.0,  # >5% threshold
        price_change_1h=15.0,
        price_change_24h=20.0,
        timestamp=time.time(),
    )
    
    signal = detect_momentum_spike(spike_snapshot, window)
    assert signal is not None, "Momentum spike should trigger"
    assert signal.signal_type == "momentum_spike"
    assert signal.strength > 0
    print(f"  [PASS] Momentum spike detected: strength={signal.strength:.1f}")
    
    # Test volume breakout
    vol_snapshot = PairSnapshot(
        pair_address="pair2",
        chain_id="base",
        token_symbol="PUMP",
        token_address="addr2",
        price_usd=0.05,
        volume_5m=20000,
        volume_1h=500000,     # Well above 24h/24 average
        volume_24h=1000000,
        liquidity_usd=200000,
        fdv=5000000,
        price_change_5m=3.0,
        price_change_1h=8.0,
        price_change_24h=15.0,
        txns_1h_buys=150,
        txns_1h_sells=80,
        timestamp=time.time(),
    )
    
    vol_window = RollingWindow()
    vol_signal = detect_volume_breakout(vol_snapshot, vol_window)
    assert vol_signal is not None, "Volume breakout should trigger"
    assert vol_signal.signal_type == "volume_breakout"
    print(f"  [PASS] Volume breakout detected: strength={vol_signal.strength:.1f}")
    
    # Test new pair detection
    new_snapshot = PairSnapshot(
        pair_address="pair3",
        chain_id="solana",
        token_symbol="NEW",
        token_address="addr3",
        price_usd=0.001,
        volume_5m=5000,
        volume_1h=50000,
        volume_24h=200000,
        liquidity_usd=500000,
        fdv=2000000,
        price_change_5m=2.0,
        price_change_1h=10.0,
        price_change_24h=0,
        pair_created_at=int((time.time() - 3600) * 1000),  # 1 hour ago
        timestamp=time.time(),
    )
    
    new_window = RollingWindow()
    new_signal = detect_new_pair(new_snapshot, new_window)
    assert new_signal is not None, "New pair should be detected"
    assert new_signal.signal_type == "new_pair"
    print(f"  [PASS] New pair detected: strength={new_signal.strength:.1f}")


if __name__ == "__main__":
    # Hack imports for hyphenated directory names
    import importlib
    sys.modules["services_market_data"] = importlib.import_module("services.market-data")
    sys.modules["services_market_data.models"] = importlib.import_module("services.market-data.models")
    sys.modules["services_market_data.config"] = importlib.import_module("services.market-data.config")
    sys.modules["services_signal_engine"] = importlib.import_module("services.signal-engine")
    sys.modules["services_signal_engine.models"] = importlib.import_module("services.signal-engine.models")
    sys.modules["services_signal_engine.config"] = importlib.import_module("services.signal-engine.config")
    sys.modules["services_signal_engine.pipeline"] = importlib.import_module("services.signal-engine.pipeline")
    sys.modules["services_signal_engine.pipeline.data_pipeline"] = importlib.import_module("services.signal-engine.pipeline.data_pipeline")
    sys.modules["services_signal_engine.signals"] = importlib.import_module("services.signal-engine.signals")
    sys.modules["services_signal_engine.signals.momentum"] = importlib.import_module("services.signal-engine.signals.momentum")
    sys.modules["services_signal_engine.signals.volume"] = importlib.import_module("services.signal-engine.signals.volume")
    sys.modules["services_signal_engine.signals.new_pair"] = importlib.import_module("services.signal-engine.signals.new_pair")
    
    print("=" * 60)
    print("  Nexxore Services - Integration Test")
    print("=" * 60)
    
    tests = [
        test_config,
        test_market_data_models,
        test_signal_engine_models,
        test_signal_detectors,
    ]
    
    passed = 0
    failed = 0
    
    for test in tests:
        try:
            test()
            passed += 1
        except Exception as e:
            print(f"\n  [FAIL] {test.__name__}: {e}")
            import traceback
            traceback.print_exc()
            failed += 1
    
    print("\n" + "=" * 60)
    print(f"  Results: {passed} passed, {failed} failed")
    print("=" * 60)
    
    sys.exit(1 if failed > 0 else 0)
