#!/usr/bin/env python3
"""
Simplified Standalone Research Bot
Works without Docker, PostgreSQL, or Redis
Stores data in local JSON files

Run: python3 run_simple.py
"""

import asyncio
import aiohttp
import ssl
import certifi
import json
import os
from datetime import datetime, timezone, timedelta
from typing import Dict, List, Any, Optional
from dataclasses import dataclass, asdict
from pathlib import Path
import logging

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger('ResearchBot')


# =============================================================================
# DATA STORAGE (Local JSON files instead of PostgreSQL)
# =============================================================================

class LocalStorage:
    """Simple file-based storage"""
    
    def __init__(self, data_dir: str = "./data"):
        self.data_dir = Path(data_dir)
        self.data_dir.mkdir(exist_ok=True)
        
    def save(self, category: str, data: Dict):
        """Save data to JSON file"""
        filepath = self.data_dir / f"{category}.json"
        
        # Load existing data
        existing = self.load(category)
        
        # Merge/append new data
        if isinstance(existing, dict):
            existing.update(data)
        elif isinstance(existing, list):
            if isinstance(data, list):
                existing.extend(data)
            else:
                existing.append(data)
        else:
            existing = data
        
        # Save
        with open(filepath, 'w') as f:
            json.dump(existing, f, indent=2, default=str)
        
    def load(self, category: str) -> Any:
        """Load data from JSON file"""
        filepath = self.data_dir / f"{category}.json"
        if filepath.exists():
            with open(filepath, 'r') as f:
                return json.load(f)
        return {}


# =============================================================================
# HTTP CLIENT
# =============================================================================

class HTTPClient:
    """Async HTTP client with SSL handling"""
    
    def __init__(self):
        self._session: Optional[aiohttp.ClientSession] = None
        
    async def get_session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            ssl_context = ssl.create_default_context(cafile=certifi.where())
            connector = aiohttp.TCPConnector(ssl=ssl_context)
            timeout = aiohttp.ClientTimeout(total=30, connect=10)
            self._session = aiohttp.ClientSession(
                timeout=timeout,
                connector=connector,
                headers={'User-Agent': 'ResearchBot/1.0', 'Accept': 'application/json'}
            )
        return self._session
    
    async def get(self, url: str, params: Dict = None) -> Dict:
        session = await self.get_session()
        try:
            async with session.get(url, params=params) as response:
                if response.status == 200:
                    return await response.json()
                else:
                    logger.error(f"HTTP {response.status} for {url}")
                    return {}
        except Exception as e:
            logger.error(f"Error fetching {url}: {e}")
            return {}
    
    async def close(self):
        if self._session and not self._session.closed:
            await self._session.close()


# =============================================================================
# DATA COLLECTORS
# =============================================================================

@dataclass
class MarketData:
    symbol: str
    price: float
    change_24h: float
    volume_24h: float
    high_24h: float
    low_24h: float
    timestamp: str


@dataclass 
class FuturesData:
    symbol: str
    funding_rate: float
    open_interest: float
    long_short_ratio: float
    mark_price: float
    timestamp: str


@dataclass
class OnChainData:
    chain: str
    tvl: float
    tvl_change_24h: float
    timestamp: str


@dataclass
class SentimentData:
    fear_greed_value: int
    fear_greed_label: str
    timestamp: str


@dataclass
class TradeSetup:
    symbol: str
    direction: str  # LONG or SHORT
    confidence: float
    entry_price: float
    stop_loss: float
    target_1: float
    target_2: float
    risk_reward: float
    supporting_factors: List[str]
    timestamp: str


