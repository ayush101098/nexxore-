# Web3 Intelligence Agent

## Overview

The Web3 Intelligence Agent aggregates real-time data across the DeFi/Web3 ecosystem to provide comprehensive market intelligence. It combines news aggregation, sentiment analysis, token tracking, and alpha detection into a unified platform.

## Features

### 1. **News Aggregation & Analysis**
- 30+ crypto news sources (CoinTelegraph, CoinDesk, TheBlock, etc.)
- Real-time sentiment analysis
- Protocol & token extraction
- Topic clustering (DeFi, NFT, AI, Layer2, Staking)

### 2. **Token Hub with Trust Scores**
- 5,000+ token database
- Security audits & smart contract verification
- Market cap, liquidity, volume tracking
- Community engagement metrics
- Risk assessment (0-100 trust score)

### 3. **Market Trend Detection**
- Sector momentum (DeFi, AI, Layer2, RWA)
- Liquidity analysis
- Cross-chain tracking
- Emerging opportunities

### 4. **Community Pulse**
- Sentiment aggregation (Twitter, Discord, Telegram)
- Mention volume tracking
- Narrative identification
- Risk indicator alerts

### 5. **Alpha Opportunity Identification**
- New token launches
- Partnership announcements
- Protocol upgrades
- Liquidation cascades detection

## Setup

### Prerequisites
```bash
node --version  # v14+
```

### Environment Variables
```bash
# Add to .env
NEWS_API_KEY=your_newsapi_key
COINGECKO_API_KEY=your_coingecko_key
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
X_API_KEY=your_x_api_key
```

## Usage

### Run Intelligence Report
```bash
node run.js
```

Output includes:
- Latest news (top 10)
- Trending tokens
- Community sentiment
- Market trends
- Alpha opportunities

### API Integration
```bash
# Start server
cd /agents
node server.js

# Generate Web3 intelligence report
curl -X POST http://localhost:3000/api/agents/web3

# Response includes:
{
  "type": "web3_intelligence_report",
  "sections": {
    "news": {
      "latestNews": [...],
      "topicDistribution": {...},
      "sentimentBreakdown": {...}
    },
    "trending": {
      "topTokens": [...]
    },
    "communityPulse": {
      "overallSentiment": "bullish",
      "mentionVolume": 5000,
      "trendingNarratives": [...]
    },
    "alphaOpportunities": [
      {
        "type": "new_launch",
        "headline": "...",
        "confidence": "medium"
      }
    ],
    "marketTrends": [
      {
        "sector": "DeFi",
        "momentum": "bullish",
        "signals": 12
      }
    ]
  }
}
```

## Token Hub API

### Get Token Info
```bash
curl http://localhost:3000/api/tokens/AAVE?chain=ethereum
```

Response:
```json
{
  "symbol": "AAVE",
  "chain": "ethereum",
  "name": "Aave",
  "trustScore": 92,
  "riskLevel": "low",
  "marketData": {
    "price": 185.50,
    "marketCap": 2500000000,
    "volume24h": 150000000,
    "dilutionRisk": "low"
  },
  "security": {
    "isAudited": true,
    "auditors": ["Trail of Bits", "OpenZeppelin"],
    "hasMultisig": true,
    "exploits": 0
  },
  "community": {
    "twitterFollowers": 450000,
    "discordMembers": 125000,
    "sentiment": 0.65
  }
}
```

### Compare Tokens
```bash
curl -X POST http://localhost:3000/api/tokens/compare \
  -H "Content-Type: application/json" \
  -d '{"tokens": ["AAVE", "COMPOUND", "MAKER"]}'
```

### Get Tokens by Category
```bash
# Via agent
const category = await tokenHub.getTokensByCategory('lending');
// Returns: [AAVE, COMPOUND, MAKER] sorted by trust score
```

Categories supported:
- `stablecoin` - USDC, DAI, USDT, FRAX
- `layer2` - ARB, OP, SCROLL, LINEA
- `lending` - AAVE, COMP, MAKER
- `dex` - UNI, CRV, GMX, BALANCER
- `ai` - RENDER, FET, AGIX
- `rwa` - ONDO, PROPY, KYC3

## Alert System

### Create Alerts
```javascript
const alertSystem = new AlertSystem();

// Alpha alert
await alertSystem.createAlphaAlert({
  protocol: 'AAVE',
  alphaScore: 85,
  category: 'yield_farming'
});

// Sentiment alert
await alertSystem.createSentimentAlert('ETH', 0.8);

// Whale alert
await alertSystem.createWhaleAlert({
  token: 'AAVE',
  amount: 500000,
  amountUSD: 92500000,
  type: 'buy'
});

// Launch alert
await alertSystem.createLaunchAlert({
  symbol: 'NEW',
  name: 'New Protocol',
  chain: 'ethereum'
});
```

