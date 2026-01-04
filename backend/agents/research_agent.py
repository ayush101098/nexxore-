"""
Research Agent Service
Monitors protocols, governance forums, and security incidents
"""

import asyncio
import json
import logging
from dataclasses import dataclass, asdict
from datetime import datetime, timedelta
from enum import Enum
from typing import Optional, List, Dict, Any

import aiohttp
import anthropic
import redis.asyncio as redis
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)


class SignalSeverity(Enum):
    INFO = "INFO"
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


@dataclass
class ResearchSignal:
    """Research signal with severity level"""
    id: str
    timestamp: datetime
    severity: SignalSeverity
    source: str
    protocol: str
    title: str
    summary: str
    details: Dict[str, Any]
    recommended_action: str
    url: Optional[str] = None


class ResearchAgent:
    """
    Research Agent that monitors protocols and security incidents
    """

    PROTOCOLS = [
        {"name": "Aave", "governance_url": "https://governance.aave.com", "defillama_slug": "aave"},
        {"name": "Compound", "governance_url": "https://compound.finance/governance", "defillama_slug": "compound-finance"},
        {"name": "Maker", "governance_url": "https://forum.makerdao.com", "defillama_slug": "makerdao"},
    ]

    STABLECOINS = [
        {"symbol": "USDC", "address": "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"},
        {"symbol": "DAI", "address": "0x6b175474e89094c44da98b954eedc46db2dafc7"},
        {"symbol": "USDT", "address": "0xdac17f958d2ee523a2206206994597c13d831ec7"},
    ]

    def __init__(
        self,
        anthropic_api_key: str,
        redis_url: str,
        discord_webhook_url: Optional[str] = None,
        defillama_api: str = "https://api.llama.fi"
    ):
        self.client = anthropic.Anthropic(api_key=anthropic_api_key)
        self.redis_url = redis_url
        self.discord_webhook_url = discord_webhook_url
        self.defillama_api = defillama_api
        self.redis: Optional[redis.Redis] = None
        self.session: Optional[aiohttp.ClientSession] = None

    async def initialize(self):
        """Initialize connections"""
        self.redis = redis.from_url(self.redis_url)
        self.session = aiohttp.ClientSession()

    async def close(self):
        """Clean up resources"""
        if self.redis:
            await self.redis.close()
        if self.session:
            await self.session.close()

    async def run_monitoring_cycle(self) -> List[ResearchSignal]:
        """Run a complete monitoring cycle"""
        signals = []
        
        # Monitor governance forums
        gov_signals = await self._monitor_governance()
        signals.extend(gov_signals)
        
        # Monitor TVL changes
        tvl_signals = await self._monitor_tvl_changes()
        signals.extend(tvl_signals)
        
        # Monitor stablecoin prices
        stable_signals = await self._monitor_stablecoin_prices()
        signals.extend(stable_signals)
        
        # Search for security incidents
        security_signals = await self._search_security_incidents()
        signals.extend(security_signals)
        
        # Store signals in Redis
        for signal in signals:
            await self._store_signal(signal)
            
            # Send Discord alert for HIGH/CRITICAL
            if signal.severity in [SignalSeverity.HIGH, SignalSeverity.CRITICAL]:
                await self._send_discord_alert(signal)
        
        return signals

    async def _monitor_governance(self) -> List[ResearchSignal]:
        """Monitor governance forums for proposals"""
        signals = []
        
        for protocol in self.PROTOCOLS:
            try:
                # Scrape governance page
                async with self.session.get(protocol["governance_url"]) as resp:
                    if resp.status != 200:
                        continue
                    
                    html = await resp.text()
                    soup = BeautifulSoup(html, 'html.parser')
                    
                    # Look for proposal keywords (simplified)
                    proposals = soup.find_all(['h2', 'h3', 'a'], string=lambda t: t and any(
                        kw in t.lower() for kw in ['proposal', 'vote', 'governance', 'upgrade']
                    ))
                    
                    for proposal in proposals[:5]:  # Limit to recent
                        text = proposal.get_text()
                        
                        # Analyze with Claude
                        analysis = await self._analyze_governance_proposal(
                            protocol["name"], text
                        )
                        
                        if analysis:
                            signals.append(ResearchSignal(
                                id=f"gov_{protocol['name']}_{datetime.utcnow().timestamp()}",
                                timestamp=datetime.utcnow(),
                                severity=analysis["severity"],
                                source="governance_forum",
                                protocol=protocol["name"],
                                title=text[:100],
                                summary=analysis["summary"],
                                details=analysis,
                                recommended_action=analysis["recommended_action"],
                                url=protocol["governance_url"]
                            ))
                            
            except Exception as e:
                logger.error(f"Governance monitoring failed for {protocol['name']}: {e}")
        
        return signals

    async def _analyze_governance_proposal(
        self,
        protocol: str,
        proposal_text: str
    ) -> Optional[Dict]:
        """Analyze governance proposal using Claude"""
        try:
            message = self.client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=1000,
                messages=[{
                    "role": "user",
                    "content": f"""Analyze this governance proposal for {protocol}:

{proposal_text}

Assess the risk to yield vault depositors. Respond with JSON:
{{
    "severity": "INFO|LOW|MEDIUM|HIGH|CRITICAL",
    "summary": "brief summary",
    "risk_factors": ["factor1", "factor2"],
    "recommended_action": "action to take"
}}"""
                }]
            )
            
            response = message.content[0].text
            json_start = response.find('{')
            json_end = response.rfind('}') + 1
            return json.loads(response[json_start:json_end])
            
        except Exception as e:
            logger.error(f"Proposal analysis failed: {e}")
            return None

    async def _monitor_tvl_changes(self) -> List[ResearchSignal]:
        """Monitor protocol TVL changes via DefiLlama"""
        signals = []
        
        for protocol in self.PROTOCOLS:
            try:
                url = f"{self.defillama_api}/protocol/{protocol['defillama_slug']}"
                async with self.session.get(url) as resp:
                    if resp.status != 200:
                        continue
                    
                    data = await resp.json()
                    
                    # Calculate TVL changes
                    tvl_history = data.get("tvl", [])
                    if len(tvl_history) < 2:
                        continue
                    
                    current_tvl = tvl_history[-1].get("totalLiquidityUSD", 0)
                    day_ago_tvl = tvl_history[-2].get("totalLiquidityUSD", 0)
                    
                    if day_ago_tvl == 0:
                        continue
                    
                    change_pct = ((current_tvl - day_ago_tvl) / day_ago_tvl) * 100
                    
                    # Alert on significant changes
                    if abs(change_pct) >= 10:
                        severity = SignalSeverity.HIGH if abs(change_pct) >= 20 else SignalSeverity.MEDIUM
                        
                        signals.append(ResearchSignal(
                            id=f"tvl_{protocol['name']}_{datetime.utcnow().timestamp()}",
                            timestamp=datetime.utcnow(),
                            severity=severity,
                            source="defillama",
                            protocol=protocol["name"],
                            title=f"{protocol['name']} TVL {'+' if change_pct > 0 else ''}{change_pct:.1f}%",
                            summary=f"TVL changed from ${day_ago_tvl/1e9:.2f}B to ${current_tvl/1e9:.2f}B",
                            details={
                                "current_tvl": current_tvl,
                                "previous_tvl": day_ago_tvl,
                                "change_pct": change_pct
                            },
                            recommended_action="Review allocation" if change_pct < -10 else "Monitor"
                        ))
                        
            except Exception as e:
                logger.error(f"TVL monitoring failed for {protocol['name']}: {e}")
        
        return signals

    async def _monitor_stablecoin_prices(self) -> List[ResearchSignal]:
        """Monitor stablecoin prices from Chainlink"""
        signals = []
        
        # Use CoinGecko as backup
        try:
            ids = "usd-coin,dai,tether"
            url = f"https://api.coingecko.com/api/v3/simple/price?ids={ids}&vs_currencies=usd"
            
            async with self.session.get(url) as resp:
                if resp.status != 200:
                    return signals
                
                prices = await resp.json()
                
                # Check for depegs
                for coin_id, symbol in [("usd-coin", "USDC"), ("dai", "DAI"), ("tether", "USDT")]:
                    if coin_id not in prices:
                        continue
                    
                    price = prices[coin_id]["usd"]
                    deviation = abs(price - 1.0) * 100
                    
                    if deviation >= 0.5:  # 0.5% deviation
                        severity = SignalSeverity.CRITICAL if deviation >= 2 else SignalSeverity.HIGH
                        
                        signals.append(ResearchSignal(
                            id=f"depeg_{symbol}_{datetime.utcnow().timestamp()}",
                            timestamp=datetime.utcnow(),
                            severity=severity,
                            source="price_feed",
                            protocol=symbol,
                            title=f"{symbol} Depeg Alert: ${price:.4f}",
                            summary=f"{symbol} trading at ${price:.4f}, {deviation:.2f}% off peg",
                            details={
                                "symbol": symbol,
                                "price": price,
                                "deviation_pct": deviation
                            },
                            recommended_action="Exit positions immediately" if severity == SignalSeverity.CRITICAL else "Monitor closely"
                        ))
                        
        except Exception as e:
            logger.error(f"Stablecoin monitoring failed: {e}")
        
        return signals

    async def _search_security_incidents(self) -> List[ResearchSignal]:
        """Search for security incidents using Claude with web search"""
        signals = []
        
        try:
            # Use Claude to search for recent security incidents
            message = self.client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=2000,
                messages=[{
                    "role": "user",
                    "content": """Search for any recent DeFi security incidents, hacks, or exploits 
in the past 24 hours affecting Aave, Compound, Maker, or major stablecoins (USDC, DAI, USDT).

For each incident found, provide:
{{
    "incidents": [
        {{
            "protocol": "affected protocol",
            "severity": "LOW|MEDIUM|HIGH|CRITICAL",
            "title": "brief title",
            "summary": "what happened",
            "amount_lost": "if applicable",
            "recommended_action": "what to do"
        }}
    ]
}}

If no incidents found, return: {{"incidents": []}}"""
                }]
            )
            
            response = message.content[0].text
            
            # Parse response
            json_start = response.find('{')
            json_end = response.rfind('}') + 1
            data = json.loads(response[json_start:json_end])
            
            for incident in data.get("incidents", []):
                severity_map = {
                    "LOW": SignalSeverity.LOW,
                    "MEDIUM": SignalSeverity.MEDIUM,
                    "HIGH": SignalSeverity.HIGH,
                    "CRITICAL": SignalSeverity.CRITICAL
                }
                
                signals.append(ResearchSignal(
                    id=f"security_{incident['protocol']}_{datetime.utcnow().timestamp()}",
                    timestamp=datetime.utcnow(),
                    severity=severity_map.get(incident["severity"], SignalSeverity.HIGH),
                    source="security_search",
                    protocol=incident["protocol"],
                    title=incident["title"],
                    summary=incident["summary"],
                    details=incident,
                    recommended_action=incident["recommended_action"]
                ))
                
        except Exception as e:
            logger.error(f"Security search failed: {e}")
        
        return signals

    async def _store_signal(self, signal: ResearchSignal):
        """Store signal in Redis"""
        key = f"research_signal:{signal.id}"
        
        data = {
            "id": signal.id,
            "timestamp": signal.timestamp.isoformat(),
            "severity": signal.severity.value,
            "source": signal.source,
            "protocol": signal.protocol,
            "title": signal.title,
            "summary": signal.summary,
            "details": json.dumps(signal.details),
            "recommended_action": signal.recommended_action,
            "url": signal.url
        }
        
        await self.redis.hset(key, mapping=data)
        await self.redis.expire(key, 86400 * 7)  # 7 day TTL
        
        # Add to sorted set for timeline
        await self.redis.zadd(
            "research_signals",
            {signal.id: signal.timestamp.timestamp()}
        )
        
        # Publish to channel
        await self.redis.publish(
            "research_signals_channel",
            json.dumps(asdict(signal), default=str)
        )

    async def _send_discord_alert(self, signal: ResearchSignal):
        """Send Discord webhook for high severity signals"""
        if not self.discord_webhook_url:
            return
        
        try:
            color_map = {
                SignalSeverity.HIGH: 0xFF9900,      # Orange
                SignalSeverity.CRITICAL: 0xFF0000   # Red
            }
            
            embed = {
                "title": f"🚨 {signal.severity.value}: {signal.title}",
                "description": signal.summary,
                "color": color_map.get(signal.severity, 0xFF0000),
                "fields": [
                    {"name": "Protocol", "value": signal.protocol, "inline": True},
                    {"name": "Source", "value": signal.source, "inline": True},
                    {"name": "Action", "value": signal.recommended_action, "inline": False}
                ],
                "timestamp": signal.timestamp.isoformat()
            }
            
            if signal.url:
                embed["url"] = signal.url
            
            payload = {"embeds": [embed]}
            
            async with self.session.post(
                self.discord_webhook_url,
                json=payload
            ) as resp:
                if resp.status != 204:
                    logger.warning(f"Discord webhook failed: {resp.status}")
                    
        except Exception as e:
            logger.error(f"Discord alert failed: {e}")

    async def get_recent_signals(
        self,
        limit: int = 50,
        severity_filter: Optional[SignalSeverity] = None
    ) -> List[ResearchSignal]:
        """Get recent signals from Redis"""
        signal_ids = await self.redis.zrevrange(
            "research_signals",
            0,
            limit - 1
        )
        
        signals = []
        for signal_id in signal_ids:
            key = f"research_signal:{signal_id.decode()}"
            data = await self.redis.hgetall(key)
            
            if not data:
                continue
            
            severity = SignalSeverity(data[b"severity"].decode())
            
            if severity_filter and severity != severity_filter:
                continue
            
            signals.append(ResearchSignal(
                id=data[b"id"].decode(),
                timestamp=datetime.fromisoformat(data[b"timestamp"].decode()),
                severity=severity,
                source=data[b"source"].decode(),
                protocol=data[b"protocol"].decode(),
                title=data[b"title"].decode(),
                summary=data[b"summary"].decode(),
                details=json.loads(data[b"details"].decode()),
                recommended_action=data[b"recommended_action"].decode(),
                url=data[b"url"].decode() if data.get(b"url") else None
            ))
        
        return signals