class MarketCollector:
    """Collect market data from Binance"""
    
    SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 
               'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT', 'DOTUSDT', 'LINKUSDT']
    
    def __init__(self, client: HTTPClient):
        self.client = client
        
    async def collect(self) -> List[MarketData]:
        """Collect current market data"""
        logger.info("📊 Collecting market data...")
        results = []
        
        for symbol in self.SYMBOLS:
            try:
                url = "https://api.binance.com/api/v3/ticker/24hr"
                data = await self.client.get(url, {'symbol': symbol})
                
                if data:
                    results.append(MarketData(
                        symbol=symbol,
                        price=float(data.get('lastPrice', 0)),
                        change_24h=float(data.get('priceChangePercent', 0)),
                        volume_24h=float(data.get('quoteVolume', 0)),
                        high_24h=float(data.get('highPrice', 0)),
                        low_24h=float(data.get('lowPrice', 0)),
                        timestamp=datetime.now(timezone.utc).isoformat()
                    ))
                    logger.info(f"  ✅ {symbol}: ${float(data['lastPrice']):,.2f} ({data['priceChangePercent']}%)")
                    
                await asyncio.sleep(0.1)  # Rate limit
                
            except Exception as e:
                logger.error(f"  ❌ Error collecting {symbol}: {e}")
        
        return results


class FuturesCollector:
    """Collect futures/derivatives data"""
    
    SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']
    
    def __init__(self, client: HTTPClient):
        self.client = client
        
    async def collect(self) -> List[FuturesData]:
        """Collect futures data"""
        logger.info("📈 Collecting futures data...")
        results = []
        
        for symbol in self.SYMBOLS:
            try:
                # Funding rate
                url = "https://fapi.binance.com/fapi/v1/premiumIndex"
                funding = await self.client.get(url, {'symbol': symbol})
                
                # Open interest
                url = "https://fapi.binance.com/fapi/v1/openInterest"
                oi = await self.client.get(url, {'symbol': symbol})
                
                # Long/short ratio
                url = "https://fapi.binance.com/futures/data/topLongShortPositionRatio"
                lsr = await self.client.get(url, {'symbol': symbol, 'period': '1h', 'limit': 1})
                
                if funding:
                    ls_ratio = float(lsr[0]['longShortRatio']) if lsr else 1.0
                    results.append(FuturesData(
                        symbol=symbol,
                        funding_rate=float(funding.get('lastFundingRate', 0)) * 100,
                        open_interest=float(oi.get('openInterest', 0)) if oi else 0,
                        long_short_ratio=ls_ratio,
                        mark_price=float(funding.get('markPrice', 0)),
                        timestamp=datetime.now(timezone.utc).isoformat()
                    ))
                    logger.info(f"  ✅ {symbol}: Funding={float(funding['lastFundingRate'])*100:.4f}%, L/S={ls_ratio:.2f}")
                    
                await asyncio.sleep(0.2)
                
            except Exception as e:
                logger.error(f"  ❌ Error collecting futures {symbol}: {e}")
        
        return results


class OnChainCollector:
    """Collect on-chain/DeFi data from DefiLlama"""
    
    CHAINS = ['Ethereum', 'Solana', 'BSC', 'Arbitrum', 'Base']
    
    def __init__(self, client: HTTPClient):
        self.client = client
        
    async def collect(self) -> List[OnChainData]:
        """Collect TVL data"""
        logger.info("🔗 Collecting on-chain data...")
        results = []
        
        # Get all protocols
        url = "https://api.llama.fi/v2/chains"
        chains_data = await self.client.get(url)
        
        if chains_data:
            for chain in chains_data:
                if chain.get('name') in self.CHAINS:
                    tvl = chain.get('tvl', 0)
                    change = chain.get('change_1d', 0) or 0
                    results.append(OnChainData(
                        chain=chain['name'],
                        tvl=tvl,
                        tvl_change_24h=change,
                        timestamp=datetime.now(timezone.utc).isoformat()
                    ))
                    logger.info(f"  ✅ {chain['name']}: ${tvl/1e9:.2f}B TVL ({change:+.2f}%)")
        
        return results


class SentimentCollector:
    """Collect market sentiment data"""
    
    def __init__(self, client: HTTPClient):
        self.client = client
        
    async def collect(self) -> SentimentData:
        """Collect Fear & Greed Index"""
        logger.info("😱 Collecting sentiment data...")
        
        url = "https://api.alternative.me/fng/"
        data = await self.client.get(url, {'limit': 1})
        
        if data and 'data' in data:
            fng = data['data'][0]
            result = SentimentData(
                fear_greed_value=int(fng['value']),
                fear_greed_label=fng['value_classification'],
                timestamp=datetime.now(timezone.utc).isoformat()
            )
            logger.info(f"  ✅ Fear & Greed: {result.fear_greed_value} ({result.fear_greed_label})")
            return result
        
        return SentimentData(50, "Neutral", datetime.now(timezone.utc).isoformat())


