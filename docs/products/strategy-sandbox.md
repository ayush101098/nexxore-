# Strategy Sandbox (Strategy Builder)

## Overview

The Strategy Sandbox is Nexxore's visual strategy builder that lets you create, configure, and deploy custom DeFi strategies. Choose from pre-built templates or build from scratch with full control over every parameter.

---

## Strategy Templates

### 🟢 Safe Yield
**Risk Level:** Low | **APY:** 5-8% | **Max Drawdown:** ~5%

Capital preservation strategy using blue-chip lending protocols.

| Parameter | Value |
|-----------|-------|
| Max Leverage | 1-1.5x |
| Stop Loss | 2-8% |
| Take Profit | 5-20% |
| Rebalance | Weekly |
| Slippage | 0.5% |

**Protocol Allocation:**
- Aave v3: 40%
- Compound: 30%
- MakerDAO: 20%
- Reserve: 10%

**Best For:** Treasury management, capital preservation, low-risk yield

---

### 🔵 Balanced Reallocation
**Risk Level:** Medium | **APY:** 12-18% | **Max Drawdown:** ~15%

Risk-adjusted yield optimization across multiple protocols.

| Parameter | Value |
|-----------|-------|
| Max Leverage | 1-2.5x |
| Stop Loss | 5-15% |
| Take Profit | 15-35% |
| Rebalance | Daily |
| Slippage | 1.0% |

**Protocol Allocation:**
- Aave v3: 30%
- Yearn: 25%
- Convex: 25%
- Reserve: 20%

**Best For:** Balanced risk/reward, medium-term holding, diversification

---

### 🟣 Opportunistic Alpha
**Risk Level:** High | **APY:** 25-40% | **Max Drawdown:** ~30%

Event-driven alpha capture with leverage.

| Parameter | Value |
|-----------|-------|
| Max Leverage | 1.5-4x |
| Stop Loss | 10-25% |
| Take Profit | 30-60% |
| Rebalance | On Drift >5% |
| Slippage | 2.0% |

**Protocol Allocation:**
- GMX: 30%
- Pendle: 25%
- EigenLayer: 25%
- Reserve: 20%

**Best For:** Active traders, yield optimizers, risk-tolerant users

---

### 🔴 Tactical Degen
**Risk Level:** Extreme | **APY:** 50-150%+ | **Max Drawdown:** ~50%

High-conviction, high-variance plays for maximum alpha.

| Parameter | Value |
|-----------|-------|
| Max Leverage | 2-5x |
| Stop Loss | 15-40% |
| Take Profit | 50-100% |
| Rebalance | On Drift >3% |
| Slippage | 3.0% |

**Protocol Allocation:**
- New LP Farms: 35%
- Perp DEXs: 30%
- Options Vaults: 25%
- Reserve: 10%

**Best For:** Experienced DeFi users, high risk tolerance, active management

---

### ⚪ Custom Strategy
**Risk Level:** Variable | **APY:** Variable

Build from scratch with full parameter control.

---

## Building a Strategy

### Step 1: Deposit & Mint nUSD

```
┌─────────────────────────────────────┐
│  STEP 1: ENTRY                      │
├─────────────────────────────────────┤
│                                     │
│  Collateral: [ ETH ▼ ]              │
│  Output: nUSD                       │
│                                     │
│  ┌─────────────────────────────┐   │
│  │ Collateral Ratio: 150%      │   │
│  │ Liquidation: 130%           │   │
│  │ Stability Fee: 0.5%         │   │
│  └─────────────────────────────┘   │
│                                     │
└─────────────────────────────────────┘
```

Select your collateral asset and view the minting parameters. The collateral ratio determines how much nUSD you can mint relative to your deposit.

### Step 2: Protocol Allocation

