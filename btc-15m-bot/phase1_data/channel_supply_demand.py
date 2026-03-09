"""
PHASE 1 — Channel 3: Structural Supply-Demand Imbalances
The bot's "technical analysis" brain.

Tracks:
  • Price action (15m candles, support/resistance)
  • Volume profile (OBV, VWAP deviation)
  • Momentum indicators (RSI, MACD-like)
  • Bollinger Band squeeze/expansion
"""

import asyncio
import aiohttp
import numpy as np
from loguru import logger
from datetime import datetime, timezone


class SupplyDemandChannel:
    """Score: 0–100. >60 = bullish structure, <40 = bearish."""

    def __init__(self, config):
        self.config = config
        self.session = None
        self._kline_cache = None
        self._kline_ts = 0

    async def _get_session(self):
        if self.session is None or self.session.closed:
            self.session = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=15))
        return self.session

    async def close(self):
        if self.session and not self.session.closed:
            await self.session.close()

    # ─── FETCH CANDLES ──────────────────────────────────────
    async def _fetch_klines(self, interval="15m", limit=96):
        """Fetch BTC 15m candles from Binance. 96 candles = 24h."""
        now = asyncio.get_event_loop().time()
        if self._kline_cache is not None and (now - self._kline_ts) < 60:
            return self._kline_cache

        session = await self._get_session()
        url = f"{self.config.BINANCE_REST}/api/v3/klines"
        params = {"symbol": "BTCUSDT", "interval": interval, "limit": limit}
        async with session.get(url, params=params) as resp:
            if resp.status == 200:
                raw = await resp.json()
                klines = {
                    "open": np.array([float(k[1]) for k in raw]),
                    "high": np.array([float(k[2]) for k in raw]),
                    "low": np.array([float(k[3]) for k in raw]),
                    "close": np.array([float(k[4]) for k in raw]),
                    "volume": np.array([float(k[5]) for k in raw]),
                    "close_time": [int(k[6]) for k in raw],
                }
                self._kline_cache = klines
                self._kline_ts = now
                return klines
        return None

    # ─── MAIN SCORE ─────────────────────────────────────────
    async def get_score(self) -> dict:
        try:
            klines = await self._fetch_klines()
            if klines is None:
                return {"score": 50, "direction": "neutral", "channel": "supply_demand", "details": {"error": "no kline data"}}

            results = await asyncio.gather(
                asyncio.coroutine(lambda: self._rsi_score(klines))() if asyncio.iscoroutinefunction(self._rsi_score) else asyncio.get_event_loop().run_in_executor(None, self._rsi_score, klines),
                asyncio.get_event_loop().run_in_executor(None, self._obv_score, klines),
                asyncio.get_event_loop().run_in_executor(None, self._bollinger_score, klines),
                asyncio.get_event_loop().run_in_executor(None, self._vwap_score, klines),
                asyncio.get_event_loop().run_in_executor(None, self._momentum_score, klines),
                asyncio.get_event_loop().run_in_executor(None, self._support_resistance_score, klines),
                return_exceptions=True,
            )

            rsi = results[0] if not isinstance(results[0], Exception) else {"score": 50, "detail": "err"}
            obv = results[1] if not isinstance(results[1], Exception) else {"score": 50, "detail": "err"}
            bb = results[2] if not isinstance(results[2], Exception) else {"score": 50, "detail": "err"}
            vwap = results[3] if not isinstance(results[3], Exception) else {"score": 50, "detail": "err"}
            momentum = results[4] if not isinstance(results[4], Exception) else {"score": 50, "detail": "err"}
            sr = results[5] if not isinstance(results[5], Exception) else {"score": 50, "detail": "err"}

            composite = (
                rsi["score"] * 0.20
                + obv["score"] * 0.15
                + bb["score"] * 0.15
                + vwap["score"] * 0.15
                + momentum["score"] * 0.20
                + sr["score"] * 0.15
            )

            direction = "long" if composite > 60 else ("short" if composite < 40 else "neutral")

            return {
                "score": round(composite, 1),
                "direction": direction,
                "channel": "supply_demand",
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "details": {
                    "rsi": rsi,
                    "obv": obv,
                    "bollinger": bb,
                    "vwap": vwap,
                    "momentum": momentum,
                    "support_resistance": sr,
                },
            }
        except Exception as e:
            logger.error(f"SupplyDemandChannel error: {e}")
            return {"score": 50, "direction": "neutral", "channel": "supply_demand", "details": {"error": str(e)}}

    # ─── INDICATORS ─────────────────────────────────────────

    def _rsi_score(self, klines) -> dict:
        """RSI 14 on 15m candles. <30 = oversold (bullish), >70 = overbought (bearish)."""
        closes = klines["close"]
        period = self.config.RSI_PERIOD

        deltas = np.diff(closes)
        gains = np.where(deltas > 0, deltas, 0)
        losses = np.where(deltas < 0, -deltas, 0)

        avg_gain = np.mean(gains[-period:])
        avg_loss = np.mean(losses[-period:])

        if avg_loss == 0:
            rsi = 100
        else:
            rs = avg_gain / avg_loss
            rsi = 100 - (100 / (1 + rs))

        # For 15-min trading: momentum matters
        # RSI 50-70 = healthy uptrend = bullish
        # RSI 30-50 = healthy downtrend = bearish
        # RSI >80 = overbought (reversal risk)
        # RSI <20 = oversold (bounce expected)
        if rsi > 80:
            score = 30  # overbought — reversal risk
        elif rsi > 65:
            score = 75  # strong momentum
        elif rsi > 50:
            score = 65  # mild bullish
        elif rsi > 35:
            score = 35  # mild bearish
        elif rsi > 20:
            score = 25  # weak
        else:
            score = 70  # extreme oversold — bounce likely

        return {"score": round(score, 1), "detail": f"RSI={rsi:.1f}"}

    def _obv_score(self, klines) -> dict:
        """On-Balance Volume — rising OBV with price = confirmed trend."""
        closes = klines["close"]
        volumes = klines["volume"]

        obv = np.zeros(len(closes))
        for i in range(1, len(closes)):
            if closes[i] > closes[i - 1]:
                obv[i] = obv[i - 1] + volumes[i]
            elif closes[i] < closes[i - 1]:
                obv[i] = obv[i - 1] - volumes[i]
            else:
                obv[i] = obv[i - 1]

        # OBV slope over last 12 candles (3 hours)
        recent_obv = obv[-12:]
        if len(recent_obv) >= 2:
            obv_slope = (recent_obv[-1] - recent_obv[0]) / max(abs(recent_obv[0]), 1)
        else:
            obv_slope = 0

        # Price slope
        recent_close = closes[-12:]
        price_slope = (recent_close[-1] - recent_close[0]) / recent_close[0]

        # OBV confirms price direction → strong signal
        if obv_slope > 0 and price_slope > 0:
            score = 70 + min(obv_slope * 500, 20)  # confirmed uptrend
        elif obv_slope < 0 and price_slope < 0:
            score = 30 - min(abs(obv_slope) * 500, 20)  # confirmed downtrend
        elif obv_slope > 0 and price_slope < 0:
            score = 60  # accumulation (bullish divergence)
        elif obv_slope < 0 and price_slope > 0:
            score = 40  # distribution (bearish divergence)
        else:
            score = 50

        return {"score": round(max(0, min(100, score)), 1), "detail": f"obv_slope={obv_slope:+.4f}, price_slope={price_slope:+.4f}"}

    def _bollinger_score(self, klines) -> dict:
        """
        Bollinger Bands: price near upper band = overbought, lower = oversold.
        Squeeze (narrow bands) = breakout imminent.
        """
        closes = klines["close"]
        period = self.config.BB_PERIOD
        std_mult = self.config.BB_STD

        if len(closes) < period:
            return {"score": 50, "detail": "insufficient data"}

        sma = np.mean(closes[-period:])
        std = np.std(closes[-period:])
        upper = sma + std_mult * std
        lower = sma - std_mult * std
        current = closes[-1]

        # Bandwidth (squeeze detection)
        bandwidth = (upper - lower) / sma * 100

        # %B position (0 = lower band, 1 = upper band)
        if upper != lower:
            pct_b = (current - lower) / (upper - lower)
        else:
            pct_b = 0.5

        score = 50

        # Position-based scoring
        if pct_b > 0.9:
            score = 35  # near upper band → sell pressure
        elif pct_b > 0.6:
            score = 65  # upper half → bullish
        elif pct_b > 0.4:
            score = 50  # middle → neutral
        elif pct_b > 0.1:
            score = 35  # lower half → bearish
        else:
            score = 65  # near lower band → bounce likely

        # Squeeze bonus: tight bands = imminent volatility
        if bandwidth < 2.0:
            # Squeeze — direction uncertain, boost confidence slightly toward current trend
            recent_trend = (closes[-1] - closes[-4]) / closes[-4] * 100
            if recent_trend > 0:
                score += 5
            else:
                score -= 5

        return {
            "score": round(max(0, min(100, score)), 1),
            "detail": f"%B={pct_b:.3f}, bandwidth={bandwidth:.2f}%, price=${current:,.0f}",
        }

    def _vwap_score(self, klines) -> dict:
        """
        Volume-Weighted Average Price deviation.
        Price above VWAP = bullish, below = bearish.
        """
        closes = klines["close"]
        volumes = klines["volume"]
        highs = klines["high"]
        lows = klines["low"]

        typical_price = (highs + lows + closes) / 3
        cum_vol = np.cumsum(volumes)
        cum_tp_vol = np.cumsum(typical_price * volumes)

        if cum_vol[-1] > 0:
            vwap = cum_tp_vol[-1] / cum_vol[-1]
        else:
            vwap = closes[-1]

        current = closes[-1]
        deviation_pct = (current - vwap) / vwap * 100

        # Above VWAP = institutional buying (bullish)
        # Below VWAP = institutional selling (bearish)
        if deviation_pct > 1.0:
            score = 75
        elif deviation_pct > 0.3:
            score = 65
        elif deviation_pct > -0.3:
            score = 50
        elif deviation_pct > -1.0:
            score = 35
        else:
            score = 25

        return {
            "score": round(score, 1),
            "detail": f"VWAP=${vwap:,.0f}, dev={deviation_pct:+.2f}%",
        }

    def _momentum_score(self, klines) -> dict:
        """
        Multi-timeframe momentum:
        - 4-candle (1h) rate of change
        - 12-candle (3h) rate of change
        - 48-candle (12h) rate of change
        """
        closes = klines["close"]

        def roc(n):
            if len(closes) > n:
                return (closes[-1] - closes[-n]) / closes[-n] * 100
            return 0

        roc_1h = roc(4)
        roc_3h = roc(12)
        roc_12h = roc(48)

        # Weight short-term momentum more for 15m trading
        weighted_mom = roc_1h * 0.50 + roc_3h * 0.30 + roc_12h * 0.20

        # Convert to 0-100 score
        # ±2% weighted momentum → ±50 points
        score = 50 + weighted_mom * 25
        score = max(0, min(100, score))

        return {
            "score": round(score, 1),
            "detail": f"1h={roc_1h:+.2f}%, 3h={roc_3h:+.2f}%, 12h={roc_12h:+.2f}%",
        }

    def _support_resistance_score(self, klines) -> dict:
        """
        Pivot point S/R levels.
        Price bouncing off support = bullish.
        Price rejected at resistance = bearish.
        """
        highs = klines["high"]
        lows = klines["low"]
        closes = klines["close"]

        # Use recent 24h for pivots
        h = np.max(highs[-96:]) if len(highs) >= 96 else np.max(highs)
        l = np.min(lows[-96:]) if len(lows) >= 96 else np.min(lows)
        c = closes[-1]

        pivot = (h + l + c) / 3
        r1 = 2 * pivot - l
        s1 = 2 * pivot - h
        r2 = pivot + (h - l)
        s2 = pivot - (h - l)

        current = closes[-1]
        range_size = h - l
        if range_size == 0:
            return {"score": 50, "detail": "no range"}

        # Where is price relative to pivot?
        position = (current - s2) / (r2 - s2) if r2 != s2 else 0.5

        score = 50
        # Near support → bullish bounce expected
        if current <= s1 * 1.002:
            score = 65
        elif current <= pivot * 0.998:
            score = 45
        elif current >= r1 * 0.998:
            score = 35  # near resistance
        elif current >= pivot * 1.002:
            score = 55  # above pivot = bullish

        # Recent price action: did we bounce off support or get rejected at resistance?
        last_4_low = np.min(lows[-4:])
        last_4_high = np.max(highs[-4:])

        if abs(last_4_low - s1) / s1 < 0.003 and current > last_4_low:
            score += 10  # support bounce confirmed
        if abs(last_4_high - r1) / r1 < 0.003 and current < last_4_high:
            score -= 10  # resistance rejection confirmed

        return {
            "score": round(max(0, min(100, score)), 1),
            "detail": f"S1=${s1:,.0f}, P=${pivot:,.0f}, R1=${r1:,.0f}, pos={position:.2f}",
        }
