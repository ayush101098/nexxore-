/**
 * Signal Transformation Layer
 * Normalizes raw metrics into comparable, actionable signals
 * 
 * Key principle: Raw metrics are useless. We need:
 * 1. Z-scores (relative to history)
 * 2. Rate of change (momentum)
 * 3. Percentile ranks (cross-asset comparison)
 * 4. Composite indices (multi-metric scores)
 */

class SignalTransformation {
    constructor() {
        // Historical data storage for z-score calculation
        this.historicalData = new Map();
        this.lookbackPeriods = {
            short: 7,   // 7 days
            medium: 30, // 30 days
            long: 90    // 90 days
        };
    }

    /**
     * Calculate Z-Score: How many standard deviations from mean
     * Z = (current - mean) / std_dev
     * 
     * Z > 2  = extreme high (97.5th percentile)
     * Z > 1  = elevated
     * Z < -1 = depressed
     * Z < -2 = extreme low
     */
    calculateZScore(current, historicalValues) {
        if (!historicalValues || historicalValues.length < 2) {
            return 0;
        }

        const mean = this._mean(historicalValues);
        const stdDev = this._stdDev(historicalValues, mean);
        
        if (stdDev === 0) return 0;
        
        const zScore = (current - mean) / stdDev;
        return Math.max(-3, Math.min(3, zScore)); // Clamp to [-3, 3]
    }

    /**
     * Calculate Rate of Change
     * ROC = (current - previous) / previous
     */
    calculateRateOfChange(current, previous, period = '1d') {
        if (!previous || previous === 0) return 0;
        return (current - previous) / Math.abs(previous);
    }

    /**
     * Calculate Percentile Rank across universe
     * Where does this asset rank vs all others?
     */
    calculatePercentileRank(value, allValues) {
        if (!allValues || allValues.length === 0) return 0.5;
        
        const sorted = [...allValues].sort((a, b) => a - b);
        const index = sorted.findIndex(v => v >= value);
        
        if (index === -1) return 1.0;
        return index / sorted.length;
    }

    /**
     * Normalize to [0, 1] range
     */
    normalize(value, min, max) {
        if (max === min) return 0.5;
        return Math.max(0, Math.min(1, (value - min) / (max - min)));
    }

    /**
     * Build Composite Signals
     * Combine multiple metrics into single actionable score
     */

    /**
     * Leverage Stress Index
     * LSI = w1*funding_z + w2*OI_change_z + w3*borrow_util_z
     */
    calculateLeverageStressIndex(signals) {
        const weights = {
            funding: 0.40,
            oiChange: 0.35,
            borrowUtil: 0.25
        };

        const fundingZ = this.calculateZScore(
            signals.fundingRate,
            signals.fundingHistory || []
        );
        
        const oiChangeZ = this.calculateZScore(
            signals.oiChange,
            signals.oiChangeHistory || []
        );
        
        const borrowUtilZ = this.calculateZScore(
            signals.borrowUtilization || 0,
            signals.borrowUtilHistory || []
        );

        const lsi = 
            weights.funding * fundingZ +
            weights.oiChange * oiChangeZ +
            weights.borrowUtil * borrowUtilZ;

        return {
            score: lsi,
            level: this._getLeverageStressLevel(lsi),
            components: {
                funding: { value: signals.fundingRate, z: fundingZ },
                oiChange: { value: signals.oiChange, z: oiChangeZ },
                borrowUtil: { value: signals.borrowUtilization, z: borrowUtilZ }
            }
        };
    }

