# Enhanced Alpha Detection Agent

## Overview

The Enhanced Alpha Detection Agent is an autonomous DeFi protocol scanner that identifies yield farming, emerging protocol, and liquidity opportunities. It combines multi-factor scoring with real-time sentiment analysis to surface high-confidence alpha signals.

## Features

### 1. **DeFi Protocol Scanning** (50+ protocols)
- Tracks major protocols: Aave, Curve, Uniswap, Lido, Yearn, Compound, Convex, Balancer, Sushiswap, Maker, Synthetix, dYdX, GMX, Pendle, Fuel, Scroll
- Multi-chain support (Ethereum, Polygon, Arbitrum, Optimism, Solana)
- Real-time TVL and yield data

### 2. **Alpha Scoring Engine** (0-100 score)

#### Weighted Factors:
- **TVL & Volume (30%)** - Growth trajectory and liquidity depth
- **Yield (20%)** - APY sustainability and risk-adjusted returns
- **Sentiment (20%)** - News sentiment and community engagement
- **Liquidity Flow (20%)** - Recent capital inflows/outflows
- **News Impact (10%)** - Recent announcements and catalysts

```javascript
Score = (TVL×0.30) + (Yield×0.20) + (Sentiment×0.20) + 
        (LiqFlow×0.20) + (News×0.10)
```

### 3. **Opportunity Categories**

- **🌾 Yield Farming** - High APY opportunities (15%+ APY, low IL risk)
- **🚀 Emerging Protocols** - New launches with TVL growth (>20% 7d growth)
- **📈 Bullish Narrative** - Strong positive sentiment (>70% positive news)
- **⚖️ Balanced Opportunities** - Mixed signals, moderate risk

### 4. **Protocol Analysis**

Each scanned protocol includes:
- **Mechanics** - How the protocol works
- **Pros** - Key advantages
- **Cons** - Risk factors
- **Differentiators** - Unique features

Example (AAVE):
```
Mechanics: Overcollateralized lending with risk management
Pros: Flash loans, Multi-chain, High TVL, Risk parameters
Cons: Liquidation risk, Market-dependent, Complex parameters
Differentiators: Flash loans, multi-chain expansion, isolation mode
```

### 5. **Real-time Alerts**

Automatic alerts when:
- Alpha score > 80 (High confidence)
- TVL growth > 20% (7-day)
- Sentiment spike detected
- New launches identified
- Protocol events occur

## Setup

### Prerequisites
```bash
node --version  # v14+
npm install dotenv
```

### Environment Variables
```bash
# Add to .env
NEWS_API_KEY=your_newsapi_key          # Get from newsapi.org
COINGECKO_API_KEY=your_coingecko_key   # Get from coingecko.com
OPENAI_API_KEY=your_openai_key         # Get from openai.com (optional)
GLASSNODE_API_KEY=your_glassnode_key   # Get from glassnode.com (future)
MESSARI_API_KEY=your_messari_key       # Get from messari.com (future)
```

### Installation
```bash
cd /agents/alpha
npm install
```

## Usage

### Run Full Scan
```bash
node run.js --full
```

Scans all 50+ protocols and returns top 10 alphas.

### Analyze Single Protocol
```bash
node run.js --protocol AAVE
```

Deep analysis of a specific protocol.

### With Debugging
```bash
DEBUG=nexxore:* node run.js --full
```

## API Integration

### Via Server
```bash
# Start server
node server.js

# Trigger alpha scan
curl -X POST http://localhost:3000/api/agents/alpha

# Response example:
{
  "type": "alpha_scan",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "alphaOpportunities": [
    {
      "id": "alpha_1234567890",
      "protocol": "AAVE",
      "alphaScore": 85,
      "scores": {
        "tvlVolume": 0.85,
        "yield": 0.65,
        "sentiment": 0.75,
        "liquidityFlow": 0.8,
        "newsImpact": 0.6
      },
      "category": "yield_farming",
      "metrics": {
        "tvl": 5000000000,
        "apy": 3.5,
        "sentiment": 0.6
      },
      "summary": "AAVE • $5,000M TVL • 3.5% APY • +5.2% 7d growth • Positive sentiment"
    }
  ]
}
```

## Scoring Details