@dataclass
class NewsItem:
    title: str
    source: str
    url: str
    sentiment: str
    currencies: List[str]
    published_at: str
    

class NewsCollector:
    """Collect crypto news from multiple sources"""
    
    def __init__(self, client: HTTPClient):
        self.client = client
        
    async def collect(self) -> List[NewsItem]:
        """Collect latest crypto news from free sources"""
        logger.info("📰 Collecting news...")
        results = []
        
        # Try CoinGecko trending for hot coins (proxy for news)
        try:
            trending_url = "https://api.coingecko.com/api/v3/search/trending"
            trending = await self.client.get(trending_url)
            
            if trending and 'coins' in trending:
                for item in trending['coins'][:5]:
                    coin = item.get('item', {})
                    results.append(NewsItem(
                        title=f"🔥 {coin.get('name', '')} ({coin.get('symbol', '')}) trending - Rank #{coin.get('market_cap_rank', 'N/A')}",
                        source="CoinGecko Trending",
                        url=f"https://coingecko.com/en/coins/{coin.get('id', '')}",
                        sentiment="bullish",
                        currencies=[coin.get('symbol', '').upper()],
                        published_at=datetime.now(timezone.utc).isoformat()
                    ))
                    logger.info(f"  🔥 Trending: {coin.get('name', '')} ({coin.get('symbol', '')})")
        except Exception as e:
            logger.error(f"  ❌ Error fetching trending: {e}")
        
        # Get top gainers/losers from Binance
        try:
            url = "https://api.binance.com/api/v3/ticker/24hr"
            tickers = await self.client.get(url)
            
            if tickers:
                # Filter USDT pairs only
                usdt_pairs = [t for t in tickers if t['symbol'].endswith('USDT') and float(t.get('quoteVolume', 0)) > 10000000]
                
                # Top gainers
                gainers = sorted(usdt_pairs, key=lambda x: float(x.get('priceChangePercent', 0)), reverse=True)[:3]
                for g in gainers:
                    symbol = g['symbol'].replace('USDT', '')
                    change = float(g['priceChangePercent'])
                    results.append(NewsItem(
                        title=f"🚀 {symbol} pumping +{change:.1f}% in 24h",
                        source="Binance 24h",
                        url=f"https://binance.com/en/trade/{symbol}_USDT",
                        sentiment="bullish",
                        currencies=[symbol],
                        published_at=datetime.now(timezone.utc).isoformat()
                    ))
                    logger.info(f"  🚀 Top Gainer: {symbol} +{change:.1f}%")
                
                # Top losers
                losers = sorted(usdt_pairs, key=lambda x: float(x.get('priceChangePercent', 0)))[:3]
                for l in losers:
                    symbol = l['symbol'].replace('USDT', '')
                    change = float(l['priceChangePercent'])
                    results.append(NewsItem(
                        title=f"📉 {symbol} dropping {change:.1f}% in 24h",
                        source="Binance 24h",
                        url=f"https://binance.com/en/trade/{symbol}_USDT",
                        sentiment="bearish",
                        currencies=[symbol],
                        published_at=datetime.now(timezone.utc).isoformat()
                    ))
                    logger.info(f"  📉 Top Loser: {symbol} {change:.1f}%")
                    
        except Exception as e:
            logger.error(f"  ❌ Error fetching gainers/losers: {e}")
        
        logger.info(f"  ✅ Collected {len(results)} market signals")
        return results


# =============================================================================
# SIGNAL GENERATOR
# =============================================================================

