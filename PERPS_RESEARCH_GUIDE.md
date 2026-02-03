# Perps Analysis in Research Agent - Complete Guide

## 🎯 What's New

The Research Agent now provides **comprehensive analysis for all 20 HyperLiquid perpetuals markets**, giving you institutional-grade insights for crypto futures trading.

## 📊 Analysis Coverage

### All 20 Markets:
BTC, ETH, SOL, HYPE, ARB, OP, AVAX, MATIC, DOGE, LINK, UNI, ATOM, LTC, BCH, ETC, FIL, APT, STX, INJ, TIA

### Analysis Types:

#### 1. **Technical Indicators**
- **RSI (Relative Strength Index)**: Overbought/oversold levels
- **EMA (9, 21, 50)**: Trend direction & momentum
- **Bollinger Bands**: Volatility & breakout detection
- **VWAP**: Volume-weighted average price
- **Signals**: Bullish/bearish crossovers, BB breakouts

#### 2. **Funding Rate Analysis**
- Current funding rate (8-hour period)
- Annualized funding rate (APR)
- 24-hour average funding
- **Arbitrage opportunities**:
  - `STRONG_SHORT_BIAS`: Longs paying >1% per 8h - short bias
  - `STRONG_LONG_BIAS`: Shorts paying >1% per 8h - long bias
  - `MODERATE_*_BIAS`: 0.3-1% funding rate
  - `NEUTRAL`: <0.3% funding

#### 3. **Open Interest Trends**
- Current OI vs 24h ago
- **Signal interpretation**:
  - `BULLISH_STRENGTH`: Price ↑ + OI ↑ = Strong bulls
  - `BEARISH_STRENGTH`: Price ↓ + OI ↑ = Strong bears
  - `SHORT_COVERING`: Price ↑ + OI ↓ = Shorts closing
  - `LONG_LIQUIDATION`: Price ↓ + OI ↓ = Longs liquidating

#### 4. **Risk-Adjusted Momentum**
- Price momentum (0-100 score)
- Volume strength
- Volatility penalty
- Funding bias adjustment
- **Ratings**: STRONG (>75), MODERATE (50-75), WEAK (25-50), VERY_WEAK (<25)

#### 5. **Market Regime Classification**
- `HIGH_VOLATILITY`: Large swings expected, use wider stops
- `TRENDING`: Strong direction, follow momentum
- `CONSOLIDATION`: Range-bound, mean reversion
- `LOW_LIQUIDITY`: Thin books, reduce size
- `FUNDING_ARBITRAGE`: Extreme funding, arb opportunities

#### 6. **Trading Signals**
- **Direction**: LONG / SHORT / NEUTRAL
- **Confidence**: 0-95% (multi-factor confirmation)
- **Strength**: STRONG (>70%), MODERATE (50-70%), WEAK (<50%)
- **Reasoning**: Plain-English explanation

#### 7. **Trade Recommendations**
- Entry price (current market)
- Stop loss (5% for longs, -5% for shorts)
- Take profit (10% for longs, -10% for shorts)
- Leverage suggestion (3-5x for high vol, 10-15x for low vol)
- Position size (Standard or Reduced based on confidence)

---

## 🚀 How to Use

### Access the Analysis

1. **Open Research Agent**: Navigate to `research-agent.html`
2. **Click "Perps Analysis" tab** (2nd tab in navigation)
3. **View comprehensive dashboard**

### Dashboard Sections:

#### **Market Overview**
- Total markets analyzed (20)
- Long signals count
- Short signals count
- Overall market sentiment (BULLISH/BEARISH/NEUTRAL)
- High confidence signals count

#### **Top Opportunities**
Shows top 5 high-confidence signals:
- Market name (e.g., BTC, ETH)
- Signal direction (LONG/SHORT)
- Confidence percentage
- Momentum score

#### **Funding Rate Leaders**
Top 10 markets by absolute funding rate:
- Market name
- Current funding rate
- Annualized APR
- Direction (Longs Pay / Shorts Pay)
- Arbitrage signal

#### **Full Analysis Table**
All 20 markets with:
- Current price
- 24h change %
- Signal direction
- Confidence %
- RSI value
- Funding rate
- Momentum score
- Market regime

