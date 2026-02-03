# Stablecoin Hub Architecture

## High-Level System Map

```
┌─────────────────────────────────────────────────────────────────────────────┐n│                          STABLECOIN HUB FRONTEND                             │
│  Insurance │ Underwriter Dashboard │ Perps │ Health │ Vaults │ FX            │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐n│                           STABLECOIN HUB API GATEWAY                         │
│  /api/v1/stablecoins/*  /insurance/*  /perps/*  /vaults/*  /fx/*             │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
      ┌────────────────────────────┼────────────────────────────┐
      ▼                            ▼                            ▼
┌───────────────┐          ┌────────────────┐           ┌────────────────┐
│ Risk Engine   │          │ Oracle Router  │           │ Strategy Engine│
│ (pricing/VAR) │          │ (median feeds) │           │ (vaults/alloc) │
└──────┬────────┘          └───────┬────────┘           └──────┬─────────┘
       │                           │                           │
       ▼                           ▼                           ▼
┌─────────────────────────────────────────────────────────────────────────────┐n│                               DATA LAYER                                    │
│ Postgres (policies, positions, claims) │ Redis (realtime) │ Timeseries DB  │
└─────────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐n│                         SMART CONTRACT LAYER (EVM)                           │
│  InsurancePool │ PolicyNFT │ ClaimsManager │ Vaults │ FX Pools │ OracleAdapter│
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 1) Stablecoin De-Peg Insurance

### Core Contracts
| Contract | Purpose |
|---|---|
| **InsurancePool** | Holds capital, collects premiums, pays claims |
| **PolicyNFT** | NFT-based policies with metadata (tier, coverage, expiry) |
| **ClaimsManager** | Validates triggers, settles payouts |
| **OracleAdapter** | Multi-source median price feed for depeg detection |

### Pricing & Trigger Model (Functional)
```
premium = baseRate * riskScore * volatilityFactor * utilizationFactor

riskScore = w1*pegDeviation + w2*collateralQuality + w3*liquidityDepth + w4*issuerRisk
```

**Tier Triggers**
| Tier | Trigger | Coverage |
|---|---|---|
| Basic | >5% for >24h | Capital protection |
| Standard | >2% for >12h | Capital + yield buffer |
| Premium | >1% for >4h | Priority payouts |

### Claims Flow
```
Price Feeds → OracleAdapter (median) → ClaimsManager
   └─ validates trigger window (duration + deviation)
   └─ checks policy tier + coverage limits
   └─ triggers payout from InsurancePool
```

### Underwriting Model
- LPs deposit into **InsurancePool** → receive Pool Shares
- Premiums distributed pro-rata, minus claims
- **Risk Pooling** across multiple stablecoins to reduce tail risk
- **PolicyNFT** enables transfer, history, and staking-based discounts

---

## 2) Underwriter (LP) Dashboard

### On-Chain Metrics
- Pool TVL, utilization, premium income, claim payouts
- Exposure per stablecoin and tier

### Off-Chain Analytics
- Diversification score (Herfindahl index)
- Scenario stress tests (UST/USDC events)
- APY = (premiums - claims - fees) / pool TVL

---

## 3) Stablecoin Perpetuals & Volatility Desk

### Perps Engine (Hybrid)
- **Matching/Orderbook** off-chain for speed
- **Settlement/Collateral** on-chain or via L2 custody
- Funding rate uses **peg-based index** with 8h intervals

### Required Services
| Service | Responsibility |
|---|---|
| **Perps Indexer** | Pulls prices, open interest, funding rates |
| **Funding Engine** | Calculates peg deviation funding |
| **Risk Engine** | Liquidation, margin checks (isolated/cross) |

### Pairs
USDT/USD, USDC/USD, DAI/USD, FRAX/USD, USDD/USD

### Volatility Desk
- Depeg probability model (7d, 30d)
- Funding rate comparison + arbitrage scanner
- Whale alerts, sentiment gauge, risk calendar

---

## 4) Governance & Health Monitoring

### Adaptive Stability Mechanism
- Dynamic collateral ratio adjustments
- Interest rate controller & redemption flows
- Emergency shutdown + circuit breakers

### Health Dashboard Signals
- Peg deviation tracker + collateral ratio
- Reserve composition, mint/burn velocity
- Liquidity depth, oracle latency, audits

---

## 5) Yield Vaults & Risk Management

### Vault Architecture
- **VaultFactory** deploys ERC-4626 vaults
- **StrategyRouter** allocates to whitelisted protocols
- Tiers: Conservative / Balanced / Aggressive

### Risk Controls
- Protocol whitelist, exposure limits, emergency exits
- Oracle safeguards + insurance overlays
- Drawdown monitoring + user risk profiling

---

## 6) Collateral & RWA Modules

### Collateral Diversification
- Crypto, staked assets, stablecoins, RWAs
- Collateral ratios, liquidation engine, auctions
- Stress testing + transparency portal

### RWA Integration
- Tokenized treasuries, real estate, commodities
- KYC/AML + issuer verification
- RWA oracles + default handling

---

## 7) Stablecoin FX Exchange & LP Farming

### FX Exchange
- Curve-style stableswap pools + oracle FX rates
- Spot swaps, limit orders, forward contracts

### LP & Yield Farming
- Fee + incentives APY breakdown
- Concentrated liquidity options
- IL protection for correlated pairs

---

## API Surface (Stablecoin Hub)

```
GET  /api/v1/stablecoins/overview
GET  /api/v1/stablecoins/pegs
GET  /api/v1/stablecoins/health

POST /api/v1/insurance/quote
POST /api/v1/insurance/policy
POST /api/v1/insurance/claim
GET  /api/v1/insurance/policies/{address}
GET  /api/v1/insurance/pools

POST /api/v1/perps/order
POST /api/v1/perps/close
GET  /api/v1/perps/markets
GET  /api/v1/perps/funding

POST /api/v1/vaults/deposit
POST /api/v1/vaults/withdraw
GET  /api/v1/vaults/apy

POST /api/v1/fx/swap
GET  /api/v1/fx/pairs
GET  /api/v1/fx/quotes
```

---

## Functional Improvements (Better Defaults)

1. **Oracle Router** with median-of-means to prevent single-source manipulation.
2. **Claims Cooldown** + circuit breakers to avoid bank-run claims.
3. **Risk Engine** reprices premiums daily based on utilization & volatility.
4. **Unified Position Model** for vaults, perps, and insurance exposure.
5. **Event Replay** for backtests on historical depeg events.
