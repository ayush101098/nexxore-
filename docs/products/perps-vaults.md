# Perpetual Vaults

## Overview

Nexxore Perpetual Vaults provide leveraged exposure to crypto assets through perpetual futures contracts. Unlike spot trading, perpetuals allow you to trade with leverage and profit from both rising and falling markets.

---

## What Are Perpetual Futures?

Perpetual futures (perps) are derivative contracts that:
- **Never expire** — Unlike traditional futures, no settlement date
- **Track spot price** — Maintained through funding rate mechanism
- **Allow leverage** — Trade with 1x to 50x capital efficiency
- **Enable shorting** — Profit when prices fall

---

## Nexxore Perps Features

### 🎯 Multi-Asset Support
Trade perpetuals on:
- **ETH/USD** — Ethereum perpetuals
- **BTC/USD** — Bitcoin perpetuals
- **SOL/USD** — Solana perpetuals

### 📊 Real-Time Charts
Professional-grade charting with:
- Multiple timeframes (1m, 5m, 15m, 1H, 4H, 1D, 1W)
- Candlestick patterns
- Volume indicators
- Real-time price updates from Binance

### ⚡ Order Types
- **Market Orders** — Execute immediately at current price
- **Limit Orders** — Execute at specified price or better
- **Stop Orders** — Trigger market order when price reaches level

### 💰 Leverage
Adjustable leverage from 1x to 50x:

| Leverage | Margin Required | Liquidation Risk |
|----------|-----------------|------------------|
| 1x | 100% | Very Low |
| 5x | 20% | Low |
| 10x | 10% | Medium |
| 25x | 4% | High |
| 50x | 2% | Very High |

---

## How Perpetuals Work

### Opening a Position

```
Long Position (betting price goes up):
┌─────────────────────────────────────┐
│ Entry: $3,000 ETH                   │
│ Size: 10 ETH                        │
│ Leverage: 10x                       │
│ Margin Required: $3,000             │
│ Position Value: $30,000             │
└─────────────────────────────────────┘

If ETH → $3,300 (+10%):
  Profit = $3,000 (100% ROI on margin)

If ETH → $2,700 (-10%):
  Loss = $3,000 (100% loss, liquidated)
```

### Funding Rate
Every 8 hours, funding is exchanged between longs and shorts:
- **Positive funding**: Longs pay shorts (bullish market)
- **Negative funding**: Shorts pay longs (bearish market)

This keeps perpetual price aligned with spot price.

---

## Order Panel

### Market Order
Execute immediately at best available price.

```
┌─────────────────────────────────┐
│  Market Order                   │
├─────────────────────────────────┤
│  Size: _______ ETH              │
│  Leverage: [====|----] 10x      │
│  Est. Entry: $3,245.50          │
│  Liquidation: $2,920.95         │
│                                 │
│  [  LONG  ]    [  SHORT  ]      │
└─────────────────────────────────┘
```

### Limit Order
Set your desired entry price.

```
┌─────────────────────────────────┐
│  Limit Order                    │
├─────────────────────────────────┤
│  Size: _______ ETH              │
│  Limit Price: $______           │
│  Leverage: [====|----] 10x      │
│                                 │
│  Order executes when price      │
│  reaches your limit             │
│                                 │
│  [  LONG  ]    [  SHORT  ]      │
└─────────────────────────────────┘
```

### Stop Order
Protect positions or enter on breakouts.

```
┌─────────────────────────────────┐
│  Stop Order                     │
├─────────────────────────────────┤
│  Size: _______ ETH              │
│  Stop Price: $______            │
│  Leverage: [====|----] 10x      │
│                                 │
│  Triggers market order when     │
│  price hits stop level          │
│                                 │
│  [  LONG  ]    [  SHORT  ]      │
└─────────────────────────────────┘
```

---

## Position Management

### Open Positions
View all active positions with:
- Entry price
- Current P&L
- Liquidation price
- Margin ratio

### Close Position
- **Market Close** — Instant exit
- **Limit Close** — Exit at target price
- **Partial Close** — Reduce position size

### Add/Remove Margin
Adjust position margin to change liquidation price.

---

## Risk Parameters

### Liquidation
Positions are liquidated when margin ratio drops below maintenance margin:

```
Margin Ratio = (Margin + Unrealized P&L) / Position Value

If Margin Ratio < 2.5% → Liquidation
```

### Maximum Position Size
Limits based on available liquidity and leverage:

| Leverage | Max Position |
|----------|--------------|
| 1x | Unlimited |
| 10x | $1,000,000 |
| 25x | $500,000 |
| 50x | $200,000 |

---

## Fees

| Fee Type | Amount |
|----------|--------|
| Trading Fee | 0.05% taker / 0.02% maker |
| Funding Rate | Variable (±0.01% avg) |
| Liquidation Fee | 0.5% |

---

## Strategies

### Trend Following
Go long in uptrends, short in downtrends.

### Range Trading
Long at support, short at resistance.

### Funding Farming
Capture funding payments in stable markets.

### Delta Neutral
Combine with spot to earn funding rate only.

---

## Best Practices

1. **Start with low leverage** — 2-5x recommended for beginners
2. **Always use stop losses** — Limit downside risk
3. **Monitor funding rates** — High rates erode profits
4. **Don't overtrade** — Fees add up quickly
5. **Size positions appropriately** — Never risk more than 5% per trade

---

## Next Steps

- [Delta Neutral Builder →](./delta-neutral.md)
- [Strategy Sandbox →](./strategy-sandbox.md)
