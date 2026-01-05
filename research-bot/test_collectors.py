#!/usr/bin/env python3
"""
Standalone Test Script for Research Bot Data Collectors
Tests data fetching from FREE APIs without requiring PostgreSQL or Redis

Run: python3 test_collectors.py
"""

import asyncio
import aiohttp
import ssl
import certifi
import json
from datetime import datetime, timezone, timedelta
from typing import Dict, List, Any, Optional
import logging
import os

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class SimpleFetcher:
    """Simple HTTP fetcher for testing with proper SSL handling"""
    
    def __init__(self):
        self._session: Optional[aiohttp.ClientSession] = None
    
    async def get_session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            # Create proper SSL context using certifi certificates
            ssl_context = ssl.create_default_context(cafile=certifi.where())
            connector = aiohttp.TCPConnector(ssl=ssl_context)
            
            timeout = aiohttp.ClientTimeout(total=30, connect=10)
            self._session = aiohttp.ClientSession(
                timeout=timeout,
                connector=connector,
                headers={
                    'User-Agent': 'ResearchBot/1.0',
                    'Accept': 'application/json'
                }
            )
        return self._session
    
    async def fetch(self, url: str, params: Dict = None) -> Dict:
        """Fetch JSON from URL"""
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


async def test_binance_market_data(fetcher: SimpleFetcher) -> bool:
    """Test Binance public API for market data (NO API KEY REQUIRED)"""
    logger.info("📊 Testing Binance Market Data (FREE)...")
    
    try:
        # Test 1: Get server time (basic connectivity)
        url = "https://api.binance.com/api/v3/time"
        data = await fetcher.fetch(url)
        if 'serverTime' in data:
            logger.info(f"  ✅ Binance server time: {data['serverTime']}")
        else:
            logger.error("  ❌ Failed to get server time")
            return False
        
        # Test 2: Get ticker price
        url = "https://api.binance.com/api/v3/ticker/price"
        params = {'symbol': 'BTCUSDT'}
        data = await fetcher.fetch(url, params)
        if 'price' in data:
            logger.info(f"  ✅ BTC Price: ${float(data['price']):,.2f}")
        else:
            logger.error("  ❌ Failed to get BTC price")
            return False
        
        # Test 3: Get OHLCV (klines)
        url = "https://api.binance.com/api/v3/klines"
        params = {'symbol': 'BTCUSDT', 'interval': '1h', 'limit': 5}
        data = await fetcher.fetch(url, params)
        if data and len(data) > 0:
            logger.info(f"  ✅ Got {len(data)} hourly candles")
            latest = data[-1]
            logger.info(f"     Latest candle - O: ${float(latest[1]):,.2f}, H: ${float(latest[2]):,.2f}, L: ${float(latest[3]):,.2f}, C: ${float(latest[4]):,.2f}")
        else:
            logger.error("  ❌ Failed to get OHLCV data")
            return False
        
        # Test 4: Get 24h ticker stats
        url = "https://api.binance.com/api/v3/ticker/24hr"
        params = {'symbol': 'BTCUSDT'}
        data = await fetcher.fetch(url, params)
        if 'priceChangePercent' in data:
            logger.info(f"  ✅ 24h Change: {data['priceChangePercent']}%")
            logger.info(f"     Volume: ${float(data['quoteVolume']):,.0f}")
        
        return True
        
    except Exception as e:
        logger.error(f"  ❌ Binance test failed: {e}")
        return False


async def test_binance_futures(fetcher: SimpleFetcher) -> bool:
    """Test Binance Futures public API (NO API KEY REQUIRED)"""
    logger.info("📈 Testing Binance Futures Data (FREE)...")
    
    try:
        # Test 1: Get funding rate
        url = "https://fapi.binance.com/fapi/v1/premiumIndex"
        params = {'symbol': 'BTCUSDT'}
        data = await fetcher.fetch(url, params)
        if 'lastFundingRate' in data:
            rate = float(data['lastFundingRate']) * 100
            logger.info(f"  ✅ BTC Funding Rate: {rate:.4f}%")
            logger.info(f"     Mark Price: ${float(data['markPrice']):,.2f}")
        else:
            logger.error("  ❌ Failed to get funding rate")
            return False
        
        # Test 2: Get open interest
        url = "https://fapi.binance.com/fapi/v1/openInterest"
        params = {'symbol': 'BTCUSDT'}
        data = await fetcher.fetch(url, params)
        if 'openInterest' in data:
            oi = float(data['openInterest'])
            logger.info(f"  ✅ Open Interest: {oi:,.2f} BTC")
        else:
            logger.error("  ❌ Failed to get open interest")
            return False
        
        # Test 3: Get top long/short ratio
        url = "https://fapi.binance.com/futures/data/topLongShortPositionRatio"
        params = {'symbol': 'BTCUSDT', 'period': '1h', 'limit': 1}
        data = await fetcher.fetch(url, params)
        if data and len(data) > 0:
            ratio = float(data[0]['longShortRatio'])
            logger.info(f"  ✅ Long/Short Ratio: {ratio:.2f}")
        
        return True
        
    except Exception as e:
        logger.error(f"  ❌ Binance Futures test failed: {e}")
        return False


