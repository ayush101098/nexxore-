"""
═══════════════════════════════════════════════════════════════════════════════
ARBITRAGE SCANNER - Cross-Platform Price Discovery
═══════════════════════════════════════════════════════════════════════════════
Detects arbitrage opportunities across Polymarket, Kalshi, Manifold, and others
"""

import asyncio
import aiohttp
import hashlib
import json
import logging
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple
from datetime import datetime, timedelta
from enum import Enum
from collections import defaultdict

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class Platform(Enum):
    POLYMARKET = "polymarket"
    KALSHI = "kalshi"
    MANIFOLD = "manifold"
    METACULUS = "metaculus"
    PREDICTIT = "predictit"


@dataclass
class PlatformPrice:
    """Price data from a single platform"""
    platform: Platform
    event_id: str
    yes_price: float
    no_price: float
    volume_24h: float
    liquidity: float
    fees: float  # Trading fee percentage
    last_update: datetime
    url: str


@dataclass
class LinkedEvent:
    """Events across platforms that track the same outcome"""
    canonical_id: str
    question: str
    category: str
    resolution_date: datetime
    platform_events: List[PlatformPrice] = field(default_factory=list)


@dataclass
class ArbitrageOpportunity:
    """Detected arbitrage opportunity"""
    canonical_id: str
    question: str
    buy_platform: Platform
    buy_price: float
    sell_platform: Platform
    sell_price: float
    gross_spread: float
    net_spread: float  # After fees
    estimated_profit_pct: float
    max_size: float  # Limited by liquidity
    confidence: float  # How confident we are this is the same event
    detected_at: datetime
    expires_in_hours: int


class PlatformAPI:
    """Base class for platform API integrations"""
    
    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key
        self.session: Optional[aiohttp.ClientSession] = None
    
    async def __aenter__(self):
        self.session = aiohttp.ClientSession()
        return self
    
    async def __aexit__(self, *args):
        if self.session:
            await self.session.close()
    
    async def fetch_markets(self, category: str = None) -> List[PlatformPrice]:
        raise NotImplementedError


class PolymarketAPI(PlatformAPI):
    """Polymarket integration"""
    
    BASE_URL = "https://gamma-api.polymarket.com"
    
    async def fetch_markets(self, category: str = None) -> List[PlatformPrice]:
        """Fetch active markets from Polymarket"""
        markets = []
        
        try:
            url = f"{self.BASE_URL}/markets"
            params = {"active": "true", "limit": 100}
            if category:
                params["category"] = category
            
            async with self.session.get(url, params=params) as response:
                data = await response.json()
                
            for market in data.get('results', []):
                try:
                    # Extract YES token price
                    yes_price = float(market.get('outcomePrices', '["0.5","0.5"]').strip('[]').split(',')[0].strip('"'))
                    
                    markets.append(PlatformPrice(
                        platform=Platform.POLYMARKET,
                        event_id=market.get('conditionId', ''),
                        yes_price=yes_price,
                        no_price=1 - yes_price,
                        volume_24h=float(market.get('volume24hr', 0)),
                        liquidity=float(market.get('liquidityNum', 0)),
                        fees=0.02,  # 2% fee on Polymarket
                        last_update=datetime.now(),
                        url=f"https://polymarket.com/event/{market.get('slug', '')}"
                    ))
                except Exception as e:
                    logger.warning(f"Error parsing Polymarket market: {e}")
                    continue
                    
        except Exception as e:
            logger.error(f"Error fetching Polymarket markets: {e}")
        
        return markets


class KalshiAPI(PlatformAPI):
    """Kalshi integration"""
    
    BASE_URL = "https://api.elections.kalshi.com/trade-api/v2"
    
    async def fetch_markets(self, category: str = None) -> List[PlatformPrice]:
        """Fetch active markets from Kalshi"""
        markets = []
        
        try:
            url = f"{self.BASE_URL}/markets"
            params = {"status": "open", "limit": 100}
            
            headers = {}
            if self.api_key:
                headers["Authorization"] = f"Bearer {self.api_key}"
            
            async with self.session.get(url, headers=headers, params=params) as response:
                data = await response.json()
            
            for market in data.get('markets', []):
                try:
                    yes_price = float(market.get('yes_ask', 50)) / 100
                    
                    markets.append(PlatformPrice(
                        platform=Platform.KALSHI,
                        event_id=market.get('ticker', ''),
                        yes_price=yes_price,
                        no_price=1 - yes_price,
                        volume_24h=float(market.get('volume_24h', 0)),
                        liquidity=float(market.get('open_interest', 0)) * yes_price,
                        fees=0.01,  # 1% fee on Kalshi
                        last_update=datetime.now(),
                        url=f"https://kalshi.com/markets/{market.get('ticker', '')}"
                    ))
                except Exception as e:
                    logger.warning(f"Error parsing Kalshi market: {e}")
                    continue
                    
        except Exception as e:
            logger.error(f"Error fetching Kalshi markets: {e}")
        
        return markets