---

## 📡 API Endpoints

### Get All Markets Analysis
```bash
GET /api/perps-analysis
```

**Response:**
```json
{
  "success": true,
  "timestamp": 1738627200000,
  "analysisDuration": 2345,
  "marketsAnalyzed": 20,
  "overview": {
    "longs": 8,
    "shorts": 5,
    "neutrals": 7,
    "highConfidenceSignals": 4
  },
  "topOpportunities": [
    {
      "coin": "BTC",
      "signal": "LONG",
      "confidence": "75%",
      "momentum": "68.5"
    }
  ],
  "markets": [...],
  "correlations": {...},
  "marketSentiment": "BULLISH"
}
```

### Get Single Market Analysis
```bash
GET /api/perps-analysis?coin=BTC
# or
GET /api/perps-analysis/market/BTC
```

**Response:**
```json
{
  "success": true,
  "analysis": {
    "coin": "BTC",
    "timestamp": 1738627200000,
    "price": {
      "current": "97234.50",
      "mark": "97235.20",
      "change24h": "+2.34%",
      "oracle": "97230.00"
    },
    "volume24h": "1250.5M",
    "technicals": {
      "rsi": "58.45",
      "ema9": "96800.00",
      "ema21": "95500.00",
      "ema50": "94200.00",
      "bollinger": {
        "upper": "98500.00",
        "middle": "96000.00",
        "lower": "93500.00",
        "position": "55%"
      },
      "signals": {
        "rsiOverbought": false,
        "rsiOversold": false,
        "emaBullish": true,
        "emaBearish": false,
        "bbBreakout": false
      }
    },
    "funding": {
      "current": "0.0082%",
      "avg24h": "0.0075%",
      "annualized": "8.93%",
      "direction": "longs-pay-shorts",
      "isExtreme": false,
      "opportunity": "neutral",
      "nextPayment": "8h",
      "signal": "NEUTRAL"
    },
    "openInterest": {
      "current": "245000000.00",
      "change24h": "+5.2%",
      "signal": "BULLISH_STRENGTH",
      "interpretation": "Price rising with OI increasing - strong bullish momentum"
    },
    "momentum": {
      "score": "68.5",
      "rating": "MODERATE",
      "components": {
        "price": "23.4",
        "volume": "45.2",
        "volatility": "12.1",
        "funding": "-0.8"
      }
    },
    "regime": {
      "regime": "TRENDING",
      "confidence": "0.75",
      "description": "Strong directional movement, follow momentum"
    },
    "signal": {
      "direction": "LONG",
      "confidence": "75%",
      "strength": "STRONG",
      "reasoning": [
        "RSI oversold with positive momentum",
        "Open interest confirms bullish strength"
      ]
    },
    "recommendations": {
      "entry": "97234.50",
      "stopLoss": "92373.00",
      "takeProfit": "106958.00",
      "leverage": "10-15x",
      "positionSize": "Standard"
    }
  }
}
```

---

## 🔧 Integration Examples

### Frontend Integration
```javascript
// Fetch all markets
const response = await fetch('/api/perps-analysis');
const data = await response.json();

// Display top opportunities
data.topOpportunities.forEach(opp => {
  console.log(`${opp.coin}: ${opp.signal} @ ${opp.confidence} confidence`);
});

// Find strong long signals
const strongLongs = data.markets.filter(m => 
  m.signal.direction === 'LONG' && 
  parseFloat(m.signal.confidence) > 70
);
```

### Trading Bot Integration
```javascript
// Get signal for specific market
const btcAnalysis = await fetch('/api/perps-analysis?coin=BTC').then(r => r.json());

if (btcAnalysis.signal.direction === 'LONG' && 
    parseFloat(btcAnalysis.signal.confidence) > 75) {
  
  const entry = parseFloat(btcAnalysis.recommendations.entry);
  const stopLoss = parseFloat(btcAnalysis.recommendations.stopLoss);
  const takeProfit = parseFloat(btcAnalysis.recommendations.takeProfit);
  const leverage = 10; // Parse from btcAnalysis.recommendations.leverage
  
  // Execute trade
  await openPosition({
    market: 'BTC',
    side: 'long',
    entry,
    stopLoss,
    takeProfit,
    leverage,
    size: calculatePositionSize(confidence)
  });
}
```

