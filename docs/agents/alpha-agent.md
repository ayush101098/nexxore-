# Alpha Agent

## Overview

The Alpha Agent generates actionable trading signals by analyzing market data, on-chain metrics, and technical indicators. It identifies high-probability setups and provides entry, exit, and risk management recommendations.

---

## How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                    ALPHA AGENT PIPELINE                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────┐                                           │
│  │  MARKET DATA    │                                           │
│  │  • Price action │                                           │
│  │  • Volume       │                                           │
│  │  • Order book   │                                           │
│  │  • Funding rate │                                           │
│  └────────┬────────┘                                           │
│           │                                                     │
│           ▼                                                     │
│  ┌─────────────────────────────────────┐                       │
│  │  TECHNICAL ANALYSIS                 │                       │
│  │  • Trend identification             │                       │
│  │  • Support/resistance               │                       │
│  │  • Pattern recognition              │                       │
│  │  • Momentum indicators              │                       │
│  └────────┬────────────────────────────┘                       │
│           │                                                     │
│           ▼                                                     │
│  ┌─────────────────────────────────────┐                       │
│  │  ON-CHAIN ANALYSIS                  │                       │
│  │  • Exchange flows                   │                       │
│  │  • Whale activity                   │                       │
│  │  • Funding rates                    │                       │
│  │  • Open interest                    │                       │
│  └────────┬────────────────────────────┘                       │
│           │                                                     │
│           ▼                                                     │
│  ┌─────────────────────────────────────┐                       │
│  │  SIGNAL GENERATION                  │                       │
│  │  • Entry price                      │                       │
│  │  • Stop loss                        │                       │
│  │  • Take profit targets              │                       │
│  │  • Position sizing                  │                       │
│  │  • Confidence score                 │                       │
│  └─────────────────────────────────────┘                       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Signal Types

### 🟢 Long Signal
Market conditions favor upside.

```
┌─────────────────────────────────────────┐
│  🟢 LONG SIGNAL — ETH/USD               │
├─────────────────────────────────────────┤
│                                         │
│  Entry Zone: $3,180 - $3,220            │
│  Stop Loss: $3,050 (-4.5%)              │
│  Target 1: $3,420 (+7%)                 │
│  Target 2: $3,580 (+13%)                │
│  Target 3: $3,800 (+20%)                │
│                                         │
│  Risk/Reward: 1:2.8                     │
│  Confidence: 72%                        │
│  Timeframe: 2-5 days                    │
│                                         │
│  Reasoning:                             │
│  • Bullish engulfing on daily           │
│  • Exchange outflows increasing         │
│  • Funding rate reset to neutral        │
│  • Breaking above 50 EMA                │
│                                         │
└─────────────────────────────────────────┘
```

### 🔴 Short Signal
Market conditions favor downside.

```
┌─────────────────────────────────────────┐
│  🔴 SHORT SIGNAL — SOL/USD              │
├─────────────────────────────────────────┤
│                                         │
│  Entry Zone: $198 - $202                │
│  Stop Loss: $215 (+7%)                  │
│  Target 1: $180 (-10%)                  │
│  Target 2: $165 (-18%)                  │
│                                         │
│  Risk/Reward: 1:2.5                     │
│  Confidence: 65%                        │
│  Timeframe: 3-7 days                    │
│                                         │
│  Reasoning:                             │
│  • Rejection at resistance              │
│  • High funding rate (longs crowded)    │
│  • Bearish divergence on RSI            │
│  • Whale deposits to exchanges          │
│                                         │
└─────────────────────────────────────────┘
```

### 🟡 Neutral / No Signal
When conditions don't favor directional bets.

```
┌─────────────────────────────────────────┐
│  🟡 NEUTRAL — BTC/USD                   │
├─────────────────────────────────────────┤
│                                         │
│  Current Price: $104,250                │
│  Recommendation: Wait / Delta Neutral   │
│                                         │
│  Reasoning:                             │
│  • Range-bound between $100K-$108K      │
│  • Mixed signals across indicators      │
│  • Low conviction environment           │
│                                         │
│  Alternative: Run funding rate arb      │
│                                         │
└─────────────────────────────────────────┘
```

---

## Signal Components

