# Capital Flow & Lifecycle

Overview of how user deposits are stored and utilized in Nexxore: vault mechanics, agent coordination, execution routing, and the complete deposit-to-yield lifecycle.

---

## Overview

Understanding how capital moves through Nexxore is essential for users and developers. This document details the complete lifecycle from deposit to returns.

---

## General Flow of User Deposits

1. Users deposit collateral assets into Nexxore Vaults—these can be stablecoins (USDC, USDT) or non-stablecoin assets (ETH, BTC).

2. Vault shares are minted in return, following the ERC-4626 standard. The amount received is calculated based on the prevailing NAV per share.

3. Deposited collateral is routed to the Agent Layer, where the Portfolio Agent coordinates with Research and Alpha Agents to assess market conditions.

4. The Execution Agent deploys capital to external venues (GMX, Uniswap, etc.) based on the strategy mandate.

5. The Risk Agent monitors positions continuously, enforcing drawdown limits and CVaR constraints.

6. Agents automatically rebalance positions to maintain strategy parameters (e.g., delta neutrality) or exit when profit targets are achieved.

---

## Key Parties

| Party | Role |
|-------|------|
| **User** | Deposits collateral, receives vault shares, withdraws at will |
| **Vault Contract** | ERC-4626 compliant, handles deposits/withdrawals, accounting |
| **Agent Layer** | Autonomous decision-making: research, signals, execution, risk |
| **Execution Venues** | External protocols (GMX, Uniswap) where trades settle |

---

## Step 1: Deposit

Users deposit collateral into Nexxore Vaults through the Web3 interface.

### Supported Collateral

| Asset | Status |
|-------|--------|
| ETH | Supported |
| USDC | Supported |
| USDT | Supported |
| DAI | Coming Soon |

### Transaction Flow

1. User approves token spending (ERC-20 approve)
2. User calls `vault.deposit(assets, receiver)`
3. Vault mints shares to user
4. Event emitted: `Deposit(user, amount, shares)`

---

## Step 2: Minting & Accounting

Once deposited, the protocol converts collateral to internal accounting units.

### nUSD Accounting

| Field | Value |
|-------|-------|
| Deposit | 10 ETH @ $3,200 = $32,000 |
| nUSD Credited | 32,000 nUSD |
| Vault Shares | 32,000 shares (1:1 at inception) |
| NAV per Share | $1.00 |

### As Strategies Generate Returns

After 30 days (example):
- Your Shares: 32,000 (unchanged)
- NAV per Share: $1.01
- Your Value: 32,320 nUSD (+1%)

### ERC-4626 Standard

| Benefit | Description |
|---------|-------------|
| Standard Interface | Compatible with all ERC-4626 integrations |
| Composable | Can be used as collateral in other protocols |
| Easy Accounting | Built-in conversion functions |
| Transferable | Vault shares can be transferred or traded |

---

## Step 3: Mandate Assignment

The Portfolio Agent receives capital and consults other agents to determine deployment strategy.

### Agent Coordination

| Agent | Input | Output |
|-------|-------|--------|
| Research Agent | Market data, on-chain metrics | Market state assessment |
| Alpha Agent | Technical + on-chain analysis | Trading signals |
| Portfolio Agent | All agent inputs | Strategy mandate |

### Decision Matrix

| Market Condition | Alpha Signal | Strategy Deployed |
|------------------|--------------|-------------------|
| High Funding, Bullish | Neutral | Delta-Neutral (capture funding) |
| Low Funding, Bullish | Long | Leveraged Long |
| High Funding, Bearish | Short | Hedge + Short |
| Choppy/Uncertain | Neutral | Stay DN, reduce size |

---

## Step 4: Execution

The Execution Agent deploys capital across venues with optimal routing.

### Route Optimization

For a $32,000 Delta-Neutral ETH position:

**Step 1: Buy Spot ETH**

| Venue | Price | Fee | Selected |
|-------|-------|-----|----------|
| Uniswap V3 | $3,198 | 0.3% | |
| 1inch | $3,199 | 0.2% | ✓ |
| Curve | $3,197 | 0.5% | |

**Step 2: Open Short Perp**

| Venue | Slippage | Funding | Selected |
|-------|----------|---------|----------|
| GMX | Low | +0.01% | ✓ |
| dYdX | Medium | -0.005% | |

### Position Summary

| Position | Value |
|----------|-------|
| Long: 10 ETH spot | $31,990 |
| Short: 10 ETH perp | $32,000 notional |
| Net Delta | ~0 (market neutral) |
| Funding Rate | +0.01%/8hr (earning) |

---

## Step 5: Monitoring

The Risk Agent monitors positions continuously.

### Health Checks (Every Block)

| Metric | Current | Limit | Status |
|--------|---------|-------|--------|
| Spot Position Value | $32,150 | — | Normal |
| Perp Unrealized PnL | -$150 | — | Offset by spot |
| Margin Ratio | 15% | >10% | Healthy |
| Funding Accumulated | +$12.80 | — | Earning |
| Net Portfolio Delta | 0.02 ETH | <0.5 ETH | OK |

### Alert Thresholds

| Metric | Warning | Critical | Action |
|--------|---------|----------|--------|
| Drawdown | > 2% | > 3% | Reduce exposure |
| Delta Drift | > 0.5 ETH | > 1.0 ETH | Rebalance |
| Margin Ratio | < 20% | < 15% | Add collateral |
| Funding Rate | < -0.03% | < -0.05% | Close position |

---

## Step 6: Rebalancing

Agents automatically rebalance to maintain strategy parameters.

### Rebalancing Triggers

| Trigger | Condition | Action |
|---------|-----------|--------|
| Delta Drift | \|Net Delta\| > Threshold | Adjust perp or spot size |
| Funding Flip | Funding < -0.03% | Close position, wait for better conditions |
| Profit Target | Accumulated Profit > Target | Take partial profit, rebalance |
| Risk Limit | Drawdown > Max | Force close, move to stable |

---

## Withdrawal Process

When users want to exit, the process reverses.

### Withdrawal Steps

1. User requests withdrawal (specify amount or "max")
2. Protocol calculates share value: Shares × NAV per share
3. Execution Agent unwinds proportional positions
4. Assets returned to user (original collateral + profits - fees)

### Example Withdrawal

| Field | Value |
|-------|-------|
| Deposited | 10 ETH (valued at $32,000) |
| After 90 days | — |
| Funding earned | $960 |
| Fees paid | $32 |
| Net profit | $928 (2.9%) |
| Withdrawal | 10 ETH + 0.29 ETH (profit) |

---

## Summary

| Step | Description | Responsible | Time |
|------|-------------|-------------|------|
| 1. Deposit | User sends collateral | User | ~30 sec |
| 2. Minting | Shares issued, nUSD accounted | Vault Contract | ~30 sec |
| 3. Mandate | Strategy assignment | Portfolio + Research | ~1 min |
| 4. Execution | Capital deployed to venues | Execution Agent | ~2 min |
| 5. Monitoring | Continuous risk tracking | Risk Agent | Ongoing |
| 6. Rebalancing | Maintain strategy parameters | All Agents | As needed |

---

## Next Steps

- [Risk Framework →](./risk-framework.md)
- [Perpetual Vaults →](../products/perps-vaults.md)
- [Getting Started →](../guides/getting-started.md)