---

## 🎓 Trading Strategy Examples

### 1. **High Confidence Momentum**
```
Entry: Signal direction = LONG, Confidence > 70%, Momentum > 60
Exit: Take profit at +10% or RSI > 75
Stop: -5% from entry
Leverage: 10-15x
```

### 2. **Funding Rate Arbitrage**
```
Entry: Funding signal = STRONG_SHORT_BIAS, Annualized > 15%
Strategy: Open short perpetual + buy spot (delta neutral)
Profit: Collect funding payments
Exit: When funding normalizes < 5% annualized
```

### 3. **OI Divergence**
```
Entry: OI signal = SHORT_COVERING, Price > EMA21
Thesis: Shorts closing drives price higher
Target: Previous resistance levels
Stop: Below EMA50
```

### 4. **Regime-Based Allocation**
```
HIGH_VOLATILITY: Reduce leverage to 3-5x, wider stops
TRENDING: Follow trend with momentum, 10-15x leverage
CONSOLIDATION: Range trading, sell resistance/buy support
LOW_LIQUIDITY: Avoid or reduce size significantly
```

---

## ⚠️ Important Notes

1. **Data Source**: HyperLiquid API (primary), Binance fallback
2. **Update Frequency**: 1-minute cache on API responses
3. **Historical Data**: Currently using mock prices (implement historical API for production)
4. **Risk Management**: ALWAYS use stop losses, never risk >2% per trade
5. **Backtesting**: Signals are NOT backtested - use with caution
6. **Position Sizing**: Reduce size for lower confidence signals

---

## 🛠️ Technical Details

### Calculation Methods:

**RSI (14-period)**:
```
RS = Average Gain / Average Loss
RSI = 100 - (100 / (1 + RS))
```

**EMA (Exponential Moving Average)**:
```
EMA = Price(t) * k + EMA(t-1) * (1 - k)
where k = 2 / (period + 1)
```

**Bollinger Bands (20-period, 2σ)**:
```
Middle Band = 20-period SMA
Upper Band = Middle + (2 × StdDev)
Lower Band = Middle - (2 × StdDev)
```

**Momentum Score**:
```
Score = (PriceScore × 0.4 + VolumeScore × 0.3) × (1 - VolPenalty × 0.3) + FundingBias
Normalized to 0-100 scale
```

### Data Flow:
```
HyperLiquid API → Market Data Fetch → Technical Calculation → 
Signal Generation → Confidence Scoring → API Response → Frontend Display
```

---

## 📈 Next Steps

### Planned Enhancements:
- [ ] Historical price data integration (replace mock data)
- [ ] Real-time WebSocket updates
- [ ] Liquidation heatmap visualization
- [ ] Order flow imbalance detection
- [ ] Multi-timeframe analysis (1H, 4H, 1D)
- [ ] Backtesting framework with historical P&L
- [ ] Alert system (Discord, Telegram, Email)
- [ ] Portfolio tracking & PnL dashboard
- [ ] Advanced strategies (mean reversion, pairs trading)
- [ ] Machine learning signal scoring

---

## 🆘 Troubleshooting

**Issue**: "Error loading perps analysis"
- Check if backend is running
- Verify HyperLiquid API is accessible
- Check browser console for CORS errors

**Issue**: "No high-confidence signals"
- Markets may be in consolidation/neutral regime
- Lower confidence threshold in frontend filters
- Check if API is returning data correctly

**Issue**: "Funding rates show N/A"
- HyperLiquid API may be rate limiting
- Binance fallback not configured
- Check network connection

---

## 📞 Support

For issues or feature requests:
1. Check [PERPS_STATUS.md](PERPS_STATUS.md) for system status
2. Review API logs in backend console
3. Open GitHub issue with detailed error logs

---

## ⚖️ Disclaimer

**THIS IS RESEARCH TOOL, NOT FINANCIAL ADVICE**

- Signals are algorithmic and may be wrong
- Crypto trading is extremely risky
- Use proper risk management
- Test strategies in paper trading first
- Never invest more than you can afford to lose
- Past performance does not guarantee future results
