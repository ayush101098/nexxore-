"""
News Collector - Fetches and processes crypto news with NLP analysis
Sources: CryptoPanic, RSS feeds, custom scrapers
"""

import asyncio
import logging
import hashlib
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional
import re
import aiohttp

from .base_collector import BaseCollector, FetchResult

logger = logging.getLogger(__name__)


class NewsCollector(BaseCollector[Dict]):
    """
    Collects crypto news and events:
    - News articles from CryptoPanic, Messari, etc.
    - Event detection (upgrades, unlocks, exploits)
    - Sentiment analysis using FinBERT
    - Entity extraction and keyword tagging
    
    Sources: CryptoPanic API, RSS feeds
    """
    
    CRYPTOPANIC_BASE = "https://cryptopanic.com/api/v1/posts/"
    
    # Event type keywords for classification
    EVENT_KEYWORDS = {
        'upgrade': ['upgrade', 'fork', 'hard fork', 'mainnet', 'testnet', 'v2', 'update'],
        'unlock': ['unlock', 'vesting', 'release', 'token release', 'cliff'],
        'exploit': ['hack', 'exploit', 'breach', 'attack', 'vulnerability', 'stolen'],
        'regulatory': ['sec', 'regulation', 'lawsuit', 'court', 'legal', 'ban', 'compliance'],
        'partnership': ['partnership', 'collaboration', 'integration', 'alliance'],
        'listing': ['listing', 'listed', 'delist', 'binance list', 'coinbase add'],
        'airdrop': ['airdrop', 'drop', 'distribution', 'claim'],
    }
    
    # Impact keywords
    IMPACT_KEYWORDS = {
        'critical': ['hack', 'exploit', 'stolen', 'crash', 'emergency', 'vulnerability'],
        'high': ['major', 'significant', 'milestone', 'mainnet', 'v2', 'sec'],
        'medium': ['update', 'partnership', 'listing', 'upgrade'],
        'low': ['minor', 'small', 'planned', 'routine'],
    }
    
    def __init__(self, db_pool, redis_client, config: Dict[str, Any] = None):
        super().__init__(
            name='news_events',
            db_pool=db_pool,
            redis_client=redis_client,
            config=config or {}
        )
        
        self._cryptopanic_api_key = self.config.get('cryptopanic_api_key', '')
        self._seen_hashes = set()
        
        # Lazy-loaded sentiment analyzer
        self._sentiment_analyzer = None
    
    async def _get_sentiment_analyzer(self):
        """Lazy-load sentiment analyzer"""
        if self._sentiment_analyzer is None:
            try:
                from transformers import pipeline
                self._sentiment_analyzer = pipeline(
                    "sentiment-analysis",
                    model="ProsusAI/finbert",
                    max_length=512,
                    truncation=True
                )
            except Exception as e:
                logger.warning(f"Failed to load FinBERT: {e}")
        return self._sentiment_analyzer
    
    async def fetch(
        self,
        symbols: List[str],
        since: datetime = None,
        **kwargs
    ) -> FetchResult:
        """
        Fetch news articles related to symbols
        """
        all_data = []
        errors = []
        
        if since is None:
            since = datetime.now(timezone.utc) - timedelta(hours=24)
        
        # Fetch from different sources
        tasks = [
            self._fetch_cryptopanic_news(symbols),
        ]
        
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        for result in results:
            if isinstance(result, Exception):
                errors.append(str(result))
            elif isinstance(result, list):
                all_data.extend(result)
        
        # Deduplicate
        unique_data = self._deduplicate_news(all_data)
        
        return FetchResult(
            success=len(unique_data) > 0,
            data=unique_data,
            records_count=len(unique_data),
            error='; '.join(errors) if errors else None
        )
    
    async def _fetch_cryptopanic_news(self, symbols: List[str]) -> List[Dict]:
        """Fetch news from CryptoPanic API"""
        data = []
        
        # Convert symbols to currency codes
        currencies = [s.replace('USDT', '') for s in symbols]
        
        try:
            params = {
                'auth_token': self._cryptopanic_api_key or 'free',
                'public': 'true',
                'kind': 'news',
                'filter': 'important'
            }
            
            # Add currencies filter if we have a paid key
            if self._cryptopanic_api_key:
                params['currencies'] = ','.join(currencies[:10])  # API limit
            
            await self.rate_limiter.wait_if_needed()
            
            async with self.session.get(self.CRYPTOPANIC_BASE, params=params) as response:
                if response.status == 200:
                    result = await response.json()
                    
                    if 'results' in result:
                        for post in result['results']:
                            # Extract relevant symbols
                            post_currencies = post.get('currencies', [])
                            post_symbols = [
                                f"{c.get('code')}USDT" 
                                for c in post_currencies 
                                if f"{c.get('code')}USDT" in symbols
                            ]
                            
                            if not post_symbols:
                                # Try to extract from title
                                title = post.get('title', '').upper()
                                for s in symbols:
                                    if s[:3] in title or s.replace('USDT', '') in title:
                                        post_symbols.append(s)
                                        break
                            
                            if post_symbols:
                                # Classify event type
                                title_lower = post.get('title', '').lower()
                                event_type = self._classify_event_type(title_lower)
                                impact = self._classify_impact(title_lower)
                                
                                # Extract votes for sentiment
                                votes = post.get('votes', {})
                                positive = votes.get('positive', 0)
                                negative = votes.get('negative', 0)
                                
                                if positive + negative > 0:
                                    sentiment = (positive - negative) / (positive + negative)
                                else:
                                    sentiment = 0
                                
                                # Create record for each relevant symbol
                                for symbol in post_symbols:
                                    data.append({
                                        'symbol': symbol,
                                        'timestamp': datetime.fromisoformat(
                                            post.get('published_at', '').replace('Z', '+00:00')
                                        ),
                                        'source': 'cryptopanic',
                                        'event_type': event_type,
                                        'title': post.get('title', ''),
                                        'url': post.get('url', ''),
                                        'sentiment_polarity': sentiment,
                                        'is_breaking': post.get('kind') == 'news',
                                        'impact_level': impact,
                                        'keywords': self._extract_keywords(title_lower),
                                    })
                                    
        except Exception as e:
            logger.warning(f"Failed to fetch CryptoPanic news: {e}")
        
        return data
    
    def _classify_event_type(self, text: str) -> Optional[str]:
        """Classify news event type based on keywords"""
        text = text.lower()
        
        for event_type, keywords in self.EVENT_KEYWORDS.items():
            for keyword in keywords:
                if keyword in text:
                    return event_type
        
        return None
    
    def _classify_impact(self, text: str) -> str:
        """Classify impact level based on keywords"""
        text = text.lower()
        
        for impact, keywords in self.IMPACT_KEYWORDS.items():
            for keyword in keywords:
                if keyword in text:
                    return impact
        
        return 'low'
    
    def _extract_keywords(self, text: str) -> List[str]:
        """Extract relevant keywords from text"""
        # Remove common words
        stop_words = {'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 
                      'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
                      'would', 'could', 'should', 'may', 'might', 'must', 'shall',
                      'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from',
                      'as', 'into', 'through', 'during', 'before', 'after', 'above',
                      'below', 'between', 'under', 'again', 'further', 'then', 'once'}
        
        # Extract words
        words = re.findall(r'\b[a-z]+\b', text.lower())
        
        # Filter and return unique keywords
        keywords = [w for w in words if w not in stop_words and len(w) > 2]
        return list(set(keywords))[:10]
    
    def _deduplicate_news(self, data: List[Dict]) -> List[Dict]:
        """Remove duplicate news based on title hash"""
        unique = []
        seen = set()
        
        for record in data:
            # Create hash from title
            title = record.get('title', '')
            title_hash = hashlib.md5(title.lower().encode()).hexdigest()
            
            if title_hash not in seen:
                seen.add(title_hash)
                unique.append(record)
        
        return unique
    
    async def analyze_sentiment(self, text: str) -> Dict[str, float]:
        """Analyze sentiment using FinBERT"""
        try:
            analyzer = await self._get_sentiment_analyzer()
            if analyzer is None:
                return {'polarity': 0, 'intensity': 0}
            
            # Run in thread pool to avoid blocking
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(None, analyzer, text[:512])
            
            if result:
                label = result[0]['label'].lower()
                score = result[0]['score']
                
                # Map to polarity
                if label == 'positive':
                    polarity = score
                elif label == 'negative':
                    polarity = -score
                else:
                    polarity = 0
                
                return {
                    'polarity': polarity,
                    'intensity': score
                }
                
        except Exception as e:
            logger.debug(f"Sentiment analysis failed: {e}")
        
        return {'polarity': 0, 'intensity': 0}
    
    async def validate(self, data: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Validate news data"""
        validated = []
        
        for record in data:
            # Must have title and timestamp
            if not record.get('title') or not record.get('timestamp'):
                continue
            
            # Title must not be empty
            if len(record.get('title', '').strip()) < 10:
                continue
            
            # Normalize sentiment
            if 'sentiment_polarity' in record:
                record['sentiment_polarity'] = max(-1, min(1, record['sentiment_polarity']))
            
            validated.append(record)
        
        return validated
    
    async def store(self, data: List[Dict[str, Any]]) -> int:
        """Store news events"""
        if not data:
            return 0
        
        columns = [
            'symbol', 'timestamp', 'source', 'event_type',
            'title', 'url', 'sentiment_polarity',
            'is_breaking', 'impact_level', 'keywords'
        ]
        
        records = []
        for r in data:
            keywords = r.get('keywords', [])
            if isinstance(keywords, list):
                keywords = keywords
            else:
                keywords = []
            
            records.append((
                r.get('symbol'),
                r['timestamp'],
                r.get('source', 'unknown'),
                r.get('event_type'),
                r['title'],
                r.get('url'),
                r.get('sentiment_polarity'),
                r.get('is_breaking', False),
                r.get('impact_level'),
                keywords
            ))
        
        # News doesn't have a unique constraint, just insert
        on_conflict = "DO NOTHING"
        
        return await self._batch_insert(
            self.get_table_name(),
            columns,
            records,
            on_conflict
        )
    
    def get_table_name(self) -> str:
        return 'news_events'
    
    async def get_recent_news(
        self,
        symbol: str,
        hours: int = 24,
        limit: int = 10
    ) -> List[Dict]:
        """Get recent news for a symbol"""
        async with self.db_pool.acquire() as conn:
            rows = await conn.fetch("""
                SELECT symbol, timestamp, source, event_type, title, url,
                       sentiment_polarity, is_breaking, impact_level, keywords
                FROM news_events
                WHERE symbol = $1
                AND timestamp > NOW() - INTERVAL '%s hours'
                ORDER BY timestamp DESC
                LIMIT $2
            """, symbol, hours, limit)
            
            return [dict(row) for row in rows]