class ManifoldAPI(PlatformAPI):
    """Manifold Markets integration (free/play money but useful for price discovery)"""
    
    BASE_URL = "https://api.manifold.markets/v0"
    
    async def fetch_markets(self, category: str = None) -> List[PlatformPrice]:
        """Fetch active markets from Manifold"""
        markets = []
        
        try:
            url = f"{self.BASE_URL}/markets"
            params = {"limit": 100, "sort": "newest"}
            
            async with self.session.get(url, params=params) as response:
                data = await response.json()
            
            for market in data:
                try:
                    if market.get('isResolved', False):
                        continue
                    
                    yes_price = float(market.get('probability', 0.5))
                    
                    markets.append(PlatformPrice(
                        platform=Platform.MANIFOLD,
                        event_id=market.get('id', ''),
                        yes_price=yes_price,
                        no_price=1 - yes_price,
                        volume_24h=float(market.get('volume24Hours', 0)),
                        liquidity=float(market.get('totalLiquidity', 0)),
                        fees=0.0,  # Manifold has no trading fees
                        last_update=datetime.now(),
                        url=market.get('url', '')
                    ))
                except Exception as e:
                    logger.warning(f"Error parsing Manifold market: {e}")
                    continue
                    
        except Exception as e:
            logger.error(f"Error fetching Manifold markets: {e}")
        
        return markets


class EventMatcher:
    """
    Matches events across platforms using semantic similarity
    """
    
    # Common keyword mappings for event matching
    KEYWORD_SYNONYMS = {
        'bitcoin': ['btc', 'bitcoin'],
        'ethereum': ['eth', 'ethereum'],
        'trump': ['trump', 'donald trump'],
        'biden': ['biden', 'joe biden'],
        'fed': ['federal reserve', 'fed', 'fomc'],
        'election': ['election', 'presidential', 'vote'],
    }
    
    def __init__(self):
        self.linked_events: Dict[str, LinkedEvent] = {}
    
    def normalize_question(self, question: str) -> str:
        """Normalize question text for comparison"""
        # Lowercase
        q = question.lower()
        
        # Remove common words
        stopwords = ['will', 'the', 'a', 'an', 'be', 'is', 'are', 'to', 'in', 'by', 'before', 'after']
        words = [w for w in q.split() if w not in stopwords]
        
        # Sort for consistent comparison
        return ' '.join(sorted(words))
    
    def calculate_similarity(self, q1: str, q2: str) -> float:
        """
        Calculate similarity score between two questions
        Uses Jaccard similarity of word sets
        """
        words1 = set(self.normalize_question(q1).split())
        words2 = set(self.normalize_question(q2).split())
        
        if not words1 or not words2:
            return 0.0
        
        intersection = len(words1 & words2)
        union = len(words1 | words2)
        
        return intersection / union if union > 0 else 0.0
    
    def generate_canonical_id(self, question: str) -> str:
        """Generate canonical ID for event grouping"""
        normalized = self.normalize_question(question)
        return hashlib.md5(normalized.encode()).hexdigest()[:12]
    
    def find_matches(
        self,
        events: List[Tuple[Platform, str, PlatformPrice]],  # (platform, question, price_data)
        threshold: float = 0.6
    ) -> List[LinkedEvent]:
        """
        Find matching events across platforms
        """
        linked: Dict[str, LinkedEvent] = {}
        
        for platform, question, price_data in events:
            matched = False
            
            # Try to match with existing linked events
            for canonical_id, linked_event in linked.items():
                similarity = self.calculate_similarity(question, linked_event.question)
                
                if similarity >= threshold:
                    # Check if this platform already has an entry
                    existing_platforms = {p.platform for p in linked_event.platform_events}
                    if platform not in existing_platforms:
                        linked_event.platform_events.append(price_data)
                    matched = True
                    break
            
            if not matched:
                # Create new linked event
                canonical_id = self.generate_canonical_id(question)
                linked[canonical_id] = LinkedEvent(
                    canonical_id=canonical_id,
                    question=question,
                    category="general",
                    resolution_date=datetime.now() + timedelta(days=30),
                    platform_events=[price_data]
                )
        
        # Return only events with multiple platforms
        return [e for e in linked.values() if len(e.platform_events) >= 2]


