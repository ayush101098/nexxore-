# Alpha Agent

Read how the Alpha Agent works: signal generation, entry/exit recommendations, confidence scoring, and integration with the Nexxore execution layer.

---

## Overview

The Alpha Agent generates actionable trading signals by analyzing market data, on-chain metrics, and technical indicators. It identifies high-probability setups and provides entry, exit, and risk management recommendations.

---

## How It Works

The Alpha Agent operates through a multi-stage pipeline:

| Stage | Function |
|-------|----------|
| **Data Ingestion** | Collects price action, volume, order book depth, and funding rates |
| **Technical Analysis** | Identifies trends, support/resistance, patterns, and momentum |
| **On-Chain Analysis** | Monitors exchange flows, whale activity, funding rates, and open interest |
| **Signal Generation** | Produces entry zones, stop losses, take profits, and confidence scores |

---

## Signal Types

### Long Signal

Market conditions favor upside. Generated when:
- Bullish technical patterns are confirmed
- Exchange outflows are increasing (accumulation)
- Funding rates are neutral or negative (shorts crowded)

### Short Signal

Market conditions favor downside. Generated when:
- Bearish technical patterns are confirmed
- Exchange inflows are increasing (distribution)
- Funding rates are elevated (longs crowded)

### Neutral Signal

When conditions don't favor directional bets. The agent recommends:
- Wait for clearer setup
- Deploy delta-neutral strategies
- Run funding rate arbitrage

---

## Signal Components

| Component | Description |
|-----------|-------------|
| **Entry Zone** | Price range for optimal entry. Wider zones = lower precision, higher fill probability |
| **Stop Loss** | Maximum acceptable loss level. Always defined before entry |
| **Take Profit** | Multiple targets for scaling out (TP1, TP2, TP3) |
| **Risk/Reward** | Ratio between potential loss and gain. Minimum threshold: 1:2 |
| **Confidence** | AI conviction level (0-100%). Higher = larger recommended size |
| **Timeframe** | Expected trade duration: Scalp (hours), Swing (days), Position (weeks) |

---

## Indicators Used

### Technical Indicators

| Indicator | Purpose |
|-----------|---------|
| Moving Averages (20, 50, 200) | Trend identification |
| RSI (14) | Overbought/oversold conditions |
| MACD | Momentum and trend changes |
| Bollinger Bands | Volatility measurement |
| Volume Profile | Key support/resistance levels |
| Fibonacci | Retracement and extension levels |

### On-Chain Metrics

| Metric | Purpose |
|--------|---------|
| Exchange Flows | Accumulation vs. distribution |
| Funding Rate | Market positioning and sentiment |
| Open Interest | Leverage in the system |
| Whale Transactions | Smart money movements |
| MVRV | Long-term value assessment |

---

## Using Alpha Agent

### Manual Trading

1. Review signal details and reasoning
2. Validate with your own analysis
3. Calculate position size based on account risk
4. Execute trade manually on preferred venue
5. Set stop loss immediately after entry
6. Monitor for exit signals or invalidation

### Auto-Execution (Coming Soon)

Enable automated trading with configurable parameters:

| Parameter | Description |
|-----------|-------------|
| Max Position Size | Absolute limit per trade |
| Risk Per Trade | Percentage of account risked |
| Min Confidence | Threshold for auto-execution |
| Notification Channels | Telegram, Discord, Email |

---

## Position Sizing

Alpha Agent suggests position sizes using the following formula:

$$Position\ Size = \frac{Account\ Risk\ \%}{Stop\ Loss\ \%}$$

**Example:**
- Account: $10,000
- Risk per trade: 2% ($200)
- Stop Loss: 5%
- Position Size = $200 / 5% = **$4,000**

### Risk Guidelines

| Account Size | Max Risk/Trade | Max Concurrent Positions |
|--------------|----------------|--------------------------|
| < $10K | 1-2% | 3 |
| $10K - $50K | 2-3% | 5 |
| > $50K | 1-2% | 8 |

---

## Performance Tracking

### Key Metrics

| Metric | Description |
|--------|-------------|
| **Win Rate** | Percentage of profitable signals |
| **Avg R:R** | Average risk/reward achieved |
| **Profit Factor** | Gross profit / Gross loss |
| **Sharpe Ratio** | Risk-adjusted returns |
| **Max Drawdown** | Largest peak-to-trough decline |

### Historical Performance

*Backtested on 2023-2024 data*

| Metric | ETH Signals | BTC Signals | All Signals |
|--------|-------------|-------------|-------------|
| Win Rate | 68% | 65% | 67% |
| Avg R:R | 1:2.4 | 1:2.1 | 1:2.3 |
| Profit Factor | 2.8 | 2.2 | 2.5 |
| Sharpe | 1.8 | 1.5 | 1.7 |

*Past performance does not guarantee future results.*

---

## Notifications

Configure alerts for the following events:

| Event | Description |
|-------|-------------|
| New Signal | Fresh trading opportunity generated |
| Entry Zone Reached | Price enters the recommended entry range |
| Stop Loss Hit | Position closed at loss |
| Take Profit Reached | Profit target achieved |
| Signal Invalidated | Setup no longer valid |

**Available Channels:** Telegram, Discord, Email, In-App

---

## Best Practices

1. **Don't blindly follow signals** — Use as one input in your decision-making process
2. **Always use stop losses** — Non-negotiable risk management
3. **Scale into positions** — Don't enter full size at once
4. **Track your trades** — Review performance regularly
5. **Adjust size by confidence** — Higher confidence = larger allocation
6. **Respect the timeframe** — Don't expect swing results from scalp setups

---

## Risk Disclosure

Trading involves significant risk of loss. Please be aware:

- Signals are not financial advice
- Past performance does not guarantee future results
- Never risk more than you can afford to lose
- Markets can move against any signal
- Use proper position sizing at all times

---

## Next Steps

- [Web3 Intelligence Agent →](./web3-intelligence.md)
- [Research Agent →](./research-agent.md)
- [Risk Framework →](../framework/risk-framework.md)
