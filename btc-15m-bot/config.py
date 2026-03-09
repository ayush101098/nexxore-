"""
Nexxore BTC 15-Min Bot — Central Configuration
All settings in one place. Override via .env file.
"""

import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

# ═══════════════════════════════════════════════════════════════
#  CORE
# ═══════════════════════════════════════════════════════════════

MODE = os.getenv("TRADING_MODE", "paper")  # paper | live
INITIAL_CAPITAL = float(os.getenv("INITIAL_CAPITAL", "5000"))

# ═══════════════════════════════════════════════════════════════
#  TIMING
# ═══════════════════════════════════════════════════════════════

CANDLE_INTERVAL = os.getenv("CANDLE_INTERVAL", "15m")
SCAN_INTERVAL_SECONDS = int(os.getenv("SCAN_INTERVAL_SECONDS", "900"))  # 15 min
LOOKBACK_CANDLES = int(os.getenv("LOOKBACK_CANDLES", "96"))  # 96 × 15m = 24h

# ═══════════════════════════════════════════════════════════════
#  SIGNAL THRESHOLDS
# ═══════════════════════════════════════════════════════════════

SIGNAL_THRESHOLD = float(os.getenv("SIGNAL_THRESHOLD", "70"))  # 70% = go
CHANNEL_WEIGHTS = {
    "liquidity_whale": 0.30,    # Channel 1 weight
    "macro_sentiment": 0.20,    # Channel 2 weight
    "supply_demand": 0.25,      # Channel 3 weight
    "derivatives": 0.25,        # Channel 4 weight
}

# ═══════════════════════════════════════════════════════════════
#  RISK MANAGEMENT
# ═══════════════════════════════════════════════════════════════

MAX_POSITION_SIZE_USD = float(os.getenv("MAX_POSITION_SIZE_USD", "500"))
MAX_DAILY_TRADES = int(os.getenv("MAX_DAILY_TRADES", "20"))
MAX_DAILY_LOSS_USD = float(os.getenv("MAX_DAILY_LOSS_USD", "200"))
KELLY_FRACTION = 0.25  # Quarter-Kelly for safety
MIN_EDGE_PCT = 3.0     # Minimum edge to trade (%)

# ═══════════════════════════════════════════════════════════════
#  POLYMARKET
# ═══════════════════════════════════════════════════════════════

POLYMARKET_API_KEY = os.getenv("POLYMARKET_API_KEY", "")
POLYMARKET_SECRET = os.getenv("POLYMARKET_SECRET", "")
POLYMARKET_PASSPHRASE = os.getenv("POLYMARKET_PASSPHRASE", "")
POLYMARKET_PRIVATE_KEY = os.getenv("POLYMARKET_PRIVATE_KEY", "")
POLYMARKET_FUNDER = os.getenv("POLYMARKET_FUNDER", "")
POLYMARKET_HOST = "https://clob.polymarket.com"
POLYMARKET_CHAIN_ID = 137  # Polygon

# ═══════════════════════════════════════════════════════════════
#  DATA SOURCES (free tier endpoints)
# ═══════════════════════════════════════════════════════════════

BINANCE_REST = "https://api.binance.com"
BINANCE_WS = "wss://stream.binance.com:9443/ws"
COINGLASS_API_KEY = os.getenv("COINGLASS_API_KEY", "")
GLASSNODE_API_KEY = os.getenv("GLASSNODE_API_KEY", "")
CRYPTOCOMPARE_API_KEY = os.getenv("CRYPTOCOMPARE_API_KEY", "")
NEWSAPI_KEY = os.getenv("NEWSAPI_KEY", "")
FEAR_GREED_URL = "https://api.alternative.me/fng/"
COINGLASS_BASE = "https://open-api.coinglass.com/public/v2"

# ═══════════════════════════════════════════════════════════════
#  TECHNICAL INDICATORS (for supply-demand channel)
# ═══════════════════════════════════════════════════════════════

RSI_PERIOD = 14
RSI_OVERSOLD = 30
RSI_OVERBOUGHT = 70
VWAP_PERIOD = 20
OBV_LOOKBACK = 20
BB_PERIOD = 20
BB_STD = 2.0

# ═══════════════════════════════════════════════════════════════
#  MONITORING
# ═══════════════════════════════════════════════════════════════

DASHBOARD_PORT = int(os.getenv("DASHBOARD_PORT", "3848"))
DASHBOARD_HOST = os.getenv("DASHBOARD_HOST", "0.0.0.0")
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")

# ═══════════════════════════════════════════════════════════════
#  DATABASE
# ═══════════════════════════════════════════════════════════════

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///data/nexxore_bot.db")
DATA_DIR = Path(__file__).parent / "data"
DATA_DIR.mkdir(exist_ok=True)

# ═══════════════════════════════════════════════════════════════
#  NOTIFICATIONS
# ═══════════════════════════════════════════════════════════════

TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID", "")
DISCORD_WEBHOOK_URL = os.getenv("DISCORD_WEBHOOK_URL", "")
