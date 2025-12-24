# LLM Integration Guide

## Overview

The Nexxore agents use **OpenAI GPT** to analyze news, generate trade signals, and power the chat interface.

## LLM Engine

Located in `shared/llmEngine.js`, it provides:

### 1. News Analysis
```javascript
const llmEngine = new LLMEngine({ apiKey: 'sk-...' });

const result = await llmEngine.analyzeNews([
  {
    title: 'AAVE Introduces Flash Loan Enhancements',
    description: 'New features improve efficiency...'
  },
  ...
]);

// Returns:
// {
//   opportunities: [
//     { token: 'AAVE', signal: 'BUY', confidence: 8, reasoning: '...' }
//   ],
//   summary: '...'
// }
```

### 2. Chat Interface
```javascript
const response = await llmEngine.chat(
  'What protocols should I invest in?',
  {
    recentNews: 'AAVE partnership announced...',
    protocols: ['AAVE', 'CURVE', 'UNI']
  }
);
// Returns: AI-generated market insights
```

### 3. Signal Generation
```javascript
const signals = await llmEngine.generateSignals({
  tvlLeaders: ['AAVE', 'Lido', 'Curve'],
  trending: ['UNI', 'AAVE'],
  newLaunches: ['Protocol X', 'Protocol Y'],
  newsHeadlines: [...]
});
```

## Prompting Strategy

### System Prompts

The engine uses context-aware system messages:

```javascript
// For analysis
"You are a crypto trading analyst. Analyze news and identify trading opportunities..."

// For chat
"You are a crypto market expert and DeFi analyst with access to latest news..."
```

### User Prompts

Dynamically generated based on data:

```
Analyze this market data:
TVL Leaders: AAVE, Lido, Curve
Trending: UNI, AAVE
Recent News: Partnership announcements, protocol upgrades
...
Provide 3 actionable trade ideas.
```

## Response Format

All LLM responses follow structured JSON:

```json
{
  "opportunities": [
    {
      "token": "AAVE",
      "signal": "BUY",
      "confidence": 8,
      "reasoning": "Strong TVL growth + positive news sentiment"
    }
  ],
  "summary": "..."
}
```

## Cost Optimization

- **Model**: `gpt-3.5-turbo` (cheaper, faster for summarization)
- **Token limits**: 1000 max per request
- **Batching**: Analyze multiple news items in single call
- **Caching**: Store recurring prompts

Estimated cost: **$0.50-2/day** with 100s of analyses

## Error Handling

```javascript
try {
  const result = await llmEngine.analyzeNews(news);
} catch (err) {
  if (err.message.includes('401')) {
    console.error('Invalid API key');
  } else if (err.message.includes('429')) {
    console.error('Rate limited, retry after 60s');
  }
}
```

## Rate Limits

- **Free tier**: 3 requests/minute
- **Paid tier**: 90 requests/minute
- **Fallback**: Returns mock analysis if rate limited

## Customizing Prompts

Edit system prompts in `llmEngine.js`:

```javascript
const systemPrompt = `You are a crypto market expert...
[Your custom instructions here]
Analyze news and generate trade signals.`;
```

### Example: Conservative Strategy

```javascript
const systemPrompt = `You are a conservative crypto analyst.
Only recommend BUY for protocols with:
- TVL > $100M
- 6+ months track record
- Audited contracts
- Active development
Focus on capital preservation.`;
```

### Example: Alpha Hunter

```javascript
const systemPrompt = `You are an aggressive DeFi alpha hunter.
Look for:
- New protocol launches
- Governance token unlocks
- Major partnerships
- Emerging narratives
Take calculated risks for asymmetric upside.`;
```

## Integration Examples

### With Research Agent

```javascript
const agent = new ResearchAgent(config);
const newsData = await agent.gatherSignals(['AAVE', 'CURVE']);

const analysis = await llmEngine.analyzeNews(newsData);
console.log(analysis.opportunities);
```

### With Dashboard

The dashboard automatically calls LLM endpoints:

```javascript
// User sends chat message
fetch('/api/chat', {
  method: 'POST',
  body: JSON.stringify({
    message: 'What should I buy now?',
    context: { recentNews, opportunities }
  })
});
// Server calls LLMEngine.chat() and returns response
```

## Performance

- **Latency**: 1-3 seconds per analysis
- **Tokens/call**: 100-500 input, 100-300 output
- **Cost/call**: $0.001-0.005

## Fallback Behavior

If OpenAI API fails:

1. Returns mock analysis with hardcoded signals
2. Logs error for debugging
3. Shows user-friendly error message

---

For dashboard usage, see [README.md](./README.md).
For prompting best practices, see [OpenAI docs](https://platform.openai.com/docs).
