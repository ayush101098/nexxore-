# Web3 Intelligence Agent

Read how the Web3 Intelligence Agent works: smart contract analysis, security scoring, honeypot detection, and on-chain risk assessment.

---

## Overview

The Web3 Intelligence Agent provides deep on-chain analysis, token contract auditing, and blockchain data insights. It helps you understand what's happening under the hood—from smart contract security to holder distribution.

Before any capital is deployed to interact with a new asset, the Web3 Intelligence Agent scans for risks to protect user funds.

---

## Features

### Token Contract Analysis

Comprehensive smart contract review covering:

| Check | Description |
|-------|-------------|
| Ownership | Who controls the contract, renounced or active |
| Mint Function | Can new tokens be created (inflation risk) |
| Tax Mechanisms | Buy/sell taxes, hidden fees |
| Proxy Patterns | Upgradeable contracts (can behavior change?) |
| Pause Functions | Can trading be halted by owner |
| Blacklist Functions | Can wallets be blocked from trading |

---

### Security Scoring

Risk assessment for tokens on a 0-100 scale:

| Score | Rating | Recommendation |
|-------|--------|----------------|
| 90-100 | Excellent | Safe for deployment |
| 70-89 | Good | Acceptable with monitoring |
| 50-69 | Caution | Reduced exposure only |
| 25-49 | High Risk | Avoid or minimal exposure |
| 0-24 | Critical | Do not interact |

**Scoring Factors:**

| Factor | Weight | Description |
|--------|--------|-------------|
| Contract Verification | 15% | Is source code public on Etherscan |
| Liquidity Lock | 20% | Is LP locked and for how long |
| Ownership Status | 15% | Renounced, multisig, or single owner |
| Holder Distribution | 15% | Concentration in top wallets |
| Audit Status | 15% | Third-party security audit |
| Code Analysis | 20% | Automated vulnerability scanning |

---

### Honeypot Detection

Automated detection of tokens where you can buy but cannot sell:

| Check | What It Detects |
|-------|-----------------|
| Sell Tax Analysis | Hidden 100% sell taxes |
| Transfer Restrictions | Blacklist-based blocking |
| Approval Manipulation | Contracts that revoke approvals |
| Liquidity Traps | Pools that can be drained |

**Result:** Clear Pass/Fail with explanation if honeypot detected.

---

### Holder Distribution

Understand who holds the token:

| Metric | Description |
|--------|-------------|
| Top 10 Holders | Percentage held by largest wallets |
| Top 50 Holders | Broader concentration metric |
| Exchange Holdings | Tokens held on CEXs |
| Team Wallets | Identified dev/team allocations |
| Whale Concentration | Risk of single-wallet dumps |

**Risk Thresholds:**

| Metric | Green | Yellow | Red |
|--------|-------|--------|-----|
| Top 10 | < 30% | 30-50% | > 50% |
| Single Wallet | < 10% | 10-20% | > 20% |

---

### Liquidity Analysis

DEX liquidity health assessment:

| Metric | Description |
|--------|-------------|
| Pool Depth | Total liquidity in USD |
| Primary DEX | Which exchange has most liquidity |
| LP Lock Status | Locked, unlocked, or burned |
| Lock Duration | How long until LP unlocks |
| Liquidity Trend | Growing or declining over time |

**Minimum Requirements for Nexxore Deployment:**

| Metric | Requirement |
|--------|-------------|
| Pool Depth | > $500K |
| LP Locked | > 80% |
| Lock Duration | > 6 months |

---

### Rug Pull Risk Assessment

Comprehensive rug pull indicator analysis:

| Indicator | Risk Signal |
|-----------|-------------|
| Unlocked Liquidity | High |
| Owner can mint | High |
| No contract verification | High |
| < 100 holders | Medium |
| < 7 days old | Medium |
| Team holds > 20% | Medium |
| No social presence | Low-Medium |

**Overall Risk Grade:** A (Lowest) to F (Highest)

---

## Token Analysis Report

When you request analysis of a token, you receive a structured report:

### Contract Information

| Field | Example Value |
|-------|---------------|
| Address | 0x1234...5678 |
| Chain | Ethereum |
| Verified | Yes |
| Proxy | No |
| Compiler | Solidity 0.8.19 |

### Security Assessment

| Check | Status |
|-------|--------|
| Contract verified | ✓ Pass |
| No mint function | ✓ Pass |
| Liquidity locked | ✓ Pass (12 months) |
| Ownership | ⚠ Active (not renounced) |
| Pause function | ⚠ Present |
| Third-party audit | ✗ None |

### Holder Distribution

| Category | Percentage |
|----------|------------|
| Top 10 Holders | 35% |
| Top 50 Holders | 58% |
| Exchanges | 22% |
| Known Whales | 18% |
| Team Wallets | 8% |

### Liquidity Summary

| Metric | Value |
|--------|-------|
| Primary DEX | Uniswap V3 |
| Pool Depth | $2.4M |
| 24h Volume | $850K |
| LP Locked | 85% until 2025-06 |

### Final Score

| Category | Score |
|----------|-------|
| Contract Security | 82/100 |
| Liquidity Health | 75/100 |
| Holder Distribution | 68/100 |
| **Overall** | **75/100** 🟢 |

---

## Supported Chains

| Chain | Status |
|-------|--------|
| Ethereum | Full support |
| Arbitrum | Full support |
| BSC | Full support |
| Polygon | Full support |
| Optimism | Coming soon |
| Base | Coming soon |

---

## Integration with Other Agents

| Agent | Integration |
|-------|-------------|
| Alpha Agent | Security score gates signal generation |
| Execution Agent | Only routes to verified contracts |
| Risk Agent | Security score affects position limits |

---

## Use Cases

| Use Case | How Web3 Intel Helps |
|----------|----------------------|
| New Token Evaluation | Full security report before buying |
| Portfolio Audit | Scan existing holdings for risks |
| Airdrop Safety | Verify claim contracts aren't malicious |
| LP Decisions | Assess liquidity pool risks |

---

## Next Steps

- [Alpha Agent →](./alpha-agent.md)
- [Research Agent →](./research-agent.md)
- [Agent Overview →](./overview.md)
