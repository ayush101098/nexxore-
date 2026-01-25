/**
 * Signal Type Definitions
 * Each signal type has a precise mathematical objective
 */

const SIGNAL_TYPES = {
    /**
     * Directional Alpha: Price up/down probability
     * Mathematical question: P(price_t+T > price_t | signals) - 0.5
     */
    DIRECTIONAL_ALPHA: {
        name: 'Directional Alpha',
        objective: 'Price movement probability over time horizon T',
        timeHorizons: ['3d', '7d', '14d', '30d'],
        requiredSignals: ['funding', 'oi_delta', 'whale_flows', 'tvl_momentum'],
        invalidation: {
            funding_z: { threshold: 2, direction: 'above' },
            exchange_inflow_spike: { threshold: 1.5, direction: 'above' }
        }
    },

    /**
     * Leverage Stress: System leverage fragility
     * Mathematical question: P(cascade liquidation | current leverage state)
     */
    LEVERAGE_STRESS: {
        name: 'Leverage Stress',
        objective: 'Probability of leverage-induced cascade',
        timeHorizons: ['24h', '48h', '7d'],
        requiredSignals: ['funding_rate', 'oi_change', 'borrow_utilization', 'liquidation_levels'],
        criticalThresholds: {
            funding_z: 2.0,          // 2 std above mean = crowded
            borrow_util: 0.85,       // 85% utilization = stress
            oi_expansion_rate: 0.20  // 20% daily growth = unsustainable
        }
    },

    /**
     * Liquidity Stress: When things break (execution failure risk)
     * Mathematical question: P(price impact > threshold | desired size)
     */
    LIQUIDITY_STRESS: {
        name: 'Liquidity Stress',
        objective: 'Execution risk and price impact probability',
        timeHorizons: ['intraday', '3d', '7d'],
        requiredSignals: ['tvl_delta', 'pool_depth', 'slippage_estimate', 'volume_profile'],
        criticalThresholds: {
            tvl_decline_rate: -0.15, // -15% rapid decline
            depth_ratio: 0.5,        // 50% depth vs 30d avg
            volume_decline: -0.30    // -30% volume contraction
        }
    },

    /**
     * Yield Sustainability: APY decay / farm exhaustion
     * Mathematical question: E[yield_t+T] adjusted for dilution + risk
     */
    YIELD_SUSTAINABILITY: {
        name: 'Yield Sustainability',
        objective: 'Expected yield adjusted for dilution and protocol health',
        timeHorizons: ['7d', '30d', '90d'],
        requiredSignals: ['emissions_ratio', 'fee_growth', 'tvl_organic', 'incentive_runway'],
        qualityMetrics: {
            fees_vs_emissions: 0.30,  // Fees should be >30% of total yield
            tvl_growth_organic: 0.50, // 50%+ growth without new incentives
            runway_months: 6          // Minimum incentive runway
        }
    },

    /**
     * Risk Regime Detection: Risk-on vs Risk-off
     * Mathematical question: Current market state classification
     */
    RISK_REGIME: {
        name: 'Risk Regime',
        objective: 'Classify current risk environment',
        states: ['RISK_ON', 'RISK_OFF', 'TRANSITION', 'COMPRESSION'],
        requiredSignals: ['volatility', 'correlation', 'volume_trend', 'stablecoin_flows'],
        regimeIndicators: {
            volatility_expansion: { threshold: 1.5, state: 'RISK_OFF' },
            volatility_compression: { threshold: 0.5, state: 'COMPRESSION' },
            correlation_high: { threshold: 0.8, state: 'RISK_OFF' },
            volume_spike: { threshold: 2.0, state: 'TRANSITION' }
        }
    }
};

/**
 * Signal Weights by Type
 * How much to trust each signal class for each objective
 */
const SIGNAL_WEIGHTS = {
    DIRECTIONAL_ALPHA: {
        derivatives: 0.35,    // Funding + OI = market expectations
        onchain: 0.30,        // Whale behavior = conviction
        liquidity: 0.20,      // TVL trends = organic adoption
        fundamentals: 0.15    // Fees/revenue = long-term support
    },
    
    LEVERAGE_STRESS: {
        derivatives: 0.50,    // Funding/OI = direct leverage signal
        onchain: 0.25,        // Borrow rates + utilization
        liquidity: 0.15,      // Depth degradation
        fundamentals: 0.10    // Protocol health = recovery ability
    },
    
    LIQUIDITY_STRESS: {
        derivatives: 0.15,    // Volume trends
        onchain: 0.20,        // Exchange flows
        liquidity: 0.50,      // TVL + depth = direct signal
        fundamentals: 0.15    // User retention
    },
    
    YIELD_SUSTAINABILITY: {
        derivatives: 0.10,    // Market pricing of risk
        onchain: 0.20,        // Real usage patterns
        liquidity: 0.25,      // TVL quality
        fundamentals: 0.45    // Fees vs emissions = core metric
    }
};

/**
 * Confidence Bands for Output
 * How certain are we about this signal?
 */
const CONFIDENCE_LEVELS = {
    HIGH: {
        threshold: 0.75,
        description: 'Strong multi-domain confirmation',
        color: '#22c55e',
        action: 'High conviction position'
    },
    MEDIUM: {
        threshold: 0.50,
        description: 'Moderate signal confirmation',
        color: '#f59e0b',
        action: 'Cautious position, monitor closely'
    },
    LOW: {
        threshold: 0.00,
        description: 'Weak or conflicting signals',
        color: '#ef4444',
        action: 'No position or hedge only'
    }
};

/**
 * Time Horizons for Signals
 * Different signals work on different timeframes
 */
const TIME_HORIZONS = {
    INTRADAY: { hours: 24, label: '24h', best_for: ['LEVERAGE_STRESS', 'LIQUIDITY_STRESS'] },
    SHORT: { hours: 72, label: '3d', best_for: ['DIRECTIONAL_ALPHA', 'RISK_REGIME'] },
    MEDIUM: { hours: 168, label: '7d', best_for: ['DIRECTIONAL_ALPHA', 'YIELD_SUSTAINABILITY'] },
    LONG: { hours: 720, label: '30d', best_for: ['YIELD_SUSTAINABILITY', 'fundamentals'] }
};

module.exports = {
    SIGNAL_TYPES,
    SIGNAL_WEIGHTS,
    CONFIDENCE_LEVELS,
    TIME_HORIZONS
};
