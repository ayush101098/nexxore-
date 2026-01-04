/**
 * ML Feature Engineering Module
 * Creates features for alpha signal generation using quantitative analysis
 */

class FeatureEngineering {
    constructor() {
        // Feature weights for final scoring (tuned based on backtesting)
        this.featureWeights = {
            // TVL Features (25%)
            tvlMomentum: 0.08,
            tvlAcceleration: 0.05,
            tvlConcentration: 0.04,
            tvlStability: 0.04,
            tvlRank: 0.04,
            
            // Market Features (20%)
            priceStrength: 0.06,
            volumeMomentum: 0.05,
            marketCapEfficiency: 0.05,
            relativeStrength: 0.04,
            
            // Yield Features (15%)
            yieldAttractiveness: 0.06,
            yieldSustainability: 0.05,
            yieldRiskAdjusted: 0.04,
            
            // Revenue Features (15%)
            revenueGrowth: 0.06,
            feeEfficiency: 0.05,
            revenueQuality: 0.04,
            
            // Technical Features (10%)
            trendStrength: 0.04,
            meanReversion: 0.03,
            volatilityAdjusted: 0.03,
            
            // Sentiment Features (10%)
            marketSentiment: 0.04,
            categoryMomentum: 0.03,
            narrativeStrength: 0.03,
            
            // Risk Features (5%)
            riskScore: 0.03,
            liquidityRisk: 0.02
        };
        
        // Category momentum weights
        this.hotCategories = {
            'restaking': 1.25,
            'liquid-staking': 1.15,
            'rwa': 1.20,
            'perps': 1.10,
            'lending': 1.05,
            'yield': 1.08,
            'dex': 1.0,
            'cdp': 0.95,
            'bridge': 0.90
        };
    }

    /**
     * Calculate TVL-based features
     */
    calculateTvlFeatures(protocol, allProtocols) {
        const features = {};
        
        // TVL Momentum: Rate of change in TVL
        const tvlChange1d = protocol.tvlChange1d || 0;
        const tvlChange7d = protocol.tvlChange7d || 0;
        const tvlChange1m = protocol.tvlChange1m || 0;
        
        // Momentum score: weighted average of different timeframes
        features.tvlMomentum = this.normalize(
            (tvlChange1d * 0.5) + (tvlChange7d * 0.3) + (tvlChange1m * 0.2),
            -20, 50
        );
        
        // TVL Acceleration: Change in the rate of change
        const shortTermMomentum = tvlChange1d - (tvlChange7d / 7);
        features.tvlAcceleration = this.normalize(shortTermMomentum, -5, 10);
        
        // TVL Concentration: Share of category TVL
        const categoryProtocols = allProtocols.filter(p => p.category === protocol.category);
        const categoryTvl = categoryProtocols.reduce((s, p) => s + p.tvl, 0);
        features.tvlConcentration = categoryTvl > 0 
            ? Math.min(protocol.tvl / categoryTvl, 1) 
            : 0;
        
        // TVL Stability: Low variance indicator (inverse of volatility)
        const tvlVolatility = Math.abs(tvlChange1d - tvlChange7d/7);
        features.tvlStability = this.normalize(10 - tvlVolatility, 0, 10);
        
        // TVL Rank Score
        const tvlRank = allProtocols.findIndex(p => p.id === protocol.id) + 1;
        features.tvlRank = this.normalize(100 - tvlRank, 0, 100);
        
        return features;
    }

