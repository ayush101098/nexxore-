# Comprehensive Perps Analysis - Complete Data Package

## 🎯 What Changed

The Research Agent's perps analysis now provides **EVERY PIECE OF AVAILABLE DATA** for all 20 HyperLiquid markets. Traders get complete visibility into market conditions to make fully informed decisions.

---

## 📦 Complete Data Sections

### 1. **RAW MARKET DATA** (Unprocessed)
```json
{
  "price": 97234.50,
  "markPrice": 97235.20,
  "indexPrice": 97233.80,
  "oraclePrice": 97230.00,
  "prevDayPrice": 95123.40,
  "high24h": 98456.70,
  "low24h": 94832.10,
  "volume24h": 1250500000,
  "volume1h": 52340000,
  "openInterest": 245000000,
  "prevDayOI": 232000000,
  "fundingRate": 0.0082
}
```

### 2. **PRICE METRICS** (All Price Points)
- Current, Mark, Index, Oracle prices
- 24h change %
- 24h high & low
- 24h range %
- Distance to high/low

### 3. **VOLUME ANALYSIS**
- 24-hour volume
- 1-hour volume
- Average hourly volume
- Volume spike detection (e.g., 2.3x average = 230% spike)
- Trend classification (INCREASING/DECREASING/STABLE)

### 4. **TECHNICAL INDICATORS**
- **RSI (14)**: Overbought/oversold levels
- **EMA (9, 21, 50)**: Trend direction
- **Bollinger Bands**: Upper, middle, lower, position %
- **VWAP**: Volume-weighted average
- **Signals**: RSI extreme, EMA crossovers, BB breakouts

### 5. **FUNDING RATE ANALYSIS**
- Current 8h funding rate
- Annualized APR
- 24h average funding
- Direction (longs pay vs shorts pay)
- Arbitrage opportunity signal
- Next payment time

### 6. **OPEN INTEREST TRACKING**
- Current OI
- Previous day OI
- Change % (24h)
- Absolute change
- Signal interpretation:
  - BULLISH_STRENGTH: Price↑ + OI↑
  - BEARISH_STRENGTH: Price↓ + OI↑
  - SHORT_COVERING: Price↑ + OI↓
  - LONG_LIQUIDATION: Price↓ + OI↓

### 7. **ORDER BOOK ANALYSIS**
- Spread (price difference)
- Spread in basis points
- Bid liquidity ($M)
- Ask liquidity ($M)
- Total liquidity
- Buy pressure % (bid/total)
- Imbalance (BUY_HEAVY/SELL_HEAVY/BALANCED)
- **Top 10 bids** with price & size
- **Top 10 asks** with price & size

### 8. **LIQUIDATION LEVELS**
Calculated for long and short positions:
```json
{
  "longLevels": {
    "5x": "77787.60",   // -20% price drop
    "10x": "87511.05",  // -10% price drop
    "20x": "92372.78"   // -5% price drop
  },
  "shortLevels": {
    "5x": "116681.40",  // +20% price rise
    "10x": "106958.00", // +10% price rise
    "20x": "102096.23"  // +5% price rise
  }
}
```

### 9. **SUPPORT & RESISTANCE**
Auto-detected key levels:
- Resistance 1 (24h high)
- Resistance 2 (recent period high)
- Support 1 (24h low)
- Support 2 (recent period low)
- Distance to each level (%)

### 10. **VOLATILITY METRICS**
- Realized volatility %
- 24h range %
- Classification (HIGH/MEDIUM/LOW)

### 11. **MOMENTUM SCORE**
Multi-factor risk-adjusted score (0-100):
- Price component (40% weight)
- Volume component (30% weight)
- Volatility penalty (30% weight)
- Funding bias adjustment
- Rating: STRONG (>75), MODERATE (50-75), WEAK (25-50), VERY_WEAK (<25)

### 12. **MARKET REGIME**
Classification with confidence:
- **HIGH_VOLATILITY**: Large swings expected, wide stops
- **TRENDING**: Strong direction, follow momentum
- **CONSOLIDATION**: Range-bound, mean reversion
- **LOW_LIQUIDITY**: Thin books, reduce size
- **FUNDING_ARBITRAGE**: Extreme funding, arb opportunities

### 13. **PRICE ACTION PATTERNS**
- Trend: UPTREND/DOWNTREND/RANGING
- Pattern: HIGHER_HIGHS/LOWER_LOWS/CONSOLIDATION
- Strength rating

### 14. **TRADING SIGNAL** (Multi-Factor)
```json
{
  "direction": "LONG",
  "confidence": "78%",
  "strength": "STRONG",
  "reasoning": [
    "RSI oversold (28.4) with positive momentum",
    "Bullish EMA crossover (9>96800 > 21>95500)",
    "OI increasing with price - confirms bullish strength",
    "Order book shows 62.3% buy pressure",
    "Volume spike: 230% above average"
  ],
  "warnings": [
    "Volatility spike - use reduced position size",
    "Price near support - long liquidations possible within 3.2%"
  ]
}
```

