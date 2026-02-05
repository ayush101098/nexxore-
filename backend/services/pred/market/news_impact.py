"""
═══════════════════════════════════════════════════════════════════════════════
NEWS IMPACT ENGINE - Real-time Sentiment & Event Analysis
═══════════════════════════════════════════════════════════════════════════════
Analyzes news impact on prediction markets using NLP and sentiment analysis
"""

import asyncio
import aiohttp
import re
import json
import logging
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple
from datetime import datetime, timedelta
from enum import Enum
from collections import deque

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class ImpactLevel(Enum):
    CRITICAL = "CRITICAL"   # Major market-moving event
    HIGH = "HIGH"           # Significant impact expected
    MEDIUM = "MEDIUM"       # Moderate impact
    LOW = "LOW"             # Minor or no impact
    NEUTRAL = "NEUTRAL"     # No clear direction


class SentimentDirection(Enum):
    BULLISH = "BULLISH"
    BEARISH = "BEARISH"
    NEUTRAL = "NEUTRAL"


@dataclass
class NewsArticle:
    """Parsed news article"""
    id: str
    title: str
    summary: str
    source: str
    url: str
    published_at: datetime
    entities: List[str]  # Named entities (people, orgs, etc.)
    keywords: List[str]
    raw_sentiment: float  # -1.0 to 1.0


@dataclass
class NewsImpact:
    """Impact analysis of a news article on a specific market"""
    article_id: str
    event_id: str
    impact_level: ImpactLevel
    sentiment_direction: SentimentDirection
    probability_shift: float  # Expected shift in probability (-1.0 to 1.0)
    confidence: float
    reasoning: str
    relevant_keywords: List[str]
    processed_at: datetime


@dataclass
class MarketEvent:
    """Prediction market event to track"""
    event_id: str
    question: str
    keywords: List[str]
    current_probability: float
    last_update: datetime


@dataclass
class AlertSignal:
    """Real-time alert for significant news"""
    event_id: str
    question: str
    article_title: str
    impact_level: ImpactLevel
    direction: SentimentDirection
    probability_shift: float
    action_required: str
    urgency: str  # 'IMMEDIATE', 'SOON', 'MONITOR'
    timestamp: datetime


class SentimentAnalyzer:
    """
    Simple rule-based sentiment analyzer
    In production, this would use a fine-tuned LLM or specialized model
    """
    
    # Sentiment keyword dictionaries
    POSITIVE_KEYWORDS = {
        'bullish', 'surge', 'rally', 'gains', 'breakthrough', 'success',
        'approval', 'adoption', 'growth', 'increase', 'record', 'milestone',
        'positive', 'confident', 'optimistic', 'strong', 'momentum', 'win',
        'victory', 'passed', 'approved', 'confirmed', 'achieved'
    }
    
    NEGATIVE_KEYWORDS = {
        'bearish', 'crash', 'plunge', 'decline', 'failure', 'rejected',
        'ban', 'lawsuit', 'investigation', 'loss', 'drop', 'fall',
        'negative', 'concern', 'worry', 'weak', 'risk', 'lose',
        'defeat', 'failed', 'denied', 'blocked', 'collapsed'
    }
    
    INTENSITY_MULTIPLIERS = {
        'very': 1.5, 'extremely': 2.0, 'slightly': 0.5, 'somewhat': 0.7,
        'significantly': 1.8, 'massive': 2.0, 'huge': 1.8, 'major': 1.5
    }
    
    def analyze(self, text: str) -> Tuple[float, float]:
        """
        Analyze sentiment of text
        Returns: (sentiment_score, confidence)
        sentiment_score: -1.0 (very negative) to 1.0 (very positive)
        """
        text_lower = text.lower()
        words = set(re.findall(r'\b\w+\b', text_lower))
        
        positive_count = len(words & self.POSITIVE_KEYWORDS)
        negative_count = len(words & self.NEGATIVE_KEYWORDS)
        
        # Apply intensity multipliers
        intensity = 1.0
        for word, mult in self.INTENSITY_MULTIPLIERS.items():
            if word in text_lower:
                intensity = max(intensity, mult)
        
        total = positive_count + negative_count
        if total == 0:
            return 0.0, 0.3  # Neutral with low confidence
        
        # Calculate sentiment score
        sentiment = (positive_count - negative_count) / total * intensity
        sentiment = max(-1.0, min(1.0, sentiment))
        
        # Confidence based on keyword density
        confidence = min(0.9, 0.3 + total * 0.1)
        
        return sentiment, confidence