### Entry Zone
Price range for optimal entry. Wider zones mean lower precision but higher fill probability.

### Stop Loss
Maximum acceptable loss level. Always defined before entry.

### Take Profit Targets
Multiple profit targets allow scaling out:
- **Target 1:** Conservative, high probability
- **Target 2:** Base case scenario
- **Target 3:** Extended target if momentum continues

### Risk/Reward Ratio
Relationship between potential loss and potential gain:
- **< 1:1:** Poor setup, skip
- **1:2 - 1:3:** Good setup
- **> 1:3:** Excellent setup

### Confidence Score
AI's conviction level (0-100%):
- **< 50%:** Low confidence, reduce size
- **50-70%:** Moderate confidence, standard size
- **> 70%:** High confidence, can increase size

### Timeframe
Expected duration of the trade:
- **Scalp:** Minutes to hours
- **Swing:** Days to weeks
- **Position:** Weeks to months

---

## Indicators Used

### Technical
| Indicator | Purpose |
|-----------|---------|
| Moving Averages (20, 50, 200) | Trend identification |
| RSI (14) | Overbought/oversold |
| MACD | Momentum |
| Bollinger Bands | Volatility |
| Volume Profile | Support/resistance |
| Fibonacci | Retracement levels |

### On-Chain
| Metric | Purpose |
|--------|---------|
| Exchange Flows | Accumulation/distribution |
| Funding Rate | Market positioning |
| Open Interest | Leverage in system |
| Whale Transactions | Smart money moves |
| MVRV | Value assessment |

---

## Using Alpha Agent

### Manual Trading
1. Review signal details
2. Validate with your own analysis
3. Calculate position size based on risk
4. Execute trade manually
5. Set stop loss immediately
6. Monitor for exit signals

### Auto-Execution (Coming Soon)
Enable automated trading:
1. Set maximum position size
2. Set risk per trade
3. Choose signal confidence threshold
4. Agent executes automatically
5. Notifications sent on entry/exit

---

## Position Sizing

Alpha Agent suggests position sizes based on:

```
Position Size = (Account Risk %) / (Stop Loss %)

Example:
Account: $10,000
Risk per trade: 2% ($200)
Stop Loss: 5%

Position Size = $200 / 5% = $4,000
```

### Risk Guidelines
| Account Size | Max Risk/Trade | Max Positions |
|--------------|----------------|---------------|
| < $10K | 1-2% | 3 |
| $10K-$50K | 2-3% | 5 |
| > $50K | 1-2% | 8 |

---

## Performance Tracking

### Metrics
- **Win Rate:** % of profitable signals
- **Avg R:R:** Average risk/reward achieved
- **Profit Factor:** Gross profit / Gross loss
- **Sharpe Ratio:** Risk-adjusted returns
- **Max Drawdown:** Largest peak-to-trough decline

### Historical Performance
*Backtested on 2023-2024 data*

| Metric | ETH Signals | BTC Signals | All Signals |
|--------|-------------|-------------|-------------|
| Win Rate | 68% | 65% | 67% |
| Avg R:R | 1:2.4 | 1:2.1 | 1:2.3 |
| Profit Factor | 2.8 | 2.2 | 2.5 |
| Sharpe | 1.8 | 1.5 | 1.7 |

*Past performance does not guarantee future results*

---

## Notifications

Configure alerts for:
- New signals generated
- Entry zone reached
- Stop loss hit
- Take profit reached
- Signal invalidated

Channels:
- Telegram
- Discord
- Email
- In-app

---

## Best Practices

1. **Don't blindly follow signals** — Use as one input in decision-making
2. **Always use stop losses** — Non-negotiable risk management
3. **Scale into positions** — Don't enter full size at once
4. **Track your trades** — Review performance regularly
5. **Adjust size by confidence** — Higher confidence = larger size
6. **Respect the timeframe** — Don't expect swing results from scalp setups

---

## Risk Warnings

⚠️ **Trading involves significant risk of loss**

- Signals are not financial advice
- Past performance ≠ future results
- Never risk more than you can afford to lose
- Markets can move against any signal
- Use proper position sizing

---

## Next Steps

- [Web3 Intelligence Agent →](./web3-intelligence.md)
- [Research Agent →](./research-agent.md)
