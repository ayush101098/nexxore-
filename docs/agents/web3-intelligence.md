# Web3 Intelligence Agent

## Overview

The Web3 Intelligence Agent provides deep on-chain analysis, token contract auditing, and blockchain data insights. It helps you understand what's happening under the hood — from smart contract security to holder distribution.

---

## Features

### 🔍 Token Contract Analysis
Comprehensive smart contract review:
- Ownership analysis
- Mint/burn functions
- Tax mechanisms
- Proxy patterns
- Rug pull indicators

### 📊 Holder Distribution
Understand who holds what:
- Top holders percentage
- Whale concentration
- Team/dev wallets
- Exchange holdings
- Distribution changes over time

### 🔐 Security Scoring
Risk assessment for tokens:
- Contract verification status
- Liquidity lock status
- Honeypot detection
- Similar contract analysis
- Audit history

### 🐋 Whale Tracking
Monitor large holders:
- Accumulation patterns
- Distribution events
- Wallet labeling
- Activity timelines

### 📈 Liquidity Analysis
DEX liquidity health:
- Pool depth
- Liquidity trends
- Impermanent loss risk
- LP holder distribution

---

## Token Analysis Report

```
┌─────────────────────────────────────────────────────────────────┐
│  TOKEN ANALYSIS: $EXAMPLE                                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  CONTRACT INFO                                                  │
│  ├─ Address: 0x1234...5678                                     │
│  ├─ Chain: Ethereum                                            │
│  ├─ Verified: ✅ Yes                                           │
│  ├─ Proxy: ❌ No                                               │
│  └─ Compiler: Solidity 0.8.19                                  │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  SECURITY SCORE: 78/100 🟢                                      │
│                                                                 │
│  ✅ Contract verified on Etherscan                              │
│  ✅ No mint function (fixed supply)                             │
│  ✅ Liquidity locked for 12 months                              │
│  ⚠️ 15% held by top 10 wallets                                  │
│  ⚠️ Owner can pause transfers                                   │
│  ❌ No audit from major firm                                    │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  HOLDER DISTRIBUTION                                            │
│                                                                 │
│  Top 10 Holders: 35%                                           │
│  Top 50 Holders: 58%                                           │
│  Top 100 Holders: 72%                                          │
│                                                                 │
│  Exchanges: 22%                                                │
│  Known Whales: 18%                                             │
│  Team Wallets: 8%                                              │
│  Other: 52%                                                    │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  LIQUIDITY ANALYSIS                                            │
│                                                                 │
│  Primary DEX: Uniswap V3                                       │
│  Pool Depth: $2.4M                                             │
│  24h Volume: $850K                                             │
│  Liquidity Trend: ↗️ +12% (7d)                                 │
│  LP Locked: 85% until 2025-06                                  │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  RECOMMENDATION                                                 │
│                                                                 │
│  Risk Level: MEDIUM                                            │
│  Concerns: Centralized ownership, no audit                     │
│  Positives: Locked liquidity, verified contract                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Risk Indicators

### 🔴 High Risk Signals
- Unverified contract
- Mint function accessible
- No liquidity lock
- Honeypot detected
- 50%+ held by single wallet
- Proxy contract (can be changed)
- Known scam patterns

### 🟡 Medium Risk Signals
- No audit
- High ownership concentration
- Unlocked team tokens
- Low liquidity
- Recent contract deployment
- Owner can pause

### 🟢 Low Risk Signals
- Verified contract
- Third-party audit
- Locked liquidity
- Distributed holdings
- Renounced ownership
- Long track record

---

## Honeypot Detection

Identify tokens that can't be sold:

```
HONEYPOT CHECK RESULTS
─────────────────────────────────────

Buy Simulation:  ✅ Success
Sell Simulation: ❌ Failed

Reason: Transfer blocked for non-whitelisted addresses

🔴 WARNING: This token appears to be a HONEYPOT
   Do NOT buy — you won't be able to sell