class EntityExtractor:
    """
    Simple entity extraction for matching news to events
    In production, would use spaCy or similar NLP library
    """
    
    # Common entities to track
    CRYPTO_ENTITIES = {
        'bitcoin', 'btc', 'ethereum', 'eth', 'solana', 'sol',
        'crypto', 'cryptocurrency', 'blockchain', 'defi', 'nft'
    }
    
    POLITICAL_ENTITIES = {
        'trump', 'biden', 'harris', 'republican', 'democrat', 'congress',
        'senate', 'election', 'vote', 'president', 'governor'
    }
    
    ECONOMIC_ENTITIES = {
        'fed', 'federal reserve', 'inflation', 'interest rate', 'gdp',
        'unemployment', 'recession', 'nasdaq', 'sp500', 'dow'
    }
    
    def extract(self, text: str) -> List[str]:
        """Extract relevant entities from text"""
        text_lower = text.lower()
        entities = []
        
        for entity_set in [self.CRYPTO_ENTITIES, self.POLITICAL_ENTITIES, self.ECONOMIC_ENTITIES]:
            for entity in entity_set:
                if entity in text_lower:
                    entities.append(entity)
        
        return list(set(entities))


class NewsSource:
    """Base class for news data sources"""
    
    async def fetch_news(self, keywords: List[str] = None, since: datetime = None) -> List[NewsArticle]:
        raise NotImplementedError


class MockNewsSource(NewsSource):
    """Mock news source for testing"""
    
    MOCK_NEWS = [
        {
            "title": "Bitcoin ETF Sees Record $2B Inflows in Single Day",
            "summary": "BlackRock's spot Bitcoin ETF recorded unprecedented inflows as institutional adoption accelerates.",
            "source": "CryptoNews",
            "keywords": ["bitcoin", "etf", "blackrock", "institutional"],
            "sentiment": 0.8
        },
        {
            "title": "Fed Signals Potential Rate Cut in January Meeting",
            "summary": "Federal Reserve officials indicated openness to reducing interest rates amid cooling inflation.",
            "source": "Reuters",
            "keywords": ["fed", "interest rate", "inflation", "economy"],
            "sentiment": 0.4
        },
        {
            "title": "Major Crypto Exchange Faces SEC Investigation",
            "summary": "Regulatory concerns mount as SEC launches formal investigation into trading practices.",
            "source": "WSJ",
            "keywords": ["crypto", "sec", "regulation", "investigation"],
            "sentiment": -0.6
        },
        {
            "title": "Ethereum Layer 2 TVL Reaches All-Time High",
            "summary": "Total value locked in Ethereum scaling solutions surpasses $50 billion milestone.",
            "source": "TheBlock",
            "keywords": ["ethereum", "layer2", "defi", "tvl"],
            "sentiment": 0.7
        }
    ]
    
    async def fetch_news(self, keywords: List[str] = None, since: datetime = None) -> List[NewsArticle]:
        """Return mock news articles"""
        import random
        
        articles = []
        for i, news in enumerate(self.MOCK_NEWS):
            # Filter by keywords if provided
            if keywords:
                if not any(kw.lower() in ' '.join(news['keywords']).lower() for kw in keywords):
                    continue
            
            articles.append(NewsArticle(
                id=f"mock-{i}",
                title=news['title'],
                summary=news['summary'],
                source=news['source'],
                url=f"https://example.com/news/{i}",
                published_at=datetime.now() - timedelta(hours=random.randint(1, 24)),
                entities=news['keywords'],
                keywords=news['keywords'],
                raw_sentiment=news['sentiment']
            ))
        
        return articles