class ArbitrageScanner:
    """
    Main arbitrage scanner that detects cross-platform opportunities
    """
    
    MIN_SPREAD = 0.02  # 2% minimum gross spread
    MIN_NET_SPREAD = 0.005  # 0.5% minimum net spread after fees
    MIN_LIQUIDITY = 1000  # $1k minimum liquidity
    
    def __init__(self, api_keys: Dict[str, str] = None):
        self.api_keys = api_keys or {}
        self.matcher = EventMatcher()
        self.platforms = {
            Platform.POLYMARKET: PolymarketAPI(),
            Platform.KALSHI: KalshiAPI(self.api_keys.get('kalshi')),
            Platform.MANIFOLD: ManifoldAPI(),
        }
    
    async def scan_all_platforms(self) -> List[PlatformPrice]:
        """Fetch markets from all platforms concurrently"""
        all_markets = []
        
        async with aiohttp.ClientSession() as session:
            tasks = []
            
            for platform, api in self.platforms.items():
                api.session = session
                tasks.append(self._fetch_with_retry(api, platform))
            
            results = await asyncio.gather(*tasks, return_exceptions=True)
            
            for result in results:
                if isinstance(result, list):
                    all_markets.extend(result)
                elif isinstance(result, Exception):
                    logger.error(f"Error fetching markets: {result}")
        
        return all_markets
    
    async def _fetch_with_retry(self, api: PlatformAPI, platform: Platform, retries: int = 3) -> List[PlatformPrice]:
        """Fetch with exponential backoff retry"""
        for attempt in range(retries):
            try:
                return await api.fetch_markets()
            except Exception as e:
                if attempt < retries - 1:
                    await asyncio.sleep(2 ** attempt)
                else:
                    logger.error(f"Failed to fetch {platform.value} after {retries} attempts: {e}")
                    return []
    
    def find_arbitrage(self, linked_events: List[LinkedEvent]) -> List[ArbitrageOpportunity]:
        """
        Find arbitrage opportunities in linked events
        
        Arbitrage exists when:
        1. Buy YES on Platform A at price P_a
        2. Sell YES (or buy NO) on Platform B at price P_b
        3. P_b - P_a > fees (guaranteed profit regardless of outcome)
        """
        opportunities = []
        
        for event in linked_events:
            prices = event.platform_events
            
            if len(prices) < 2:
                continue
            
            # Compare all platform pairs
            for i, price_a in enumerate(prices):
                for j, price_b in enumerate(prices):
                    if i >= j:
                        continue
                    
                    # Check YES arbitrage: buy YES on cheaper, sell YES on higher
                    yes_spread = price_b.yes_price - price_a.yes_price
                    yes_fees = price_a.fees + price_b.fees
                    yes_net = yes_spread - yes_fees
                    
                    if yes_net > self.MIN_NET_SPREAD:
                        max_size = min(price_a.liquidity, price_b.liquidity)
                        
                        if max_size >= self.MIN_LIQUIDITY:
                            opportunities.append(ArbitrageOpportunity(
                                canonical_id=event.canonical_id,
                                question=event.question,
                                buy_platform=price_a.platform,
                                buy_price=price_a.yes_price,
                                sell_platform=price_b.platform,
                                sell_price=price_b.yes_price,
                                gross_spread=yes_spread,
                                net_spread=yes_net,
                                estimated_profit_pct=yes_net / price_a.yes_price * 100 if price_a.yes_price > 0 else 0,
                                max_size=max_size,
                                confidence=0.8,  # Would be calculated by matcher
                                detected_at=datetime.now(),
                                expires_in_hours=24
                            ))
                    
                    # Check reverse direction
                    reverse_spread = price_a.yes_price - price_b.yes_price
                    reverse_net = reverse_spread - yes_fees
                    
                    if reverse_net > self.MIN_NET_SPREAD:
                        max_size = min(price_a.liquidity, price_b.liquidity)
                        
                        if max_size >= self.MIN_LIQUIDITY:
                            opportunities.append(ArbitrageOpportunity(
                                canonical_id=event.canonical_id,
                                question=event.question,
                                buy_platform=price_b.platform,
                                buy_price=price_b.yes_price,
                                sell_platform=price_a.platform,
                                sell_price=price_a.yes_price,
                                gross_spread=reverse_spread,
                                net_spread=reverse_net,
                                estimated_profit_pct=reverse_net / price_b.yes_price * 100 if price_b.yes_price > 0 else 0,
                                max_size=max_size,
                                confidence=0.8,
                                detected_at=datetime.now(),
                                expires_in_hours=24
                            ))
        
        # Sort by net spread descending
        opportunities.sort(key=lambda x: x.net_spread, reverse=True)
        
        return opportunities
    
    async def run_scan(self) -> List[ArbitrageOpportunity]:
        """
        Run full arbitrage scan
        """
        logger.info("Starting arbitrage scan...")
        
        # Fetch all markets
        markets = await self.scan_all_platforms()
        logger.info(f"Fetched {len(markets)} markets from all platforms")
        
        # For demo, create mock linked events
        # In production, this would use the EventMatcher with actual question text
        events = [(m.platform, f"Event {m.event_id}", m) for m in markets]
        
        # Find matching events
        linked = self.matcher.find_matches(events, threshold=0.6)
        logger.info(f"Found {len(linked)} linked events across platforms")
        
        # Find arbitrage opportunities
        opportunities = self.find_arbitrage(linked)
        logger.info(f"Found {len(opportunities)} arbitrage opportunities")
        
        return opportunities


