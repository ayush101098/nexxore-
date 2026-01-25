# Refined Research Agent - Architecture & Usage

## Overview

The **Refined Research Agent** is an institutional-grade onchain research analyst that generates actionable signals with probabilistic confidence scoring. Unlike traditional research bots that ingest everything, this agent is optimized for specific, mathematical objectives.

## Core Philosophy

> **You're not building a signal bot. You're building an onchain research analyst.**

Every signal answers a precise mathematical question:
- **Directional Alpha**: `P(price_t+T > price_t | signals) - 0.5`
- **Leverage Stress**: `P(cascade liquidation | current leverage state)`
- **Liquidity Stress**: `P(price impact > threshold | desired size)`
- **Yield Sustainability**: `E[yield_t+T]` adjusted for dilution + risk

## Signal Types

### 1. Directional Alpha (Price Movement Probability)

**Objective**: Predict price direction over time horizon T

**Required Signals**:
- Funding rate (level + change)
- Open Interest delta
- Whale net flows
- TVL momentum

**Time Horizons**: 3d, 7d, 14d, 30d

**Invalidation Criteria**:
- Funding z-score > +2 (crowded trade)
- Exchange inflow spike (distribution)
- Leverage stress → EXTREME

### 2. Leverage Stress (Cascade Risk)

**Objective**: Detect probability of leverage-induced cascade

**Required Signals**:
- Funding rate z-score
- OI change rate
- Borrow utilization
- Liquidation levels

**Critical Thresholds**:
- Funding z > 2.0 = crowded
- Borrow utilization > 85% = stress
- OI expansion > 20%/day = unsustainable

**Time Horizons**: 24h, 48h, 7d

### 3. Liquidity Stress (Execution Risk)

**Objective**: Measure price impact probability

**Required Signals**:
- TVL delta
- Pool depth ratios
- Slippage estimates
- Volume profiles

**Critical Thresholds**:
- TVL decline > -15% (rapid)
- Depth ratio < 50% vs 30d avg
- Volume decline > -30%

**Time Horizons**: Intraday, 3d, 7d

### 4. Yield Sustainability (APY Quality)

**Objective**: Expected yield adjusted for dilution

**Required Signals**:
- Emissions ratio
- Fee growth rate
- Organic TVL growth
- Incentive runway

**Quality Metrics**:
- Fees > 30% of total yield = sustainable
- TVL growth > 50% organic
- Runway > 6 months

**Time Horizons**: 7d, 30d, 90d

## Data Architecture

### Orthogonal Signal Classes

Data is organized by **signal class**, not platform:

#### A. Price & Derivatives (Market Expectations)
**Use for**: Direction, leverage stress, reversals

**Metrics**:
- Funding rate (level + Δ)
- Open Interest delta
- Basis (perp vs spot)
- Realized volatility

**Platforms**: Coinglass, Binance API, Bybit, Hyperliquid

**Derived Signals**:
- `Crowded Trade` = Funding spike + flat price
- `Compression` = OI up + volatility down
- `Derisking` = OI down + funding neutral

#### B. Onchain Behavior (Who is Acting)
**Use for**: Conviction vs speculation

**Metrics**:
- Active address Δ (not absolute)
- Whale net flows
- Exchange inflow/outflow
- Stablecoin supply change

**Platforms**: Glassnode, CryptoQuant, Dune, DefiLlama

**Derived Signals**:
- `Distribution Risk` = Price up + exchange inflows up
- `Dry Powder Entry` = Stablecoin inflow spike
- `Strong Hands` = Whale accumulation + exchange outflows
- `Retail FOMO` = New addresses spike

#### C. Liquidity & DeFi Structure (Execution Realism)
**Use for**: Can price actually move?

**Metrics**:
- TVL delta (protocol + chain)
- Pool depth
- Slippage at size
- Borrow utilization

**Platforms**: DefiLlama, Aave/Compound subgraphs, Curve

**Derived Signals**:
- `Organic Adoption` = TVL rising faster than price
- `Leverage Stress` = High utilization + rising borrow rates
- `Liquidity Crisis` = TVL declining + depth declining

#### D. Protocol Fundamentals (Long-term Alpha)
**Use for**: Medium-term positioning

**Metrics**:
- Fee/revenue growth
- User retention
- Emissions vs fees ratio
- Incentive dependency

**Platforms**: Token Terminal, DefiLlama, Dune

**Derived Signals**:
- `Real Demand` = Fee growth + emissions flat
- `Fragile` = TVL growth purely from emissions
- `Vampire Risk` = High emissions + low runway