    /**
     * Calculate market-based features
     */
    calculateMarketFeatures(market) {
        if (!market) return this.getDefaultMarketFeatures();
        
        const features = {};
        
        // Price Strength: Multi-timeframe price momentum
        const priceScore = (
            (market.priceChange1h || 0) * 0.1 +
            (market.priceChange24h || 0) * 0.3 +
            (market.priceChange7d || 0) * 0.3 +
            (market.priceChange30d || 0) * 0.3
        );
        features.priceStrength = this.normalize(priceScore, -30, 50);
        
        // Volume Momentum: Volume relative to market cap
        const volumeToMcap = market.marketCap > 0 
            ? (market.volume24h / market.marketCap) * 100 
            : 0;
        features.volumeMomentum = this.normalize(volumeToMcap, 0, 20);
        
        // Market Cap Efficiency: How well capital is being utilized
        const mcapToFdv = market.fdv > 0 ? (market.marketCap / market.fdv) : 1;
        features.marketCapEfficiency = mcapToFdv;
        
        // Relative Strength: Distance from ATH (opportunity indicator)
        const athDistance = Math.abs(market.athChangePercent || 0);
        features.relativeStrength = this.normalize(100 - Math.min(athDistance, 100), 0, 100);
        
        // Sparkline analysis for trend
        if (market.sparkline && market.sparkline.length > 10) {
            features.sparklineTrend = this.analyzeSparkline(market.sparkline);
        }
        
        return features;
    }

    /**
     * Calculate yield-based features
     */
    calculateYieldFeatures(yields) {
        if (!yields || yields.pools === 0) return this.getDefaultYieldFeatures();
        
        const features = {};
        
        // Yield Attractiveness: Risk-adjusted yield score
        const riskFreeRate = 5; // Assume 5% risk-free rate
        const excessYield = yields.avgApy - riskFreeRate;
        features.yieldAttractiveness = this.normalize(excessYield, 0, 50);
        
        // Yield Sustainability: Based on mean reversion signals
        const topPool = yields.topPool;
        if (topPool) {
            const apyDeviation = topPool.apy - (topPool.apyMean30d || topPool.apy);
            features.yieldSustainability = this.normalize(10 - Math.abs(apyDeviation), 0, 10);
        } else {
            features.yieldSustainability = 0.5;
        }
        
        // Risk-Adjusted Yield: Sharpe-like ratio
        const sigma = topPool?.sigma || 20;
        const sharpeProxy = sigma > 0 ? excessYield / sigma : 0;
        features.yieldRiskAdjusted = this.normalize(sharpeProxy, 0, 2);
        
        return features;
    }

    /**
     * Calculate revenue-based features
     */
    calculateRevenueFeatures(fees, volume, tvl) {
        const features = {};
        
        const fees24h = fees?.fees24h || 0;
        const volume24h = volume?.volume24h || 0;
        const feesChange = fees?.feesChange || 0;
        
        // Revenue Growth
        features.revenueGrowth = this.normalize(feesChange, -30, 50);
        
        // Fee Efficiency: Fees generated per TVL
        const feeToTvl = tvl > 0 ? (fees24h * 365 / tvl) * 100 : 0;
        features.feeEfficiency = this.normalize(feeToTvl, 0, 30);
        
        // Revenue Quality: Fees to volume ratio (take rate)
        const takeRate = volume24h > 0 ? (fees24h / volume24h) * 100 : 0;
        features.revenueQuality = this.normalize(takeRate, 0, 1);
        
        return features;
    }

    /**
     * Calculate technical analysis features
     */
    calculateTechnicalFeatures(market) {
        if (!market?.sparkline || market.sparkline.length < 14) {
            return this.getDefaultTechnicalFeatures();
        }
        
        const prices = market.sparkline;
        const features = {};
        
        // Trend Strength: Linear regression slope
        features.trendStrength = this.calculateTrendStrength(prices);
        
        // Mean Reversion Signal: Distance from moving average
        const ma = this.calculateMA(prices, 24);
        const currentPrice = prices[prices.length - 1];
        const deviation = ((currentPrice - ma) / ma) * 100;
        features.meanReversion = this.normalize(5 - Math.abs(deviation), -10, 10);
        
        // Volatility-Adjusted Returns
        const returns = this.calculateReturns(prices);
        const volatility = this.calculateStdDev(returns);
        const avgReturn = returns.reduce((s, r) => s + r, 0) / returns.length;
        features.volatilityAdjusted = volatility > 0 
            ? this.normalize(avgReturn / volatility, -2, 2) 
            : 0.5;
        
        // RSI-like momentum
        features.rsiMomentum = this.calculateRSI(prices);
        
        return features;
    }

