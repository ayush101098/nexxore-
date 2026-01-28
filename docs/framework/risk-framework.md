# Risk Framework

Overview of Nexxore's mathematical risk management methodology, including Sharpe Ratio optimization, Value at Risk (VaR), Conditional Value at Risk (CVaR), and drawdown controls.

---

## Overview

Nexxore differentiates itself through rigorous quantitative risk management. Every strategy is optimized not just for returns, but for risk-adjusted returns. The Risk Agent continuously monitors all positions and enforces strict limits.

---

## Core Risk Metrics

| Metric | Purpose | Nexxore Target |
|--------|---------|----------------|
| **Sharpe Ratio** | Risk-adjusted returns | > 2.0 |
| **Sortino Ratio** | Downside-adjusted returns | > 2.5 |
| **VaR (95%)** | Max daily loss threshold | < -3% |
| **CVaR (95%)** | Expected loss in tail events | < -5% |
| **Max Drawdown** | Largest peak-to-trough | < -10% |
| **Beta** | Market correlation | < 0.1 (DN strategies) |

---

## Sharpe Ratio

The Sharpe Ratio measures risk-adjusted returns, ensuring that returns justify the volatility taken.

### Formula

$$Sharpe = \frac{R_p - R_f}{\sigma_p}$$

**Where:**
- $R_p$ = Portfolio return
- $R_f$ = Risk-free rate
- $\sigma_p$ = Portfolio volatility (standard deviation)

### Interpretation

| Sharpe Ratio | Quality | Action |
|--------------|---------|--------|
| < 0 | Losing money | Avoid |
| 0 - 1.0 | Below average | Review strategy |
| 1.0 - 2.0 | Good | Acceptable |
| 2.0 - 3.0 | Very Good | Target range |
| > 3.0 | Excellent | Optimal |

**Nexxore Target:** All strategies must maintain Sharpe > 2.0

---

## Sortino Ratio

Unlike Sharpe, Sortino only penalizes downside volatility, making it more relevant for asymmetric return profiles.

### Formula

$$Sortino = \frac{R_p - R_f}{\sigma_d}$$

**Where:** $\sigma_d$ = Downside deviation (volatility of negative returns only)

### When to Use

| Ratio | Best For |
|-------|----------|
| Sharpe | Symmetric return distributions |
| Sortino | Strategies with positive skew, options-based approaches |

Nexxore uses both metrics for comprehensive risk assessment.

---

## Value at Risk (VaR)

VaR measures the maximum expected loss over a given time period at a specified confidence level.

### Definition

> "With 95% confidence, we will NOT lose more than X% over the specified time period."

### Example

**VaR (95%, 1 day) = -2.1%**

- 95% of days: Loss ≤ 2.1%
- 5% of days: Loss > 2.1% (tail risk)

### Limitations

VaR tells you the threshold but not what happens beyond it. This is why Nexxore primarily uses CVaR.

---

## Conditional Value at Risk (CVaR)

CVaR (also called Expected Shortfall) measures the average loss in the tail—what happens when things go wrong.

### Formula

$$CVaR_{\alpha} = E[L | L \ge VaR_{\alpha}]$$

### Why CVaR > VaR

| Metric | What It Tells You |
|--------|-------------------|
| VaR (95%) | "Loss won't exceed X, 95% of the time" |
| CVaR (95%) | "When losses DO exceed X, expect Y on average" |

CVaR is more conservative and captures tail risk better. Nexxore uses CVaR as the primary risk constraint.

### Risk Agent CVaR Enforcement

The Risk Agent monitors CVaR continuously:

| Condition | Action |
|-----------|--------|
| CVaR within limits | Normal operation |
| CVaR approaching limit (80%) | Warning alert |
| CVaR at limit (90%) | Reduce new position sizes |
| CVaR breached (100%) | Halt trading, force hedge |

---

## Maximum Drawdown

Maximum Drawdown (MDD) measures the largest peak-to-trough decline in portfolio value.

### Formula

$$MDD = \frac{Trough - Peak}{Peak} \times 100\%$$

### Drawdown Limits by Strategy

| Strategy Type | Max Drawdown | Recovery Time Target |
|---------------|--------------|----------------------|
| Conservative (DN) | -5% | < 30 days |
| Moderate | -10% | < 60 days |
| Aggressive | -20% | < 90 days |

---

## Beta & Correlation

### Portfolio Beta

Beta measures systematic risk—how much the portfolio moves relative to the market.

$$\beta_p = \frac{Cov(R_p, R_m)}{Var(R_m)}$$

### Interpretation

| Beta | Meaning |
|------|---------|
| β = 1.0 | Moves with the market |
| β > 1.0 | More volatile than market |
| β < 1.0 | Less volatile than market |
| β = 0 | Market neutral |
| β < 0 | Inverse correlation |

### Nexxore Targets

| Strategy | Target Beta |
|----------|-------------|
| Delta-Neutral | < 0.1 |
| Alpha Strategies | 0.3 - 0.7 |

---

## Risk-Adjusted Performance Comparison

| Strategy | APY | Volatility | Sharpe | Max DD | CVaR |
|----------|-----|------------|--------|--------|------|
| DN Yield | 12% | 3% | 2.67 | -3% | -2.1% |
| Moderate Alpha | 25% | 12% | 1.75 | -10% | -6.5% |
| Aggressive | 45% | 25% | 1.64 | -20% | -12.3% |
| HODL ETH | 35%* | 60% | 0.52 | -55% | -35% |

*Historical average, highly variable*

**Key Insight:** Higher returns ≠ better risk-adjusted returns. The DN Yield strategy has the best Sharpe despite lower APY.

---

## Risk Agent Implementation

The Risk Agent continuously monitors all metrics and takes automated action.

### Monitoring Frequency

| Check | Frequency |
|-------|-----------|
| Portfolio value | Every block (~12s) |
| Rolling volatility | Every block |
| VaR/CVaR recalculation | Every block |
| Drawdown from peak | Every block |
| Delta neutrality | Every block |

### Alert Levels

| Level | Threshold | Action |
|-------|-----------|--------|
| **Warning** | 80% of limit | Log alert, notify manager |
| **Caution** | 90% of limit | Reduce position sizes 50%, tighten stops |
| **Critical** | 100% of limit | Halt new positions, force hedge, emergency alert |

---

## Summary

Nexxore's risk framework ensures that all strategies maintain institutional-grade risk management:

1. **Sharpe > 2.0** — Returns must justify volatility
2. **CVaR-based limits** — Tail risk is actively managed
3. **Continuous monitoring** — Every block, every position
4. **Automated enforcement** — No human bottleneck in risk management

---

## Next Steps

- [Capital Flow & Lifecycle →](./capital-flow.md)
- [Delta Neutral Builder →](../products/delta-neutral.md)
- [Alpha Agent →](../agents/alpha-agent.md)