```
┌─────────────────────────────────────┐
│  STEP 2: ALLOCATION                 │
├─────────────────────────────────────┤
│                                     │
│  Protocol Distribution:             │
│                                     │
│  ┌─────────┐  ┌─────────┐          │
│  │ Aave v3 │  │Compound │          │
│  │   40%   │  │   30%   │          │
│  └─────────┘  └─────────┘          │
│                                     │
│  ┌─────────┐  ┌─────────┐          │
│  │MakerDAO │  │ Reserve │          │
│  │   20%   │  │   10%   │          │
│  └─────────┘  └─────────┘          │
│                                     │
└─────────────────────────────────────┘
```

Define how your capital is distributed across DeFi protocols. Each template has optimized allocations, or customize for your needs.

### Step 3: Rebalancing Rules

```
┌─────────────────────────────────────┐
│  STEP 3: REBALANCE                  │
├─────────────────────────────────────┤
│                                     │
│  Frequency: [ Weekly ▼ ]            │
│  Max Slippage: 0.5%                 │
│                                     │
│  Options:                           │
│  • Weekly                           │
│  • Daily                            │
│  • On Drift > 5%                    │
│  • On Drift > 3%                    │
│  • Manual                           │
│                                     │
└─────────────────────────────────────┘
```

Set when and how the strategy rebalances to maintain target allocations.

---

## Configuration Panel

### Position Size
- **Deposit Amount:** How much capital to deploy
- **Currency:** USDC, USDT, DAI, or ETH

### Risk Parameters

**Max Leverage**
```
[====|----------] 1.5x
Low Risk ◄───────► High Risk
```

**Stop Loss**
```
[==|------------] -5%
Tight ◄──────────► Loose
```

**Take Profit**
```
[====|----------] +15%
Conservative ◄───► Aggressive
```

### Risk Meter

Visual indicator showing overall strategy risk:

```
┌─────────────────────────────────────┐
│  OVERALL RISK LEVEL                 │
│                                     │
│  ●────────────────────────────      │
│  Conservative  Moderate  Aggressive │
└─────────────────────────────────────┘
```

---

## Summary Stats

Before deploying, review projected performance:

| Metric | Description |
|--------|-------------|
| **Est. APY** | Expected annual yield |
| **Max DD** | Maximum expected drawdown |
| **Sharpe** | Risk-adjusted return ratio |
| **Risk Score** | Low/Medium/High/Extreme |

---

## Deploying a Strategy

1. **Configure** — Set all parameters
2. **Review** — Check summary stats
3. **Connect Wallet** — Approve transactions
4. **Deploy** — Execute on-chain
5. **Monitor** — Track via dashboard

All strategies execute on-chain with deterministic logic. Every action is verifiable.

---

## Strategy Management

### Active Strategies
View all deployed strategies:
- Current value
- P&L since inception
- Time active
- Next rebalance

### Modify Strategy
Adjust parameters on active strategies:
- Change allocations
- Update risk parameters
- Pause/resume rebalancing

### Withdraw
Exit a strategy:
- Partial withdrawal
- Full withdrawal with nUSD burn

---

## Best Practices

1. **Start conservative** — Use Safe Yield template first
2. **Diversify** — Don't put all capital in one strategy
3. **Monitor weekly** — Check performance and adjust
4. **Understand the protocols** — Know where your funds go
5. **Keep reserves** — Don't deploy 100% of capital

---

## FAQ

**Q: Can I change my strategy after deploying?**
A: Yes, you can modify parameters anytime. Changes take effect at next rebalance.

**Q: What happens if a protocol gets hacked?**
A: Strategies diversify across protocols. Reserve allocation provides buffer. Insurance integrations coming soon.

**Q: How is APY calculated?**
A: Based on historical protocol yields, adjusted for fees and rebalancing costs.

**Q: Can I lose money?**
A: Yes. Even safe strategies have drawdown potential. Only invest what you can afford to lose.

---

## Next Steps

- [Delta Neutral Builder →](./delta-neutral.md)
- [Nexxore Agents →](../agents/overview.md)
