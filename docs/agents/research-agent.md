# Research Agent

Read how the Research Agent works: real-time market intelligence, news aggregation, whale tracking, and actionable insights for informed decision-making.

---

## Overview

The Research Agent is your 24/7 market intelligence system. It aggregates data from dozens of sources, synthesizes information using AI, and presents actionable insights—all in real-time.

---

## Features

### Live Crypto News

Real-time news aggregation from major crypto outlets:

| Source | Coverage |
|--------|----------|
| CoinDesk | Breaking news, analysis |
| The Block | Institutional coverage |
| Decrypt | Project updates |
| CryptoCompare | Market news feed |

Each article is categorized, timestamped, and ranked by relevance.

---

### Top Gainers (24h)

Live tracking of the biggest winners in the market:

| Data Point | Description |
|------------|-------------|
| Symbol | Token ticker |
| Price | Current market price |
| 24h Change | Percentage gain |
| Volume | Trading volume |
| Market Cap | Total market capitalization |

Data sourced from CoinGecko, updated every 60 seconds.

---

### Top Losers (24h)

Track the biggest decliners to:

- Identify panic selling opportunities
- Spot potential reversal candidates
- Monitor portfolio risk exposure

Same data granularity as gainers, inverse selection criteria.

---

### Whale Movements

Large transaction monitoring across major wallets:

| Movement Type | Interpretation |
|---------------|----------------|
| Exchange Deposit | Potential selling pressure |
| Exchange Withdrawal | Accumulation signal |
| Wallet-to-Wallet | OTC deal or repositioning |
| Stablecoin Mint | Fresh capital entering market |

**Example Alert:**

> **15,000 ETH ($49.5M)** — Binance → Unknown Wallet  
> Withdrawal | 12 minutes ago  
> *Interpretation: Large withdrawal suggests accumulation, not selling.*

---

### Smart Money Wallets

Track known institutional and whale wallets:

| Entity | Type |
|--------|------|
| Jump Trading | Market maker |
| Paradigm | VC fund |
| a16z | VC fund |
| Galaxy Digital | Trading firm |
| Wintermute | Market maker |
| Cumberland | OTC desk |

**Monitoring includes:**
- Holdings changes
- Recent transaction activity
- Entry/exit patterns
- New position detection

---

### Chain Activity

Cross-chain TVL and activity metrics:

| Chain | Data Available |
|-------|----------------|
| Ethereum | TVL, gas, activity |
| Arbitrum | TVL, transactions |
| BSC | TVL, volume |
| Solana | TVL, TPS |
| Optimism | TVL, growth |

Data sourced from DefiLlama, updated in real-time.

---

### Fear & Greed Index

Market sentiment indicator on a 0-100 scale:

| Range | Sentiment | Historical Signal |
|-------|-----------|-------------------|
| 0-24 | Extreme Fear | Often precedes rallies |
| 25-44 | Fear | Accumulation zone |
| 45-55 | Neutral | No clear signal |
| 56-74 | Greed | Caution warranted |
| 75-100 | Extreme Greed | Often precedes corrections |

---

### Gas Prices

Ethereum gas tracking for optimal transaction timing:

| Speed | Gas (Gwei) | Wait Time |
|-------|------------|-----------|
| Slow | ~15 | 5-10 min |
| Standard | ~25 | 1-3 min |
| Fast | ~40 | < 1 min |

Includes historical trends and recommendations for timing large transactions.

---

### Airdrop Opportunities

Track potential and confirmed airdrops:

| Field | Description |
|-------|-------------|
| Protocol | Project name |
| Status | Confirmed, Speculated, or Claimable |
| Est. Value | Projected airdrop value |
| Requirements | Actions needed to qualify |
| Deadline | Claim or qualification deadline |

---

## Data Sources

| Category | Sources |
|----------|---------|
| Price Data | Binance, CoinGecko, CoinMarketCap |
| News | CryptoCompare, RSS feeds, Twitter |
| On-Chain | Etherscan, Arbiscan, DefiLlama |
| Whale Data | Whale Alert, Arkham, Nansen |
| Sentiment | Alternative.me, LunarCrush |

---

## Update Frequency

| Data Type | Frequency |
|-----------|-----------|
| Prices | Real-time (~1s) |
| News | Every 5 minutes |
| Whale Alerts | Real-time |
| TVL Data | Every 15 minutes |
| Fear & Greed | Daily |

---

## Use Cases

| Use Case | How Research Agent Helps |
|----------|--------------------------|
| Market Timing | Fear & Greed + Whale movements |
| Asset Selection | Top gainers + Smart money tracking |
| Risk Assessment | News sentiment + Chain activity |
| Opportunity Detection | Airdrops + New listings |

---

## Integration with Other Agents

| Agent | Integration |
|-------|-------------|
| Alpha Agent | Research insights inform signal generation |
| Web3 Intelligence | News triggers deeper contract analysis |
| Risk Agent | Market stress indicators adjust risk limits |

---

## Next Steps

- [Alpha Agent →](./alpha-agent.md)
- [Web3 Intelligence →](./web3-intelligence.md)
- [Agent Overview →](./overview.md)
