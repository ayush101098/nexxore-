# How Nexxore Works

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        NEXXORE PROTOCOL                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │   User       │───▶│  nUSD Mint   │───▶│  Strategy    │      │
│  │  Deposits    │    │  Engine      │    │  Deployment  │      │
│  └──────────────┘    └──────────────┘    └──────────────┘      │
│         │                   │                   │               │
│         ▼                   ▼                   ▼               │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │  Collateral  │    │  Yield       │    │  AI Agents   │      │
│  │  Vault       │    │  Protocols   │    │  Execution   │      │
│  └──────────────┘    └──────────────┘    └──────────────┘      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## The Flow

### 1. Deposit Collateral
Users deposit collateral (ETH, WBTC, stablecoins) into Nexxore vaults.

### 2. Mint nUSD
Collateral backs the minting of nUSD, Nexxore's native synthetic stablecoin.

### 3. Select Strategy
Choose from pre-built strategies or create custom allocations in the Strategy Sandbox.

### 4. AI Execution
Nexxore agents monitor and execute the strategy, rebalancing as needed.

### 5. Earn Yield
Yield accumulates from:
- Lending protocol interest
- Liquidity provision fees
- Funding rate arbitrage
- Trading profits

### 6. Withdraw Anytime
Burn nUSD to reclaim collateral plus accumulated yield.

---

## Key Components

### nUSD Engine
The minting and redemption system for nUSD. Manages collateral ratios, liquidations, and stability fees.

### Strategy Vaults
Pre-configured strategies with different risk profiles:
- **Safe Yield** — Conservative, capital preservation
- **Balanced** — Risk-adjusted optimization
- **Aggressive** — Higher returns, higher risk
- **Degen** — Maximum alpha, maximum risk

### AI Agents
Autonomous programs that:
- Monitor market conditions 24/7
- Identify opportunities across DeFi
- Execute rebalancing decisions
- Manage risk parameters

### Perpetual Vaults
Leverage trading infrastructure for delta-neutral strategies and directional bets.

---

## Value Flow

```
User Collateral
      │
      ▼
┌─────────────────┐
│  nUSD Minting   │ ◀─── Stability Fee (paid to protocol)
└─────────────────┘
      │
      ▼
┌─────────────────┐
│  Protocol       │ ◀─── Lending Interest
│  Deployment     │ ◀─── LP Fees
│                 │ ◀─── Funding Rates
└─────────────────┘
      │
      ▼
   Yield
      │
      ├───▶ User (majority)
      └───▶ Protocol Treasury (performance fee)
```

---

## Security Model

### Smart Contract Security
- Audited contracts
- Timelocked upgrades
- Multi-sig admin

### Risk Management
- Automated liquidations
- Position limits
- Circuit breakers

### Transparency
- All actions on-chain
- Real-time dashboards
- Public agent logs

---

## Next: Understanding nUSD

[Learn about the nUSD stablecoin →](./nusd.md)