## Signal Transformation

### 1. Normalization

All metrics are normalized to be comparable:

**Z-Score**: How many standard deviations from mean
```javascript
Z = (current - mean_30d) / std_30d
```

**Interpretations**:
- Z > 2: Extreme high (97.5th percentile)
- Z > 1: Elevated
- Z < -1: Depressed
- Z < -2: Extreme low

**Rate of Change**: Momentum over time
```javascript
ROC = (current - previous) / previous
```

**Percentile Rank**: Position in universe
```javascript
rank = position / total_assets
```

### 2. Composite Signals

#### Leverage Stress Index (LSI)
```javascript
LSI = 
  0.40 × funding_z +
  0.35 × OI_change_z +
  0.25 × borrow_util_z
```

**Levels**:
- `EXTREME` (LSI > 1.5): Cascade imminent
- `HIGH` (LSI > 1.0): Elevated risk
- `ELEVATED` (LSI > 0.5): Watch closely
- `NORMAL` (LSI > -0.5): Healthy
- `LOW` (LSI < -0.5): Underlevered

#### Liquidity Health Index (LHI)
```javascript
LHI = 
  0.40 × tvl_momentum_z +
  0.35 × depth_ratio_z +
  0.25 × volume_consistency
```

**Levels**:
- `EXCELLENT` (LHI > 1.0)
- `GOOD` (LHI > 0.5)
- `ADEQUATE` (LHI > 0)
- `WEAK` (LHI > -1.0)
- `STRESSED` (LHI < -1.0)

#### Yield Quality Index (YQI)
```javascript
YQI = 
  0.45 × fees_ratio +
  0.35 × organic_growth +
  0.20 × sustainability
```

**Levels**:
- `SUSTAINABLE` (YQI > 0.75): Fee-driven
- `MODERATE` (YQI > 0.50): Balanced
- `FRAGILE` (YQI > 0.25): Emissions-dependent
- `UNSUSTAINABLE` (YQI < 0.25): Vampire risk

## Agent Pipeline

The agent follows a strict 7-step pipeline:

### Step 1: Regime Detection
**Question**: What's the market environment?

**Regimes**:
- `RISK_ON`: Volatility normalized, low correlation
- `RISK_OFF`: Volatility expanding, high correlation
- `COMPRESSION`: Low vol, volume declining (breakout risk)
- `TRANSITION`: Regime shifting, uncertainty elevated

**Impact**: 
- RISK_OFF → Suppress long signals
- COMPRESSION → Boost mean reversion signals

### Step 2: Collect Multi-Domain Signals
Fetch data from all 4 orthogonal classes:
- Derivatives
- Onchain
- Liquidity
- Fundamentals

### Step 3: Transform Signals
Convert raw metrics to normalized features:
- Z-scores for all metrics
- Composite indices (LSI, LHI, YQI)
- Directional alpha calculation

### Step 4: Analyze by Signal Type
Route to appropriate analysis:
- Directional Alpha → probability output
- Leverage Stress → level classification
- Liquidity Stress → health score
- Yield Sustainability → quality rating

### Step 5: Multi-Domain Confirmation
**Require confirmation across signal classes**

Example for Directional Long:
- ✅ Derivatives: Funding neutral/negative
- ✅ Onchain: Exchange outflows increasing
- ✅ Liquidity: TVL stable or rising
- ✅ Fundamentals: Fees not collapsing

Confirmation Rate = `confirmed_domains / 4`

### Step 6: Calculate Confidence
```javascript
Confidence = 
  0.50 × confirmation_rate +
  0.30 × data_quality +
  0.20 × signal_strength
  
// Apply regime adjustment
if (regime == RISK_OFF) confidence *= 0.7
if (regime == COMPRESSION) confidence *= 1.1
```

**Confidence Levels**:
- `HIGH` (≥0.75): Strong multi-domain confirmation
- `MEDIUM` (≥0.50): Moderate confirmation
- `LOW` (<0.50): Weak or conflicting signals

### Step 7: Generate Actionable Output
10-second readable format:
- Asset & signal action
- Confidence score & level
- Time horizon
- **Drivers** (why this signal?)
- **Risks** (what could go wrong?)
- **Invalidation criteria** (when to exit?)

## Output Format

### Example Signal Output

