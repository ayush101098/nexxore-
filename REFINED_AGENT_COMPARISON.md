# Research Agent: Before vs After

## The Problem With "Ingest Everything"

### ❌ OLD APPROACH (Generic Research Bot)

```
Question: "Is AAVE a good opportunity?"

Output:
"AAVE has positive sentiment on Twitter. TVL is up 5%. 
Price increased 3% today. There are 42 news mentions this week.
Overall score: 73/100"
```

**Issues**:
- ❌ Vague "score" with no clear meaning
- ❌ No time horizon specified
- ❌ Conflating different signal types
- ❌ No risk context
- ❌ No invalidation criteria
- ❌ Can't tell HOW confident the signal is
- ❌ Doesn't answer a specific question

### ✅ NEW APPROACH (Institutional Research Analyst)

```
Asset: AAVE
Signal: CAUTIOUS LONG
Confidence: 72% (MEDIUM)
Time Horizon: 7d

Mathematical Objective:
P(price_7d > price_now | signals) = 0.68

✅ Drivers:
• Funding normalized from +0.08% to +0.02% (z=-1.2) - derisking
• Whale net flows: +$12M over 3d (z=+1.8) - accumulation
• Exchange outflows: -$45M (z=+2.1) - strong hands
• TVL +8% w/o new incentives - organic adoption

⚠️ Risks:
• Leverage stress ELEVATED (LSI=0.7) - monitor closely
• Market regime: RISK_OFF (85% confidence) - headwinds
• OI expanding +15% in 24h - watch for reversal

Invalidation (Exit if):
• Funding rate z-score > +2 (crowded long)
• Exchange inflows spike >$100M (distribution)
• Leverage stress → EXTREME

Composite Scores:
Leverage: ELEVATED | Liquidity: GOOD | Yield: MODERATE

Confirmation:
3/4 domains confirmed (derivatives ✅, onchain ✅, liquidity ✅, fundamentals ❌)
```

**Advantages**:
- ✅ Precise mathematical objective
- ✅ Probabilistic confidence
- ✅ Clear time horizon
- ✅ Specific drivers explained
- ✅ Risk factors identified
- ✅ Exit criteria defined
- ✅ Multi-domain confirmation
- ✅ Actionable in 10 seconds

## Feature Comparison

| Feature | Old Agent | Refined Agent |
|---------|-----------|---------------|
| **Signal Objective** | Vague "opportunity score" | Precise math question (P(price up), cascade risk, etc.) |
| **Data Organization** | By platform (Twitter, DeFiLlama) | By signal class (derivatives, onchain, liquidity, fundamentals) |
| **Normalization** | Raw values or simple % | Z-scores, percentile ranks, rate of change |
| **Composite Signals** | Weighted average | Domain-specific indices (LSI, LHI, YQI) |
| **Confirmation** | Single source sufficient | Multi-domain required |
| **Confidence** | Fixed or binary | Probabilistic (0-100%) with levels |
| **Regime Awareness** | None | Automatic risk suppression in RISK_OFF |
| **Output Format** | Technical dump | 10-second actionable format |
| **Time Horizon** | Unspecified | Explicit (3d, 7d, 30d) |
| **Invalidation** | None | Clear exit criteria |

## Signal Type Comparison

### OLD: Generic "Alpha Score"
```javascript
// Everything mixed together
const alphaScore = 
  0.25 × sentiment +
  0.25 × priceChange +
  0.25 × tvlChange +
  0.25 × newsCount;

// Output: 73/100
// Meaning: ??? (unclear)
```

### NEW: Signal Type Specific

#### Directional Alpha
```javascript
// Optimizes for: P(price_t+T > price_t)
const directionalAlpha = 
  0.35 × derivatives_score +  // Funding + OI
  0.30 × onchain_score +      // Whale flows
  0.20 × liquidity_score +    // TVL momentum
  0.15 × fundamentals_score;  // Fee growth

// Output: 0.68 probability of upward move
// Meaning: 68% chance price increases over 7d
```

#### Leverage Stress
```javascript
// Optimizes for: P(cascade | leverage state)
const leverageStress = 
  0.40 × funding_z +
  0.35 × oi_change_z +
  0.25 × borrow_util_z;

// Output: "ELEVATED" (LSI = 0.7)
// Meaning: Leverage building, watch for cascade
```

#### Yield Sustainability
```javascript
// Optimizes for: E[yield_t+T] adjusted for dilution
const yieldQuality = 
  0.45 × fees_ratio +      // Fees vs emissions
  0.35 × organic_growth +  // TVL growth attribution
  0.20 × runway;           // Sustainability

// Output: "MODERATE" (YQI = 0.58)
// Meaning: Some emissions dependency, monitor
```

## Data Collection Comparison

### OLD: Platform-Centric
```
Sources:
- Twitter API → sentiment
- CoinGecko → price
- DeFiLlama → TVL
- CoinDesk → news

Problem: Overlapping signals, redundant data
```

### NEW: Signal-Class Orthogonal
```
Signal Classes:
A. Price & Derivatives → market expectations
   - Funding rates, OI, volatility
   
B. Onchain Behavior → who is acting
   - Whale flows, exchange flows, addresses
   
C. Liquidity Structure → can price move?
   - TVL, depth, utilization
   
D. Fundamentals → sustainable?
   - Fees, revenue, emissions ratio

Benefit: No overlap, each class orthogonal
```

