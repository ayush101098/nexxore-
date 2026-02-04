# On-Chain Analyst Agent

The On-Chain Analyst is Nexxore's data intelligence layer for perpetual trading. It provides comprehensive market analysis across 20 assets, combining technical indicators, fundamental metrics, derivatives data, and AI-powered trading signals.

---

## Overview

The On-Chain Analyst Agent is a real-time market intelligence system optimized for speed and accuracy. It serves as the data backbone for:

- **Traders** — Get instant analysis on any perp market
- **Execution Agents** — Consume signals programmatically via API
- **Risk Management** — Monitor market conditions 24/7

---

## Supported Markets

The agent tracks 20 perpetual markets:

| Tier | Assets |
|------|--------|
| **Major** | BTC, ETH, SOL |
| **Large Cap** | BNB, XRP, DOGE, ADA, AVAX, LINK, DOT |
| **Mid Cap** | MATIC, UNI, ATOM, LTC, NEAR, APT |
| **Emerging** | OP, ARB, INJ, SUI |

---

## Data Sources

### Primary: Binance API (~100ms latency)

| Endpoint | Data |
|----------|------|
| `/ticker/24hr` | Price, volume, 24h change |
| `/fapi/v1/premiumIndex` | Funding rates |
| `/klines` | OHLC candlestick data |

### Secondary: CoinGecko (fallback)

| Endpoint | Data |
|----------|------|
| `/coins/markets` | Market cap, volume, supply |
| `/coins/{id}/market_chart` | Historical prices |

### Additional Sources

| Source | Data Type |
|--------|-----------|
| Alternative.me | Fear & Greed Index |
| CoinGecko Global | Total market cap, BTC dominance |
| Binance Futures | Open interest, funding rates |

---

## Analysis Modules

### 📊 Technical Analysis

Real-time indicators calculated from OHLC data:

| Indicator | Calculation | Signal |
|-----------|-------------|--------|
| **RSI (14)** | Relative Strength Index | Overbought (>70) / Oversold (<30) |
| **MACD** | Moving Average Convergence/Divergence | Bullish/Bearish crossover |
| **EMA 9/21** | Exponential Moving Average cross | Short-term trend |
| **EMA 50/200** | Golden Cross / Death Cross | Long-term trend |
| **Bollinger Bands** | Standard deviation bands | Volatility + position |
| **Stochastic RSI** | RSI of RSI | Momentum extremes |
| **ADX** | Average Directional Index | Trend strength |

### 📈 Support & Resistance

Automated S/R level calculation from historical OHLC:

```
Resistance Levels:
├── R3: $108,450 (+4.2%) — Strong
├── R2: $105,200 (+1.1%) — Medium
└── R1: $104,800 (+0.7%) — Weak

Current Price: $104,100

Support Levels:
├── S1: $103,200 (-0.9%) — Weak
├── S2: $101,500 (-2.5%) — Medium
└── S3: $98,800 (-5.1%) — Strong
```

### 📋 Fundamental Analysis

Project-level metrics for informed decisions:

| Metric | Description |
|--------|-------------|
| **Market Cap** | Total value of circulating supply |
| **Volume/MCap** | Liquidity ratio |
| **TVL** | Total value locked in protocols |
| **Dev Activity** | GitHub commits, releases |
| **Consensus** | Network mechanism (PoW, PoS, etc.) |
| **Launch Year** | Time in market |

### 📉 Derivatives Data

Perpetual-specific intelligence:

| Metric | Significance |
|--------|--------------|
| **Funding Rate** | Positive = longs pay shorts |
| **Open Interest** | Total outstanding contracts |
| **Long/Short Ratio** | Market positioning |
| **Liquidation Levels** | Price points with clustered liquidations |

---

## Trading Signals

The agent generates verdicts for each market:

### Signal Types

| Signal | Meaning | Typical Action |
|--------|---------|----------------|
| **BULLISH** | Positive momentum, favorable conditions | Long entries on pullbacks |
| **BEARISH** | Negative pressure, unfavorable setup | Shorts at resistance |
| **NEUTRAL** | Consolidating, no clear direction | Range trade or wait |

