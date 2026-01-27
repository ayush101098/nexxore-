# Delta Neutral Builder

## Overview

The Delta Neutral Builder enables users to create market-neutral strategies that generate yield regardless of whether crypto prices go up or down. By combining spot positions with perpetual shorts, you earn funding rates while eliminating directional exposure.

---

## What is Delta Neutral?

**Delta** measures exposure to price movement. A **delta-neutral** position has zero net exposure — it doesn't profit or lose from price changes.

```
Traditional Long Position:
Price ↑ 10% → Profit +10%
Price ↓ 10% → Loss -10%
Delta = +1 (fully exposed)

Delta Neutral Position:
Price ↑ 10% → Profit 0%
Price ↓ 10% → Loss 0%
Delta = 0 (no exposure)
BUT: Earn funding rate continuously
```

---

## How It Works

### The Strategy

```
┌─────────────────────────────────────────────────────────────┐
│               DELTA NEUTRAL STRUCTURE                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   ┌─────────────────┐     ┌─────────────────┐              │
│   │  SPOT LONG      │     │  PERP SHORT     │              │
│   │  Buy 1 ETH      │  +  │  Short 1 ETH    │  =  Δ = 0   │
│   │  @ $3,000       │     │  @ $3,000       │              │
│   └─────────────────┘     └─────────────────┘              │
│          │                        │                         │
│          ▼                        ▼                         │
│   If ETH → $3,300:         If ETH → $3,300:                │
│   Spot: +$300              Perp: -$300                      │
│                                                             │
│   Net P&L from price: $0                                    │
│   Funding earned: +$X (if positive)                         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Funding Rate Profit

In crypto perpetuals, **funding rates** are paid every 8 hours:
- **Positive funding:** Longs pay shorts (bullish market)
- **Negative funding:** Shorts pay longs (bearish market)

Historically, funding is positive ~70% of the time, meaning shorts (delta-neutral positions) earn yield.

---

## Building a Delta Neutral Position

### Step 1: Select Asset

Choose which asset to run delta-neutral on:
- **ETH** — Highest liquidity, most stable funding
- **BTC** — Large market, consistent yields
- **SOL** — Higher volatility, potentially higher funding

### Step 2: Configure Position Size

```
┌─────────────────────────────────────┐
│  POSITION CONFIGURATION             │
├─────────────────────────────────────┤
│                                     │
│  Asset: [ ETH ▼ ]                   │
│                                     │
│  Position Size: $10,000             │
│                                     │
│  Spot Allocation: $5,000            │
│  Perp Margin: $5,000                │
│                                     │
│  Effective Leverage: 2x             │
│                                     │
└─────────────────────────────────────┘
```

### Step 3: Set Risk Parameters

```
┌─────────────────────────────────────┐
│  RISK PARAMETERS                    │
├─────────────────────────────────────┤
│                                     │
│  Max Funding Rate: -0.05%           │
│  (Close if funding turns negative)  │
│                                     │
│  Delta Threshold: ±2%               │
│  (Rebalance when delta drifts)      │
│                                     │
│  Auto-Close on: [ None ▼ ]          │
│  • Never                            │
│  • 3 days negative funding          │
│  • Manual only                      │
│                                     │
└─────────────────────────────────────┘
```

### Step 4: Deploy

The system automatically:
1. Buys spot ETH
2. Opens perpetual short position
3. Monitors and collects funding

---

## Position Management

### Dashboard View

```
┌─────────────────────────────────────────────────────────────┐
│  ETH DELTA NEUTRAL                              ACTIVE 🟢   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Position Value    │  Current Delta    │  Funding APY      │
│  $10,245.50        │  +0.12%           │  18.5%            │
│  +$245.50 (P&L)    │  (Near Neutral)   │  (Annualized)     │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  SPOT POSITION          │  PERP POSITION                   │
│  1.52 ETH               │  -1.52 ETH                       │
│  Entry: $3,289          │  Entry: $3,289                   │
│  Value: $5,122          │  Value: -$5,122                  │
│  P&L: +$122             │  P&L: -$118                      │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  FUNDING HISTORY                                            │
│  Last 8h: +$12.45   │  24h: +$38.20   │  Total: +$241.50  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Rebalancing

When price moves significantly, delta drifts from zero. The system rebalances:

```
Price ↑ 20%:
- Spot value increases
- Perp short is underwater
- Net delta becomes positive
→ System sells some spot, increases short to re-neutralize

Price ↓ 20%:
- Spot value decreases  
- Perp short is profitable
- Net delta becomes negative
→ System buys more spot, reduces short to re-neutralize
```

---

## Yield Sources

| Source | Description | Typical APY |
|--------|-------------|-------------|
| Funding Rate | 8h payments from longs | 10-30% |
| Spot Staking | Stake spot ETH (stETH) | 3-5% |
| Lending Yield | Lend margin as collateral | 2-4% |

**Combined APY:** 15-40% (varies with market conditions)

---

## Risk Factors

### Funding Rate Reversal
If funding turns negative for extended periods, the position loses money.

**Mitigation:** 
- Set max negative funding threshold
- Auto-close after X days of negative funding
- Monitor funding rate trends

### Liquidation Risk
High volatility can liquidate the perp position before rebalancing.

**Mitigation:**
- Use lower leverage (2x recommended)
- Keep excess margin
- Enable auto-rebalance on large moves

### Execution Risk
Slippage during rebalancing can create temporary delta exposure.

**Mitigation:**
- Use DEXs with deep liquidity
- Set max slippage parameters
- Rebalance during low volatility periods

### Smart Contract Risk
Bugs in protocols could lead to loss of funds.

**Mitigation:**
- Use audited protocols
- Diversify across venues
- Keep position sizes reasonable

---

## Performance Metrics

### Historical Backtests

| Period | ETH Delta Neutral | BTC Delta Neutral |
|--------|-------------------|-------------------|
| 2024 YTD | +22.4% | +18.7% |
| 2023 | +31.2% | +24.8% |
| 2022 (Bear) | +15.6% | +12.3% |

*Past performance does not guarantee future results*

### Risk Metrics

| Metric | Value |
|--------|-------|
| Sharpe Ratio | 2.1 |
| Max Drawdown | -8.5% |
| Win Rate | 73% of 8h periods |
| Avg Funding | +0.015% per 8h |

---

## Advanced Features

### Multi-Asset Delta Neutral
Run delta-neutral across multiple assets:
- ETH: 50%
- BTC: 30%
- SOL: 20%

### Yield Stacking
Combine with other strategies:
- Delta neutral base
- Plus staking yield on spot
- Plus lending yield on margin

### Automated Position Sizing
AI agent adjusts position size based on:
- Current funding rate
- Historical funding volatility
- Market sentiment indicators

---

## Getting Started

1. **Navigate** to Delta Neutral Builder
2. **Select** asset and position size
3. **Configure** risk parameters
4. **Connect** wallet and approve
5. **Deploy** and monitor

---

## FAQ

**Q: What's the minimum position size?**
A: $1,000 recommended for cost efficiency.

**Q: How often does rebalancing occur?**
A: When delta drifts beyond threshold (default 2%).

**Q: Can I run multiple delta-neutral positions?**
A: Yes, across different assets.

**Q: What happens in extreme volatility?**
A: Auto-rebalancing kicks in. In extreme cases, position may be closed to prevent liquidation.

**Q: Is this truly "risk-free"?**
A: No. While market-neutral, there are still risks (funding reversal, execution, smart contract). It's lower risk than directional trading, not zero risk.

---

## Next Steps

- [Nexxore Agents →](../agents/overview.md)
- [Research Agent →](../agents/research-agent.md)
