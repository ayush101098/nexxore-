"""
PHASE 5 — Execution Layer: The Hands
Actually places trades on Polymarket BTC 15-minute up/down markets.

Supports:
  • Paper mode: simulated trades with real prices
  • Live mode: real CLOB orders on Polymarket (Polygon chain)
  
Polymarket BTC markets:
  - "Will BTC go up in the next 15 minutes?" → YES = long, NO = short
  - We buy YES tokens when signal says LONG
  - We buy NO tokens (or sell YES) when signal says SHORT
"""

import asyncio
import aiohttp
import time
from datetime import datetime, timezone
from loguru import logger


# ═══════════════════════════════════════════════════════════════
#  POLYMARKET CLOB CLIENT (graceful fallback)
# ═══════════════════════════════════════════════════════════════
try:
    from py_clob_client.client import ClobClient
    from py_clob_client.clob_types import OrderArgs, OrderType
    from py_clob_client.order_builder.constants import BUY, SELL

    CLOB_AVAILABLE = True
except ImportError:
    CLOB_AVAILABLE = False
    logger.warning("⚠️  py-clob-client not installed — paper mode only")


class ExecutionLayer:
    """
    Places trades on Polymarket or simulates them.
    The bot's 'hands' that reach out and trade.
    """

    def __init__(self, config):
        self.config = config
        self.mode = config.MODE  # paper | live
        self.clob_client = None
        self.session = None

        # Trade tracking
        self.pending_orders = []
        self.filled_orders = []
        self.paper_positions = []

        # BTC market tracking
        self._btc_market_id = None
        self._btc_yes_token = None
        self._btc_no_token = None

    async def initialize(self):
        """Setup execution layer."""
        self.session = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=15))

        if self.mode == "live" and CLOB_AVAILABLE:
            await self._init_clob()
        else:
            if self.mode == "live":
                logger.warning("Live mode requested but CLOB client not available → falling back to paper")
                self.mode = "paper"
            logger.info("📝 Paper trading mode active")

    async def _init_clob(self):
        """Initialize Polymarket CLOB client for live trading."""
        try:
            self.clob_client = ClobClient(
                host=self.config.POLYMARKET_HOST,
                key=self.config.POLYMARKET_API_KEY,
                chain_id=self.config.POLYMARKET_CHAIN_ID,
                funder=self.config.POLYMARKET_FUNDER,
            )
            # Derive API creds
            self.clob_client.set_api_creds(
                self.clob_client.create_or_derive_api_creds()
            )
            logger.info("🔗 Polymarket CLOB client initialized")
        except Exception as e:
            logger.error(f"CLOB init failed: {e} → falling back to paper mode")
            self.mode = "paper"

    async def close(self):
        if self.session and not self.session.closed:
            await self.session.close()

    # ─── FIND BTC 15-MIN MARKET ─────────────────────────────

    async def find_btc_market(self) -> dict:
        """
        Find the active BTC 15-minute up/down market on Polymarket.
        Searches for markets matching "BTC" + "15 min" or similar.
        """
        try:
            url = "https://gamma-api.polymarket.com/events"
            params = {"limit": 50, "active": "true", "order": "startDate", "ascending": "false"}
            async with self.session.get(url, params=params) as resp:
                if resp.status == 200:
                    events = await resp.json()
                    for event in events:
                        title = event.get("title", "").lower()
                        # Look for BTC 15-min markets
                        if "btc" in title and ("15" in title or "minute" in title or "min" in title):
                            markets = event.get("markets", [])
                            if markets:
                                market = markets[0]
                                self._btc_market_id = market.get("id")
                                self._btc_yes_token = market.get("clobTokenIds", ["", ""])[0] if market.get("clobTokenIds") else None
                                self._btc_no_token = market.get("clobTokenIds", ["", ""])[1] if market.get("clobTokenIds") and len(market.get("clobTokenIds", [])) > 1 else None
                                logger.info(f"🎯 Found BTC market: {event.get('title')} (ID: {self._btc_market_id})")
                                return {
                                    "event_id": event.get("id"),
                                    "title": event.get("title"),
                                    "market_id": self._btc_market_id,
                                    "yes_token": self._btc_yes_token,
                                    "no_token": self._btc_no_token,
                                    "yes_price": float(market.get("outcomePrices", '["0.5","0.5"]').strip('[]').split(',')[0].strip('"') or 0.5),
                                    "volume": float(market.get("volume", 0) or 0),
                                }

            # Also search the markets endpoint directly
            url = "https://gamma-api.polymarket.com/markets"
            params = {"limit": 50, "active": "true", "order": "volume", "ascending": "false"}
            async with self.session.get(url, params=params) as resp:
                if resp.status == 200:
                    markets = await resp.json()
                    for market in markets:
                        q = market.get("question", "").lower()
                        if "btc" in q or "bitcoin" in q:
                            if "15" in q or "minute" in q or "min" in q or "price" in q:
                                self._btc_market_id = market.get("id")
                                tokens = market.get("clobTokenIds", [])
                                self._btc_yes_token = tokens[0] if tokens else None
                                self._btc_no_token = tokens[1] if len(tokens) > 1 else None
                                logger.info(f"🎯 Found BTC market via search: {market.get('question')}")
                                return {
                                    "market_id": self._btc_market_id,
                                    "question": market.get("question"),
                                    "yes_token": self._btc_yes_token,
                                    "no_token": self._btc_no_token,
                                }

            logger.warning("⚠️  No active BTC 15-min market found on Polymarket")
            return None
        except Exception as e:
            logger.error(f"Market search error: {e}")
            return None

    # ─── EXECUTE TRADE ──────────────────────────────────────

    async def execute(self, decision: dict) -> dict:
        """
        Execute a trade decision from the strategy brain.
        decision = { action, direction, size_usd, entry_price, stop_loss, take_profit, ... }
        """
        action = decision.get("action")
        if action not in ("buy", "sell", "close"):
            return {"status": "skipped", "reason": f"action={action}"}

        if self.mode == "paper":
            return await self._paper_execute(decision)
        else:
            return await self._live_execute(decision)

    async def _paper_execute(self, decision: dict) -> dict:
        """Simulate trade execution with real prices."""
        direction = decision.get("direction", "long")
        size_usd = decision.get("size_usd", 0)
        entry = decision.get("entry_price", 0)
        action = decision.get("action")

        if action == "close":
            # Close existing paper position
            if self.paper_positions:
                pos = self.paper_positions[-1]
                pos["status"] = "closed"
                pos["exit_price"] = entry
                pos["pnl_usd"] = decision.get("pnl_usd", 0)
                pos["closed_at"] = datetime.now(timezone.utc).isoformat()

                self.filled_orders.append(pos)
                logger.info(f"📝 Paper CLOSE: PnL=${pos['pnl_usd']:+.2f}")

                return {
                    "status": "filled",
                    "mode": "paper",
                    "order_id": f"paper-{int(time.time())}",
                    "action": "close",
                    "pnl_usd": pos["pnl_usd"],
                }

        # New position
        order = {
            "order_id": f"paper-{int(time.time())}",
            "mode": "paper",
            "action": action,
            "direction": direction,
            "size_usd": size_usd,
            "entry_price": entry,
            "stop_loss": decision.get("stop_loss"),
            "take_profit": decision.get("take_profit"),
            "status": "filled",
            "opened_at": datetime.now(timezone.utc).isoformat(),
            "polymarket_side": "YES" if direction == "long" else "NO",
        }

        self.paper_positions.append(order)
        self.filled_orders.append(order)

        logger.info(
            f"📝 Paper {action.upper()}: {direction.upper()} ${size_usd:.2f} @ ${entry:,.2f} "
            f"(Poly: {'YES' if direction == 'long' else 'NO'})"
        )

        return {"status": "filled", **order}

    async def _live_execute(self, decision: dict) -> dict:
        """Execute real trade on Polymarket via CLOB."""
        if not self.clob_client:
            logger.error("No CLOB client — cannot execute live")
            return {"status": "error", "reason": "no CLOB client"}

        direction = decision.get("direction", "long")
        size_usd = decision.get("size_usd", 0)
        action = decision.get("action")

        try:
            # Determine token and side
            if direction == "long":
                token_id = self._btc_yes_token
                side = BUY
            else:
                token_id = self._btc_no_token
                side = BUY

            if not token_id:
                # Try to find market first
                market = await self.find_btc_market()
                if not market:
                    return {"status": "error", "reason": "no BTC market found"}
                token_id = self._btc_yes_token if direction == "long" else self._btc_no_token

            if not token_id:
                return {"status": "error", "reason": "no token ID for direction"}

            # Calculate quantity (Polymarket tokens are $0-$1)
            # If YES price is 0.60, $100 buys ~166 tokens
            price = 0.50  # Will be refined with order book
            quantity = size_usd / max(price, 0.01)

            # Build and submit order
            order_args = OrderArgs(
                price=price,
                size=quantity,
                side=side,
                token_id=token_id,
            )

            signed_order = self.clob_client.create_and_post_order(order_args)

            result = {
                "status": "submitted",
                "mode": "live",
                "order_id": signed_order.get("orderID", "unknown"),
                "direction": direction,
                "size_usd": size_usd,
                "token_id": token_id,
                "price": price,
                "quantity": quantity,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }

            self.pending_orders.append(result)
            logger.info(f"🔴 LIVE ORDER: {direction} ${size_usd:.2f} → {result['order_id']}")

            return result

        except Exception as e:
            logger.error(f"Live execution error: {e}")
            return {"status": "error", "reason": str(e)}

    # ─── GET CURRENT BTC PRICE ──────────────────────────────

    async def get_btc_price(self) -> float:
        """Fetch current BTC price from Binance."""
        try:
            url = "https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT"
            async with self.session.get(url) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    return float(data.get("price", 0))
        except Exception as e:
            logger.error(f"Price fetch error: {e}")
        return 0

    # ─── STATUS ─────────────────────────────────────────────

    def get_status(self) -> dict:
        return {
            "mode": self.mode,
            "clob_connected": self.clob_client is not None,
            "btc_market_id": self._btc_market_id,
            "pending_orders": len(self.pending_orders),
            "filled_orders": len(self.filled_orders),
            "paper_positions": len(self.paper_positions),
        }

    def get_trade_history(self) -> list:
        return list(self.filled_orders)