    /**
     * Liquidity Health Index
     * LHI = w1*tvl_momentum + w2*depth_ratio + w3*volume_consistency
     */
    calculateLiquidityHealthIndex(signals) {
        const weights = {
            tvlMomentum: 0.40,
            depthRatio: 0.35,
            volumeConsistency: 0.25
        };

        const tvlMomentumZ = this.calculateZScore(
            signals.tvlChange || 0,
            signals.tvlHistory || []
        );

        const depthRatio = signals.currentDepth / (signals.avgDepth30d || signals.currentDepth || 1);
        const depthZ = this.calculateZScore(depthRatio, [0.8, 0.9, 1.0, 1.1, 1.2]);

        const volumeCV = signals.volumeStdDev / (signals.volumeMean || 1); // Coefficient of variation
        const volumeConsistency = 1 / (1 + volumeCV); // Lower CV = higher consistency

        const lhi = 
            weights.tvlMomentum * tvlMomentumZ +
            weights.depthRatio * depthZ +
            weights.volumeConsistency * this.normalize(volumeConsistency, 0, 1);

        return {
            score: lhi,
            level: this._getLiquidityHealthLevel(lhi),
            components: {
                tvlMomentum: { z: tvlMomentumZ },
                depthRatio: { value: depthRatio, z: depthZ },
                volumeConsistency: { value: volumeConsistency }
            }
        };
    }

    /**
     * Yield Quality Index
     * YQI = w1*fees_ratio + w2*organic_growth + w3*sustainability
     */
    calculateYieldQualityIndex(signals) {
        const weights = {
            feesRatio: 0.45,      // Fees vs emissions
            organicGrowth: 0.35,  // TVL growth without new incentives
            sustainability: 0.20   // Runway + protocol health
        };

        // Fees as % of total yield
        const feesRatio = signals.feesApy / (signals.totalApy || signals.feesApy || 1);
        const feesScore = this.normalize(feesRatio, 0, 1);

        // TVL growth attribution
        const organicGrowthRate = signals.tvlChangeOrganic || 0;
        const organicScore = this.normalize(organicGrowthRate, -0.1, 0.3); // -10% to +30%

        // Sustainability: runway in months
        const runwayMonths = signals.incentiveRunway || 0;
        const sustainabilityScore = this.normalize(runwayMonths, 0, 12); // 0-12 months

        const yqi = 
            weights.feesRatio * feesScore +
            weights.organicGrowth * organicScore +
            weights.sustainability * sustainabilityScore;

        return {
            score: yqi,
            level: this._getYieldQualityLevel(yqi),
            components: {
                feesRatio: { value: feesRatio, score: feesScore },
                organicGrowth: { value: organicGrowthRate, score: organicScore },
                sustainability: { runway: runwayMonths, score: sustainabilityScore }
            }
        };
    }

    /**
     * Directional Alpha Score
     * Multi-factor model combining derivatives, onchain, and fundamentals
     */
    calculateDirectionalAlpha(signals) {
        const weights = {
            derivatives: 0.35,
            onchain: 0.30,
            liquidity: 0.20,
            fundamentals: 0.15
        };

        // Derivatives signal: funding + OI
        const fundingSignal = -this.calculateZScore(signals.fundingRate, signals.fundingHistory || []);
        const oiSignal = this.calculateZScore(signals.oiChange, signals.oiHistory || []);
        const derivativesScore = (fundingSignal * 0.6 + oiSignal * 0.4);

        // Onchain signal: whale flows + exchange flows
        const whaleFlowsZ = this.calculateZScore(signals.whaleNetFlows || 0, signals.whaleHistory || []);
        const exchangeOutflowZ = this.calculateZScore(signals.exchangeNetFlows || 0, signals.exchangeHistory || []);
        const onchainScore = (whaleFlowsZ * 0.5 + exchangeOutflowZ * 0.5);

        // Liquidity signal: TVL momentum
        const tvlMomentumZ = this.calculateZScore(signals.tvlChange || 0, signals.tvlHistory || []);
        const liquidityScore = tvlMomentumZ;

        // Fundamentals: fee growth
        const feeGrowthZ = this.calculateZScore(signals.feeGrowth || 0, signals.feeHistory || []);
        const fundamentalsScore = feeGrowthZ;

        const alphaScore = 
            weights.derivatives * derivativesScore +
            weights.onchain * onchainScore +
            weights.liquidity * liquidityScore +
            weights.fundamentals * fundamentalsScore;

        // Convert z-score to probability (sigmoid-like transformation)
        const probability = this._zScoreToProb(alphaScore);

        return {
            score: alphaScore,
            probability: probability,
            direction: alphaScore > 0 ? 'LONG' : 'SHORT',
            strength: Math.abs(alphaScore),
            components: {
                derivatives: { score: derivativesScore, weight: weights.derivatives },
                onchain: { score: onchainScore, weight: weights.onchain },
                liquidity: { score: liquidityScore, weight: weights.liquidity },
                fundamentals: { score: fundamentalsScore, weight: weights.fundamentals }
            }
        };
    }