### Alert Handlers

#### Telegram
```bash
# 1. Create bot with @BotFather
# 2. Set environment variables
TELEGRAM_BOT_TOKEN=123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefgh
TELEGRAM_CHAT_ID=987654321

# 3. Send test alert
curl -X POST http://localhost:3000/api/alerts/test
```

#### X/Twitter
```bash
# 1. Get API keys from developer.twitter.com
# 2. Set environment variables
X_API_KEY=your_api_key
X_API_SECRET=your_api_secret
X_ACCESS_TOKEN=your_access_token
X_ACCESS_TOKEN_SECRET=your_token_secret

# 3. Automatic tweets on high-score alphas
# "🔥 ALPHA: AAVE - Score 85/100 • Yield Farming • APY: 3.5%"
```

## Data Sources

### News
- **NewsAPI** - 30+ crypto publications
- Real-time updates (configurable frequency)
- Protocol extraction and tagging

### Prices & Market Data
- **CoinGecko** - Free tier (no auth required)
- 10,000+ tokens
- 24h, 7d, 30d price changes
- Market cap, volume, trends

### Sentiment
- **X/Twitter** - Real-time mentions
- **Discord** - Community engagement
- **Telegram** - Group activity
- Keyword-based sentiment estimation

### On-Chain
- **Glassnode** (premium) - Address clustering, whale tracking
- **Messari** (premium) - Research, fundamentals
- **DuneAnalytics** - Custom queries

## Customization

### Add Custom Data Source
```javascript
class CustomDataSource {
  async fetch() {
    // Implement fetch logic
    return { tokens: [...], metrics: {...} };
  }
}

const agent = new Web3IntelligenceAgent();
agent.dataFetcher.addSource('custom', new CustomDataSource());
```

### Change Update Frequency
```javascript
const agent = new Web3IntelligenceAgent({
  updateFrequencyMs: 60000  // 1 minute
});
```

### Custom Alert Rules
```javascript
alertSystem.registerHandler('custom', async (alert) => {
  if (alert.sentiment > 0.8 && alert.volume > 1000000) {
    // Custom logic
  }
});
```

## Performance

- **Report Generation**: ~3-5 seconds
- **Token Lookup**: <100ms (cached)
- **News Fetch**: ~2-3 seconds (30 articles)
- **Sentiment Analysis**: ~1 second (keyword-based)
- **Memory Usage**: ~150-200MB
- **Cache TTL**: 1 hour for news, hourly for tokens

## Monitoring

### View System Stats
```bash
curl http://localhost:3000/api/health

# Response:
{
  "status": "operational",
  "agents": {
    "research": {...},
    "alpha": {...},
    "web3": {...}
  },
  "alerts": {
    "handlersRegistered": ["telegram", "x"],
    "alertsQueued": 0,
    "isRunning": true
  }
}
```

## Integration Examples

### With Portfolio Tracker
```javascript
// Track positions in recommended protocols
const portfolio = {
  positions: [
    { protocol: 'AAVE', amount: 100 },
    { protocol: 'CURVE', amount: 500 }
  ]
};

const report = await web3Agent.generateReport();
report.alphaOpportunities.forEach(opp => {
  if (portfolio.positions.some(p => p.protocol === opp.protocol)) {
    console.log('Existing position:', opp);
  }
});
```

### With Discord Notifications
```javascript
const discordHandler = async (alert) => {
  // Send to Discord webhook
  const embed = {
    title: alert.title,
    description: alert.message,
    color: alert.severity === 'critical' ? 0xFF0000 : 0x00FF00
  };
  
  await fetch(process.env.DISCORD_WEBHOOK_URL, {
    method: 'POST',
    body: JSON.stringify({ embeds: [embed] })
  });
};

alertSystem.registerHandler('discord', discordHandler);
```

## Risk Management

### Trust Score Calculation
```
Base: 50 points

+ Audited: 15 pts
+ Multisig: 10 pts
+ No exploits: 10 pts
+ Market cap >$100M: 10 pts
+ Volume >$10M: 5 pts
+ 50k+ Twitter: 10 pts
+ 10k+ Discord: 5 pts

- Declining community: -10 pts
- Negative sentiment: -15 pts

Final: 0-100 range
```

### Risk Levels
- **Low** (80-100): Established projects, multiple audits
- **Medium** (60-79): Solid fundamentals, some red flags
- **High** (40-59): Newer/smaller projects, audit needed
- **Extreme** (<40): Not recommended

## Next Steps

1. **Portfolio Integration** - Track user positions
2. **Mobile Notifications** - Push alerts to mobile
3. **Advanced Sentiment** - FinBERT-based analysis
4. **Arbitrage Detection** - Cross-chain price differences
5. **Smart Contract Monitoring** - Real-time contract changes

## Support

See main `/agents/README.md` for general setup and troubleshooting.
