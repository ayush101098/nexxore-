# Nexxore - Web3 Intelligence & Alpha Detection Platform

Autonomous agents for DeFi analysis, alpha detection, and market intelligence.

## 🚀 System Overview

```
Nexxore AI Platform
├── 📰 Research Agent      - News aggregation + LLM analysis
├── 🎯 Alpha Detection     - DeFi protocol scanning (50+ protocols)
├── 🌐 Web3 Intelligence   - Market trends + sentiment tracking
├── 💰 Token Hub           - Token database with trust scores
├── 🚨 Alert System        - Telegram, X/Twitter, Webhooks
└── 📊 Interactive Dashboard - 3-column UI for research
```

## Quick Start

### 1. Install Dependencies
```bash
cd agents
npm install
```

### 2. Configure Environment
```bash
# Create .env file
cat > .env << EOF
NEWS_API_KEY=your_newsapi_key           # Get from newsapi.org
OPENAI_API_KEY=your_openai_key          # Get from openai.com
COINGECKO_API_KEY=optional_key           # Get from coingecko.com
TELEGRAM_BOT_TOKEN=your_telegram_token   # Get from @BotFather (optional)
TELEGRAM_CHAT_ID=your_chat_id            # Get from /start command
X_API_KEY=your_x_api_key                # Get from developer.twitter.com (optional)
EOF
```

### 3. Start the Server
```bash
node server.js
```

Output:
```
╔════════════════════════════════════════════════════╗
║    🌐 Web3 Intelligence Agent Server              ║
╚════════════════════════════════════════════════════╝

🔌 API Endpoints running on http://localhost:3000
```

### 4. Open Dashboard
Visit **http://localhost:3000** in browser

## Agents

### 📰 Research Agent
**Purpose**: Real-time news aggregation + LLM-powered analysis

```bash
# Via API
curl http://localhost:3000/api/news              # Get latest news
curl -X POST http://localhost:3000/api/chat \    # Chat with LLM
  -H "Content-Type: application/json" \
  -d '{"message":"What is happening with AAVE?"}'

# Via CLI
cd research && node run.js
```

Features:
- Real crypto news (30+ sources)
- Keyword extraction & protocol tagging
- Sentiment estimation
- GPT-powered Q&A

### 🎯 Alpha Detection Agent
**Purpose**: Identify high-confidence DeFi opportunities

```bash
# Scan all protocols
curl -X POST http://localhost:3000/api/agents/alpha

# Via CLI
cd alpha && node run.js --full
cd alpha && node run.js --protocol AAVE
```

Features:
- Weighted scoring (TVL 30%, Yield 20%, Sentiment 20%, Liquidity 20%, News 10%)
- 50+ protocol coverage
- Real-time sentiment analysis
- Opportunity categorization (yield farming, emerging, bullish narrative)
- Protocol mechanics & risk assessment

Example output:
```json
{
  "protocol": "AAVE",
  "alphaScore": 85,
  "category": "yield_farming",
  "metrics": {
    "tvl": 5000000000,
    "apy": 3.5,
    "sentiment": 0.65,
    "tvlChange7d": 5.2
  },
  "summary": "AAVE • $5,000M TVL • 3.5% APY • +5.2% 7d • Positive sentiment"
}
```

### 🌐 Web3 Intelligence Agent
**Purpose**: Ecosystem-wide market intelligence & trend detection

```bash
# Generate comprehensive report
curl -X POST http://localhost:3000/api/agents/web3

# Via CLI
cd web3-intelligence && node run.js
```

Features:
- News aggregation (30+ articles)
- Trending tokens
- Community sentiment (Twitter, Discord, Telegram)
- Market trends by sector (DeFi, AI, Layer2, RWA)
- Alpha opportunity detection
- Risk indicators

Example report includes:
- Latest news with sentiment
- Topic distribution
- Top gaining/losing tokens
- Bullish narratives
- Event alerts (launches, upgrades, partnerships)

### 💰 Token Hub
**Purpose**: Comprehensive token database with trust scoring

```bash
# Get token info
curl http://localhost:3000/api/tokens/AAVE?chain=ethereum

# Compare tokens
curl -X POST http://localhost:3000/api/tokens/compare \
  -d '{"tokens": ["AAVE","CURVE","UNI"]}'
```

