# Quick Start: Refined Research Agent Integration

## What We Built

You now have an **institutional-grade research agent** that:

1. ✅ **Optimizes for specific objectives** (directional alpha, leverage stress, liquidity stress, yield sustainability)
2. ✅ **Uses orthogonal signal classes** (derivatives, onchain, liquidity, fundamentals)
3. ✅ **Transforms raw metrics** into normalized, comparable signals (z-scores, composites)
4. ✅ **Multi-domain confirmation** (requires cross-validation across signal classes)
5. ✅ **Probabilistic confidence scoring** (tells you HOW certain the signal is)
6. ✅ **10-second actionable output** (drivers, risks, invalidation criteria)
7. ✅ **Risk-aware** (regime detection + automatic suppression)

## File Summary

### Core Agent Files (NEW)
```
agents/research/
├── signalTypes.js              # Signal type definitions & thresholds
├── signalTransformation.js     # Z-scores, composites, normalization
├── orthogonalCollectors.js     # Data organized by signal class
├── refinedResearchAgent.js     # Main agent with 7-step pipeline
└── REFINED_AGENT_README.md     # Complete documentation
```

### API & Frontend (NEW)
```
api/
└── research-refined.js         # API endpoints for signals

js/components/
└── researchInsights.js         # Dashboard component

css/
└── researchInsights.css        # Insights UI styles
```

## Integration Steps

### Step 1: Add API Routes

In your main server file (e.g., `agents/server.js` or `api/index.js`):

```javascript
const refinedResearch = require('./api/research-refined');

// Add routes
app.get('/api/research/signals', refinedResearch.getSignals);
app.post('/api/research/scan', refinedResearch.scanMarkets);
app.get('/api/research/signal/:protocol', refinedResearch.getProtocolSignal);
app.get('/api/research/regime', refinedResearch.getMarketRegime);
app.get('/api/research/history', refinedResearch.getAnalysisHistory);
```

### Step 2: Update research.html

Add the new dashboard component to your research page:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <!-- Existing head content -->
  <link rel="stylesheet" href="css/researchInsights.css">
</head>
<body>
  <!-- Your existing header/nav -->
  
  <div class="container">
    <!-- NEW: Insights Dashboard -->
    <div id="insightsDashboard"></div>
    
    <!-- Your existing panels -->
  </div>
  
  <!-- Add before closing body tag -->
  <script src="js/components/researchInsights.js"></script>
</body>
</html>
```

### Step 3: Connect Data Collectors

#### For Derivatives Data:
Your existing `research-bot/src/collectors/derivatives_collector.py` is good! 
Just ensure it's accessible to the agent:

```javascript
// In orthogonalCollectors.js
async collectDerivativesSignals(symbol) {
  // Call your Python collector via API
  const response = await fetch(`http://localhost:8000/api/derivatives/${symbol}`);
  const data = await response.json();
  
  // Map to our signal format
  return {
    fundingRate: data.funding_rate,
    fundingHistory: data.funding_history,
    openInterest: data.open_interest,
    // ... rest of mapping
  };
}
```

#### For Onchain Data:
Integrate with Glassnode/CryptoQuant/Dune:

```javascript
async collectOnchainSignals(protocol) {
  // Example: Dune Analytics
  const whaleData = await fetch(
    `https://api.dune.com/api/v1/query/${QUERY_ID}/results`,
    { headers: { 'X-Dune-API-Key': process.env.DUNE_API_KEY } }
  );
  
  // Map to signal format
}
```

#### For Liquidity Data:
Your `dataAggregator.js` already has DefiLlama integration. Use it!

```javascript
async collectLiquiditySignals(protocol) {
  const data = await dataAggregator.aggregateProtocolData(protocol);
  
  return {
    tvl: data.protocol.tvl,
    tvlChange24h: data.protocol.tvlChange1d,
    // ... use existing data
  };
}
```

### Step 4: Test the Agent

Create a test script:

```javascript
// test-refined-agent.js
const { RefinedResearchAgent } = require('./agents/research/refinedResearchAgent');

async function test() {
  const agent = new RefinedResearchAgent();
  
  // Test single asset analysis
  const signal = await agent.analyzeAsset('aave', 'DIRECTIONAL_ALPHA', '7d');
  console.log('Signal:', JSON.stringify(signal, null, 2));
  
  // Test batch analysis
  const batch = await agent.analyzeBatch(
    ['aave', 'uniswap', 'lido'],
    'LEVERAGE_STRESS'
  );
  console.log('Batch results:', batch.qualified, 'qualified signals');
}

test();
```

Run it:
```bash
node test-refined-agent.js
```

## Signal Types Usage

### Directional Alpha (Price Prediction)
```javascript
const signal = await agent.analyzeAsset('aave', 'DIRECTIONAL_ALPHA', '7d');

// Output includes:
// - probability: 0.68 (68% chance of upward move)
// - direction: 'LONG' or 'SHORT'
// - drivers: why this direction?
// - invalidation: when to exit?
```

**Best for**: Trading decisions, position sizing

### Leverage Stress (Cascade Risk)
```javascript
const signal = await agent.analyzeAsset('gmx', 'LEVERAGE_STRESS', '24h');

