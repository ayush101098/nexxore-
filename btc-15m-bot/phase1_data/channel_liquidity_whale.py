"""
PHASE 1 — Channel 1: Liquidity Conditions & Whale Activity
The bot's "eyes" watching big money movements.

Tracks:
  • Exchange net inflows/outflows (are whales depositing to sell or withdrawing to hold?)
  • Large BTC transactions (>$1M moves)
  • Order book depth imbalance (bid vs ask pressure)
  • Liquidation cascades (forced selling/buying)
"""

import asyncio
import aiohttp
import time
from loguru import logger
from datetime import datetime, timezone


class LiquidityWhaleChannel:
    """Score: 0–100. >60 = bullish whale activity, <40 = bearish."""

    def __init__(self, config):
        self.config = config
        self.coinglass_key = config.COINGLASS_API_KEY
        self.session = None
        self._cache = {}
        self._cache_ttl = 120  # 2 min cache

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
        """Returns { score: 0-100, direction: 'long'|'short'|'neutral', details: {...} }"""
        try:
            results = await asyncio.gather(
                self._exchange_netflow(),
                self._whale_transactions(),
                self._orderbook_imbalance(),
                self._liquidation_data(),
                return_exceptions=True,
            )

            netflow = results[0] if not isinstance(results[0], Exception) else {"score": 50, "detail": "unavailable"}
            whales = results[1] if not isinstance(results[1], Exception) else {"score": 50, "detail": "unavailable"}
            orderbook = results[2] if not isinstance(results[2], Exception) else {"score": 50, "detail": "unavailable"}
            liquidations = results[3] if not isinstance(results[3], Exception) else {"score": 50, "detail": "unavailable"}

            # Weighted composite
            composite = (
                netflow["score"] * 0.30
                + whales["score"] * 0.25
                + orderbook["score"] * 0.25
                + liquidations["score"] * 0.20
            )

            direction = "long" if composite > 60 else ("short" if composite < 40 else "neutral")

            return {
                "score": round(composite, 1),
                "direction": direction,
                "channel": "liquidity_whale",
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "details": {
                    "exchange_netflow": netflow,
                    "whale_transactions": whales,
                    "orderbook_imbalance": orderbook,
                    "liquidations": liquidations,
                },
            }
        except Exception as e:
            logger.error(f"LiquidityWhaleChannel error: {e}")
            return {"score": 50, "direction": "neutral", "channel": "liquidity_whale", "details": {"error": str(e)}}

    # ─── SUB-SIGNALS ────────────────────────────────────────

    async def _exchange_netflow(self) -> dict:
        """
        Negative netflow = BTC leaving exchanges = bullish (accumulation)
        Positive netflow = BTC entering exchanges = bearish (distribution)
        """
        try:
            session = await self._get_session()

            # Try Coinglass API for exchange netflow
            if self.coinglass_key:
                url = f"{self.config.COINGLASS_BASE}/indicator/exchange_netflow"
                headers = {"coinglassSecret": self.coinglass_key}
                async with session.get(url, headers=headers, params={"symbol": "BTC", "interval": "h1"}) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        if data.get("data"):
                            flows = data["data"]
                            recent = flows[-4:] if len(flows) >= 4 else flows  # last 4 hours
                            total_flow = sum(f.get("value", 0) for f in recent)
                            # Large outflow (-5000+ BTC) → very bullish (90)
                            # Large inflow (+5000+ BTC) → very bearish (10)
                            score = max(0, min(100, 50 - (total_flow / 100)))
                            return {"score": round(score, 1), "detail": f"netflow={total_flow:.0f} BTC/4h"}

            # Fallback: Use Binance BTC price momentum as proxy
            url = f"{self.config.BINANCE_REST}/api/v3/klines"
            params = {"symbol": "BTCUSDT", "interval": "1h", "limit": 4}
            async with session.get(url, params=params) as resp:
                if resp.status == 200:
                    klines = await resp.json()
                    if klines:
                        # Volume trend as netflow proxy
                        volumes = [float(k[5]) for k in klines]
                        closes = [float(k[4]) for k in klines]
                        price_change = (closes[-1] - closes[0]) / closes[0] * 100
                        vol_trend = volumes[-1] / max(sum(volumes[:-1]) / max(len(volumes) - 1, 1), 1)

                        # Rising price + high volume = bullish accumulation
                        if price_change > 0 and vol_trend > 1.2:
                            score = min(80, 55 + price_change * 3)
                        elif price_change < 0 and vol_trend > 1.2:
                            score = max(20, 45 + price_change * 3)
                        else:
                            score = 50 + price_change * 2
                        return {"score": round(max(0, min(100, score)), 1), "detail": f"proxy: Δ{price_change:.2f}%, vol_ratio={vol_trend:.2f}"}

            return {"score": 50, "detail": "no data"}
        except Exception as e:
            logger.warning(f"Exchange netflow error: {e}")
            return {"score": 50, "detail": str(e)}

    async def _whale_transactions(self) -> dict:
        """
        Track large BTC transactions via blockchain.info public API.
        Many large txns in short time → institutional activity.
        """
        try:
            session = await self._get_session()

            # Blockchain.info — recent blocks for large tx detection
            url = "https://blockchain.info/latestblock"
            async with session.get(url) as resp:
                if resp.status == 200:
                    block = await resp.json()
                    block_hash = block.get("hash", "")

                    # Get block transactions
                    block_url = f"https://blockchain.info/rawblock/{block_hash}?limit=50"
                    async with session.get(block_url) as block_resp:
                        if block_resp.status == 200:
                            block_data = await block_resp.json()
                            txs = block_data.get("tx", [])

                            whale_count = 0
                            total_whale_volume = 0
                            buy_pressure = 0

                            for tx in txs[:50]:
                                out_value = sum(o.get("value", 0) for o in tx.get("out", []))
                                btc_value = out_value / 1e8
                                if btc_value > 10:  # >10 BTC = whale
                                    whale_count += 1
                                    total_whale_volume += btc_value
                                    # Multi-output = distribution (bearish), few outputs = accumulation (bullish)
                                    if len(tx.get("out", [])) <= 2:
                                        buy_pressure += 1

                            if whale_count > 0:
                                accumulation_ratio = buy_pressure / whale_count
                                # High accumulation → bullish
                                score = 40 + accumulation_ratio * 30 + min(whale_count, 10) * 1.5
                                return {
                                    "score": round(max(0, min(100, score)), 1),
                                    "detail": f"{whale_count} whales, {total_whale_volume:.0f} BTC, accum_ratio={accumulation_ratio:.2f}",
                                }

            return {"score": 50, "detail": "no whale data"}
        except Exception as e:
            logger.warning(f"Whale tx error: {e}")
            return {"score": 50, "detail": str(e)}

    async def _orderbook_imbalance(self) -> dict:
        """
        Bid/ask depth imbalance from Binance.
        More bids than asks → buy pressure → bullish.
        """
        try:
            session = await self._get_session()
            url = f"{self.config.BINANCE_REST}/api/v3/depth"
            params = {"symbol": "BTCUSDT", "limit": 100}
            async with session.get(url, params=params) as resp:
                if resp.status == 200:
                    book = await resp.json()
                    bids = book.get("bids", [])
                    asks = book.get("asks", [])

                    bid_depth = sum(float(b[1]) for b in bids[:50])  # top 50 levels
                    ask_depth = sum(float(a[1]) for a in asks[:50])
                    total = bid_depth + ask_depth

                    if total > 0:
                        imbalance = (bid_depth - ask_depth) / total  # -1 to +1
                        # +0.3 imbalance → ~80 score, -0.3 → ~20
                        score = 50 + imbalance * 100
                        return {
                            "score": round(max(0, min(100, score)), 1),
                            "detail": f"bids={bid_depth:.1f} BTC, asks={ask_depth:.1f} BTC, imbalance={imbalance:+.3f}",
                        }

            return {"score": 50, "detail": "no orderbook"}
        except Exception as e:
            logger.warning(f"Orderbook error: {e}")
            return {"score": 50, "detail": str(e)}

    async def _liquidation_data(self) -> dict:
        """
        Recent liquidations indicate forced position closes.
        Short liquidations → price going up (bullish).
        Long liquidations → price going down (bearish).
        """
        try:
            session = await self._get_session()

            if self.coinglass_key:
                url = f"{self.config.COINGLASS_BASE}/indicator/liquidation"
                headers = {"coinglassSecret": self.coinglass_key}
                async with session.get(url, headers=headers, params={"symbol": "BTC", "interval": "h1"}) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        if data.get("data"):
                            recent = data["data"][-4:]
                            long_liqs = sum(d.get("longLiquidationUsd", 0) for d in recent)
                            short_liqs = sum(d.get("shortLiquidationUsd", 0) for d in recent)
                            total = long_liqs + short_liqs
                            if total > 0:
                                ratio = short_liqs / total  # High = shorts getting rekt = bullish
                                score = 30 + ratio * 40
                                return {
                                    "score": round(score, 1),
                                    "detail": f"long_liqs=${long_liqs/1e6:.1f}M, short_liqs=${short_liqs/1e6:.1f}M",
                                }

            # Fallback: Use funding rate as liquidation proxy
            url = f"{self.config.BINANCE_REST}/fapi/v1/fundingRate"
            params = {"symbol": "BTCUSDT", "limit": 4}
            async with session.get(url, params=params) as resp:
                if resp.status == 200:
                    rates = await resp.json()
                    if rates:
                        avg_rate = sum(float(r.get("fundingRate", 0)) for r in rates) / len(rates)
                        # Very positive funding → longs overleveraged → bearish pressure
                        # Very negative funding → shorts overleveraged → bullish pressure
                        score = 50 - avg_rate * 10000  # ±0.01 funding → ±100 points scaled
                        return {
                            "score": round(max(0, min(100, score)), 1),
                            "detail": f"avg_funding={avg_rate:.6f} (proxy)",
                        }

            return {"score": 50, "detail": "no liquidation data"}
        except Exception as e:
            logger.warning(f"Liquidation error: {e}")
            return {"score": 50, "detail": str(e)}
