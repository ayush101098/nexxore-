# Research Agent

## Overview

The Research Agent is your 24/7 market intelligence system. It aggregates data from dozens of sources, synthesizes information, and presents actionable insights — all in real-time.

---

## Features

### 🔥 Live Crypto News
Real-time news aggregation from major crypto outlets:
- CoinDesk, The Block, Decrypt
- CryptoCompare news feed
- Project announcements
- Regulatory updates

Each article is categorized and timestamped for easy scanning.

---

### 📈 Top Gainers (24h)
Live tracking of the biggest winners:
- Symbol and name
- Current price
- 24h percentage change
- Trading volume
- Market cap

Data sourced from CoinGecko, updated every 60 seconds.

---

### 📉 Top Losers (24h)
Track the biggest decliners:
- Identify panic selling opportunities
- Spot potential dead cat bounces
- Monitor portfolio risk

Same data granularity as gainers.

---

### 🐋 Whale Movements
Large transaction monitoring:
- Exchange deposits (potential sells)
- Exchange withdrawals (accumulation)
- Wallet-to-wallet transfers
- Stablecoin minting/burning

```
Example Alert:
📤 15,000 ETH ($49.5M)
   Binance → Unknown Wallet
   Withdrawal | 12m ago
   
   Interpretation: Large withdrawal from exchange
   suggests accumulation, not selling.
```

---

### 💰 Smart Money Wallets
Track known institutional and whale wallets:
- Jump Trading
- Paradigm
- a16z
- Galaxy Digital
- Wintermute
- Cumberland

Monitor their:
- Holdings changes
- Recent activity
- Entry/exit patterns

---

### ⚡ Chain Activity
Cross-chain TVL and activity metrics:
- Ethereum, BSC, Solana, Arbitrum, etc.
- Real-time TVL from DefiLlama
- Chain-specific trends

---

### 😱 Fear & Greed Index
Market sentiment indicator:
- 0-24: Extreme Fear
- 25-44: Fear
- 45-55: Neutral
- 56-74: Greed
- 75-100: Extreme Greed

Historical accuracy shows extreme fear often precedes rallies.

---

### ⛽ Gas Prices
Ethereum gas tracking:
- Current gas price (Gwei)
- Low/Normal/High indicator
- Helps time transactions

---

## Dashboard Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  RESEARCH AGENT                              [Refresh] 🔄       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  BTC $104,250    ETH $3,312    DeFi TVL $185B    F&G 68       │
│  +2.3%           +1.8%         +0.5%              Greed        │
│                                                                 │
├───────────────────────────────────┬─────────────────────────────┤
│  📊 SIGNALS   🔬 RESEARCH         │  📈 ANALYTICS   🎁 AIRDROPS │
├───────────────────────────────────┴─────────────────────────────┤
│                                                                 │
│  ┌─────────────────────┐  ┌─────────────────────┐              │
│  │ 🔥 Live News        │  │ 📈 Top Gainers      │              │
│  │                     │  │                     │              │
│  │ • ETH ETF inflows.. │  │ PEPE  +24.5%       │              │
│  │ • Solana DeFi TVL.. │  │ ARB   +18.2%       │              │
│  │ • Fed rate decision │  │ OP    +15.8%       │              │
│  └─────────────────────┘  └─────────────────────┘              │
│                                                                 │
│  ┌─────────────────────┐  ┌─────────────────────┐              │
│  │ 📉 Top Losers       │  │ 🐋 Whale Movements  │              │
│  │                     │  │                     │              │
│  │ DOGE  -8.2%        │  │ 📤 15K ETH to wallet│              │
│  │ SHIB  -6.5%        │  │ 📥 1.2K BTC to CB  │              │
│  │ AVAX  -4.1%        │  │ 🏭 100M USDT mint  │              │
│  └─────────────────────┘  └─────────────────────┘              │
│                                                                 │
│  ┌─────────────────────┐  ┌─────────────────────┐              │
│  │ 💰 Smart Money      │  │ ⚡ Chain Activity   │              │
│  │                     │  │                     │              │
│  │ Jump: Bought 5K ETH │  │ Ethereum  $62.5B   │              │
│  │ Paradigm: Moved USDC│  │ Solana    $8.2B    │              │
│  │ a16z: Staked UNI    │  │ Arbitrum  $3.8B    │              │
│  └─────────────────────┘  └─────────────────────┘              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Tabs

### Signals Tab
Primary dashboard with:
- Live news
- Gainers/Losers
- Whale movements
- Smart money tracking
- Chain activity

### Research Tab
Deep-dive analysis:
- Hot narratives (AI x Crypto, RWA, Bitcoin L2s, etc.)
- Market analysis reports
- Protocol deep-dives

### Analytics Tab
Quantitative data:
- Top protocols by TVL (live from DefiLlama)
- Chain distribution charts
- Yield opportunities

### Airdrops Tab
Opportunity tracking:
- Active farming (Monad, Berachain, Hyperliquid, etc.)
- Upcoming claims
- Estimated values
- How-to guides

### Macro Tab
Broader market context:
- FOMC meetings
- CPI data
- ETF flows
- Jobs reports
- BTC dominance
- Total crypto market cap

---

## Data Sources

| Source | Data Type | Update Frequency |
|--------|-----------|------------------|
| Binance | Prices | Real-time |
| CoinGecko | Market data | 60 seconds |
| DefiLlama | TVL | 5 minutes |
| CryptoCompare | News | Real-time |
| Alternative.me | Fear & Greed | 12 hours |
| Etherscan | Gas | 15 seconds |

---

## Using Research Agent

### Quick Scan (5 min)
1. Check Fear & Greed — extreme readings signal opportunity
2. Scan top gainers/losers — spot momentum
3. Check whale movements — large moves precede volatility

### Deep Research (30 min)
1. Read through news for narratives
2. Check smart money for institutional positioning
3. Review analytics for protocol health
4. Check airdrops for farming opportunities

### Strategy Integration
Use Research Agent insights to inform:
- Entry timing
- Narrative selection
- Risk adjustment
- Protocol selection

---

## Alerts (Coming Soon)

Configure notifications for:
- Whale movements > $10M
- Fear & Greed extremes
- Specific token news
- Smart money activity

---

## API Access (Coming Soon)

```javascript
// Get latest research data
const research = await nexxore.research.getData();

// Get specific signals
const whales = await nexxore.research.getWhaleMovements();
const gainers = await nexxore.research.getGainers();
const news = await nexxore.research.getNews({ limit: 10 });
```

---

## Best Practices

1. **Don't react to single data points** — Look for convergence
2. **Context matters** — News impact varies by market conditions
3. **Track patterns** — Same whale, same behavior = signal
4. **Time your research** — Check before major decisions
5. **Combine with other tools** — Research informs, doesn't replace analysis

---

## Next Steps

- [Alpha Agent →](./alpha-agent.md)
- [Web3 Intelligence →](./web3-intelligence.md)
