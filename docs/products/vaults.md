# Yield Vaults

Nexxore Vaults are automated yield-generating strategies that put your crypto assets to work. Deposit USDC, ETH, or other supported assets and earn passive income through battle-tested DeFi strategies.

---

## Overview

Vaults are smart contracts that:

1. **Accept deposits** of a specific asset (e.g., USDC)
2. **Execute strategies** to generate yield
3. **Compound earnings** automatically
4. **Allow withdrawals** at any time (subject to strategy liquidity)

All vaults follow the ERC-4626 standard for maximum DeFi composability.

---

## Vault Types

### 🟢 Safe Yield (Low Risk)

**Target APY:** 8-15%

Conservative strategy focused on capital preservation:

- Blue-chip lending protocols (Aave, Compound)
- Overcollateralized positions only
- USDC/USDT stablecoin pairs
- Minimal impermanent loss exposure

**Best for:** Long-term holders seeking stable, predictable returns.

---

### 🟡 Balanced Growth (Medium Risk)

**Target APY:** 15-30%

Diversified approach balancing yield and risk:

- Multi-protocol yield aggregation
- Delta-neutral funding rate capture
- Liquidity provision on major DEXs
- Active rebalancing by AI agents

**Best for:** Users comfortable with moderate volatility for higher returns.

---

### 🔴 Aggressive Alpha (High Risk)

**Target APY:** 30-60%

Maximum yield strategies for sophisticated users:

- Leveraged yield farming
- New protocol incentives
- Cross-chain arbitrage
- Active trading strategies

**Best for:** Risk-tolerant users seeking maximum returns.

---

### 🟣 Degen Mode (Extreme Risk)

**Target APY:** 60%+

High-risk, high-reward experimental strategies:

- Newly launched protocols
- Leveraged perp funding
- Meme token liquidity
- Event-driven plays

**Best for:** Experienced DeFi users who understand and accept high risk.

---

## How Vaults Work

### 1. Deposit

Connect your wallet and deposit supported assets. You receive vault shares (svTokens) representing your position.

```
User deposits 1,000 USDC
↓
Receives 1,000 svUSDC (at 1:1 initial ratio)
```

### 2. Strategy Execution

Your assets are deployed into yield-generating strategies:

| Strategy | Mechanism |
|----------|-----------|
| Lending | Supply to Aave/Compound, earn interest |
| LP | Provide liquidity, earn trading fees |
| Funding | Capture perp funding rates |
| Staking | Stake protocol tokens for rewards |

### 3. Yield Accumulation

Earnings compound automatically. The share-to-asset ratio increases over time:

```
After 1 year at 12% APY:
1,000 svUSDC = 1,120 USDC
```

### 4. Withdrawal

Redeem your shares for underlying assets plus accumulated yield at any time.

---

## Supported Assets

| Asset | Vaults | Chains |
|-------|--------|--------|
| **USDC** | Safe, Balanced, Aggressive | Ethereum, Arbitrum, Base |
| **ETH** | Balanced, Aggressive | Ethereum, Arbitrum |
| **BTC (WBTC)** | Balanced | Ethereum, Arbitrum |
| **SOL** | Coming Soon | Solana |

---

## Vault Specifications

### ERC-4626 Compliance

All vaults implement the ERC-4626 tokenized vault standard:

```solidity
interface IERC4626 {
    function deposit(uint256 assets, address receiver) returns (uint256 shares);
    function withdraw(uint256 assets, address receiver, address owner) returns (uint256 shares);
    function redeem(uint256 shares, address receiver, address owner) returns (uint256 assets);
    function totalAssets() returns (uint256);
    function convertToShares(uint256 assets) returns (uint256);
    function convertToAssets(uint256 shares) returns (uint256);
}
```

### Fees

| Fee Type | Amount | Description |
|----------|--------|-------------|
| **Deposit** | 0% | No fee to deposit |
| **Withdrawal** | 0.1% | Small fee on withdrawals |
| **Performance** | 10% | On profits only, not principal |
| **Management** | 0.5% | Annual fee on AUM |

### Security

- **Audited** — Smart contracts audited by leading firms
- **Timelocks** — Admin changes require 48-hour delay
- **Multisig** — Treasury controlled by 3/5 multisig
- **Insurance** — Optional coverage via Nexus Mutual

---

## Risk Management

### Position Limits

| Metric | Safe | Balanced | Aggressive |
|--------|------|----------|------------|
| Max single protocol | 40% | 50% | 70% |
| Max leverage | 1x | 2x | 5x |
| Stablecoin minimum | 80% | 50% | 20% |

### Monitoring

AI agents continuously monitor:

- Protocol health and TVL changes
- Smart contract risk scores
- Liquidity depth
- Market volatility

### Circuit Breakers

Automatic safeguards trigger if:

- Single-day loss exceeds 5%
- Protocol TVL drops 30%+
- Smart contract exploit detected

---

## Getting Started

### 1. Choose Your Vault

Select based on your risk tolerance and return expectations.

### 2. Connect Wallet

Support for MetaMask, WalletConnect, and more.

### 3. Approve & Deposit

Approve the vault contract to spend your tokens, then deposit.

### 4. Monitor

Track your position and earnings in the dashboard.

### 5. Withdraw

Redeem shares for assets + yield at any time.

---

## Vault Analytics

Track performance at [nexxore.xyz/vaults](https://nexxore.xyz/vaults):

| Metric | Description |
|--------|-------------|
| **TVL** | Total value locked in vault |
| **APY** | Current annualized yield |
| **Your Shares** | Your share token balance |
| **Your Value** | Current value of your position |
| **Historical** | 7d, 30d, 90d performance charts |

---

## FAQ

**Q: Can I lose money in vaults?**
A: Yes. While Safe vaults minimize risk, all DeFi carries smart contract and market risks. Never deposit more than you can afford to lose.

**Q: How often is yield distributed?**
A: Yields are compounded continuously. Your share value increases in real-time.

**Q: Is there a lock-up period?**
A: No. Withdrawals are available 24/7, subject to strategy liquidity.

**Q: What happens if a protocol gets hacked?**
A: Diversification limits single-protocol exposure. Some vaults also have insurance coverage.

---

*Earn yield while you sleep with Nexxore Vaults.*