class NewsImpactEngine:
    """
    Main engine for analyzing news impact on prediction markets
    """
    
    # Impact thresholds
    CRITICAL_THRESHOLD = 0.15
    HIGH_THRESHOLD = 0.10
    MEDIUM_THRESHOLD = 0.05
    
    def __init__(self, news_sources: List[NewsSource] = None, llm_client = None):
        self.news_sources = news_sources or [MockNewsSource()]
        self.sentiment_analyzer = SentimentAnalyzer()
        self.entity_extractor = EntityExtractor()
        self.llm_client = llm_client  # For advanced analysis
        
        # Tracked events
        self.events: Dict[str, MarketEvent] = {}
        
        # Recent alerts (deque for efficient FIFO)
        self.recent_alerts: deque = deque(maxlen=100)
    
    def track_event(self, event: MarketEvent):
        """Add an event to track"""
        self.events[event.event_id] = event
    
    async def fetch_all_news(self, since: datetime = None) -> List[NewsArticle]:
        """Fetch news from all sources"""
        if since is None:
            since = datetime.now() - timedelta(hours=24)
        
        all_news = []
        
        tasks = [source.fetch_news(since=since) for source in self.news_sources]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        for result in results:
            if isinstance(result, list):
                all_news.extend(result)
            elif isinstance(result, Exception):
                logger.error(f"Error fetching news: {result}")
        
        # Sort by recency
        all_news.sort(key=lambda x: x.published_at, reverse=True)
        
        return all_news
    
    def match_article_to_events(self, article: NewsArticle) -> List[Tuple[str, float]]:
        """
        Match a news article to relevant tracked events
        Returns: List of (event_id, relevance_score)
        """
        matches = []
        
        article_keywords = set(kw.lower() for kw in article.keywords + article.entities)
        
        for event_id, event in self.events.items():
            event_keywords = set(kw.lower() for kw in event.keywords)
            
            # Calculate overlap
            overlap = len(article_keywords & event_keywords)
            if overlap == 0:
                continue
            
            # Relevance score based on keyword overlap
            relevance = overlap / max(len(event_keywords), 1)
            
            # Boost for exact question matches
            if any(kw in event.question.lower() for kw in article_keywords):
                relevance *= 1.5
            
            if relevance >= 0.2:  # Minimum relevance threshold
                matches.append((event_id, min(relevance, 1.0)))
        
        return matches
    
    def calculate_probability_shift(
        self,
        article: NewsArticle,
        event: MarketEvent,
        relevance: float
    ) -> Tuple[float, float]:
        """
        Calculate expected probability shift from news
        Returns: (shift, confidence)
        """
        # Get sentiment from article
        sentiment, sent_confidence = self.sentiment_analyzer.analyze(
            article.title + " " + article.summary
        )
        
        # Use article's raw sentiment if available and confident
        if article.raw_sentiment != 0:
            sentiment = article.raw_sentiment
            sent_confidence = 0.7
        
        # Base shift proportional to sentiment and relevance
        base_shift = sentiment * relevance * 0.15  # Max 15% shift
        
        # Adjust for current probability (bigger shifts near 50%)
        prob_factor = 1 - abs(event.current_probability - 0.5) * 2
        adjusted_shift = base_shift * (0.5 + prob_factor * 0.5)
        
        # Confidence based on sentiment confidence and relevance
        confidence = sent_confidence * relevance
        
        return adjusted_shift, confidence
    
    def determine_impact_level(self, shift: float, confidence: float) -> ImpactLevel:
        """Determine impact level from probability shift"""
        effective_shift = abs(shift) * confidence
        
        if effective_shift >= self.CRITICAL_THRESHOLD:
            return ImpactLevel.CRITICAL
        elif effective_shift >= self.HIGH_THRESHOLD:
            return ImpactLevel.HIGH
        elif effective_shift >= self.MEDIUM_THRESHOLD:
            return ImpactLevel.MEDIUM
        elif effective_shift > 0:
            return ImpactLevel.LOW
        else:
            return ImpactLevel.NEUTRAL
    
    def analyze_article(self, article: NewsArticle, event: MarketEvent, relevance: float) -> NewsImpact:
        """
        Analyze a single article's impact on an event
        """
        shift, confidence = self.calculate_probability_shift(article, event, relevance)
        impact_level = self.determine_impact_level(shift, confidence)
        
        # Determine direction
        if shift > 0.01:
            direction = SentimentDirection.BULLISH
        elif shift < -0.01:
            direction = SentimentDirection.BEARISH
        else:
            direction = SentimentDirection.NEUTRAL
        
        # Generate reasoning
        reasoning = self._generate_reasoning(article, event, shift, confidence)
        
        return NewsImpact(
            article_id=article.id,
            event_id=event.event_id,
            impact_level=impact_level,
            sentiment_direction=direction,
            probability_shift=round(shift, 4),
            confidence=round(confidence, 4),
            reasoning=reasoning,
            relevant_keywords=list(set(article.keywords) & set(event.keywords)),
            processed_at=datetime.now()
        )
    
    def _generate_reasoning(
        self,
        article: NewsArticle,
        event: MarketEvent,
        shift: float,
        confidence: float
    ) -> str:
        """Generate explanation for impact analysis"""
        direction = "positive" if shift > 0 else "negative" if shift < 0 else "neutral"
        magnitude = "significant" if abs(shift) > 0.05 else "moderate" if abs(shift) > 0.02 else "minor"
        
        return (
            f"News '{article.title[:50]}...' from {article.source} has a {magnitude} {direction} impact "
            f"on '{event.question[:30]}...'. Expected probability shift: {shift:+.1%} "
            f"(confidence: {confidence:.0%})"
        )
    
    async def scan_for_impacts(self) -> List[NewsImpact]:
        """
        Scan recent news for impacts on tracked events
        """
        news = await self.fetch_all_news()
        impacts = []
        
        for article in news:
            matches = self.match_article_to_events(article)
            
            for event_id, relevance in matches:
                event = self.events[event_id]
                impact = self.analyze_article(article, event, relevance)
                
                if impact.impact_level != ImpactLevel.NEUTRAL:
                    impacts.append(impact)
        
        # Sort by impact level
        level_order = {
            ImpactLevel.CRITICAL: 0,
            ImpactLevel.HIGH: 1,
            ImpactLevel.MEDIUM: 2,
            ImpactLevel.LOW: 3,
            ImpactLevel.NEUTRAL: 4
        }
        impacts.sort(key=lambda x: level_order[x.impact_level])
        
        return impacts
    
    def generate_alerts(self, impacts: List[NewsImpact]) -> List[AlertSignal]:
        """
        Generate actionable alerts from high-impact news
        """
        alerts = []
        
        for impact in impacts:
            if impact.impact_level in [ImpactLevel.CRITICAL, ImpactLevel.HIGH]:
                event = self.events.get(impact.event_id)
                if not event:
                    continue
                
                # Determine urgency
                if impact.impact_level == ImpactLevel.CRITICAL:
                    urgency = "IMMEDIATE"
                    action = f"{'BUY' if impact.probability_shift > 0 else 'SELL'} position immediately"
                else:
                    urgency = "SOON"
                    action = f"Review position and consider {'increasing' if impact.probability_shift > 0 else 'reducing'} exposure"
                
                alerts.append(AlertSignal(
                    event_id=impact.event_id,
                    question=event.question,
                    article_title=impact.reasoning[:100],
                    impact_level=impact.impact_level,
                    direction=impact.sentiment_direction,
                    probability_shift=impact.probability_shift,
                    action_required=action,
                    urgency=urgency,
                    timestamp=datetime.now()
                ))
        
        # Add to recent alerts
        for alert in alerts:
            self.recent_alerts.append(alert)
        
        return alerts


