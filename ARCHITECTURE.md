# Nexxore Simplified Architecture

## Product Overview

| Product | Description | Risk Level |
|---------|-------------|------------|
| **Perps** | High-leverage perpetual trading | High |
| **Safe Yield Vaults** | Conservative yield strategies | Low |
| **Strategy Builder** | Custom strategy creation | Variable |
| **Delta Neutral Builder** | Market-neutral positions | Medium |
| **Agent Layer** | Unified AI intelligence | - |

---

## Simplified System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND (React/Next.js)                        │
│   Perps UI │ Vaults UI │ Strategy Builder │ Delta Builder │ Dashboard       │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              API GATEWAY (FastAPI)                           │
│                         /api/v1/* - Single Entry Point                       │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
          ┌────────────────────────┼────────────────────────┐
          ▼                        ▼                        ▼
┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
│   AGENT LAYER    │    │  VAULT ENGINE    │    │  CHAIN ADAPTER   │
│                  │    │                  │    │                  │
│ • Research Agent │    │ • Deposit/Redeem │    │ • Ethereum       │
│ • Alpha Agent    │    │ • nUSD Mint/Burn │    │ • Solana         │
│ • Risk Agent     │    │ • Strategy Exec  │    │ • Hyperliquid    │
│ • Execution Agent│    │ • Rebalancing    │    │                  │
└────────┬─────────┘    └────────┬─────────┘    └────────┬─────────┘
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              DATA LAYER (Redis + PostgreSQL)                 │
│  Real-time Cache │ Historical Data │ User Positions │ Agent Signals         │
└─────────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           SMART CONTRACTS (On-Chain)                         │
│                                                                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │   nUSD      │  │   Vaults    │  │  Strategy   │  │   Oracle    │        │
│  │  (ERC-20)   │  │  (ERC-4626) │  │  Router     │  │  (Chainlink)│        │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘        │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Smart Contracts Required

### 1. Core Contracts (Required)

| Contract | Chain | Purpose |
|----------|-------|---------|
| **nUSD Token** | Ethereum | Overcollateralized stablecoin, mint/burn against collateral |
| **CollateralManager** | Ethereum | Holds user collateral (ETH, BTC, SOL), tracks positions |
| **VaultFactory** | Ethereum | Deploy ERC-4626 vaults with minimal proxy pattern |
| **BaseVault** | Ethereum | ERC-4626 vault implementation |
| **StrategyRouter** | Ethereum | Routes capital to yield strategies |
| **PriceOracle** | Ethereum | Chainlink price feeds for collateral valuation |

### 2. Cross-Chain Contracts

| Contract | Chain | Purpose |
|----------|-------|---------|
| **SolanaVault** | Solana | Native Solana vault using SPL Token Vault |
| **HyperliquidAdapter** | Hyperliquid | Bridge adapter for perps positions |
| **CrossChainBridge** | All | LayerZero/Wormhole message passing |

### 3. Contract Interaction Flow

```
User deposits ETH
        │
        ▼
┌───────────────────┐
│ CollateralManager │ ◄── Receives ETH, records position
└────────┬──────────┘
         │
         ▼
┌───────────────────┐
│   nUSD Token      │ ◄── Mints nUSD to user (e.g., 80% LTV)
└────────┬──────────┘
         │
         ▼
┌───────────────────┐
│  StrategyRouter   │ ◄── Deploys collateral to yield strategies
└────────┬──────────┘
         │
    ┌────┴────┐
    ▼         ▼
┌───────┐ ┌───────┐
│ Aave  │ │ Lido  │ ◄── External protocols (staking, lending)
└───────┘ └───────┘
```

---

## Agent Architecture (Simplified)

### Four Core Agents

| Agent | Input | Output | Update Frequency |
|-------|-------|--------|------------------|
| **Research Agent** | News APIs, Social feeds, On-chain data | Market insights, Trend signals | Every 5 min |
| **Alpha Agent** | Research signals, Price data, TVL metrics | Trading opportunities, Entry/exit points | Every 1 min |
| **Risk Agent** | Portfolio positions, Market volatility | Risk scores, Rebalance triggers | Real-time |
| **Execution Agent** | Alpha signals + Risk approval | Trade execution, Position management | On-demand |

### Data Flow

```
┌──────────────────────────────────────────────────────────────────────┐
│                        DATA SOURCES                                   │
│  CoinGecko │ DefiLlama │ Messari │ Twitter │ Binance │ Hyperliquid  │
└──────────────────────────┬───────────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────────────┐
│                      DATA AGGREGATOR                                  │
│              (Unified interface, caching, normalization)              │
└──────────────────────────┬───────────────────────────────────────────┘
                           │
         ┌─────────────────┼─────────────────┐
         ▼                 ▼                 ▼
┌─────────────┐   ┌─────────────┐   ┌─────────────┐
│  Research   │──▶│   Alpha     │──▶│  Execution  │
│   Agent     │   │   Agent     │   │   Agent     │
└─────────────┘   └─────────────┘   └──────┬──────┘
         │                 │               │
         └────────┬────────┘               │
                  ▼                        ▼
         ┌─────────────┐          ┌─────────────┐
         │    Risk     │◀─────────│   Smart     │
         │   Agent     │          │  Contracts  │
         └─────────────┘          └─────────────┘
```

---

## nUSD Mechanism

### User Flow (Simple)

```
1. User deposits 1 ETH ($3,000)
2. CollateralManager locks ETH
3. nUSD minted: $2,400 (80% LTV)
4. ETH deployed to yield strategies
5. User can use nUSD anywhere

To redeem:
1. User returns 2,400 nUSD
2. nUSD burned
3. User receives 1 ETH (+ any yield earned)
```

### Why User Doesn't Care Where ETH Goes

The **CollateralManager** guarantees redemption:

```solidity
// CollateralManager.sol
mapping(address => uint256) public collateralBalance;  // User's ETH balance
mapping(address => uint256) public nUSDDebt;           // nUSD minted

function redeem(uint256 nUSDAmount) external {
    require(nUSDDebt[msg.sender] >= nUSDAmount);
    
    // Calculate ETH to return (proportional)
    uint256 ethToReturn = (collateralBalance[msg.sender] * nUSDAmount) / nUSDDebt[msg.sender];
    
    // Recall from strategies if needed
    strategyRouter.recallFunds(ethToReturn);
    
    // Burn nUSD, return ETH
    nUSD.burn(msg.sender, nUSDAmount);
    payable(msg.sender).transfer(ethToReturn);
}
```

**Key Invariant**: `collateralBalance[user] * price >= nUSDDebt[user]` always

---

## Multi-Chain Strategy

### Target Chains

| Chain | Use Case | Tech Stack |
|-------|----------|------------|
| **Ethereum** | Primary vaults, nUSD, DeFi composability | Solidity, ERC-4626 |
| **Solana** | High-speed trading, low fees | Anchor/Rust, SPL Token Vault |
| **Hyperliquid** | Perps trading, funding rate capture | API-based, no contracts |

### Cross-Chain Architecture

```
                    ┌─────────────────────┐
                    │   Nexxore Backend   │
                    │   (Single Source)   │
                    └──────────┬──────────┘
                               │
          ┌────────────────────┼────────────────────┐
          ▼                    ▼                    ▼
┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
│    Ethereum      │ │     Solana       │ │   Hyperliquid    │
│                  │ │                  │ │                  │
│ • nUSD (native)  │ │ • Wrapped nUSD   │ │ • No contracts   │
│ • BaseVault      │ │ • SolanaVault    │ │ • API trading    │
│ • Strategies     │ │ • SPL strategies │ │ • Funding capture│
└──────────────────┘ └──────────────────┘ └──────────────────┘
          │                    │                    │
          └────────────────────┼────────────────────┘
                               ▼
                    ┌─────────────────────┐
                    │  LayerZero/Wormhole │
                    │   (Cross-chain msg) │
                    └─────────────────────┘
```

---

## Backend Simplification

### Current State (Complex)
- Multiple agent servers
- Separate API endpoints
- Fragmented data sources

### Proposed State (Simple)

```
/backend
├── api/
│   ├── main.py              # Single FastAPI entry
│   ├── routes/
│   │   ├── vaults.py        # Vault operations
│   │   ├── nusd.py          # nUSD mint/redeem
│   │   ├── perps.py         # Perps trading
│   │   ├── strategies.py    # Strategy builder
│   │   └── agents.py        # Agent insights
│   └── middleware/
│       ├── auth.py          # JWT authentication
│       └── rate_limit.py    # Rate limiting
│
├── agents/
│   ├── orchestrator.py      # Unified agent coordinator
│   ├── research.py          # Research agent
│   ├── alpha.py             # Alpha agent
│   ├── risk.py              # Risk agent
│   └── execution.py         # Execution agent
│
├── data/
│   ├── aggregator.py        # Unified data fetcher
│   ├── cache.py             # Redis caching
│   ├── sources/
│   │   ├── coingecko.py
│   │   ├── defillama.py
│   │   ├── binance.py
│   │   └── hyperliquid.py
│   └── scheduler.py         # Cron jobs for data updates
│
├── chains/
│   ├── ethereum.py          # Web3.py interactions
│   ├── solana.py            # Solana-py interactions
│   └── hyperliquid.py       # HL API wrapper
│
└── db/
    ├── models.py            # SQLAlchemy models
    └── migrations/          # Alembic migrations
```

### Key API Endpoints

```
# Vaults
POST   /api/v1/vaults/deposit
POST   /api/v1/vaults/withdraw
GET    /api/v1/vaults/{id}/info
GET    /api/v1/vaults/{id}/apy

# nUSD
POST   /api/v1/nusd/mint
POST   /api/v1/nusd/redeem
GET    /api/v1/nusd/collateral/{address}

# Perps
POST   /api/v1/perps/open
POST   /api/v1/perps/close
GET    /api/v1/perps/positions/{address}
GET    /api/v1/perps/funding-rates

# Strategies
POST   /api/v1/strategies/create
GET    /api/v1/strategies/templates
POST   /api/v1/strategies/backtest

# Agents
GET    /api/v1/agents/research/latest
GET    /api/v1/agents/alpha/signals
GET    /api/v1/agents/risk/score/{address}
WS     /api/v1/agents/stream
```

---

## Data Layer Updates

### Research Agent Data Sources

| Source | Data | Update Frequency |
|--------|------|------------------|
| CoinGecko | Prices, market cap, volume | 1 min |
| DefiLlama | TVL, protocol metrics | 5 min |
| Messari | News, research reports | 15 min |
| Twitter/X | Social sentiment | 5 min |
| Binance | Order book, funding rates | 10 sec |
| Hyperliquid | Perps data, open interest | 10 sec |

### Caching Strategy

```python
# Redis cache structure
{
    "prices:eth": { "value": 3000, "ttl": 60 },        # 1 min
    "tvl:aave": { "value": 15000000000, "ttl": 300 },  # 5 min
    "signals:alpha": { "value": [...], "ttl": 60 },    # 1 min
    "research:latest": { "value": {...}, "ttl": 300 }, # 5 min
}
```

### Background Jobs

```python
# scheduler.py
from apscheduler.schedulers.asyncio import AsyncIOScheduler

scheduler = AsyncIOScheduler()

# Price updates every minute
@scheduler.scheduled_job('interval', seconds=60)
async def update_prices():
    await data_aggregator.fetch_prices()

# Research analysis every 5 minutes
@scheduler.scheduled_job('interval', minutes=5)
async def run_research():
    await research_agent.analyze()

# Risk scoring every 30 seconds
@scheduler.scheduled_job('interval', seconds=30)
async def update_risk():
    await risk_agent.score_all_positions()
```

---

## Implementation Priority

### Phase 1: Core (Week 1-2)
1. ✅ EVM Vaults (BaseVault, VaultFactory)
2. 🔲 nUSD Token + CollateralManager
3. 🔲 Unified API Gateway
4. 🔲 Data Aggregator with caching

### Phase 2: Agents (Week 3-4)
1. 🔲 Agent Orchestrator
2. 🔲 Research Agent (live data)
3. 🔲 Alpha Agent (signal generation)
4. 🔲 Risk Agent (portfolio scoring)

### Phase 3: Multi-Chain (Week 5-6)
1. 🔲 Solana Vault (Anchor)
2. 🔲 Hyperliquid integration
3. 🔲 Cross-chain messaging

### Phase 4: Products (Week 7-8)
1. 🔲 Perps UI integration
2. 🔲 Strategy Builder
3. 🔲 Delta Neutral Builder

---

## Summary

### What Needs Smart Contracts

| Contract | Required | Chain |
|----------|----------|-------|
| nUSD Token | ✅ Yes | Ethereum |
| CollateralManager | ✅ Yes | Ethereum |
| VaultFactory | ✅ Yes (exists) | Ethereum |
| BaseVault | ✅ Yes (exists) | Ethereum |
| StrategyRouter | ✅ Yes | Ethereum |
| PriceOracle | ✅ Yes | Ethereum |
| SolanaVault | ✅ Yes | Solana |
| HyperliquidAdapter | ❌ No (API only) | - |

### What Stays Off-Chain

- All 4 agents (Research, Alpha, Risk, Execution)
- Data aggregation and caching
- Strategy backtesting
- User authentication
- API rate limiting
- WebSocket feeds

---

*Architecture designed for simplicity, scalability, and multi-chain expansion.*