Trust Score Calculation:
- Audit status (+15 pts)
- Multisig wallet (+10 pts)
- Known exploits (+10 pts)
- Market cap >$100M (+10 pts)
- Community size (+15 pts)
- Sentiment analysis (-15 pts if negative)

### 🚨 Alert System
**Purpose**: Real-time notifications across multiple channels

#### Telegram
```bash
# 1. Get bot token from @BotFather
# 2. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID
# 3. Test alert
curl -X POST http://localhost:3000/api/alerts/test
```

#### X/Twitter
```bash
# 1. Set X API credentials
# 2. High-score alphas auto-tweet:
# "🔥 ALPHA: AAVE - Score 85/100 • Yield Farming • APY: 3.5%"
```

#### Webhook
```javascript
// Register custom handler
alertSystem.registerHandler('webhook', async (alert) => {
  await fetch(process.env.WEBHOOK_URL, {
    method: 'POST',
    body: JSON.stringify(alert)
  });
});
```

## API Reference

### Health Check
```bash
GET /api/health
```

### Research Agent
```bash
GET  /api/news                  # Latest crypto news
POST /api/analyze-news          # LLM analysis of articles
POST /api/chat                  # Chat with LLM
GET  /api/trending              # Trending tokens
```

### Alpha Detection
```bash
POST /api/agents/alpha          # Full DeFi scan
```

### Web3 Intelligence
```bash
POST /api/agents/web3           # Market intelligence report
```

### Token Hub
```bash
GET  /api/tokens/:symbol        # Get token info
POST /api/tokens/compare        # Compare multiple tokens
```

### Alerts
```bash
POST /api/alerts/test           # Test alert dispatch
```

## Architecture

```
agents/
├── shared/
│   ├── utils.js                  # Scoring, logging, helpers
│   ├── dataSources.js           # News, Prices, DeFi, Sentiment APIs
│   ├── newsFetcher.js           # Real NewsAPI + sentiment
│   ├── llmEngine.js             # OpenAI GPT integration
│   ├── alertSystem.js           # Alert dispatch system
│   ├── telegramHandler.js       # Telegram bot integration
│   ├── xAutomation.js           # X/Twitter tweet generation
│   └── package.json
├── research/
│   ├── agent.js                 # Research Agent main
│   ├── run.js                   # CLI runner
│   └── ARCHITECTURE.md          # Detailed design docs
├── alpha/
│   ├── agent.js                 # Alpha Detection main
│   ├── run.js                   # CLI runner
│   ├── README.md                # Setup & usage
│   └── package.json
├── web3-intelligence/
│   ├── agent.js                 # Web3 Intelligence main
│   ├── tokenHub.js              # Token database + trust scores
│   ├── run.js                   # CLI runner
│   ├── README.md                # Setup & usage
│   └── package.json
├── dashboard.html               # Interactive 3-column web UI
├── server.js                    # Main API server
├── README.md                    # This file
└── LLM_GUIDE.md                # LLM customization guide
```

## Configuration

### API Keys Required (Free Tiers Available)

| Service | Purpose | Free Tier | URL |
|---------|---------|-----------|-----|
| NewsAPI | Crypto news | 100 req/day | newsapi.org |
| OpenAI | LLM analysis | $18/mo credits | openai.com |
| CoinGecko | Token data | 10-50 req/sec | coingecko.com |
| Telegram | Bot alerts | Free | @BotFather |
| X/Twitter | Tweet automation | $100/mo | developer.twitter.com |

### Premium Data Sources (Future)
- **Glassnode** - On-chain metrics ($500+/mo)
- **Messari** - Research & fundamentals ($200+/mo)
- **DuneAnalytics** - Custom blockchain queries (Free)

## Usage Examples

### Example 1: Find Yield Farming Opportunities
```bash
# Scan for high-yield, safe protocols
curl -X POST http://localhost:3000/api/agents/alpha | \
  jq '.alphaOpportunities[] | select(.category=="yield_farming" and .alphaScore>75)'
```

### Example 2: Monitor Specific Protocol
```bash
# Deep analysis of Aave
curl http://localhost:3000/api/agents/alpha -d '{"protocol":"AAVE"}'
```