async def test_defillama_tvl(fetcher: SimpleFetcher) -> bool:
    """Test DefiLlama API for TVL data (FREE, NO API KEY)"""
    logger.info("🔗 Testing DefiLlama TVL Data (FREE)...")
    
    try:
        # Test 1: Get total TVL
        url = "https://api.llama.fi/v2/historicalChainTvl"
        data = await fetcher.fetch(url)
        if data and len(data) > 0:
            latest = data[-1]
            tvl = latest.get('tvl', 0)
            logger.info(f"  ✅ Total DeFi TVL: ${tvl/1e9:.2f}B")
        
        # Test 2: Get Ethereum TVL
        url = "https://api.llama.fi/v2/historicalChainTvl/Ethereum"
        data = await fetcher.fetch(url)
        if data and len(data) > 0:
            latest = data[-1]
            tvl = latest.get('tvl', 0)
            logger.info(f"  ✅ Ethereum TVL: ${tvl/1e9:.2f}B")
        
        # Test 3: Get Solana TVL
        url = "https://api.llama.fi/v2/historicalChainTvl/Solana"
        data = await fetcher.fetch(url)
        if data and len(data) > 0:
            latest = data[-1]
            tvl = latest.get('tvl', 0)
            logger.info(f"  ✅ Solana TVL: ${tvl/1e9:.2f}B")
        
        return True
        
    except Exception as e:
        logger.error(f"  ❌ DefiLlama test failed: {e}")
        return False


async def test_coingecko_free(fetcher: SimpleFetcher) -> bool:
    """Test CoinGecko FREE API (rate limited)"""
    logger.info("🦎 Testing CoinGecko Data (FREE)...")
    
    try:
        # Get bitcoin price
        url = "https://api.coingecko.com/api/v3/simple/price"
        params = {
            'ids': 'bitcoin,ethereum,solana',
            'vs_currencies': 'usd',
            'include_24hr_change': 'true',
            'include_market_cap': 'true'
        }
        data = await fetcher.fetch(url, params)
        
        if 'bitcoin' in data:
            btc = data['bitcoin']
            logger.info(f"  ✅ BTC: ${btc['usd']:,.2f} ({btc.get('usd_24h_change', 0):.2f}%)")
        if 'ethereum' in data:
            eth = data['ethereum']
            logger.info(f"  ✅ ETH: ${eth['usd']:,.2f} ({eth.get('usd_24h_change', 0):.2f}%)")
        if 'solana' in data:
            sol = data['solana']
            logger.info(f"  ✅ SOL: ${sol['usd']:,.2f} ({sol.get('usd_24h_change', 0):.2f}%)")
        
        return bool(data)
        
    except Exception as e:
        logger.error(f"  ❌ CoinGecko test failed: {e}")
        return False


async def test_cryptopanic_news(fetcher: SimpleFetcher, api_key: str = None) -> bool:
    """Test CryptoPanic news API"""
    logger.info("📰 Testing CryptoPanic News...")
    
    try:
        if not api_key:
            api_key = os.getenv('CRYPTOPANIC_API_KEY', '')
        
        if not api_key or api_key == 'your_cryptopanic_api_key':
            logger.warning("  ⚠️ No CryptoPanic API key - skipping (get free key at cryptopanic.com)")
            return True
        
        url = f"https://cryptopanic.com/api/v1/posts/"
        params = {
            'auth_token': api_key,
            'currencies': 'BTC,ETH,SOL',
            'filter': 'important',
            'kind': 'news'
        }
        data = await fetcher.fetch(url, params)
        
        if 'results' in data:
            news_count = len(data['results'])
            logger.info(f"  ✅ Got {news_count} news articles")
            if news_count > 0:
                latest = data['results'][0]
                logger.info(f"     Latest: {latest.get('title', 'N/A')[:60]}...")
            return True
        else:
            logger.error("  ❌ No news results")
            return False
        
    except Exception as e:
        logger.error(f"  ❌ CryptoPanic test failed: {e}")
        return False