    /**
     * Regime Detection
     * Classify current market state
     */
    detectRegime(signals) {
        const volatilityZ = this.calculateZScore(
            signals.volatility,
            signals.volatilityHistory || []
        );
        
        const correlationZ = this.calculateZScore(
            signals.assetCorrelation || 0.5,
            signals.correlationHistory || []
        );

        const volumeZ = this.calculateZScore(
            signals.volume,
            signals.volumeHistory || []
        );

        // Regime classification logic
        if (volatilityZ > 1.5) {
            return {
                regime: 'RISK_OFF',
                confidence: Math.min(volatilityZ / 3, 1),
                indicators: { volatility: 'expanding', correlation: correlationZ > 0.8 ? 'high' : 'moderate' }
            };
        }

        if (volatilityZ < -1.0 && volumeZ < 0) {
            return {
                regime: 'COMPRESSION',
                confidence: Math.min(Math.abs(volatilityZ) / 3, 1),
                indicators: { volatility: 'compressing', volume: 'declining', breakout_risk: 'high' }
            };
        }

        if (correlationZ > 1.5) {
            return {
                regime: 'RISK_OFF',
                confidence: Math.min(correlationZ / 3, 1),
                indicators: { correlation: 'extreme', risk: 'systemic' }
            };
        }

        if (volatilityZ > 0.5 || volumeZ > 1.0) {
            return {
                regime: 'TRANSITION',
                confidence: 0.6,
                indicators: { volatility: 'elevated', volume: volumeZ > 1 ? 'surging' : 'normal' }
            };
        }

        return {
            regime: 'RISK_ON',
            confidence: 0.7,
            indicators: { volatility: 'normalized', correlation: 'low', environment: 'constructive' }
        };
    }

    // Helper functions

    _mean(values) {
        return values.reduce((sum, v) => sum + v, 0) / values.length;
    }

    _stdDev(values, mean) {
        const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
        return Math.sqrt(variance);
    }

    _zScoreToProb(z) {
        // Sigmoid-like transformation: prob = 0.5 + 0.4 * tanh(z/2)
        // Maps [-3, 3] to roughly [0.1, 0.9]
        return 0.5 + 0.4 * Math.tanh(z / 2);
    }

    _getLeverageStressLevel(lsi) {
        if (lsi > 1.5) return 'EXTREME';
        if (lsi > 1.0) return 'HIGH';
        if (lsi > 0.5) return 'ELEVATED';
        if (lsi > -0.5) return 'NORMAL';
        return 'LOW';
    }

    _getLiquidityHealthLevel(lhi) {
        if (lhi > 1.0) return 'EXCELLENT';
        if (lhi > 0.5) return 'GOOD';
        if (lhi > 0) return 'ADEQUATE';
        if (lhi > -1.0) return 'WEAK';
        return 'STRESSED';
    }

    _getYieldQualityLevel(yqi) {
        if (yqi > 0.75) return 'SUSTAINABLE';
        if (yqi > 0.5) return 'MODERATE';
        if (yqi > 0.25) return 'FRAGILE';
        return 'UNSUSTAINABLE';
    }
}

module.exports = { SignalTransformation };