### Example 3: Get Market Pulse
```bash
# Current sentiment + trends
curl -X POST http://localhost:3000/api/agents/web3 | \
  jq '.sections | {sentiment: .communityPulse.overallSentiment, trends: .marketTrends}'
```

### Example 4: Compare Safety of Tokens
```bash
# Trust scores
curl -X POST http://localhost:3000/api/tokens/compare \
  -d '{"tokens":["USDC","DAI","FRAX"]}' | \
  jq 'sort_by(-.trustScore)'
```

## Performance

| Operation | Time | Notes |
|-----------|------|-------|
| Alpha scan (50 protocols) | 5 sec | Parallel fetches |
| Single protocol analysis | 1 sec | Cached results |
| Web3 report | 3-5 sec | ~30 news articles |
| Token lookup | <100ms | 1-hour cache |
| Dashboard load | 2 sec | Full data load |

## Customization

### Change Scoring Weights
Edit `/agents/alpha/agent.js`:
```javascript
calculateAlphaScore(scores) {
  const weighted =
    scores.tvlVolume * 0.30 +      // Adjust these weights
    scores.yield * 0.20 +
    scores.sentiment * 0.20 +
    scores.liquidityFlow * 0.20 +
    scores.newsImpact * 0.10;
  return Math.round(weighted * 100);
}
```

### Add Custom Protocol
```javascript
const agent = new AlphaDetectionAgent();
agent.protocols.push('MY_TOKEN');
```

### Configure LLM Model
Edit `/agents/shared/llmEngine.js`:
```javascript
const response = await fetch('https://api.openai.com/v1/chat/completions', {
  body: JSON.stringify({
    model: 'gpt-4',  // Switch model here
    temperature: 0.7,
    max_tokens: 500
  })
});
```

## Roadmap

### Phase 1 (Current) ✅
- [x] Research Agent (news + LLM)
- [x] Alpha Detection (DeFi scanning)
- [x] Web3 Intelligence (trends + sentiment)
- [x] Token Hub (trust scores)
- [x] Alert System (Telegram, X)
- [x] Interactive Dashboard

### Phase 2 (Next 4 weeks)
- [ ] Portfolio Tracker (track user positions)
- [ ] Self-Learning (tune scoring from engagement)
- [ ] Advanced Sentiment (FinBERT, Messari)
- [ ] Options/Perpetuals signals
- [ ] Mobile app

### Phase 3 (2+ months)
- [ ] Arbitrage detection
- [ ] Smart contract monitoring
- [ ] DeFi risk dashboard
- [ ] Community alerts (Discord bot)
- [ ] Cloud deployment (AWS/Docker)

## Support & Documentation

- **Setup Issues**: See individual agent READMEs in `/agents/{alpha,web3-intelligence}`
- **LLM Customization**: `/agents/LLM_GUIDE.md`
- **Architecture**: `/agents/research/ARCHITECTURE.md`
- **Main README**: `/agents/README.md`

## Troubleshooting

### "Missing API keys"
```bash
# Check .env file
cat .env

# Get keys from:
# NewsAPI: https://newsapi.org/account
# OpenAI: https://platform.openai.com/account/api-keys
# CoinGecko: https://www.coingecko.com/en/api
```

### "Port 3000 already in use"
```bash
# Use different port
PORT=3001 node server.js

# Or kill existing process
lsof -i :3000 | grep node | awk '{print $2}' | xargs kill -9
```

### "LLM not responding"
```bash
# Check API key
echo $OPENAI_API_KEY

# Verify balance at platform.openai.com
# Try with smaller max_tokens value
```

## License

MIT - See LICENSE file

## Contact

For questions or feature requests, open an issue on GitHub.
1. **NewsAPI** (free tier available)
   - Sign up at https://newsapi.org
   - Get key and set: `export NEWS_API_KEY="your_key"`

2. **OpenAI** (required for LLM)
   - Sign up at https://platform.openai.com
   - Get API key and set: `export OPENAI_API_KEY="sk-..."`

3. **Optional: CoinGecko** (for price data, free tier)
   - Sign up at https://www.coingecko.com/api

### Environment File

Create `.env` in `/agents`:

```bash
NEWS_API_KEY=your_newsapi_key
OPENAI_API_KEY=your_openai_api_key
COINGECKO_API_KEY=your_coingecko_key
DEBUG=nexxore:*
```

## Research Agent Features

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