### 15. **TRADE RECOMMENDATIONS**
Complete trade plan:
- **Entry**: Current market price
- **Stop Loss**: Support level (not arbitrary %)
- **Take Profit**: Resistance level
- **Leverage**: 3-5x (high vol) / 10-15x (normal) / 2-3x (low liq)
- **Position Size**: Standard (100%) / Reduced (50%) / Small (25%)
- **Risk/Reward Ratio**: Calculated based on SL/TP distances

---

## 🔬 Signal Generation Logic

### Confidence Scoring System

Base confidence starts at 0.5 (50%), then:

**Technical Signals (+15% each)**:
- RSI oversold (<30) + momentum >40 → LONG
- RSI overbought (>70) + momentum <30 → SHORT
- Bullish EMA crossover → LONG bias (+10%)
- Bearish EMA crossover → SHORT bias (+10%)
- Bollinger Band breakout → Volatility warning

**Funding Rate (+10%)**:
- Strong short bias (>1% per 8h) → Confirms SHORT
- Strong long bias (<-1% per 8h) → Confirms LONG

**Open Interest (+10%)**:
- BULLISH_STRENGTH → Confirms LONG
- BEARISH_STRENGTH → Confirms SHORT
- SHORT_COVERING → Suggests LONG
- LONG_LIQUIDATION → Warning flag

**Order Book (+5%)**:
- Buy pressure >60% → Supports LONG
- Buy pressure <40% → Supports SHORT

**Volume (+5%)**:
- Spike >1.5x average → Confirms direction

**Price Action (+5% each)**:
- Higher highs pattern → Confirms LONG
- Lower lows pattern → Confirms SHORT

**Maximum confidence: 95%** (never 100% - markets are uncertain)

### Warning System

Automatic warnings for:
- **Liquidation Proximity**: <5% from support/resistance
- **Wide Spreads**: >10 bps - low liquidity
- **Volatility Spikes**: BB breakouts, >5% realized vol
- **Liquidation Cascades**: OI dropping with price

---

## 📊 Example API Response

**GET /api/perps-analysis?coin=BTC**

```json
{
  "success": true,
  "analysis": {
    "coin": "BTC",
    "timestamp": 1738627200000,
    
    "rawData": { /* All unprocessed data */ },
    
    "price": {
      "current": "97234.50",
      "mark": "97235.20",
      "index": "97233.80",
      "oracle": "97230.00",
      "change24h": "+2.34%",
      "high24h": "98456.70",
      "low24h": "94832.10",
      "range24h": "3.82%",
      "distanceToHigh": "-1.26%",
      "distanceToLow": "+2.53%"
    },
    
    "volume": {
      "24h": "1250.50M",
      "1h": "52.34M",
      "avgHourly": "52.10M",
      "spike": "2.30x",
      "trend": "INCREASING"
    },
    
    "technicals": {
      "rsi": "28.45",
      "ema9": "96800.00",
      "ema21": "95500.00",
      "ema50": "94200.00",
      "vwap": "96234.50",
      "bollinger": {
        "upper": "98500.00",
        "middle": "96000.00",
        "lower": "93500.00",
        "position": "45%"
      },
      "signals": {
        "rsiOverbought": false,
        "rsiOversold": true,
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
      "previous": "232000000.00",
      "change24h": "+5.60%",
      "changeAbsolute": "13000000.00",
      "signal": "BULLISH_STRENGTH",
      "interpretation": "Price rising with OI increasing - strong bullish momentum"
    },
    
    "orderBook": {
      "spread": "0.70",
      "spreadBps": "7.20",
      "bidLiquidity": "45.30M",
      "askLiquidity": "28.10M",
      "totalLiquidity": "73.40M",
      "buyPressure": "61.70%",
      "imbalance": "BUY_HEAVY",
      "topBids": [
        { "price": 97234.00, "size": 1.234 },
        { "price": 97233.00, "size": 2.145 }
        /* ... 8 more levels */
      ],
      "topAsks": [
        { "price": 97234.70, "size": 0.890 },
        { "price": 97235.50, "size": 1.456 }
        /* ... 8 more levels */
      ]
    },
    
    "liquidations": {
      "longLevels": {
        "5x": "77787.60",
        "10x": "87511.05",
        "20x": "92372.78"
      },
      "shortLevels": {
        "5x": "116681.40",
        "10x": "106958.00",
        "20x": "102096.23"
      }
    },
    
    "levels": {
      "resistance1": "98456.70",
      "resistance2": "98123.45",
      "support1": "94832.10",
      "support2": "95234.20",
      "distanceToResistance": "+1.26%",
      "distanceToSupport": "+2.53%"
    },
    
    "volatility": {
      "realized": "2.15%",
      "range24h": "3.82%",
      "classification": "MEDIUM"
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
    
    "priceAction": {
      "trend": "UPTREND",
      "pattern": "HIGHER_HIGHS",
      "strength": "MODERATE"
    },
    
    "signal": {
      "direction": "LONG",
      "confidence": "78%",
      "strength": "STRONG",
      "reasoning": [
        "RSI oversold (28.45) with positive momentum",
        "Bullish EMA crossover (9>96800 > 21>95500)",
        "OI increasing with price - confirms bullish strength",
        "Order book shows 61.70% buy pressure",
        "Volume spike: 230% above average",
        "Higher highs pattern - uptrend continuation"
      ],
      "warnings": [
        "Price near support - long liquidations possible within 2.5%"
      ]
    },
    
    "recommendations": {
      "entry": "97234.50",
      "stopLoss": "94832.10",
      "takeProfit": "98456.70",
      "leverage": "10-15x",
      "positionSize": "Standard (100%)",
      "riskReward": "2.14"
    }
  }
}
```