### TVL/Volume Scoring
```
0% - 30%: 0.1
30% - 50%: 0.3
50% - 80%: 0.6
80%+: 0.9
```

### Yield Scoring
```
< 2% APY: 0.1
2-5%: 0.3
5-10%: 0.5
10-20%: 0.75
20%+: 1.0 (capped)
```

### Sentiment Scoring
```
Raw: -1.0 (bearish) to +1.0 (bullish)
Normalized: (score + 1) / 2
Range: 0.0 (very bearish) to 1.0 (very bullish)
```

## Integration Examples

### With Telegram Alerts
```javascript
const agent = new AlphaDetectionAgent();
const alertSystem = new AlertSystem();
const { createTelegramHandler } = require('./shared/telegramHandler');

const telegramHandler = await createTelegramHandler(
  process.env.TELEGRAM_BOT_TOKEN,
  process.env.TELEGRAM_CHAT_ID
);

alertSystem.registerHandler('telegram', (alert) => telegramHandler.handle(alert));

const result = await agent.scanForAlpha();
for (const signal of result.alphaOpportunities) {
  if (signal.alphaScore >= 80) {
    await alertSystem.createAlphaAlert(signal);
  }
}
```

### With X/Twitter Automation
```javascript
const XAutomationHandler = require('./shared/xAutomation');

const xHandler = new XAutomationHandler({
  xApiKey: process.env.X_API_KEY,
  xApiSecret: process.env.X_API_SECRET,
  xAccessToken: process.env.X_ACCESS_TOKEN,
  xAccessTokenSecret: process.env.X_ACCESS_TOKEN_SECRET
});

alertSystem.registerHandler('x', (alert) => xHandler.handle(alert));

// Tweets generated: "🔥 ALPHA: AAVE - Score 85/100 • Yield Farming • APY: 3.5%"
```

## Performance

- **Scan Time**: ~5 seconds for full 50+ protocol scan
- **Cache TTL**: 5 minutes per protocol
- **Data Sources**: NewsAPI, CoinGecko, Sentiment Analysis
- **Update Frequency**: Every 5 minutes (configurable)

## Customization

### Change Minimum Score Threshold
```javascript
const agent = new AlphaDetectionAgent({
  minAlphaScore: 60  // Default: 50
});
```

### Add Custom Protocols
```javascript
const agent = new AlphaDetectionAgent();
agent.protocols.push('CUSTOM_TOKEN');
```

### Adjust Scoring Weights
In `agent.js`, modify `calculateAlphaScore()`:
```javascript
const weighted =
  scores.tvlVolume * 0.35 +  // Increase TVL weight
  scores.yield * 0.25 +
  scores.sentiment * 0.15 +
  scores.liquidityFlow * 0.20 +
  scores.newsImpact * 0.05;
```

## Monitoring

### Health Check
```bash
curl http://localhost:3000/api/health
```

### View Metadata
```javascript
const agent = new AlphaDetectionAgent();
console.log(agent.getMetadata());
// {
//   name: 'AlphaDetectionAgent',
//   type: 'alpha_detection',
//   capabilities: [...],
//   protocolCoverage: 50
// }
```

## Risk Assessment

### Alpha Score Interpretation

- **🔴 >85**: Critical alpha - immediate research required
- **🟠 75-85**: High confidence - strong opportunity
- **🟡 60-75**: Medium confidence - monitor developments
- **🟢 50-60**: Lower confidence - track for changes
- **⚪ <50**: Not recommended

### Risk Factors Considered

1. **Smart Contract Risk** - Audits, exploits, multisig
2. **Market Risk** - Liquidity, slippage, volatility
3. **Impermanent Loss** - For LP opportunities
4. **Liquidation Risk** - For lending protocols
5. **Regulatory Risk** - Compliance changes

## Next Steps

1. **Data Enhancement** - Integrate Glassnode for on-chain metrics
2. **Self-Learning** - Track tweet engagement for signal tuning
3. **Multi-Chain Expansion** - Deep dive into Solana, Polygon yields
4. **Options Integration** - Perpetual/options market signals
5. **Portfolio Tracking** - Track user positions in recommended protocols

## Support

For issues or feature requests:
- Check `/agents/README.md` for general setup
- Review `/agents/LLM_GUIDE.md` for LLM customization
- See `/agents/research/ARCHITECTURE.md` for system design
