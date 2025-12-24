# Research Agent - Architecture

## Overview

The **Research Agent** is an autonomous intelligence system that detects alpha opportunities in DeFi by analyzing:

- **News & Narrative**: CoinDesk, CoinTelegraph, RSS feeds, project blogs
- **Social Sentiment**: Twitter/X mentions, sentiment scoring
- **On-Chain Metrics**: TVL, APY, yields, whale transactions
- **Price Momentum**: 24h changes, volume spikes

## Data Flow

```
┌─────────────────────────────────────┐
│     Input (Protocol / Keywords)     │
└──────────────┬──────────────────────┘
               │
    ┌──────────┴──────────┐
    │                     │
┌───▼──────┐      ┌───────▼────┐
│  Gather  │      │   Group    │
│ Signals  │──────▶  Signals   │
└─────────┬┘      └───────┬────┘
    │ Multiple sources       │
    │ (news, price, defi)    │
    │                        │
    │                 ┌──────▼──────┐
    │                 │    Score    │
    │                 │ Confidence  │
    │                 └──────┬──────┘
    │                        │
    │                 ┌──────▼──────┐
    │                 │  Generate   │
    │                 │  Insights   │
    │                 │  & Summary  │
    │                 └──────┬──────┘
    │                        │
    └────────────────────────┤
                             │
                    ┌────────▼──────────┐
                    │ Output: Insights  │
                    │ (JSON, Telegram)  │
                    └───────────────────┘
```

## Core Components

### 1. DataFetcher
Unified interface for all data sources:

```javascript
const fetcher = new DataFetcher(apiKeys);

// Fetch comprehensive protocol context
const context = await fetcher.fetchProtocolContext('AAVE');
// Returns: { defi, price, sentiment, timestamp }
```

**Supported Sources:**
- `news` - NewsSource (CoinDesk, CoinTelegraph, RSS)
- `prices` - PriceSource (CoinGecko, CMC)
- `defi` - DeFiSource (DeFiLlama)
- `sentiment` - SentimentSource (Twitter, Discord)
- `onchain` - OnChainSource (Etherscan, Solscan)

### 2. ResearchAgent
Main analysis engine:

```javascript
const agent = new ResearchAgent(config);

const result = await agent.analyze({
  protocol: 'AAVE',
  lookbackHours: 24
});

// Result: { insights, summary, confidence, timestamp }
```

**Methods:**
- `analyze(context)` - Run full analysis
- `gatherSignals(keywords, lookbackHours)` - Collect raw signals
- `scoreInsights(signals, protocol)` - Calculate confidence
- `generateSummary(insights)` - Human-readable output

### 3. Insight Scoring

Confidence score is calculated as weighted average:

```
Confidence = 
  30% × |Sentiment Score| +
  30% × TVL Growth Normalized +
  20% × News Signal Presence +
  20% × |Price Change| Normalized
```

**Filters:**
- Minimum confidence threshold (default: 0.4)
- Only protocols with TVL > $1M (configurable)
- Dedup by protocol + signal type

## Integration Examples

### Standalone Node.js
```javascript
const ResearchAgent = require('./agents/research/agent');

const agent = new ResearchAgent({
  apiKeys: {
    coingecko: 'YOUR_KEY',
    newsapi: 'YOUR_KEY'
  }
});

const insight = await agent.analyze({ protocol: 'AAVE' });
console.log(insight);
```

### REST API (Future)
```bash
curl -X POST http://localhost:3000/agents/research/analyze \
  -H "Content-Type: application/json" \
  -d '{"protocol": "AAVE", "lookbackHours": 24}'
```

### Telegram Bot Integration
```javascript
const ResearchAgent = require('./agents/research/agent');

bot.on('message', async (msg) => {
  const protocol = msg.text;
  const agent = new ResearchAgent(config);
  const insight = await agent.analyze({ protocol });
  bot.sendMessage(msg.chat.id, formatInsight(insight));
});
```

### Python Integration
```python
import subprocess
import json

result = subprocess.run(
  ['node', 'agents/research/run.js', '--protocol', 'AAVE'],
  capture_output=True,
  text=True
)

insight = json.loads(result.stdout)
```

## Configuration

### Environment Variables

```bash
# Data source API keys
COINGECKO_API_KEY=xxx
NEWS_API_KEY=xxx
TWITTER_API_KEY=xxx
ETHERSCAN_API_KEY=xxx

# Agent settings
RESEARCH_MIN_CONFIDENCE=0.4
RESEARCH_LOOKBACK_HOURS=24
RESEARCH_MAX_RESULTS=10

# Logging
DEBUG=nexxore:*
```

### Runtime Config

```javascript
new ResearchAgent({
  minConfidence: 0.4,
  maxResults: 10,
  lookbackHours: 24
});
```

## Output Format

### Insight Object
```json
{
  "id": "insight_1703411400000_a1b2c3d4",
  "type": "alpha_opportunity",
  "protocol": "AAVE",
  "confidence": 0.78,
  "signals": [
    {
      "type": "social_sentiment",
      "score": 0.65,
      "weight": 0.3
    },
    {
      "type": "defi_metrics",
      "tvlChange7d": 12.5,
      "weight": 0.3
    }
  ],
  "summary": "AAVE: Strong TVL growth (+12.5%). Positive social sentiment. Price momentum +4.2%.",
  "tags": ["high_tvl_growth", "bullish", "momentum"],
  "timestamp": "2025-12-24T10:30:00Z",
  "source": "research_agent"
}
```

### Analysis Result
```json
{
  "type": "research_analysis",
  "insights": [...],
  "summary": "Top opportunity: AAVE (78% confidence). 3 bullish, 1 bearish signals.",
  "signalsAnalyzed": 45,
  "executionTimeMs": 3200,
  "confidence": 0.78,
  "timestamp": "2025-12-24T10:30:00Z"
}
```

## Running the Agent

### CLI

```bash
# Analyze single protocol
node agents/research/run.js --protocol AAVE --lookback 24

# With debug logging
DEBUG=nexxore:* node agents/research/run.js

# Streaming mode (continuous updates)
node agents/research/run.js --stream true

# Multiple keywords
node agents/research/run.js --keywords "AAVE,CURVE,UNI" --confidence 0.5
```

### Programmatic

```javascript
const ResearchAgent = require('./agents/research/agent');

(async () => {
  const agent = new ResearchAgent({ apiKeys: {...} });
  const result = await agent.analyze({ protocol: 'AAVE' });
  console.log(result);
})();
```

## Testing

```bash
cd agents/research
npm test
```

## Performance Benchmarks

- **Single protocol analysis**: ~2-4 seconds
- **Data fetch latency**: News (1-2s), Prices (500ms), DeFi (1s), Sentiment (2-3s)
- **Cache hit rate**: ~40% (5-15 min TTL)

## Future Enhancements

1. **Real-time streaming**: WebSocket subscriptions to data sources
2. **ML-based scoring**: Train on historical alpha accuracy
3. **Multi-chain support**: Solana, Polygon, Arbitrum
4. **Custom protocols**: User-defined scoring rules
5. **Backtesting**: Historical performance analysis

---

For integration examples and API reference, see [agents/README.md](../README.md).
