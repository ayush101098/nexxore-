# Agent Overview

Read how Nexxore's autonomous AI agents work: the agent swarm architecture, roles and responsibilities, and how they coordinate to execute strategies.

---

## What Are Nexxore Agents?

Nexxore Agents are autonomous AI programs that run 24/7 to:

- Monitor markets and on-chain data in real-time
- Identify opportunities and risks
- Execute strategies and rebalancing
- Generate research and actionable insights

Unlike traditional DeFi bots that follow simple if-then rules, Nexxore agents use AI to make intelligent decisions in complex, changing market conditions.

---

## The Agent Swarm

Nexxore operates a coordinated swarm of specialized agents, each with distinct responsibilities:

| Agent | Role | Primary Function |
|-------|------|------------------|
| **On-Chain Analyst** | The Analyst | Market intelligence, technicals, fundamentals for 20 perp markets |
| **Prediction Markets Agent** | The Oracle | AI signals for Polymarket & Kalshi, arbitrage detection |
| **Market Data Agent** | The Collector | Dexscreener integration, top movers, new pairs, liquidity monitoring |
| **Signal Engine** | The Scorer | 4-signal alpha detection, composite scoring (0–100), WebSocket feed |
| **Alpha Agent** | The Strategist | Trading signal generation, entry/exit recommendations |
| **Web3 Intelligence Agent** | The Auditor | Contract analysis, security scoring, rug pull detection |
| **Execution Agent** | The Trader | Order routing, slippage minimization, venue selection |
| **Risk Agent** | The Guardian | CVaR monitoring, drawdown enforcement, position limits |

---

## Agent Architecture

### Data Layer

All agents draw from a shared data layer that includes:

| Source | Data Type |
|--------|-----------|
| On-chain | Transactions, wallet balances, contract events |
| Price Feeds | Real-time prices from CEXs and DEXs |
| News/Social | Crypto news, Twitter sentiment, Discord activity |
| Whale Alerts | Large transaction monitoring |
| DeFi Analytics | TVL, yields, protocol metrics |

### LLM Engine

At the core of each agent is a Large Language Model (LLM) that provides:

- Analysis and reasoning capabilities
- Pattern recognition across data streams
- Natural language synthesis for reports
- Decision-making under uncertainty

### Execution Layer

Agents execute actions through:

- Smart contract calls (ERC-20 approvals, swaps, positions)
- Multi-chain support (Arbitrum, Ethereum, future chains)
- Transaction optimization (gas estimation, MEV protection)

---

## Agent Coordination

Agents don't operate in isolation—they coordinate through a shared messaging layer:

| Flow | Description |
|------|-------------|
| Research → Alpha | Market analysis informs signal generation |
| Alpha → Execution | Signals trigger trade execution |
| Web3 Intel → All | Security scores gate asset exposure |
| Risk → All | Risk limits override all other agents |

### Example Workflow

1. **Research Agent** detects unusual whale accumulation in ETH
2. **Web3 Intelligence** confirms no smart contract risks
3. **Alpha Agent** generates a long signal with 72% confidence
4. **Risk Agent** approves position size within CVaR limits
5. **Execution Agent** routes order to GMX for best fill

---

## Available Agents

### On-Chain Analyst (Research Agent)

Comprehensive market intelligence for perpetual trading.

**Provides:**
- Real-time price tracking for 20 markets (BTC, ETH, SOL, etc.)
- Technical analysis: RSI, MACD, EMA crossovers, Bollinger Bands
- Fundamental analysis: TVL, dev activity, tokenomics
- Derivatives data: funding rates, open interest, liquidations
- Support/resistance level calculation from OHLC data
- Trading signals: BULLISH/BEARISH/NEUTRAL with confidence
- API integration for execution agents (`window.nexxoreAgent`)

[Learn more →](./research-agent.md)

---

### Market Data Agent

Dexscreener data integration and real-time DEX pair monitoring.

**Provides:**
- Async Dexscreener API client with rate limiting (60/300 rpm)
- Top movers discovery across 5 chains (Solana, Ethereum, Base, BSC, Arbitrum)
- New pair detection (age <24h, liquidity >$100K)
- Liquidity change monitoring (>20% in 10 min)
- Token search across all Dexscreener pairs
- Time-series SQLite storage with 7-day retention
- Redis + in-memory LRU caching (10s–300s TTLs)
- REST API on port 3860

[Learn more →](./market-data.md)

---

### Signal Engine (Market Intelligence Agent)

Composite alpha signal scoring system with 4 independent detectors.

**Provides:**
- Momentum spike detection (price_5m >5%, vol >2× avg, liq >$500K → 0-40 pts)
- Volume breakout detection (vol_1h >3× 24h avg → 0-30 pts)
- Liquidity inflow detection (>20% increase in 10 min → 0-20 pts)
- New pair scoring (age <24h, liq >$100K → 0-10 pts)
- Composite scoring (0–100) with classification: >70 strong trade, 50-70 watchlist
- Rolling window data pipeline (5m/15m/1h/24h)
- WebSocket live feed (/ws/signals/live)
- REST API on port 3861

[Learn more →](./signal-engine.md)

AI-powered intelligence for prediction market traders.

**Provides:**
- Real-time odds analysis for Polymarket & Kalshi
- Cross-platform arbitrage detection
- AI trading signals with confidence scoring
- Market categorization: Politics, Crypto, Sports, Economy, Tech
- Odds movement tracking and alerts
- Portfolio analytics and performance tracking
- Auto-trade integration (coming soon)

[Learn more →](./prediction-markets.md)

---

### Alpha Agent

Trading signal generation engine.

**Provides:**
- Entry and exit signals
- Risk/reward analysis
- Position sizing recommendations
- Multi-timeframe analysis
- Confidence scoring

[Learn more →](./alpha-agent.md)

---

### Web3 Intelligence Agent

On-chain data analysis and security auditing.

**Provides:**
- Token contract analysis
- Liquidity monitoring
- Holder distribution analysis
- Honeypot and rug pull detection
- Security scoring (0-100)

[Learn more →](./web3-intelligence.md)

---

## Agent Performance

Agents are continuously monitored for performance:

| Metric | Description |
|--------|-------------|
| **Uptime** | Agent availability (target: 99.9%) |
| **Latency** | Time from signal to execution |
| **Accuracy** | Signal win rate over time |
| **Risk Adherence** | Compliance with CVaR limits |

---

## Technical Specifications

| Specification | Value |
|---------------|-------|
| Update Frequency | Every block (~12s on Ethereum) |
| Supported Chains | Arbitrum, Ethereum (more coming) |
| LLM Provider | OpenAI GPT-4 / Anthropic Claude |
| Execution Venues | GMX, Uniswap, 1inch |

---

## Next Steps

- [On-Chain Analyst →](./research-agent.md)
- [Market Data Agent →](./market-data.md)
- [Signal Engine →](./signal-engine.md)
- [Prediction Markets Agent →](./prediction-markets.md)
- [Alpha Agent →](./alpha-agent.md)
- [Web3 Intelligence →](./web3-intelligence.md)
- [Risk Framework →](../framework/risk-framework.md)