## Example: AAVE Analysis

### OLD OUTPUT
```
AAVE Analysis:

Sentiment: Positive (Twitter mentions +25%)
Price: +3.2% (24h)
TVL: $10.5B (+5% 7d)
News: 42 mentions this week
Market Cap Rank: #47

Alpha Score: 73/100
Recommendation: BUY

---
What does 73/100 mean? When to sell? What's the risk?
```

### NEW OUTPUT
```
Asset: AAVE
Signal Type: DIRECTIONAL_ALPHA
Action: CAUTIOUS LONG
Confidence: 72% (MEDIUM)
Time Horizon: 7d

Probability: 68% chance of upward move

✅ Drivers (why long):
• Funding normalized: +0.08% → +0.02% (z=-1.2)
  → Crowded longs exiting, derisking underway
  
• Whale accumulation: +$12M net flows over 3d (z=+1.8)
  → Strong hands accumulating
  
• Exchange outflows: -$45M (z=+2.1)
  → Tokens leaving exchanges = holding conviction
  
• TVL +8% without new incentives
  → Organic growth, not farming driven

⚠️ Risks (what could go wrong):
• Leverage stress ELEVATED (LSI=0.7)
  → Open interest rising fast, cascade risk building
  
• Market regime: RISK_OFF (85% confidence)
  → Systemic headwinds, defensive posture needed
  
• OI expanding +15% in 24h
  → Rapid leverage increase, watch for reversal

Invalidation (exit if):
• Funding rate z-score > +2 (crowded long)
• Exchange inflows spike >$100M/day (distribution)
• Leverage stress → EXTREME (LSI > 1.5)

Market Regime:
State: RISK_OFF
Impact: Headwinds for risk assets - long bias suppressed
Confidence: 85%

Composite Scores:
• Leverage Stress Index: ELEVATED (0.7)
• Liquidity Health Index: GOOD (0.6)
• Yield Quality Index: MODERATE (0.58)

Confirmation:
3/4 domains confirmed
✅ Derivatives: Funding normalizing, basis stable
✅ Onchain: Strong accumulation pattern
✅ Liquidity: TVL growing, depth stable
❌ Fundamentals: Fee growth slowing

Signal Strength: 0.68
Components:
• Derivatives: 0.45 (40% weight)
• Onchain: 0.72 (30% weight)
• Liquidity: 0.38 (20% weight)
• Fundamentals: -0.12 (15% weight)
```

## Key Improvements

### 1. Precise Objectives
**Before**: "Find good opportunities"
**After**: "What's P(price up over 7d)?" or "Is leverage stress building?"

### 2. Normalized Signals
**Before**: "Funding rate is 0.05%"
**After**: "Funding rate z-score is +2.1 (extreme high, crowded long)"

### 3. Multi-Domain Confirmation
**Before**: Twitter sentiment is positive → BUY
**After**: Derivatives + Onchain + Liquidity all confirm → HIGH confidence

### 4. Risk Awareness
**Before**: No regime context
**After**: RISK_OFF detected → suppress long signals automatically

### 5. Actionable Output
**Before**: Score of 73 (meaning unclear)
**After**: 68% probability, invalidation at funding z>2, exit if OI spikes

## Why This Matters

### OLD: Signal Bot
```
Input: "Check AAVE"
Output: "Score: 73/100, BUY"
User: "Okay but... why? For how long? What's the risk?"
```

### NEW: Research Analyst
```
Input: "Directional alpha for AAVE, 7-day horizon"

Output:
"68% probability of upward move based on:
- Funding derisking (z=-1.2)
- Whale accumulation (+$12M, z=+1.8)
- Exchange outflows (-$45M, z=+2.1)

Risks:
- Leverage building (LSI=0.7)
- Market is RISK_OFF

Exit if:
- Funding z>+2 or exchange inflows spike"

User: "Perfect, I know exactly what to do."
```

## Integration Benefits

### For Trading Agents
**Before**: Generic "buy signal" of unclear quality
**After**: Probabilistic signal with confidence, time horizon, and invalidation

### For Yield Agents
**Before**: "APY is 15%, looks good"
**After**: "Yield Quality: FRAGILE - 80% emissions, runway <3mo, vampire risk"

### For Risk Management
**Before**: No leverage monitoring
**After**: "Leverage Stress: EXTREME - cascade imminent, hedge now"

### For Users
**Before**: Black box with scores
**After**: Transparent reasoning with drivers, risks, and exits

## The Institutional Edge

This is how professional traders and quant funds operate:

1. **Precise objectives** (not vague opportunity hunting)
2. **Normalized signals** (z-scores, not raw values)
3. **Multi-factor models** (composite indices)
4. **Risk regime awareness** (don't fight the tape)
5. **Probabilistic thinking** (confidence scores, not certainty)
6. **Clear exits** (invalidation criteria defined upfront)

You now have this edge.

## Bottom Line

**OLD**: Research bot that ingests everything and outputs unclear "scores"

**NEW**: Onchain research analyst that answers precise mathematical questions with probabilistic confidence and actionable insights

This is the difference between:
- Amateur signal generation
- Institutional-grade alpha research

Choose wisely.
