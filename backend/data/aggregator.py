"""
Unified Data Aggregator

Single source of truth for all market data.
Handles caching, normalization, and source fallbacks.
"""

import asyncio
import logging
from typing import Dict, Any, List, Optional
from datetime import datetime
import aiohttp
import redis.asyncio as redis

logger = logging.getLogger(__name__)


class DataAggregator:
    """
    Unified data fetcher with caching.
    
    Sources:
    - CoinGecko: Prices, market data
    - DefiLlama: TVL, protocol metrics
    - Binance: Real-time prices, funding rates
    - Hyperliquid: Perps data, open interest
    - Messari: News, research
    """
    
    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.redis: Optional[redis.Redis] = None
        self.session: Optional[aiohttp.ClientSession] = None
        
        # API keys
        self.coingecko_key = config.get('coingecko_api_key')
        self.messari_key = config.get('messari_api_key')
        
        # Cache TTLs (seconds)
        self.ttl = {
            'prices': 60,           # 1 min
            'funding_rates': 10,    # 10 sec
            'tvl': 300,             # 5 min
            'news': 900,            # 15 min
            'market_data': 60,      # 1 min
        }
        
    async def initialize(self):
        """Initialize connections."""
        self.redis = redis.from_url(
            self.config.get('redis_url', 'redis://localhost:6379')
        )
        self.session = aiohttp.ClientSession()
        logger.info("Data aggregator initialized")
        
    async def close(self):
        """Cleanup connections."""
        if self.session:
            await self.session.close()
        if self.redis:
            await self.redis.close()
            
    # ==================== PRICES ====================
    
    async def get_prices(self, tokens: List[str]) -> Dict[str, float]:
        """
        Get current prices for tokens.
        
        Args:
            tokens: List of token symbols (ETH, BTC, SOL)
            
        Returns:
            Dict mapping symbol to USD price
        """
        cache_key = f"prices:{','.join(sorted(tokens))}"
        
        # Check cache
        cached = await self.redis.get(cache_key)
        if cached:
            return eval(cached)  # Safe since we control the data
            
        # Fetch from CoinGecko
        try:
            prices = await self._fetch_coingecko_prices(tokens)
            await self.redis.setex(cache_key, self.ttl['prices'], str(prices))
            return prices
        except Exception as e:
            logger.error(f"Price fetch failed: {e}")
            # Fallback to Binance
            return await self._fetch_binance_prices(tokens)
            
    async def _fetch_coingecko_prices(self, tokens: List[str]) -> Dict[str, float]:
        """Fetch from CoinGecko API."""
        # Map symbols to CoinGecko IDs
        id_map = {
            'ETH': 'ethereum',
            'BTC': 'bitcoin',
            'SOL': 'solana',
            'USDT': 'tether',
            'USDC': 'usd-coin',
        }
        
        ids = [id_map.get(t.upper(), t.lower()) for t in tokens]
        
        url = f"https://api.coingecko.com/api/v3/simple/price"
        params = {
            'ids': ','.join(ids),
            'vs_currencies': 'usd',
            'include_24hr_change': 'true'
        }
        
        if self.coingecko_key:
            params['x_cg_pro_api_key'] = self.coingecko_key
            
        async with self.session.get(url, params=params) as resp:
            data = await resp.json()
            
        # Map back to symbols
        result = {}
        for symbol, cg_id in id_map.items():
            if cg_id in data:
                result[symbol] = data[cg_id]['usd']
                
        return result
        
    async def _fetch_binance_prices(self, tokens: List[str]) -> Dict[str, float]:
        """Fallback to Binance API."""
        result = {}
        
        for token in tokens:
            if token.upper() in ['USDT', 'USDC']:
                result[token] = 1.0
                continue
                
            symbol = f"{token.upper()}USDT"
            url = f"https://api.binance.com/api/v3/ticker/price?symbol={symbol}"
            
            try:
                async with self.session.get(url) as resp:
                    data = await resp.json()
                    result[token] = float(data['price'])
            except:
                pass
                
        return result
        
    # ==================== FUNDING RATES ====================
    
    async def get_funding_rates(self, symbols: List[str] = None) -> Dict[str, Any]:
        """
        Get perp funding rates from Binance and Hyperliquid.
        
        Returns:
            Dict with funding rates per symbol and venue
        """
        symbols = symbols or ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']
        cache_key = f"funding:{','.join(symbols)}"
        
        cached = await self.redis.get(cache_key)
        if cached:
            return eval(cached)
            
        result = {}
        
        # Fetch Binance funding
        try:
            binance_rates = await self._fetch_binance_funding(symbols)
            result['binance'] = binance_rates
        except Exception as e:
            logger.error(f"Binance funding fetch failed: {e}")
            
        # Fetch Hyperliquid funding
        try:
            hl_rates = await self._fetch_hyperliquid_funding(symbols)
            result['hyperliquid'] = hl_rates
        except Exception as e:
            logger.error(f"Hyperliquid funding fetch failed: {e}")
            
        await self.redis.setex(cache_key, self.ttl['funding_rates'], str(result))
        return result
        
    async def _fetch_binance_funding(self, symbols: List[str]) -> Dict[str, float]:
        """Fetch funding rates from Binance Futures."""
        url = "https://fapi.binance.com/fapi/v1/premiumIndex"
        
        async with self.session.get(url) as resp:
            data = await resp.json()
            
        result = {}
        for item in data:
            if item['symbol'] in symbols:
                result[item['symbol']] = {
                    'rate': float(item['lastFundingRate']),
                    'next_time': item['nextFundingTime'],
                    'mark_price': float(item['markPrice'])
                }
                
        return result
        
    async def _fetch_hyperliquid_funding(self, symbols: List[str]) -> Dict[str, float]:
        """Fetch funding rates from Hyperliquid."""
        url = "https://api.hyperliquid.xyz/info"
        
        payload = {"type": "metaAndAssetCtxs"}
        
        async with self.session.post(url, json=payload) as resp:
            data = await resp.json()
            
        result = {}
        
        if isinstance(data, list) and len(data) > 1:
            asset_ctxs = data[1]
            universe = data[0].get('universe', [])
            
            for i, ctx in enumerate(asset_ctxs):
                if i < len(universe):
                    symbol = universe[i]['name']
                    if f"{symbol}USDT" in symbols or symbol in symbols:
                        result[symbol] = {
                            'rate': float(ctx.get('funding', 0)),
                            'mark_price': float(ctx.get('markPx', 0)),
                            'open_interest': float(ctx.get('openInterest', 0))
                        }
                        
        return result
        
    # ==================== TVL & PROTOCOL DATA ====================
    
    async def get_protocol_tvl(self, protocols: List[str]) -> Dict[str, Any]:
        """
        Get TVL data from DefiLlama.
        
        Args:
            protocols: List of protocol names (aave, lido, etc.)
        """
        cache_key = f"tvl:{','.join(sorted(protocols))}"
        
        cached = await self.redis.get(cache_key)
        if cached:
            return eval(cached)
            
        result = {}
        
        for protocol in protocols:
            try:
                url = f"https://api.llama.fi/protocol/{protocol}"
                async with self.session.get(url) as resp:
                    data = await resp.json()
                    
                result[protocol] = {
                    'tvl': data.get('tvl', 0),
                    'tvl_change_1d': data.get('change_1d', 0),
                    'tvl_change_7d': data.get('change_7d', 0),
                    'chains': list(data.get('chainTvls', {}).keys())
                }
            except Exception as e:
                logger.error(f"TVL fetch failed for {protocol}: {e}")
                
        await self.redis.setex(cache_key, self.ttl['tvl'], str(result))
        return result
        
    # ==================== NEWS & SENTIMENT ====================
    
    async def get_news(self, keywords: List[str] = None, limit: int = 20) -> List[Dict]:
        """
        Get crypto news from multiple sources.
        """
        keywords = keywords or ['crypto', 'defi', 'ethereum']
        cache_key = f"news:{','.join(sorted(keywords))}:{limit}"
        
        cached = await self.redis.get(cache_key)
        if cached:
            return eval(cached)
            
        news = []
        
        # Fetch from CryptoPanic (free tier)
        try:
            url = "https://cryptopanic.com/api/v1/posts/"
            params = {
                'auth_token': self.config.get('cryptopanic_key', 'free'),
                'filter': 'important',
                'public': 'true'
            }
            
            async with self.session.get(url, params=params) as resp:
                data = await resp.json()
                
            for item in data.get('results', [])[:limit]:
                news.append({
                    'title': item.get('title'),
                    'url': item.get('url'),
                    'source': item.get('source', {}).get('title'),
                    'published': item.get('published_at'),
                    'sentiment': self._parse_sentiment(item)
                })
        except Exception as e:
            logger.error(f"News fetch failed: {e}")
            
        await self.redis.setex(cache_key, self.ttl['news'], str(news))
        return news
        
    def _parse_sentiment(self, item: Dict) -> float:
        """Parse sentiment from news item."""
        votes = item.get('votes', {})
        positive = votes.get('positive', 0)
        negative = votes.get('negative', 0)
        total = positive + negative
        
        if total == 0:
            return 0.0
            
        return (positive - negative) / total
        
    # ==================== MARKET DATA ====================
    
    async def get_market_overview(self) -> Dict[str, Any]:
        """
        Get overall market data.
        """
        cache_key = "market:overview"
        
        cached = await self.redis.get(cache_key)
        if cached:
            return eval(cached)
            
        result = {}
        
        # Global market data from CoinGecko
        try:
            url = "https://api.coingecko.com/api/v3/global"
            async with self.session.get(url) as resp:
                data = await resp.json()
                
            global_data = data.get('data', {})
            result['global'] = {
                'total_market_cap': global_data.get('total_market_cap', {}).get('usd'),
                'total_volume': global_data.get('total_volume', {}).get('usd'),
                'btc_dominance': global_data.get('market_cap_percentage', {}).get('btc'),
                'eth_dominance': global_data.get('market_cap_percentage', {}).get('eth'),
                'market_cap_change_24h': global_data.get('market_cap_change_percentage_24h_usd')
            }
        except Exception as e:
            logger.error(f"Global market fetch failed: {e}")
            
        # Fear & Greed Index
        try:
            url = "https://api.alternative.me/fng/"
            async with self.session.get(url) as resp:
                data = await resp.json()
                
            fng = data.get('data', [{}])[0]
            result['fear_greed'] = {
                'value': int(fng.get('value', 50)),
                'classification': fng.get('value_classification', 'Neutral')
            }
        except Exception as e:
            logger.error(f"Fear & Greed fetch failed: {e}")
            result['fear_greed'] = {'value': 50, 'classification': 'Neutral'}
            
        await self.redis.setex(cache_key, self.ttl['market_data'], str(result))
        return result


# Singleton
_aggregator: Optional[DataAggregator] = None


async def get_data_aggregator(config: Dict[str, Any] = None) -> DataAggregator:
    """Get or create data aggregator singleton."""
    global _aggregator
    
    if _aggregator is None:
        _aggregator = DataAggregator(config or {})
        await _aggregator.initialize()
        
    return _aggregator