# ═══════════════════════════════════════════════════════════════════════════════
# MOCK DATA FOR DEMO
# ═══════════════════════════════════════════════════════════════════════════════

def create_mock_opportunities() -> List[ArbitrageOpportunity]:
    """Create mock opportunities for demonstration"""
    return [
        ArbitrageOpportunity(
            canonical_id="btc150k2026",
            question="Will Bitcoin reach $150,000 before July 2026?",
            buy_platform=Platform.POLYMARKET,
            buy_price=0.42,
            sell_platform=Platform.KALSHI,
            sell_price=0.47,
            gross_spread=0.05,
            net_spread=0.02,  # After 3% total fees
            estimated_profit_pct=4.76,
            max_size=50000,
            confidence=0.95,
            detected_at=datetime.now(),
            expires_in_hours=48
        ),
        ArbitrageOpportunity(
            canonical_id="fed2025",
            question="Will the Fed cut rates in January 2025?",
            buy_platform=Platform.KALSHI,
            buy_price=0.28,
            sell_platform=Platform.POLYMARKET,
            sell_price=0.33,
            gross_spread=0.05,
            net_spread=0.02,
            estimated_profit_pct=7.14,
            max_size=25000,
            confidence=0.92,
            detected_at=datetime.now(),
            expires_in_hours=24
        ),
        ArbitrageOpportunity(
            canonical_id="eth5k2025",
            question="Will Ethereum reach $5,000 in 2025?",
            buy_platform=Platform.MANIFOLD,
            buy_price=0.35,
            sell_platform=Platform.POLYMARKET,
            sell_price=0.41,
            gross_spread=0.06,
            net_spread=0.04,  # Manifold has no fees
            estimated_profit_pct=11.43,
            max_size=15000,
            confidence=0.88,
            detected_at=datetime.now(),
            expires_in_hours=72
        ),
    ]


# ═══════════════════════════════════════════════════════════════════════════════
# MAIN DEMO
# ═══════════════════════════════════════════════════════════════════════════════

async def main():
    """Demo the arbitrage scanner"""
    
    print("=" * 70)
    print("ARBITRAGE SCANNER - Cross-Platform Price Discovery")
    print("=" * 70)
    
    # Use mock data for demo
    opportunities = create_mock_opportunities()
    
    print(f"\n🔍 Found {len(opportunities)} arbitrage opportunities:\n")
    
    for i, opp in enumerate(opportunities, 1):
        print(f"{'─' * 70}")
        print(f"#{i} {opp.question}")
        print(f"{'─' * 70}")
        print(f"   📉 BUY  {opp.buy_platform.value.upper():12} @ {opp.buy_price:.1%}")
        print(f"   📈 SELL {opp.sell_platform.value.upper():12} @ {opp.sell_price:.1%}")
        print(f"   💰 Gross Spread: {opp.gross_spread:.1%}")
        print(f"   💵 Net Spread:   {opp.net_spread:.1%} (after fees)")
        print(f"   📊 Est. Profit:  {opp.estimated_profit_pct:.2f}%")
        print(f"   📏 Max Size:     ${opp.max_size:,.0f}")
        print(f"   🎯 Confidence:   {opp.confidence:.1%}")
        print(f"   ⏰ Expires:      {opp.expires_in_hours}h")
        print()
    
    # Summary
    total_opportunity = sum(o.max_size * o.net_spread for o in opportunities)
    print(f"\n{'=' * 70}")
    print(f"📈 TOTAL OPPORTUNITY: ${total_opportunity:,.2f} potential profit")
    print(f"{'=' * 70}")


if __name__ == "__main__":
    asyncio.run(main())
