# Nexxore Autonomous Agents

Modular, composable agents for DeFi intelligence and automated decision-making.

## Architecture

```
agents/
├── shared/           # Common utilities (data fetching, storage, formatting)
├── research/         # Research Agent (news, sentiment, protocols)
├── alpha/            # Alpha Detection Agent (scoring, opportunities)
├── execution/        # Execution Agent (trade signals, automation)
└── output/           # Output Agents (Telegram, X, Dashboard)
```

## Design Principles

1. **Modular**: Each agent is independent, can run standalone or in combination
2. **Composable**: Agents can chain together (research → alpha → execution → output)
3. **Simple**: Minimal dependencies, easy to integrate anywhere
4. **Testable**: Clear input/output contracts
5. **Observable**: Built-in logging, event tracking

## Quick Start

### 1. Research Agent

Detects alpha opportunities across DeFi by analyzing news, social sentiment, and on-chain data.

```bash
cd agents/research
node run.js
```

Output:
```json
{
  "type": "research_insight",
  "protocol": "Curve",
  "confidence": 0.85,
  "signals": [
    { "type": "news", "value": "New partnership announced", "weight": 0.3 },
    { "type": "social_sentiment", "value": 0.72, "weight": 0.2 },
    { "type": "tvl_growth", "value": "12% week-over-week", "weight": 0.3 }
  ],
  "summary": "High alpha potential driven by TVL growth and positive narrative momentum.",
  "timestamp": "2025-12-24T10:30:00Z"
}
```

## Data Flow

```
News APIs (CoinDesk, RSS) → Research Agent → Storage
X/Twitter Sentiment       →        ↓       → Analysis
On-chain Metrics (DeFiLlama) → Processing → Output
                          ↓
                    Alpha Detection
                          ↓
                    Execution Signals
                          ↓
                    Telegram/X/Dashboard
```

## Agent Interfaces

All agents expose a common interface:

```javascript
class Agent {
  async analyze(context) {
    // Input: { protocol, data, config }
    // Output: { type, confidence, signals, summary }
  }
  
  async subscribe(topics) {
    // Stream insights for specific topics
  }
  
  getMetadata() {
    // Returns agent capabilities, required data, outputs
  }
}
```

## Integration

### In Node.js
```javascript
const ResearchAgent = require('./research/agent');
const agent = new ResearchAgent({ apiKeys: {...} });

const insight = await agent.analyze({
  protocol: 'AAVE',
  lookbackHours: 24
});
```

### In Python
```python
from agents.research import ResearchAgent

agent = ResearchAgent(api_keys={...})
insight = agent.analyze(protocol='AAVE', lookback_hours=24)
```

### REST API (future)
```
POST /agents/research/analyze
{ "protocol": "AAVE", "lookbackHours": 24 }
```

## Configuration

Each agent reads from `.env` or config files:

```
RESEARCH_AGENT_API_KEYS={"coingecko": "...", "news": "..."}
RESEARCH_AGENT_UPDATE_INTERVAL=300
RESEARCH_AGENT_OUTPUT_WEBHOOK=https://nexxore.local/webhooks/insights
```

## Monitoring & Debugging

Enable debug logs:
```bash
DEBUG=nexxore:* node agents/research/run.js
```

## Future Agents

- **Alpha Agent**: Scoring, quantitative opportunity ranking
- **Execution Agent**: Trade signals, position management
- **Portfolio Agent**: Rebalancing, risk management
- **Output Agent**: Multi-channel distribution (Telegram, X, Discord)

---

For detailed PRD and implementation specs, see [ARCHITECTURE.md](./ARCHITECTURE.md).
