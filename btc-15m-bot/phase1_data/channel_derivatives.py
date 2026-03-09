"""
PHASE 1 — Channel 4: Derivatives Market Positioning & Leverage
The bot's "pulse check" on leveraged traders.

Tracks:
  • Funding rates (who's paying who)
  • Open interest changes (new money entering)
  • Long/short ratio (crowd positioning)
  • Liquidation heatmap zones
"""

import asyncio
import aiohttp
import numpy as np
from loguru import logger
from datetime import datetime, timezone


class DerivativesChannel:
    """Score: 0–100. >60 = bullish derivatives positioning, <40 = bearish."""

    def __init__(self, config):
        self.config = config
        self.session = None

    async def _get_session(self):
        if self.session is None or self.session.closed:
            self.session = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=15))
        return self.session

    async def close(self):
        if self.session and not self.session.closed:
            await self.session.close()

    # ─── MAIN SCORE ─────────────────────────────────────────
    async def get_score(self) -> dict:
        try:
            results = await asyncio.gather(
                self._funding_rate(),
                self._open_interest(),
                self._long_short_ratio(),
                self._leverage_heatmap(),
                return_exceptions=True,
            )

            funding = results[0] if not isinstance(results[0], Exception) else {"score": 50, "detail": "unavailable"}
            oi = results[1] if not isinstance(results[1], Exception) else {"score": 50, "detail": "unavailable"}
            ls_ratio = results[2] if not isinstance(results[2], Exception) else {"score": 50, "detail": "unavailable"}
            leverage = results[3] if not isinstance(results[3], Exception) else {"score": 50, "detail": "unavailable"}

            composite = (
                funding["score"] * 0.30
                + oi["score"] * 0.25
                + ls_ratio["score"] * 0.25
                + leverage["score"] * 0.20
            )

            direction = "long" if composite > 60 else ("short" if composite < 40 else "neutral")

            return {
                "score": round(composite, 1),
                "direction": direction,
                "channel": "derivatives",
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "details": {
                    "funding_rate": funding,
                    "open_interest": oi,
                    "long_short_ratio": ls_ratio,
                    "leverage_heatmap": leverage,
                },
            }
        except Exception as e:
            logger.error(f"DerivativesChannel error: {e}")
            return {"score": 50, "direction": "neutral", "channel": "derivatives", "details": {"error": str(e)}}

    # ─── SUB-SIGNALS ────────────────────────────────────────

    async def _funding_rate(self) -> dict:
        """
        Funding rate = cost of holding leveraged positions.
        Positive = longs pay shorts → market overleveraged long → contrarian bearish.
        Negative = shorts pay longs → market overleveraged short → contrarian bullish.

        For 15-min: extreme funding = reversal likely.
        """
        try:
            session = await self._get_session()

            # Binance Futures funding rate
            url = f"https://fapi.binance.com/fapi/v1/fundingRate"
            params = {"symbol": "BTCUSDT", "limit": 8}  # last 8 periods
            async with session.get(url, params=params) as resp:
                if resp.status == 200:
                    rates = await resp.json()
                    if rates:
                        current_rate = float(rates[-1].get("fundingRate", 0))
                        avg_rate = sum(float(r.get("fundingRate", 0)) for r in rates) / len(rates)

                        # Extreme positive funding (>0.05%) → longs overleveraged → bearish
                        # Extreme negative funding (<-0.03%) → shorts overleveraged → bullish
                        # Neutral (±0.01%) → balanced

                        if current_rate > 0.001:  # >0.1%
                            score = 15  # extremely bullish crowd = contrarian sell
                        elif current_rate > 0.0005:  # >0.05%
                            score = 30
                        elif current_rate > 0.0001:  # >0.01%
                            score = 45
                        elif current_rate > -0.0001:
                            score = 55  # neutral-slightly bullish
                        elif current_rate > -0.0003:
                            score = 65  # shorts paying → bullish
                        elif current_rate > -0.0005:
                            score = 75
                        else:
                            score = 85  # extreme negative = bullish

                        # Trend: funding getting more negative = shorts building = bullish
                        if len(rates) >= 4:
                            recent = sum(float(r["fundingRate"]) for r in rates[-2:]) / 2
                            older = sum(float(r["fundingRate"]) for r in rates[:2]) / 2
                            if recent < older:
                                score += 5  # funding decreasing = bullish
                            elif recent > older:
                                score -= 5

                        return {
                            "score": round(max(0, min(100, score)), 1),
                            "detail": f"funding={current_rate:.6f}, avg={avg_rate:.6f}",
                        }

            return {"score": 50, "detail": "no funding data"}
        except Exception as e:
            logger.warning(f"Funding rate error: {e}")
            return {"score": 50, "detail": str(e)}

    async def _open_interest(self) -> dict:
        """
        Open Interest = total outstanding contracts.
        Rising OI + rising price = new longs (bullish continuation).
        Rising OI + falling price = new shorts (bearish continuation).
        Falling OI + rising price = short covering (weak rally).
        Falling OI + falling price = long liquidation (capitulation → bottom near).
        """
        try:
            session = await self._get_session()

            # Current OI
            url = "https://fapi.binance.com/fapi/v1/openInterest"
            async with session.get(url, params={"symbol": "BTCUSDT"}) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    current_oi = float(data.get("openInterest", 0))

            # Historical OI (last 30 periods of 15m)
            hist_url = "https://fapi.binance.com/futures/data/openInterestHist"
            params = {"symbol": "BTCUSDT", "period": "15m", "limit": 30}
            async with session.get(hist_url, params=params) as resp:
                if resp.status == 200:
                    hist = await resp.json()
                    if hist and len(hist) >= 2:
                        oi_values = [float(h.get("sumOpenInterest", 0)) for h in hist]
                        oi_change_pct = (oi_values[-1] - oi_values[0]) / max(oi_values[0], 1) * 100

                        # Get price direction for context
                        price_url = f"{self.config.BINANCE_REST}/api/v3/klines?symbol=BTCUSDT&interval=15m&limit=30"
                        async with session.get(price_url) as price_resp:
                            if price_resp.status == 200:
                                klines = await price_resp.json()
                                price_change = (float(klines[-1][4]) - float(klines[0][1])) / float(klines[0][1]) * 100

                                # Classify regime
                                if oi_change_pct > 2 and price_change > 0.3:
                                    score = 75  # new longs → bullish
                                    regime = "new_longs"
                                elif oi_change_pct > 2 and price_change < -0.3:
                                    score = 25  # new shorts → bearish
                                    regime = "new_shorts"
                                elif oi_change_pct < -2 and price_change > 0.3:
                                    score = 55  # short covering → weak rally
                                    regime = "short_covering"
                                elif oi_change_pct < -2 and price_change < -0.3:
                                    score = 60  # capitulation → bottom near
                                    regime = "capitulation"
                                else:
                                    score = 50
                                    regime = "neutral"

                                return {
                                    "score": round(score, 1),
                                    "detail": f"OI_Δ={oi_change_pct:+.2f}%, price_Δ={price_change:+.2f}%, regime={regime}",
                                }

            return {"score": 50, "detail": "no OI data"}
        except Exception as e:
            logger.warning(f"Open interest error: {e}")
            return {"score": 50, "detail": str(e)}

    async def _long_short_ratio(self) -> dict:
        """
        Top trader long/short ratio from Binance Futures.
        Contrarian: if everyone is long, be cautious.
        """
        try:
            session = await self._get_session()

            # Top traders long/short ratio
            url = "https://fapi.binance.com/futures/data/topLongShortPositionRatio"
            params = {"symbol": "BTCUSDT", "period": "15m", "limit": 8}
            async with session.get(url, params=params) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    if data:
                        current = float(data[-1].get("longShortRatio", 1.0))
                        long_pct = float(data[-1].get("longAccount", 0.5))
                        short_pct = float(data[-1].get("shortAccount", 0.5))

                        # Trend in ratio
                        if len(data) >= 4:
                            prev_ratio = float(data[-4].get("longShortRatio", 1.0))
                            ratio_change = current - prev_ratio
                        else:
                            ratio_change = 0

                        # Scoring: contrarian approach
                        # Ratio >2.0 = too many longs → bearish signal
                        # Ratio <0.5 = too many shorts → bullish signal
                        # Ratio 0.8-1.2 = balanced → use trend
                        if current > 2.5:
                            score = 20  # extreme long crowding
                        elif current > 1.8:
                            score = 30
                        elif current > 1.3:
                            score = 40
                        elif current > 0.8:
                            score = 55  # balanced, slight long bias = ok
                        elif current > 0.5:
                            score = 65  # more shorts = bullish
                        elif current > 0.3:
                            score = 75
                        else:
                            score = 85  # extreme short crowding → bullish

                        # Trend bonus
                        if ratio_change < -0.2:
                            score += 5  # longs decreasing = healthy
                        elif ratio_change > 0.2:
                            score -= 5  # longs increasing = crowded

                        return {
                            "score": round(max(0, min(100, score)), 1),
                            "detail": f"L/S={current:.2f}, long={long_pct:.1%}, short={short_pct:.1%}, Δ={ratio_change:+.2f}",
                        }

            return {"score": 50, "detail": "no L/S data"}
        except Exception as e:
            logger.warning(f"Long/short ratio error: {e}")
            return {"score": 50, "detail": str(e)}

    async def _leverage_heatmap(self) -> dict:
        """
        Estimate liquidation zones based on OI and price levels.
        If price is approaching a liquidation cluster → expect volatility.
        """
        try:
            session = await self._get_session()

            # Get current price and recent range
            url = f"{self.config.BINANCE_REST}/api/v3/klines?symbol=BTCUSDT&interval=15m&limit=48"
            async with session.get(url) as resp:
                if resp.status == 200:
                    klines = await resp.json()
                    if klines:
                        current = float(klines[-1][4])
                        high_12h = max(float(k[2]) for k in klines)
                        low_12h = min(float(k[3]) for k in klines)
                        range_pct = (high_12h - low_12h) / current * 100

                        # Estimate liquidation zones (typical 3x-10x leverage)
                        # Longs liquidated below: current * (1 - 1/leverage)
                        # Shorts liquidated above: current * (1 + 1/leverage)
                        long_liq_5x = current * 0.80  # 5x longs liq at -20%
                        long_liq_10x = current * 0.90  # 10x at -10%
                        long_liq_20x = current * 0.95  # 20x at -5%
                        short_liq_5x = current * 1.20  # 5x shorts liq at +20%
                        short_liq_10x = current * 1.10  # 10x at +10%
                        short_liq_20x = current * 1.05  # 20x at +5%

                        # Distance to nearest major liquidation zone
                        dist_to_short_liq = (short_liq_20x - current) / current * 100
                        dist_to_long_liq = (current - long_liq_20x) / current * 100

                        score = 50

                        # If we're closer to short liquidation cluster → bullish cascade potential
                        if dist_to_short_liq < 3:
                            score = 70  # approaching short squeeze zone
                        elif dist_to_long_liq < 3:
                            score = 30  # approaching long liquidation

                        # Tight range = coiled spring
                        if range_pct < 2:
                            # Tight range → look at which direction has more liquidations
                            if dist_to_short_liq < dist_to_long_liq:
                                score += 5  # more likely to squeeze shorts
                            else:
                                score -= 5

                        return {
                            "score": round(max(0, min(100, score)), 1),
                            "detail": f"range={range_pct:.1f}%, short_liq_dist={dist_to_short_liq:.1f}%, long_liq_dist={dist_to_long_liq:.1f}%",
                        }

            return {"score": 50, "detail": "no heatmap data"}
        except Exception as e:
            logger.warning(f"Leverage heatmap error: {e}")
            return {"score": 50, "detail": str(e)}