class SignalGenerator:
    """Generate trade signals based on collected data"""
    
    def __init__(self):
        pass
    
    def generate(
        self,
        market_data: List[MarketData],
        futures_data: List[FuturesData],
        sentiment: SentimentData
    ) -> List[TradeSetup]:
        """Generate trade setups"""
        logger.info("🎯 Generating trade signals...")
        setups = []
        
        # Create lookup for futures data
        futures_lookup = {f.symbol: f for f in futures_data}
        
        for market in market_data:
            symbol = market.symbol
            futures = futures_lookup.get(symbol)
            
            # Calculate signal factors
            factors = []
            score = 50  # Start neutral
            
            # Factor 1: 24h change momentum
            if market.change_24h > 3:
                factors.append(f"Strong momentum (+{market.change_24h:.1f}%)")
                score += 15
            elif market.change_24h < -3:
                factors.append(f"Weak momentum ({market.change_24h:.1f}%)")
                score -= 15
            
            # Factor 2: Fear/Greed contrarian
            if sentiment.fear_greed_value < 25:
                factors.append(f"Extreme fear ({sentiment.fear_greed_label})")
                score += 10  # Contrarian bullish
            elif sentiment.fear_greed_value > 75:
                factors.append(f"Extreme greed ({sentiment.fear_greed_label})")
                score -= 10  # Contrarian bearish
            
            # Factor 3: Funding rate
            if futures:
                if futures.funding_rate > 0.05:
                    factors.append(f"High funding ({futures.funding_rate:.3f}%)")
                    score -= 5  # Too bullish
                elif futures.funding_rate < -0.01:
                    factors.append(f"Negative funding ({futures.funding_rate:.3f}%)")
                    score += 5  # Contrarian bullish
                
                # Factor 4: Long/short ratio
                if futures.long_short_ratio > 2.5:
                    factors.append(f"Crowded long ({futures.long_short_ratio:.2f})")
                    score -= 5
                elif futures.long_short_ratio < 0.7:
                    factors.append(f"Crowded short ({futures.long_short_ratio:.2f})")
                    score += 5
            
            # Factor 5: Volume analysis
            if market.volume_24h > 1e9:  # >$1B volume
                factors.append("High volume (>$1B)")
                score += 5
            
            # Generate setup if score is significant
            if abs(score - 50) >= 15 and len(factors) >= 2:
                direction = "LONG" if score > 50 else "SHORT"
                confidence = min(abs(score - 50) / 50 * 100, 90)
                
                # Calculate levels
                entry = market.price
                atr_estimate = (market.high_24h - market.low_24h) / entry * 100
                
                if direction == "LONG":
                    stop_loss = entry * (1 - atr_estimate / 100 * 1.5)
                    target_1 = entry * (1 + atr_estimate / 100 * 1.0)
                    target_2 = entry * (1 + atr_estimate / 100 * 2.0)
                else:
                    stop_loss = entry * (1 + atr_estimate / 100 * 1.5)
                    target_1 = entry * (1 - atr_estimate / 100 * 1.0)
                    target_2 = entry * (1 - atr_estimate / 100 * 2.0)
                
                risk = abs(entry - stop_loss)
                reward = abs(target_1 - entry)
                rr = reward / risk if risk > 0 else 0
                
                setup = TradeSetup(
                    symbol=symbol,
                    direction=direction,
                    confidence=round(confidence, 1),
                    entry_price=round(entry, 2),
                    stop_loss=round(stop_loss, 2),
                    target_1=round(target_1, 2),
                    target_2=round(target_2, 2),
                    risk_reward=round(rr, 2),
                    supporting_factors=factors,
                    timestamp=datetime.now(timezone.utc).isoformat()
                )
                setups.append(setup)
                
                logger.info(f"  🎯 {symbol} {direction}: {confidence:.0f}% confidence, R:R={rr:.2f}")
        
        # Sort by confidence
        setups.sort(key=lambda x: x.confidence, reverse=True)
        return setups[:5]  # Top 5 setups


# =============================================================================
# MAIN BOT
# =============================================================================