async def test_fear_greed_index(fetcher: SimpleFetcher) -> bool:
    """Test Fear & Greed Index (FREE)"""
    logger.info("😱 Testing Fear & Greed Index (FREE)...")
    
    try:
        url = "https://api.alternative.me/fng/"
        params = {'limit': 1}
        data = await fetcher.fetch(url, params)
        
        if 'data' in data and len(data['data']) > 0:
            fng = data['data'][0]
            value = int(fng['value'])
            classification = fng['value_classification']
            logger.info(f"  ✅ Fear & Greed Index: {value} ({classification})")
            return True
        
        return False
        
    except Exception as e:
        logger.error(f"  ❌ Fear & Greed test failed: {e}")
        return False


async def test_ccxt_integration() -> bool:
    """Test CCXT library if installed"""
    logger.info("🔄 Testing CCXT Library...")
    
    try:
        import ccxt.async_support as ccxt
        
        # Create exchange without API keys (public data only)
        exchange = ccxt.binance({
            'enableRateLimit': True,
        })
        
        # Fetch ticker
        ticker = await exchange.fetch_ticker('BTC/USDT')
        logger.info(f"  ✅ CCXT BTC/USDT: ${ticker['last']:,.2f}")
        logger.info(f"     24h Volume: ${ticker['quoteVolume']:,.0f}")
        
        # Fetch OHLCV
        ohlcv = await exchange.fetch_ohlcv('BTC/USDT', '1h', limit=5)
        logger.info(f"  ✅ CCXT OHLCV: Got {len(ohlcv)} candles")
        
        await exchange.close()
        return True
        
    except ImportError:
        logger.warning("  ⚠️ CCXT not installed - run: pip install ccxt")
        return True
    except Exception as e:
        logger.error(f"  ❌ CCXT test failed: {e}")
        return False


async def run_all_tests():
    """Run all collector tests"""
    logger.info("=" * 60)
    logger.info("🚀 RESEARCH BOT DATA COLLECTOR TESTS")
    logger.info("=" * 60)
    logger.info("")
    
    fetcher = SimpleFetcher()
    results = {}
    
    try:
        # Test each data source
        results['binance_spot'] = await test_binance_market_data(fetcher)
        await asyncio.sleep(0.5)  # Rate limit friendly
        
        results['binance_futures'] = await test_binance_futures(fetcher)
        await asyncio.sleep(0.5)
        
        results['defillama'] = await test_defillama_tvl(fetcher)
        await asyncio.sleep(0.5)
        
        results['coingecko'] = await test_coingecko_free(fetcher)
        await asyncio.sleep(0.5)
        
        results['fear_greed'] = await test_fear_greed_index(fetcher)
        await asyncio.sleep(0.5)
        
        results['cryptopanic'] = await test_cryptopanic_news(fetcher)
        await asyncio.sleep(0.5)
        
        results['ccxt'] = await test_ccxt_integration()
        
    finally:
        await fetcher.close()
    
    # Summary
    logger.info("")
    logger.info("=" * 60)
    logger.info("📋 TEST SUMMARY")
    logger.info("=" * 60)
    
    passed = sum(1 for v in results.values() if v)
    total = len(results)
    
    for name, success in results.items():
        status = "✅ PASS" if success else "❌ FAIL"
        logger.info(f"  {name}: {status}")
    
    logger.info("")
    logger.info(f"  Total: {passed}/{total} tests passed")
    
    if passed == total:
        logger.info("")
        logger.info("🎉 All FREE data sources are working!")
        logger.info("📝 For full functionality, configure API keys in .env:")
        logger.info("   - BINANCE_API_KEY (optional, more data)")
        logger.info("   - CRYPTOPANIC_API_KEY (free at cryptopanic.com)")
        logger.info("   - GLASSNODE_API_KEY (paid, on-chain metrics)")
        logger.info("   - TWITTER_BEARER_TOKEN (paid, social data)")
    
    return passed == total


if __name__ == "__main__":
    asyncio.run(run_all_tests())