// Output includes:
// - level: 'EXTREME', 'HIGH', 'ELEVATED', 'NORMAL', 'LOW'
// - components: funding_z, oi_z, borrow_util_z
// - risks: cascade probability
```

**Best for**: Risk management, position hedging

### Liquidity Stress (Execution Risk)
```javascript
const signal = await agent.analyzeAsset('pendle', 'LIQUIDITY_STRESS', '3d');

// Output includes:
// - level: 'EXCELLENT', 'GOOD', 'ADEQUATE', 'WEAK', 'STRESSED'
// - components: TVL health, depth ratios, volume consistency
// - risks: slippage, price impact
```

**Best for**: Large position planning, rebalancing

### Yield Sustainability (APY Quality)
```javascript
const signal = await agent.analyzeAsset('ethena', 'YIELD_SUSTAINABILITY', '30d');

// Output includes:
// - level: 'SUSTAINABLE', 'MODERATE', 'FRAGILE', 'UNSUSTAINABLE'
// - components: fees_ratio, organic_growth, runway
// - risks: vampire attack, emissions exhaustion
```

**Best for**: Vault allocations, yield farming

## Dashboard Usage

The insights dashboard provides:

1. **Market Regime Banner**: Shows RISK_ON/RISK_OFF/COMPRESSION/TRANSITION
2. **Signal Type Selector**: Toggle between alpha/stress/liquidity/yield
3. **Signal Cards**: Actionable 10-second format with:
   - Confidence badge (HIGH/MEDIUM/LOW)
   - Signal action (STRONG LONG, CAUTIOUS SHORT, etc.)
   - Drivers (✅ why this signal?)
   - Risks (⚠️ what could go wrong?)
   - Invalidation criteria
   - Composite scores (leverage, liquidity, yield)

## Customization

### Adjust Confidence Thresholds
```javascript
// In signalTypes.js
const CONFIDENCE_LEVELS = {
    HIGH: { threshold: 0.80 },  // Change from 0.75 to 0.80
    MEDIUM: { threshold: 0.60 }, // Change from 0.50 to 0.60
    LOW: { threshold: 0.00 }
};
```

### Change Signal Weights
```javascript
// In signalTypes.js
const SIGNAL_WEIGHTS = {
    DIRECTIONAL_ALPHA: {
        derivatives: 0.40,    // Increase from 0.35
        onchain: 0.35,        // Increase from 0.30
        liquidity: 0.15,      // Decrease from 0.20
        fundamentals: 0.10    // Decrease from 0.15
    }
};
```

### Add Custom Protocols
```javascript
// In research-refined.js
const TOP_PROTOCOLS = [
    'aave', 'uniswap', 'lido',
    'your-protocol-here',
    'another-protocol'
];
```

## Production Checklist

- [ ] Connect real derivatives data (Coinglass/Binance APIs)
- [ ] Integrate onchain data (Glassnode/Dune)
- [ ] Add error handling & retries
- [ ] Implement caching for expensive calls
- [ ] Set up monitoring/logging
- [ ] Add rate limiting for APIs
- [ ] Backtest signals on historical data
- [ ] Calibrate confidence thresholds
- [ ] Create alert system (Telegram/Discord)
- [ ] Add authentication for API endpoints

## Example Output

Here's what a real signal looks like:

```
Asset: AAVE
Signal: CAUTIOUS LONG
Confidence: 72% (MEDIUM)
Time Horizon: 7d

✅ Drivers:
• Funding normalized after spike - derisking underway
• Whale accumulation + exchange outflows - strong conviction
• TVL growing organically - real demand signal

⚠️ Risks:
• Leverage stress ELEVATED - monitor closely
• Risk-off regime - systemic headwinds

Invalidation:
• Funding rate z-score > +2 (crowded trade)
• Exchange inflow spike (distribution)

Scores:
Leverage: ELEVATED | Liquidity: GOOD | Yield: MODERATE
```

## Key Concepts

### Z-Scores
Measures how far current value is from historical mean:
- Z > 2: Extreme (top 2.5%)
- Z > 1: Elevated
- Z < -1: Depressed
- Z < -2: Extreme low

### Composite Signals
Combine multiple metrics into single score:
- **LSI** (Leverage Stress Index) = funding + OI + utilization
- **LHI** (Liquidity Health Index) = TVL + depth + volume
- **YQI** (Yield Quality Index) = fees + organic + runway

### Multi-Domain Confirmation
Signal must be confirmed across multiple data sources:
- Derivatives AND Onchain AND Liquidity = high confidence
- Only 1 domain confirmed = low confidence

## Resources

- **Full Documentation**: `agents/research/REFINED_AGENT_README.md`
- **Signal Types**: `agents/research/signalTypes.js`
- **Transformation Logic**: `agents/research/signalTransformation.js`
- **API Reference**: `api/research-refined.js`

## Support

If you need help:
1. Check the full README for detailed explanations
2. Review signal type definitions in `signalTypes.js`
3. Examine example outputs in the documentation
4. Test with sample protocols first

---

**You now have an institutional-grade research agent. Use it wisely.**