    /**
     * Calculate sentiment features
     */
    calculateSentimentFeatures(fearGreed, category, categoryData) {
        const features = {};
        
        // Market Sentiment from Fear & Greed
        const fg = fearGreed?.current || 50;
        const fgTrend = fearGreed?.trend || 0;
        features.marketSentiment = this.normalize(fg + (fgTrend * 0.5), 0, 100);
        
        // Category Momentum: Hot categories get boost
        const categoryMultiplier = this.hotCategories[category] || 1.0;
        features.categoryMomentum = categoryMultiplier;
        
        // Narrative Strength: Based on category trends
        if (categoryData && categoryData[category]) {
            const catAvgChange = categoryData[category].avgChange || 0;
            features.narrativeStrength = this.normalize(catAvgChange, -10, 20);
        } else {
            features.narrativeStrength = 0.5;
        }
        
        return features;
    }

    /**
     * Calculate risk features
     */
    calculateRiskFeatures(protocol, market, yields) {
        const features = {};
        
        // Audit score
        const hasAudit = protocol.audits && protocol.audits > 0;
        
        // Age score (older = safer, but diminishing returns)
        const ageMonths = protocol.listedAt 
            ? (Date.now() / 1000 - protocol.listedAt) / (30 * 24 * 3600)
            : 12;
        const ageFactor = Math.min(ageMonths / 24, 1); // Max score at 2 years
        
        // Chain diversification
        const chainCount = (protocol.chains || []).length;
        const chainFactor = Math.min(chainCount / 5, 1);
        
        // IL Risk from yields
        const ilRisk = yields?.topPool?.ilRisk || 'no';
        const ilFactor = ilRisk === 'no' ? 1 : (ilRisk === 'yes' ? 0.5 : 0.75);
        
        // Combined risk score (higher = lower risk = better)
        features.riskScore = (
            (hasAudit ? 0.3 : 0) +
            (ageFactor * 0.3) +
            (chainFactor * 0.2) +
            (ilFactor * 0.2)
        );
        
        // Liquidity Risk
        const liquidityUsd = market?.volume24h || 0;
        features.liquidityRisk = this.normalize(
            Math.log10(Math.max(liquidityUsd, 1)),
            4, 9 // $10K to $1B volume
        );
        
        return features;
    }

    /**
     * Generate all features for a protocol
     */
    async generateFeatures(protocolData, marketOverview) {
        const { protocol, yields, volume, fees, market, mapping } = protocolData;
        const allProtocols = marketOverview?.topProtocols || [];
        const fearGreed = marketOverview?.sentiment;
        const categories = marketOverview?.categories;
        
        const tvlFeatures = this.calculateTvlFeatures(protocol, allProtocols);
        const marketFeatures = this.calculateMarketFeatures(market);
        const yieldFeatures = this.calculateYieldFeatures(yields);
        const revenueFeatures = this.calculateRevenueFeatures(fees, volume, protocol.tvl);
        const technicalFeatures = this.calculateTechnicalFeatures(market);
        const sentimentFeatures = this.calculateSentimentFeatures(
            fearGreed, mapping.category, categories
        );
        const riskFeatures = this.calculateRiskFeatures(protocol, market, yields);
        
        return {
            tvl: tvlFeatures,
            market: marketFeatures,
            yield: yieldFeatures,
            revenue: revenueFeatures,
            technical: technicalFeatures,
            sentiment: sentimentFeatures,
            risk: riskFeatures
        };
    }

    /**
     * Calculate final alpha score from features
     */
    calculateAlphaScore(features) {
        let score = 0;
        let totalWeight = 0;
        
        // Flatten features
        const flatFeatures = {};
        Object.values(features).forEach(group => {
            Object.assign(flatFeatures, group);
        });
        
        // Calculate weighted score
        for (const [feature, weight] of Object.entries(this.featureWeights)) {
            const value = flatFeatures[feature];
            if (typeof value === 'number' && !isNaN(value)) {
                score += value * weight;
                totalWeight += weight;
            }
        }
        
        // Normalize to 0-100
        const normalizedScore = totalWeight > 0 
            ? (score / totalWeight) * 100 
            : 50;
        
        return Math.max(0, Math.min(100, normalizedScore));
    }