# ═══════════════════════════════════════════════════════════════════════════════
# MAIN DEMO
# ═══════════════════════════════════════════════════════════════════════════════

async def main():
    """Demo the news impact engine"""
    
    print("=" * 70)
    print("NEWS IMPACT ENGINE - Real-time Sentiment Analysis")
    print("=" * 70)
    
    # Initialize engine
    engine = NewsImpactEngine()
    
    # Track some events
    events = [
        MarketEvent(
            event_id="btc150k",
            question="Will Bitcoin reach $150,000 before July 2026?",
            keywords=["bitcoin", "btc", "crypto", "price"],
            current_probability=0.45,
            last_update=datetime.now()
        ),
        MarketEvent(
            event_id="fedcut",
            question="Will the Fed cut rates in January 2025?",
            keywords=["fed", "interest rate", "fomc", "economy"],
            current_probability=0.35,
            last_update=datetime.now()
        ),
        MarketEvent(
            event_id="eth5k",
            question="Will Ethereum reach $5,000 in 2025?",
            keywords=["ethereum", "eth", "crypto", "defi"],
            current_probability=0.38,
            last_update=datetime.now()
        )
    ]
    
    for event in events:
        engine.track_event(event)
    
    print(f"\n📡 Tracking {len(events)} events...")
    
    # Scan for impacts
    impacts = await engine.scan_for_impacts()
    
    print(f"\n📰 Analyzed news articles. Found {len(impacts)} relevant impacts:\n")
    
    for impact in impacts:
        event = engine.events[impact.event_id]
        icon = "🔴" if impact.impact_level == ImpactLevel.CRITICAL else \
               "🟠" if impact.impact_level == ImpactLevel.HIGH else \
               "🟡" if impact.impact_level == ImpactLevel.MEDIUM else "🟢"
        
        direction_icon = "📈" if impact.sentiment_direction == SentimentDirection.BULLISH else \
                        "📉" if impact.sentiment_direction == SentimentDirection.BEARISH else "➡️"
        
        print(f"{icon} {impact.impact_level.value:8} | {direction_icon} {impact.probability_shift:+.1%}")
        print(f"   Event: {event.question[:50]}...")
        print(f"   {impact.reasoning}")
        print()
    
    # Generate alerts
    alerts = engine.generate_alerts(impacts)
    
    if alerts:
        print("\n" + "=" * 70)
        print("🚨 ALERTS GENERATED")
        print("=" * 70)
        
        for alert in alerts:
            print(f"\n⚡ [{alert.urgency}] {alert.impact_level.value}")
            print(f"   Event: {alert.question[:50]}...")
            print(f"   Shift: {alert.probability_shift:+.1%}")
            print(f"   Action: {alert.action_required}")


if __name__ == "__main__":
    asyncio.run(main())