### Signal Generation Logic

```javascript
function calculateSignal(market) {
  const data = marketData[market];
  const funding = fundingData[market];
  
  let score = 0;
  
  // Price momentum
  if (data.change24h > 3) score += 2;
  else if (data.change24h > 0) score += 1;
  else if (data.change24h < -3) score -= 2;
  else if (data.change24h < 0) score -= 1;
  
  // Funding rate (negative = bullish)
  if (funding.rate < -0.0001) score += 1;
  else if (funding.rate > 0.0005) score -= 1;
  
  // Volume trend
  if (data.volume24h > averageVolume * 1.5) score += 1;
  
  // Return verdict
  if (score >= 2) return 'BULLISH';
  if (score <= -2) return 'BEARISH';
  return 'NEUTRAL';
}
```

### Signal Output

```json
{
  "market": "BTC-PERP",
  "verdict": "BULLISH",
  "confidence": 0.72,
  "analysis": "Positive momentum with 24h gain of +2.4%. Funding rate negative at -0.0012% indicating shorts overleveraged. Volume 35% above average.",
  "strategy": "Long entries on pullbacks to $103K support. Stops below $101.5K. Scale in gradually."
}
```

---

## Execution Agent API

The On-Chain Analyst exposes a JavaScript API for programmatic access:

```javascript
// Access the agent from browser console or other agents
const agent = window.nexxoreAgent;

// Get analysis for single market
const btcIntel = agent.getMarketIntelligence('BTC');
console.log(btcIntel);
// {
//   price: 104100,
//   change24h: 2.4,
//   volume: 28500000000,
//   funding: -0.0012,
//   signal: 'BULLISH',
//   confidence: 0.72,
//   support: [103200, 101500, 98800],
//   resistance: [104800, 105200, 108450]
// }

// Get all 20 markets
const allMarkets = agent.getAllMarketIntelligence();

// Raw data access
const prices = agent.getMarketData();
const funding = agent.getFundingData();

// Force refresh
await agent.refreshData();
```

---

## Performance Optimizations

Version 3.2 includes significant performance improvements:

| Optimization | Before | After |
|--------------|--------|-------|
| **Primary API** | CoinGecko (~2s) | Binance (~100ms) |
| **Initial Load** | 3-5 seconds | 500-800ms |
| **Market Switch** | 1-2 seconds | <200ms |
| **S/R Calculation** | Blocking | Non-blocking async |
| **OHLC Cache** | None | 10 minute TTL |
| **Error Handling** | Crash on timeout | Graceful fallback |

---

## Update Frequency

| Data Type | Frequency |
|-----------|-----------|
| Prices | Real-time WebSocket |
| Funding Rates | Every 30 seconds |
| S/R Levels | On market change |
| Fear & Greed | Daily |
| Global Stats | Every 5 minutes |

---

## Use Cases

### For Traders

1. **Market Selection** — Find assets with strongest signals
2. **Entry Timing** — Use S/R levels for optimal entries
3. **Risk Assessment** — Check funding rates and OI
4. **News Context** — Understand what's driving moves

### For Execution Agents

1. **Signal Consumption** — Use `getMarketIntelligence()` API
2. **Data Pipeline** — Feed into ML models
3. **Automated Trading** — Trigger orders on BULLISH signals

### For Risk Management

1. **Portfolio Monitoring** — Track all positions
2. **Correlation Analysis** — Detect correlated moves
3. **Stress Alerts** — Fear & Greed extremes

---

## Integration

| System | Integration Method |
|--------|-------------------|
| Execution Agent | JavaScript API (`window.nexxoreAgent`) |
| External Systems | REST API (coming soon) |
| Alerts | Webhook notifications |
| Analytics | Data export |

---

## Next Steps

- [Prediction Markets Agent →](./prediction-markets.md)
- [Alpha Agent →](./alpha-agent.md)
- [Web3 Intelligence →](./web3-intelligence.md)
- [Agent Overview →](./overview.md)
