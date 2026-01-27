# nUSD — Nexxore's Synthetic Stablecoin

## What is nUSD?

**nUSD** is Nexxore's native synthetic stablecoin, pegged 1:1 to the US Dollar. Unlike traditional stablecoins where collateral sits idle, nUSD is backed by **productive collateral** that generates yield.

---

## How It Works

```
┌─────────────────────────────────────────────────────┐
│                  nUSD ARCHITECTURE                  │
├─────────────────────────────────────────────────────┤
│                                                     │
│   Collateral (ETH/WBTC/USDC)                       │
│         │                                           │
│         ▼                                           │
│   ┌───────────────┐                                │
│   │  nUSD Mint    │ ───▶ User receives nUSD       │
│   │  Engine       │                                │
│   └───────────────┘                                │
│         │                                           │
│         ▼                                           │
│   ┌───────────────┐                                │
│   │  Collateral   │ ───▶ Deployed to yield        │
│   │  Deployed     │      protocols (Aave,         │
│   │               │      Compound, etc.)          │
│   └───────────────┘                                │
│         │                                           │
│         ▼                                           │
│   Yield accumulates to nUSD holders                │
│                                                     │
└─────────────────────────────────────────────────────┘
```

---

## Minting nUSD

### Step 1: Deposit Collateral
Deposit supported assets:
- ETH
- WBTC
- USDC
- DAI
- stETH
- rETH

### Step 2: Set Collateral Ratio
Choose your collateral ratio based on risk tolerance:

| Strategy | Collateral Ratio | Liquidation Threshold |
|----------|------------------|----------------------|
| Safe Yield | 150% | 130% |
| Balanced | 175% | 150% |
| Aggressive | 200% | 175% |
| Degen | 250% | 200% |

### Step 3: Mint nUSD
Receive nUSD proportional to your collateral and chosen ratio.

**Example:**
- Deposit: $15,000 in ETH
- Collateral Ratio: 150%
- nUSD Minted: $10,000

---

## Why nUSD?

### 🔄 Productive Collateral
Traditional CDPs (like MakerDAO) keep collateral idle. Nexxore deploys your collateral into yield-generating protocols while you hold nUSD.

### 📊 Yield Bearing
nUSD inherently earns yield. The longer you hold, the more value accrues.

### 🛡️ Over-Collateralized
Always backed by more collateral than nUSD in circulation. No algorithmic risks.

### ⚡ Auto-Protection
Smart rebalancing helps prevent liquidations by auto-adjusting positions.

---

## Stability Mechanism

nUSD maintains its peg through:

### 1. Over-Collateralization
Minimum 130-250% collateral backing (depending on strategy).

### 2. Liquidation Engine
Under-collateralized positions are liquidated to maintain system health.

### 3. Stability Fee
Annual fee paid by minters, adjustable by governance.

### 4. Redemption Arbitrage
If nUSD < $1: Arbitrageurs buy nUSD cheap, redeem for $1 of collateral
If nUSD > $1: Arbitrageurs mint nUSD, sell for > $1

---

## Fees

| Fee Type | Amount | Description |
|----------|--------|-------------|
| Minting Fee | 0% | No fee to mint nUSD |
| Stability Fee | 0.5-3.5% | Annual, varies by strategy |
| Redemption Fee | 0.5% | Fee when burning nUSD |
| Liquidation Penalty | 10% | Penalty on liquidated positions |

---

## Use Cases

### 1. Leverage Without Selling
Hold ETH exposure while accessing liquidity via nUSD.

### 2. Yield Farming
Deploy nUSD into additional yield opportunities.

### 3. Trading Capital
Use nUSD as margin for perpetual trading.

### 4. Treasury Management
DAOs can hold nUSD for yield without directional risk.

---

## Risks

| Risk | Mitigation |
|------|------------|
| Smart Contract Risk | Audits, bug bounties, timelocks |
| Collateral Volatility | Over-collateralization, liquidations |
| Protocol Risk | Diversified deployment, due diligence |
| Depeg Risk | Arbitrage mechanisms, reserve fund |

---

## Next Steps

- [Perpetual Vaults →](./products/perps-vaults.md)
- [Strategy Sandbox →](./products/strategy-sandbox.md)