```json
{
  "asset": "AAVE",
  "signal": "CAUTIOUS LONG",
  "strength": 0.68,
  "confidence": 0.72,
  "confidenceLevel": "MEDIUM",
  "timeHorizon": "7d",
  
  "drivers": [
    "Funding normalized after spike - derisking underway",
    "Whale accumulation + exchange outflows - strong conviction",
    "TVL growing organically - real demand signal"
  ],
  
  "risks": [
    "Leverage stress ELEVATED - monitor closely",
    "Risk-off regime - systemic headwinds"
  ],
  
  "marketRegime": {
    "state": "RISK_OFF",
    "confidence": 0.85,
    "indicators": {
      "volatility": "expanding",
      "correlation": "high"
    },
    "impact": "Headwinds for risk assets"
  },
  
  "invalidation": [
    "Funding rate z-score > +2 (crowded trade)",
    "Exchange inflow spike (distribution)",
    "Leverage stress moves to EXTREME"
  ],
  
  "details": {
    "signalType": "DIRECTIONAL_ALPHA",
    "confirmation": {
      "rate": 0.75,
      "domains": {
        "derivatives": true,
        "onchain": true,
        "liquidity": true,
        "fundamentals": false
      }
    },
    "compositeScores": {
      "leverageStress": "ELEVATED",
      "liquidityHealth": "GOOD",
      "yieldQuality": "MODERATE"
    }
  }
}
```

## API Usage

### Get Signals for Type
```bash
GET /api/research/signals?type=DIRECTIONAL_ALPHA&limit=10
```

Returns top signals for specified type.

### Scan All Markets
```bash
POST /api/research/scan
{
  "signalType": "LEVERAGE_STRESS",
  "protocols": ["aave", "uniswap", "lido", ...]
}
```

Returns ranked signals with summary.

### Get Protocol Signal
```bash
GET /api/research/signal/aave?type=YIELD_SUSTAINABILITY&timeHorizon=30d
```

Returns detailed signal for specific protocol.

### Get Market Regime
```bash
GET /api/research/regime
```

Returns current market regime classification.

## Frontend Integration

### Dashboard Components

1. **Regime Banner**: Market environment indicator
2. **Signal Type Selector**: Choose signal type
3. **Signals Grid**: Card-based signal display
4. **Signal Cards**: 10-second actionable format

### Signal Card Structure

- **Header**: Asset + confidence badge
- **Action**: LONG/SHORT/MONITOR
- **Drivers**: Bullish/supportive factors (✅)
- **Risks**: What could go wrong (⚠️)
- **Invalidation**: Exit criteria
- **Composite Scores**: LSI, LHI, YQI pills

## File Structure

```
agents/research/
├── signalTypes.js           # Signal type definitions
├── signalTransformation.js  # Normalization & composites
├── orthogonalCollectors.js  # Data collectors by class
├── refinedResearchAgent.js  # Main agent pipeline
├── dataAggregator.js        # Existing data layer
└── featureEngineering.js    # Existing features

api/
└── research-refined.js      # API endpoints

js/components/
└── researchInsights.js      # Dashboard component

css/
└── researchInsights.css     # Dashboard styles
```

## Key Advantages

### 1. Precise Objectives
Every signal has a clear mathematical goal, not vague "insights".

### 2. Multi-Domain Confirmation
Requires cross-validation across signal classes. No single metric triggers trades.

### 3. Probabilistic Output
Confidence scoring tells you HOW certain the signal is.

### 4. Risk-Aware
Automatic suppression in risk-off regimes. Regime-adjusted confidence.

### 5. Actionable Format
10-second readability. Drivers, risks, and invalidation criteria included.

### 6. Institutional Thinking
This is how professional traders and quant funds operate.

## Integration with Nexxore

The research agent serves as:

1. **Upstream Intelligence**: Feeds trading agents
2. **Risk Gatekeeper**: Validates realloc/yield strategies
3. **Transparency Layer**: Shows users "why the agent acted"

It's your **information edge** before markets react.

## Next Steps

1. **Integrate real data collectors** (Coinglass, Glassnode, etc.)
2. **Backtest signals** on historical data
3. **Calibrate weights** based on performance
4. **Add more protocols** to monitoring universe
5. **Build alert system** for high-confidence signals
6. **Create portfolio view** showing position recommendations

## Notes

- All metrics are normalized for comparability
- Z-scores use 30-day rolling windows
- Confidence bands are calibrated for 50%+ accuracy
- Regime detection uses market-wide data, not per-asset
- Signal suppression prevents fighting the regime

---

**Remember**: Raw metrics are useless. You want normalized, comparable, actionable signals with confidence scores.

This is institutional-grade research.