class ResearchBot:
    """Main bot orchestrator"""
    
    def __init__(self):
        self.client = HTTPClient()
        self.storage = LocalStorage()
        
        self.market_collector = MarketCollector(self.client)
        self.futures_collector = FuturesCollector(self.client)
        self.onchain_collector = OnChainCollector(self.client)
        self.sentiment_collector = SentimentCollector(self.client)
        self.news_collector = NewsCollector(self.client)
        
        self.signal_generator = SignalGenerator()
        
    async def run_cycle(self) -> Dict:
        """Run a single data collection and signal generation cycle"""
        logger.info("")
        logger.info("=" * 60)
        logger.info(f"🤖 RESEARCH BOT CYCLE - {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        logger.info("=" * 60)
        
        results = {}
        
        try:
            # Collect data
            market_data = await self.market_collector.collect()
            await asyncio.sleep(0.5)
            
            futures_data = await self.futures_collector.collect()
            await asyncio.sleep(0.5)
            
            onchain_data = await self.onchain_collector.collect()
            await asyncio.sleep(0.5)
            
            sentiment = await self.sentiment_collector.collect()
            
            news_data = await self.news_collector.collect()
            
            # Store data
            self.storage.save('market_data', {
                'timestamp': datetime.now(timezone.utc).isoformat(),
                'data': [asdict(m) for m in market_data]
            })
            self.storage.save('futures_data', {
                'timestamp': datetime.now(timezone.utc).isoformat(),
                'data': [asdict(f) for f in futures_data]
            })
            self.storage.save('onchain_data', {
                'timestamp': datetime.now(timezone.utc).isoformat(),
                'data': [asdict(o) for o in onchain_data]
            })
            self.storage.save('sentiment', asdict(sentiment))
            self.storage.save('news_data', {
                'timestamp': datetime.now(timezone.utc).isoformat(),
                'data': [asdict(n) for n in news_data]
            })
            
            # Generate signals
            setups = self.signal_generator.generate(market_data, futures_data, sentiment)
            
            # Store setups
            self.storage.save('trade_setups', {
                'timestamp': datetime.now(timezone.utc).isoformat(),
                'setups': [asdict(s) for s in setups]
            })
            
            # Print summary
            logger.info("")
            logger.info("=" * 60)
            logger.info("📋 TRADE SETUPS")
            logger.info("=" * 60)
            
            if setups:
                for i, setup in enumerate(setups, 1):
                    logger.info(f"\n  #{i} {setup.symbol} - {setup.direction}")
                    logger.info(f"     Confidence: {setup.confidence}%")
                    logger.info(f"     Entry: ${setup.entry_price:,.2f}")
                    logger.info(f"     Stop Loss: ${setup.stop_loss:,.2f}")
                    logger.info(f"     Target 1: ${setup.target_1:,.2f}")
                    logger.info(f"     Target 2: ${setup.target_2:,.2f}")
                    logger.info(f"     Risk/Reward: {setup.risk_reward}")
                    logger.info(f"     Factors: {', '.join(setup.supporting_factors)}")
            else:
                logger.info("  No high-confidence setups at this time")
            
            results = {
                'success': True,
                'market_data_count': len(market_data),
                'futures_data_count': len(futures_data),
                'onchain_data_count': len(onchain_data),
                'news_data_count': len(news_data),
                'setups': [asdict(s) for s in setups],
                'timestamp': datetime.now(timezone.utc).isoformat()
            }
            
        except Exception as e:
            logger.error(f"❌ Cycle error: {e}")
            results = {'success': False, 'error': str(e)}
        
        return results
    
    async def run_continuous(self, interval_minutes: int = 15):
        """Run continuously with specified interval"""
        logger.info(f"🚀 Starting continuous mode (interval: {interval_minutes} minutes)")
        logger.info("Press Ctrl+C to stop")
        
        try:
            while True:
                await self.run_cycle()
                logger.info(f"\n⏰ Next cycle in {interval_minutes} minutes...")
                await asyncio.sleep(interval_minutes * 60)
        except KeyboardInterrupt:
            logger.info("\n👋 Shutting down...")
        finally:
            await self.client.close()
    
    async def close(self):
        await self.client.close()


async def main():
    """Main entry point"""
    import argparse
    
    parser = argparse.ArgumentParser(description='Crypto Research Bot')
    parser.add_argument('--continuous', '-c', action='store_true', help='Run continuously')
    parser.add_argument('--interval', '-i', type=int, default=15, help='Interval in minutes (default: 15)')
    args = parser.parse_args()
    
    bot = ResearchBot()
    
    try:
        if args.continuous:
            await bot.run_continuous(args.interval)
        else:
            results = await bot.run_cycle()
            
            # Print JSON output for API integration
            print("\n" + "=" * 60)
            print("📤 JSON OUTPUT")
            print("=" * 60)
            print(json.dumps(results, indent=2))
    finally:
        await bot.close()


if __name__ == "__main__":
    asyncio.run(main())