```

---

## Wallet Analysis

Track any wallet's on-chain activity:

```
┌─────────────────────────────────────────────────────────────────┐
│  WALLET ANALYSIS: 0xabcd...1234                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  OVERVIEW                                                       │
│  ├─ Total Value: $2.4M                                         │
│  ├─ # of Tokens: 24                                            │
│  ├─ First Tx: 2021-03-15                                       │
│  ├─ Last Tx: 2h ago                                            │
│  └─ Label: Likely Fund/Whale                                   │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  TOP HOLDINGS                                                   │
│                                                                 │
│  1. ETH      │ 450.2   │ $1.48M   │ 62%                        │
│  2. USDC     │ 420,000 │ $420K    │ 17%                        │
│  3. LINK     │ 12,500  │ $175K    │ 7%                         │
│  4. UNI      │ 18,200  │ $128K    │ 5%                         │
│  5. AAVE     │ 850     │ $102K    │ 4%                         │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  RECENT ACTIVITY (7d)                                          │
│                                                                 │
│  • Bought 50 ETH @ $3,280                     │ 2h ago         │
│  • Swapped 10K USDC → ARB                     │ 1d ago         │
│  • Deposited 200 ETH to Aave                  │ 3d ago         │
│  • Withdrew 500 LINK from Binance             │ 5d ago         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Use Cases

### 1. New Token Research
Before buying any new token:
1. Enter contract address
2. Review security score
3. Check holder distribution
4. Verify liquidity lock
5. Run honeypot check

### 2. Whale Watching
Follow smart money:
1. Add whale addresses to watchlist
2. Get alerts on movements
3. Analyze their portfolios
4. Identify accumulation patterns

### 3. Project Due Diligence
Deep dive into protocols:
1. Analyze all related contracts
2. Map token flows
3. Identify team wallets
4. Track treasury movements

### 4. Portfolio Monitoring
Understand your holdings:
1. Security score for each token
2. Liquidity health check
3. Holder concentration changes
4. Contract upgrade alerts

---

## Data Sources

| Source | Data |
|--------|------|
| Etherscan/Block Explorers | Contract code, transactions |
| DEX APIs | Liquidity, trading data |
| Token Lists | Known safe tokens |
| Audit Databases | Security reports |
| Wallet Labels | Known entities |
| Scam Databases | Flagged contracts |

---

## Supported Chains

- ✅ Ethereum
- ✅ BSC
- ✅ Polygon
- ✅ Arbitrum
- ✅ Optimism
- ✅ Base
- ✅ Solana
- 🔄 More coming...

---

## API Access (Coming Soon)

```javascript
// Analyze a token
const analysis = await nexxore.web3Intel.analyzeToken({
  address: '0x1234...5678',
  chain: 'ethereum'
});

console.log(analysis.securityScore); // 78
console.log(analysis.isHoneypot);    // false
console.log(analysis.holders.top10); // 35%

// Analyze a wallet
const wallet = await nexxore.web3Intel.analyzeWallet({
  address: '0xabcd...1234',
  chain: 'ethereum'
});

console.log(wallet.totalValue);      // $2,400,000
console.log(wallet.recentActivity);  // [...]
```

---

## Best Practices

1. **Always verify contracts** — Never buy unverified tokens
2. **Check before you buy** — 30 seconds of research can save you
3. **Watch for red flags** — If something seems off, it probably is
4. **Follow the whales** — But understand why, not just what
5. **Monitor your holdings** — Security status can change

---

## Common Scam Patterns

| Pattern | Description | Detection |
|---------|-------------|-----------|
| Honeypot | Can buy but not sell | Sell simulation fails |
| Rug Pull | Liquidity removed | LP not locked |
| Mint Exploit | Unlimited supply creation | Uncapped mint function |
| Fee Trap | High/increasing fees | Fee > 10% on transfer |
| Proxy Swap | Contract replaced with malicious version | Upgradeable proxy |

---

## Next Steps

- [Research Agent →](./research-agent.md)
- [Alpha Agent →](./alpha-agent.md)
- [Getting Started Guide →](../guides/getting-started.md)