    /**
     * Get feature importance breakdown
     */
    getFeatureBreakdown(features) {
        const flatFeatures = {};
        Object.entries(features).forEach(([category, group]) => {
            Object.entries(group).forEach(([name, value]) => {
                flatFeatures[name] = {
                    value,
                    category,
                    weight: this.featureWeights[name] || 0,
                    contribution: (value || 0) * (this.featureWeights[name] || 0)
                };
            });
        });
        
        return Object.entries(flatFeatures)
            .sort((a, b) => b[1].contribution - a[1].contribution)
            .map(([name, data]) => ({
                name,
                ...data
            }));
    }

    // ==================== Helper Functions ====================

    normalize(value, min, max) {
        if (max === min) return 0.5;
        return Math.max(0, Math.min(1, (value - min) / (max - min)));
    }

    calculateMA(prices, period) {
        if (prices.length < period) return prices[prices.length - 1];
        const recent = prices.slice(-period);
        return recent.reduce((s, p) => s + p, 0) / period;
    }

    calculateReturns(prices) {
        const returns = [];
        for (let i = 1; i < prices.length; i++) {
            returns.push((prices[i] - prices[i-1]) / prices[i-1]);
        }
        return returns;
    }

    calculateStdDev(values) {
        if (values.length < 2) return 0;
        const mean = values.reduce((s, v) => s + v, 0) / values.length;
        const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
        return Math.sqrt(squaredDiffs.reduce((s, v) => s + v, 0) / values.length);
    }

    calculateTrendStrength(prices) {
        if (prices.length < 7) return 0.5;
        
        // Simple linear regression
        const n = prices.length;
        const x = Array.from({length: n}, (_, i) => i);
        const sumX = x.reduce((s, v) => s + v, 0);
        const sumY = prices.reduce((s, v) => s + v, 0);
        const sumXY = x.reduce((s, v, i) => s + v * prices[i], 0);
        const sumX2 = x.reduce((s, v) => s + v * v, 0);
        
        const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
        const avgPrice = sumY / n;
        const normalizedSlope = avgPrice !== 0 ? (slope / avgPrice) * 100 : 0;
        
        return this.normalize(normalizedSlope, -5, 5);
    }

    calculateRSI(prices, period = 14) {
        if (prices.length < period + 1) return 0.5;
        
        const changes = this.calculateReturns(prices.slice(-period - 1));
        const gains = changes.filter(c => c > 0);
        const losses = changes.filter(c => c < 0).map(Math.abs);
        
        const avgGain = gains.length > 0 ? gains.reduce((s, g) => s + g, 0) / period : 0;
        const avgLoss = losses.length > 0 ? losses.reduce((s, l) => s + l, 0) / period : 0;
        
        if (avgLoss === 0) return 1;
        const rs = avgGain / avgLoss;
        const rsi = 100 - (100 / (1 + rs));
        
        return this.normalize(rsi, 30, 70); // Normalize to favor neutral RSI
    }

    analyzeSparkline(prices) {
        if (prices.length < 20) return 0.5;
        
        const recent = prices.slice(-24); // Last 24 hours
        const older = prices.slice(-48, -24); // Previous 24 hours
        
        const recentAvg = recent.reduce((s, p) => s + p, 0) / recent.length;
        const olderAvg = older.reduce((s, p) => s + p, 0) / older.length;
        
        const trendChange = ((recentAvg - olderAvg) / olderAvg) * 100;
        return this.normalize(trendChange, -10, 10);
    }

    getDefaultMarketFeatures() {
        return {
            priceStrength: 0.5,
            volumeMomentum: 0.5,
            marketCapEfficiency: 0.5,
            relativeStrength: 0.5
        };
    }

    getDefaultYieldFeatures() {
        return {
            yieldAttractiveness: 0.5,
            yieldSustainability: 0.5,
            yieldRiskAdjusted: 0.5
        };
    }

    getDefaultTechnicalFeatures() {
        return {
            trendStrength: 0.5,
            meanReversion: 0.5,
            volatilityAdjusted: 0.5,
            rsiMomentum: 0.5
        };
    }
}

module.exports = { FeatureEngineering };
