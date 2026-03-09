"""
PHASE 1 — Channel 2: Macro & Geopolitical Sentiment
The bot's "ears" listening to the world.

Tracks:
  • Crypto Fear & Greed Index
  • BTC-related news sentiment (via public APIs)
  • DXY / Dollar strength proxy (inverse correlation with BTC)
  • Gold correlation (risk-on/risk-off signal)
"""

import asyncio
import aiohttp
import re
from loguru import logger
from datetime import datetime, timezone


class MacroSentimentChannel:
    """Score: 0–100. >60 = bullish macro, <40 = bearish."""

    def __init__(self, config):
        self.config = config
        self.session = None

    async def _get_session(self):
        if self.session is None or self.session.closed:
            self.session = aiohttp.ClientSession(
                timeout=aiohttp.ClientTimeout(total=15),
                headers={"accept": "application/json"},
            )
        return self.session

    async def close(self):
        if self.session and not self.session.closed:
            await self.session.close()

    # ─── MAIN SCORE ─────────────────────────────────────────
    async def get_score(self) -> dict:
        try:
            results = await asyncio.gather(
                self._fear_greed_index(),
                self._news_sentiment(),
                self._dollar_strength(),
                self._risk_appetite(),
                return_exceptions=True,
            )

            fg = results[0] if not isinstance(results[0], Exception) else {"score": 50, "detail": "unavailable"}
            news = results[1] if not isinstance(results[1], Exception) else {"score": 50, "detail": "unavailable"}
            dxy = results[2] if not isinstance(results[2], Exception) else {"score": 50, "detail": "unavailable"}
            risk = results[3] if not isinstance(results[3], Exception) else {"score": 50, "detail": "unavailable"}

            composite = (
                fg["score"] * 0.30
                + news["score"] * 0.25
                + dxy["score"] * 0.25
                + risk["score"] * 0.20
            )

            direction = "long" if composite > 60 else ("short" if composite < 40 else "neutral")

            return {
                "score": round(composite, 1),
                "direction": direction,
                "channel": "macro_sentiment",
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "details": {
                    "fear_greed": fg,
                    "news_sentiment": news,
                    "dollar_strength": dxy,
                    "risk_appetite": risk,
                },
            }
        except Exception as e:
            logger.error(f"MacroSentimentChannel error: {e}")
            return {"score": 50, "direction": "neutral", "channel": "macro_sentiment", "details": {"error": str(e)}}

    # ─── SUB-SIGNALS ────────────────────────────────────────

    async def _fear_greed_index(self) -> dict:
        """
        Crypto Fear & Greed: 0 = Extreme Fear, 100 = Extreme Greed.
        Contrarian: extreme fear → bullish opportunity.
        But for 15-min bot, momentum matters more — greed = continuation.
        Blend: 60% momentum (greed=bullish), 40% contrarian (fear=opportunity).
        """
        try:
            session = await self._get_session()
            url = self.config.FEAR_GREED_URL
            async with session.get(url, params={"limit": 2}) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    entries = data.get("data", [])
                    if entries:
                        current = int(entries[0].get("value", 50))
                        prev = int(entries[1].get("value", 50)) if len(entries) > 1 else current
                        label = entries[0].get("value_classification", "Neutral")

                        # Momentum component: greed = bullish
                        momentum_score = current

                        # Contrarian component: extreme fear → opportunity
                        contrarian_score = 100 - current if current < 25 else (0 if current > 80 else 50)

                        # Trend: improving sentiment = bullish
                        trend_bonus = (current - prev) * 0.5

                        score = momentum_score * 0.60 + contrarian_score * 0.40 + trend_bonus
                        return {
                            "score": round(max(0, min(100, score)), 1),
                            "detail": f"F&G={current} ({label}), prev={prev}",
                        }

            return {"score": 50, "detail": "no F&G data"}
        except Exception as e:
            logger.warning(f"Fear & Greed error: {e}")
            return {"score": 50, "detail": str(e)}

    async def _news_sentiment(self) -> dict:
        """
        Scan crypto news headlines for bullish/bearish keywords.
        Uses CryptoCompare news API (free, no key needed) + keyword scoring.
        """
        try:
            session = await self._get_session()

            # CryptoCompare public news feed
            url = "https://min-api.cryptocompare.com/data/v2/news/?lang=EN&categories=BTC"
            headers = {}
            if self.config.CRYPTOCOMPARE_API_KEY:
                headers["Authorization"] = f"Apikey {self.config.CRYPTOCOMPARE_API_KEY}"

            async with session.get(url, headers=headers) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    articles = data.get("Data", [])[:20]

                    if not articles:
                        return {"score": 50, "detail": "no articles"}

                    bullish_kw = [
                        "surge", "soar", "rally", "bullish", "breakout", "pump",
                        "all-time high", "ath", "buy", "accumulate", "etf approved",
                        "adoption", "institutional", "upgrade", "milestone",
                        "moon", "parabolic", "breakthrough", "support",
                    ]
                    bearish_kw = [
                        "crash", "plunge", "dump", "bearish", "sell-off", "selloff",
                        "ban", "hack", "exploit", "fraud", "sec", "regulation",
                        "fear", "panic", "collapse", "liquidat", "bankrupt",
                        "lawsuit", "crackdown", "reject",
                    ]

                    bull_hits = 0
                    bear_hits = 0

                    for art in articles:
                        text = (art.get("title", "") + " " + art.get("body", "")[:200]).lower()
                        for kw in bullish_kw:
                            if kw in text:
                                bull_hits += 1
                        for kw in bearish_kw:
                            if kw in text:
                                bear_hits += 1

                    total = bull_hits + bear_hits
                    if total > 0:
                        ratio = bull_hits / total
                        score = ratio * 100
                    else:
                        score = 50  # neutral

                    return {
                        "score": round(max(0, min(100, score)), 1),
                        "detail": f"bull={bull_hits}, bear={bear_hits}, articles={len(articles)}",
                    }

            return {"score": 50, "detail": "news API failed"}
        except Exception as e:
            logger.warning(f"News sentiment error: {e}")
            return {"score": 50, "detail": str(e)}

    async def _dollar_strength(self) -> dict:
        """
        DXY proxy: BTC typically moves inversely to USD strength.
        Use EUR/USD from Binance as proxy (EURUSDT not available, use gold or stablecoin flows).
        Fallback: USDT market cap changes as dollar strength proxy.
        """
        try:
            session = await self._get_session()

            # Use BTC dominance shift as macro proxy
            url = "https://api.coingecko.com/api/v3/global"
            async with session.get(url) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    global_data = data.get("data", {})
                    btc_dom = global_data.get("market_cap_percentage", {}).get("btc", 50)
                    market_cap_change = global_data.get("market_cap_change_percentage_24h_usd", 0)

                    # Rising BTC dominance + positive market = strong BTC (bullish)
                    # Falling market cap = risk-off = bearish for BTC
                    score = 50

                    if market_cap_change > 2:
                        score += 15  # strong risk-on
                    elif market_cap_change > 0:
                        score += 7
                    elif market_cap_change < -2:
                        score -= 15  # risk-off
                    elif market_cap_change < 0:
                        score -= 7

                    # BTC dominance > 55% = flight to quality within crypto
                    if btc_dom > 55:
                        score += 5
                    elif btc_dom < 40:
                        score -= 5

                    return {
                        "score": round(max(0, min(100, score)), 1),
                        "detail": f"btc_dom={btc_dom:.1f}%, mkt_Δ={market_cap_change:+.1f}%",
                    }

            return {"score": 50, "detail": "no macro data"}
        except Exception as e:
            logger.warning(f"Dollar strength error: {e}")
            return {"score": 50, "detail": str(e)}

    async def _risk_appetite(self) -> dict:
        """
        Risk-on vs risk-off gauge.
        Compare BTC performance vs ETH (risk-on altcoin proxy).
        If ETH outperforming BTC → risk-on → generally bullish for crypto.
        """
        try:
            session = await self._get_session()

            # Fetch BTC and ETH 4h candles
            btc_url = f"{self.config.BINANCE_REST}/api/v3/klines?symbol=BTCUSDT&interval=4h&limit=2"
            eth_url = f"{self.config.BINANCE_REST}/api/v3/klines?symbol=ETHUSDT&interval=4h&limit=2"

            async with session.get(btc_url) as btc_resp, session.get(eth_url) as eth_resp:
                if btc_resp.status == 200 and eth_resp.status == 200:
                    btc_klines = await btc_resp.json()
                    eth_klines = await eth_resp.json()

                    if btc_klines and eth_klines:
                        btc_change = (float(btc_klines[-1][4]) - float(btc_klines[0][1])) / float(btc_klines[0][1]) * 100
                        eth_change = (float(eth_klines[-1][4]) - float(eth_klines[0][1])) / float(eth_klines[0][1]) * 100

                        # ETH outperforming = risk-on = bullish environment
                        eth_btc_spread = eth_change - btc_change

                        score = 50
                        if eth_btc_spread > 1:
                            score += 15  # strong risk-on
                        elif eth_btc_spread > 0:
                            score += 7
                        elif eth_btc_spread < -1:
                            score -= 10  # flight to safety (can still be BTC bullish)
                        else:
                            score -= 3

                        # Absolute BTC strength matters too
                        if btc_change > 1:
                            score += 10
                        elif btc_change < -1:
                            score -= 10

                        return {
                            "score": round(max(0, min(100, score)), 1),
                            "detail": f"BTC={btc_change:+.2f}%, ETH={eth_change:+.2f}%, spread={eth_btc_spread:+.2f}%",
                        }

            return {"score": 50, "detail": "no risk data"}
        except Exception as e:
            logger.warning(f"Risk appetite error: {e}")
            return {"score": 50, "detail": str(e)}