---

## 💡 How Traders Use This Data

### Conservative Trader
```
1. Check warnings first
2. Require confidence >70%
3. Verify multiple signal confirmations
4. Use support/resistance for SL/TP
5. Reduce size if volatility is HIGH
```

### Aggressive Trader
```
1. Act on confidence >50%
2. Use order book imbalance for timing
3. Follow momentum score
4. Higher leverage in TRENDING regime
5. Volume spike = entry trigger
```

### Arbitrage Trader
```
1. Filter by funding signal
2. Look for STRONG_*_BIAS
3. Calculate annualized APR
4. Delta neutral position (perp + spot)
5. Collect funding payments
```

### Risk Manager
```
1. Monitor liquidation proximity
2. Track OI changes (liquidation cascades)
3. Check spread width (liquidity)
4. Adjust size based on volatility
5. Watch warning flags
```

---

## 🚀 Usage Examples

### Find High-Confidence Longs
```javascript
const res = await fetch('/api/perps-analysis');
const data = await res.json();

const strongLongs = data.markets
  .filter(m => 
    m.signal.direction === 'LONG' &&
    parseFloat(m.signal.confidence) > 70 &&
    m.signal.warnings.length === 0
  )
  .sort((a, b) => 
    parseFloat(b.signal.confidence) - parseFloat(a.signal.confidence)
  );

console.log('Top long opportunities:', strongLongs.slice(0, 5));
```

### Find Funding Arbitrage
```javascript
const fundingArbs = data.markets
  .filter(m => 
    m.funding.signal.includes('STRONG') &&
    Math.abs(parseFloat(m.funding.annualized)) > 20
  )
  .map(m => ({
    coin: m.coin,
    funding: m.funding.current,
    annualized: m.funding.annualized,
    direction: m.funding.direction
  }));

console.log('Funding arbitrage opportunities:', fundingArbs);
```

### Check Liquidation Risks
```javascript
const btcAnalysis = await fetch('/api/perps-analysis?coin=BTC')
  .then(r => r.json());

const distToSupport = parseFloat(btcAnalysis.analysis.levels.distanceToSupport);

if (distToSupport < 5) {
  console.warn(`BTC within ${distToSupport}% of support!`);
  console.log('Long liquidation levels:', btcAnalysis.analysis.liquidations.longLevels);
}
```

---

## 📋 Complete Data Checklist

✅ Price (current, mark, index, oracle)
✅ 24h high/low/range
✅ Volume (24h, 1h, spike detection)
✅ Open interest (current, change, signal)
✅ Funding rate (current, annualized, arbitrage)
✅ Order book (spread, liquidity, imbalance, levels)
✅ Technical indicators (RSI, EMA, BB, VWAP)
✅ Liquidation levels (5x/10x/20x for long/short)
✅ Support & resistance (auto-detected)
✅ Volatility (realized, range, classification)
✅ Momentum (multi-factor score)
✅ Market regime (5 types with confidence)
✅ Price action (trend, pattern, strength)
✅ Trading signal (direction, confidence, reasoning, warnings)
✅ Recommendations (entry, SL, TP, leverage, size, R/R)

---

## 🔄 Data Refresh

- **Cache TTL**: 1 minute
- **HyperLiquid API**: Real-time data
- **Historical Data**: Last 100 hours (1h candles)
- **Order Book**: L2 snapshot (top 10 levels)

---

## ⚠️ Important Notes

1. **ALL DATA IS REAL**: No mocked data (except fallback if API fails)
2. **MAKE YOUR OWN DECISIONS**: Agent provides data, YOU decide trades
3. **USE RISK MANAGEMENT**: Always use stop losses
4. **VERIFY SIGNALS**: Cross-reference multiple data points
5. **UNDERSTAND WARNINGS**: Don't ignore risk flags

---

**TRADERS NOW HAVE COMPLETE MARKET TRANSPARENCY**

Every piece of available data is exposed. No black boxes. No hidden analysis. You see everything the system sees and make your own informed decisions.
