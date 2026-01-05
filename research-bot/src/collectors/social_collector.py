"""
Social & Sentiment Collector - Fetches social media metrics and sentiment
Sources: Twitter API, LunarCrush, CryptoPanic
"""

import asyncio
import logging
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional
import hashlib
import aiohttp

from .base_collector import BaseCollector, FetchResult

logger = logging.getLogger(__name__)


class SocialCollector(BaseCollector[Dict]):
    """
    Collects social media metrics and sentiment:
    - Twitter mention counts and engagement
    - Sentiment analysis scores
    - Influencer activity tracking
    - Viral content detection
    
    Sources: Twitter API v2, LunarCrush (if available)
    """
    
    TWITTER_API_BASE = "https://api.twitter.com/2"
    LUNARCRUSH_BASE = "https://lunarcrush.com/api3"
    
    # Crypto-specific cashtags and search terms
    SYMBOL_SEARCH_TERMS = {
        'BTCUSDT': ['$BTC', 'Bitcoin', '#Bitcoin'],
        'ETHUSDT': ['$ETH', 'Ethereum', '#Ethereum'],
        'SOLUSDT': ['$SOL', 'Solana', '#Solana'],
        'BNBUSDT': ['$BNB', 'BNB', '#BNB'],
        'AVAXUSDT': ['$AVAX', 'Avalanche', '#Avalanche'],
        'MATICUSDT': ['$MATIC', 'Polygon', '#Polygon'],
        'LINKUSDT': ['$LINK', 'Chainlink', '#Chainlink'],
        'ARBUSDT': ['$ARB', 'Arbitrum', '#Arbitrum'],
        'OPUSDT': ['$OP', 'Optimism', '#Optimism'],
    }
    
    def __init__(self, db_pool, redis_client, config: Dict[str, Any] = None):
        super().__init__(
            name='social_metrics',
            db_pool=db_pool,
            redis_client=redis_client,
            config=config or {}
        )
        
        self._twitter_bearer_token = self.config.get('twitter_bearer_token')
        self._lunarcrush_api_key = self.config.get('lunarcrush_api_key')
        
    def _get_default_headers(self) -> Dict[str, str]:
        headers = super()._get_default_headers()
        if self._twitter_bearer_token:
            headers['Authorization'] = f'Bearer {self._twitter_bearer_token}'
        return headers
    
    async def fetch(
        self,
        symbols: List[str],
        **kwargs
    ) -> FetchResult:
        """
        Fetch social metrics from multiple sources
        """
        all_data = []
        errors = []
        
        # Fetch from different sources
        tasks = []
        
        if self._twitter_bearer_token:
            tasks.append(self._fetch_twitter_metrics(symbols))
        
        if self._lunarcrush_api_key:
            tasks.append(self._fetch_lunarcrush_metrics(symbols))
        
        # Fallback to free APIs
        tasks.append(self._fetch_cryptopanic_sentiment(symbols))
        
        if tasks:
            results = await asyncio.gather(*tasks, return_exceptions=True)
            
            for result in results:
                if isinstance(result, Exception):
                    errors.append(str(result))
                elif isinstance(result, list):
                    all_data.extend(result)
        
        # Merge by symbol and source
        merged = self._merge_social_data(all_data)
        
        return FetchResult(
            success=len(merged) > 0,
            data=merged,
            records_count=len(merged),
            error='; '.join(errors) if errors else None
        )
    
    async def _fetch_twitter_metrics(self, symbols: List[str]) -> List[Dict]:
        """Fetch Twitter mention counts and engagement"""
        data = []
        
        for symbol in symbols:
            search_terms = self.SYMBOL_SEARCH_TERMS.get(symbol, [f'${symbol[:3]}'])
            
            try:
                # Build search query
                query = ' OR '.join(search_terms) + ' -is:retweet lang:en'
                
                url = f"{self.TWITTER_API_BASE}/tweets/counts/recent"
                params = {
                    'query': query,
                    'granularity': 'hour'
                }
                
                await self.rate_limiter.wait_if_needed()
                response = await self._fetch_with_retry(url, params=params)
                
                if response and 'data' in response:
                    # Get last hour count
                    counts = response['data']
                    if counts:
                        latest = counts[-1]
                        prev = counts[-2] if len(counts) > 1 else counts[0]
                        
                        current_count = latest.get('tweet_count', 0)
                        prev_count = prev.get('tweet_count', 0)
                        change = ((current_count - prev_count) / max(prev_count, 1)) * 100
                        
                        data.append({
                            'symbol': symbol,
                            'timestamp': datetime.now(timezone.utc),
                            'source': 'twitter',
                            'mention_count': current_count,
                            'mention_change_1h': change,
                        })
                        
            except Exception as e:
                logger.debug(f"Failed to fetch Twitter for {symbol}: {e}")
        
        return data
    
    async def _fetch_lunarcrush_metrics(self, symbols: List[str]) -> List[Dict]:
        """Fetch comprehensive social metrics from LunarCrush"""
        data = []
        
        # LunarCrush uses different symbol format
        lc_symbols = [s.replace('USDT', '') for s in symbols]
        
        try:
            url = f"{self.LUNARCRUSH_BASE}/coins/list"
            params = {
                'key': self._lunarcrush_api_key,
                'sort': 'galaxy_score',
                'limit': 100
            }
            
            await self.rate_limiter.wait_if_needed()
            response = await self._fetch_with_retry(url, params=params)
            
            if response and 'data' in response:
                for coin in response['data']:
                    if coin.get('symbol') in lc_symbols:
                        symbol = f"{coin['symbol']}USDT"
                        
                        data.append({
                            'symbol': symbol,
                            'timestamp': datetime.now(timezone.utc),
                            'source': 'lunarcrush',
                            'mention_count': coin.get('social_volume', 0),
                            'engagement_score': coin.get('social_score', 0),
                            'sentiment_score': self._normalize_sentiment(
                                coin.get('average_sentiment', 50)
                            ),
                            'influencer_mentions': coin.get('social_contributors', 0),
                            'unique_authors': coin.get('social_contributors', 0),
                        })
                        
        except Exception as e:
            logger.warning(f"Failed to fetch LunarCrush: {e}")
        
        return data
    
    async def _fetch_cryptopanic_sentiment(self, symbols: List[str]) -> List[Dict]:
        """Fetch sentiment from CryptoPanic news API"""
        data = []
        
        try:
            # CryptoPanic free tier - aggregated sentiment
            url = "https://cryptopanic.com/api/v1/posts/"
            params = {
                'auth_token': self.config.get('cryptopanic_api_key', 'free'),
                'public': 'true',
                'kind': 'news'
            }
            
            await self.rate_limiter.wait_if_needed()
            
            # Use session for request
            async with self.session.get(url, params=params) as response:
                if response.status == 200:
                    result = await response.json()
                    
                    if 'results' in result:
                        # Count mentions and sentiment per symbol
                        symbol_mentions = {}
                        
                        for post in result['results']:
                            currencies = post.get('currencies', [])
                            votes = post.get('votes', {})
                            
                            positive = votes.get('positive', 0)
                            negative = votes.get('negative', 0)
                            
                            for curr in currencies:
                                code = curr.get('code', '')
                                symbol = f"{code}USDT"
                                
                                if symbol in symbols:
                                    if symbol not in symbol_mentions:
                                        symbol_mentions[symbol] = {
                                            'count': 0,
                                            'positive': 0,
                                            'negative': 0
                                        }
                                    
                                    symbol_mentions[symbol]['count'] += 1
                                    symbol_mentions[symbol]['positive'] += positive
                                    symbol_mentions[symbol]['negative'] += negative
                        
                        # Convert to records
                        for symbol, stats in symbol_mentions.items():
                            total_votes = stats['positive'] + stats['negative']
                            sentiment = (stats['positive'] - stats['negative']) / max(total_votes, 1)
                            
                            data.append({
                                'symbol': symbol,
                                'timestamp': datetime.now(timezone.utc),
                                'source': 'cryptopanic',
                                'mention_count': stats['count'],
                                'sentiment_score': sentiment,
                                'sentiment_positive_count': stats['positive'],
                                'sentiment_negative_count': stats['negative'],
                            })
                            
        except Exception as e:
            logger.warning(f"Failed to fetch CryptoPanic: {e}")
        
        return data
    
    def _normalize_sentiment(self, score: float) -> float:
        """Normalize sentiment to [-1, 1] range"""
        # LunarCrush uses 0-100 scale
        if score > 1:
            return (score - 50) / 50
        return score
    
    def _merge_social_data(self, data: List[Dict]) -> List[Dict]:
        """Merge social data (keep separate by source)"""
        merged = {}
        
        for record in data:
            symbol = record.get('symbol')
            source = record.get('source', 'unknown')
            ts = record.get('timestamp')
            
            if not symbol or not ts:
                continue
            
            ts_rounded = ts.replace(minute=0, second=0, microsecond=0)
            key = (symbol, source, ts_rounded)
            
            if key not in merged:
                merged[key] = {
                    'symbol': symbol,
                    'source': source,
                    'timestamp': ts_rounded
                }
            
            for field, value in record.items():
                if field not in ['symbol', 'source', 'timestamp'] and value is not None:
                    merged[key][field] = value
        
        return list(merged.values())
    
    async def validate(self, data: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Validate social data"""
        validated = []
        
        for record in data:
            if not record.get('symbol') or not record.get('timestamp'):
                continue
            
            # Counts must be non-negative
            for field in ['mention_count', 'engagement_score', 'unique_authors']:
                if field in record and record[field] is not None:
                    record[field] = max(0, int(record[field]))
            
            # Sentiment must be in [-1, 1]
            if 'sentiment_score' in record and record['sentiment_score'] is not None:
                record['sentiment_score'] = max(-1, min(1, record['sentiment_score']))
            
            validated.append(record)
        
        return validated
    
    async def store(self, data: List[Dict[str, Any]]) -> int:
        """Store social metrics"""
        if not data:
            return 0
        
        columns = [
            'symbol', 'timestamp', 'source',
            'mention_count', 'unique_authors', 'engagement_score',
            'sentiment_score', 'sentiment_positive_count', 
            'sentiment_negative_count', 'sentiment_neutral_count',
            'mention_change_1h', 'mention_change_24h',
            'influencer_mentions', 'viral_posts'
        ]
        
        records = []
        for r in data:
            records.append((
                r['symbol'],
                r['timestamp'],
                r.get('source', 'unknown'),
                r.get('mention_count'),
                r.get('unique_authors'),
                r.get('engagement_score'),
                r.get('sentiment_score'),
                r.get('sentiment_positive_count'),
                r.get('sentiment_negative_count'),
                r.get('sentiment_neutral_count'),
                r.get('mention_change_1h'),
                r.get('mention_change_24h'),
                r.get('influencer_mentions'),
                r.get('viral_posts')
            ))
        
        on_conflict = """
            (symbol, source, timestamp) DO UPDATE SET
            mention_count = COALESCE(EXCLUDED.mention_count, social_metrics.mention_count),
            unique_authors = COALESCE(EXCLUDED.unique_authors, social_metrics.unique_authors),
            engagement_score = COALESCE(EXCLUDED.engagement_score, social_metrics.engagement_score),
            sentiment_score = COALESCE(EXCLUDED.sentiment_score, social_metrics.sentiment_score)
        """
        
        return await self._batch_insert(
            self.get_table_name(),
            columns,
            records,
            on_conflict
        )
    
    def get_table_name(self) -> str:
        return 'social_metrics'
