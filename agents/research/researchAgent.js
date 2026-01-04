/**
 * Research Analyst Agent
 * AI-powered signal generation with ML features and conviction scoring
 */

const { dataAggregator, PROTOCOL_MAPPINGS } = require('./dataAggregator');
const { FeatureEngineering } = require('./featureEngineering');

class ResearchAnalystAgent {
    constructor() {
        this.featureEngine = new FeatureEngineering();
        this.signalHistory = [];
        this.analysisCache = new Map();
        this.cacheExpiry = 10 * 60 * 1000; // 10 minutes
        
        // Signal thresholds
        this.thresholds = {
            strongBuy: 80,
            buy: 65,
            hold: 45,
            sell: 30
        };
        
        // Conviction confidence bands
        this.confidenceBands = {
            high: { min: 0.75, color: 'green' },
            medium: { min: 0.50, color: 'yellow' },
            low: { min: 0, color: 'red' }
        };
    }

    /**
     * Analyze a single protocol and generate signal
     */
    async analyzeProtocol(protocolSlug) {
        // Check cache
        const cached = this.analysisCache.get(protocolSlug);
        if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
            return cached.analysis;
        }

        try {
            // Fetch comprehensive data
            const [protocolData, marketOverview] = await Promise.all([
                dataAggregator.aggregateProtocolData(protocolSlug),
                dataAggregator.getMarketOverview()
            ]);

            if (!protocolData?.protocol) {
                return this.createErrorAnalysis(protocolSlug, 'Protocol not found');
            }

            // Generate ML features
            const features = await this.featureEngine.generateFeatures(
                protocolData, 
                marketOverview
            );

            // Calculate alpha score
            const alphaScore = this.featureEngine.calculateAlphaScore(features);
            
            // Get feature breakdown for explainability
            const featureBreakdown = this.featureEngine.getFeatureBreakdown(features);
            
            // Calculate conviction and confidence
            const { conviction, confidence } = this.calculateConviction(
                alphaScore, features, protocolData
            );
            
            // Generate signal
            const signal = this.generateSignal(alphaScore, conviction, confidence);
            
            // Create analysis object
            const analysis = {
                protocol: {
                    id: protocolSlug,
                    name: protocolData.protocol.name,
                    symbol: protocolData.mapping.symbol,
                    category: protocolData.mapping.category,
                    tvl: protocolData.protocol.tvl,
                    price: protocolData.market?.price,
                    priceChange24h: protocolData.market?.priceChange24h
                },
                signal: {
                    action: signal.action,
                    strength: signal.strength,
                    alphaScore,
                    conviction,
                    confidence,
                    confidenceLevel: this.getConfidenceLevel(confidence)
                },
                features: {
                    summary: this.getFeatureSummary(features),
                    breakdown: featureBreakdown.slice(0, 10), // Top 10 contributors
                    raw: features
                },
                metrics: {
                    tvlChange1d: protocolData.protocol.tvlChange1d,
                    tvlChange7d: protocolData.protocol.tvlChange7d,
                    maxApy: protocolData.yields?.maxApy,
                    avgApy: protocolData.yields?.avgApy,
                    volume24h: protocolData.volume?.volume24h,
                    fees24h: protocolData.fees?.fees24h
                },
                market: {
                    fearGreed: marketOverview?.sentiment?.fearGreed,
                    sentiment: marketOverview?.sentiment?.classification,
                    categoryTrend: marketOverview?.categories?.[protocolData.mapping.category]?.avgChange
                },
                reasoning: this.generateReasoning(features, signal, protocolData),
                risks: this.identifyRisks(features, protocolData),
                catalysts: this.identifyCatalysts(features, protocolData),
                timestamp: new Date().toISOString(),
                dataQuality: this.assessDataQuality(protocolData)
            };

            // Cache analysis
            this.analysisCache.set(protocolSlug, {
                analysis,
                timestamp: Date.now()
            });

            return analysis;
        } catch (error) {
            console.error(`Error analyzing ${protocolSlug}:`, error);
            return this.createErrorAnalysis(protocolSlug, error.message);
        }
    }

    /**
     * Scan all tracked protocols and rank by alpha
     */
    async scanAllProtocols() {
        const protocols = Object.keys(PROTOCOL_MAPPINGS);
        const analyses = [];
        
        // Process in batches to avoid rate limits
        const batchSize = 5;
        for (let i = 0; i < protocols.length; i += batchSize) {
            const batch = protocols.slice(i, i + batchSize);
            const batchResults = await Promise.all(
                batch.map(p => this.analyzeProtocol(p))
            );
            analyses.push(...batchResults.filter(a => !a.error));
            
            // Small delay between batches
            if (i + batchSize < protocols.length) {
                await new Promise(r => setTimeout(r, 1000));
            }
        }

        // Sort by alpha score
        analyses.sort((a, b) => b.signal.alphaScore - a.signal.alphaScore);

        // Add rankings
        analyses.forEach((a, i) => {
            a.rank = i + 1;
        });

        return {
            timestamp: new Date().toISOString(),
            totalAnalyzed: analyses.length,
            signals: {
                strongBuy: analyses.filter(a => a.signal.action === 'STRONG BUY'),
                buy: analyses.filter(a => a.signal.action === 'BUY'),
                hold: analyses.filter(a => a.signal.action === 'HOLD'),
                sell: analyses.filter(a => a.signal.action === 'SELL' || a.signal.action === 'STRONG SELL')
            },
            topPicks: analyses.slice(0, 5),
            allAnalyses: analyses
        };
    }

    /**
     * Get high conviction opportunities
     */
    async getHighConvictionOpportunities(minConfidence = 0.6) {
        const scan = await this.scanAllProtocols();
        
        return scan.allAnalyses
            .filter(a => 
                a.signal.confidence >= minConfidence && 
                (a.signal.action === 'STRONG BUY' || a.signal.action === 'BUY')
            )
            .slice(0, 10);
    }

    /**
     * Calculate conviction and confidence
     */
    calculateConviction(alphaScore, features, protocolData) {
        // Conviction: How strongly we believe in the signal
        let conviction = alphaScore;
        
        // Boost conviction for convergent signals
        const tvlPositive = features.tvl.tvlMomentum > 0.5;
        const pricePositive = features.market.priceStrength > 0.5;
        const yieldAttractive = features.yield.yieldAttractiveness > 0.5;
        const revenueGrowing = features.revenue.revenueGrowth > 0.5;
        
        const positiveSignals = [tvlPositive, pricePositive, yieldAttractive, revenueGrowing]
            .filter(Boolean).length;
        
        if (positiveSignals >= 3) conviction *= 1.1;
        if (positiveSignals >= 4) conviction *= 1.05;
        
        // Reduce conviction for high risk
        if (features.risk.riskScore < 0.3) conviction *= 0.9;
        if (features.risk.liquidityRisk < 0.3) conviction *= 0.95;
        
        conviction = Math.min(100, conviction);
        
        // Confidence: How certain we are about the analysis
        let confidence = 0.5;
        
        // Higher confidence with more data
        const hasMarketData = protocolData.market !== null;
        const hasYieldData = protocolData.yields?.pools > 0;
        const hasVolumeData = protocolData.volume?.volume24h > 0;
        const hasFeeData = protocolData.fees?.fees24h > 0;
        
        const dataPoints = [hasMarketData, hasYieldData, hasVolumeData, hasFeeData];
        confidence += dataPoints.filter(Boolean).length * 0.1;
        
        // Higher confidence with consistent signals
        const signalConsistency = this.calculateSignalConsistency(features);
        confidence += signalConsistency * 0.2;
        
        // Lower confidence for extreme scores
        const isExtreme = alphaScore > 90 || alphaScore < 10;
        if (isExtreme) confidence *= 0.85;
        
        confidence = Math.max(0.2, Math.min(0.95, confidence));
        
        return { conviction, confidence };
    }

    /**
     * Calculate signal consistency across feature categories
     */
    calculateSignalConsistency(features) {
        const categoryScores = [
            Object.values(features.tvl).reduce((s, v) => s + v, 0) / Object.keys(features.tvl).length,
            Object.values(features.market).reduce((s, v) => s + v, 0) / Object.keys(features.market).length,
            Object.values(features.yield).reduce((s, v) => s + v, 0) / Object.keys(features.yield).length,
            Object.values(features.revenue).reduce((s, v) => s + v, 0) / Object.keys(features.revenue).length
        ];
        
        const mean = categoryScores.reduce((s, v) => s + v, 0) / categoryScores.length;
        const variance = categoryScores.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / categoryScores.length;
        const stdDev = Math.sqrt(variance);
        
        // Lower std dev = higher consistency
        return 1 - Math.min(stdDev * 2, 1);
    }

    /**
     * Generate trading signal
     */
    generateSignal(alphaScore, conviction, confidence) {
        let action, strength;
        
        if (alphaScore >= this.thresholds.strongBuy) {
            action = 'STRONG BUY';
            strength = 'very high';
        } else if (alphaScore >= this.thresholds.buy) {
            action = 'BUY';
            strength = 'high';
        } else if (alphaScore >= this.thresholds.hold) {
            action = 'HOLD';
            strength = 'moderate';
        } else if (alphaScore >= this.thresholds.sell) {
            action = 'SELL';
            strength = 'low';
        } else {
            action = 'STRONG SELL';
            strength = 'very low';
        }
        
        // Adjust for low confidence
        if (confidence < 0.4 && (action === 'STRONG BUY' || action === 'STRONG SELL')) {
            action = action === 'STRONG BUY' ? 'BUY' : 'SELL';
        }
        
        return {
            action,
            strength,
            score: alphaScore,
            conviction,
            confidence
        };
    }

    /**
     * Get confidence level label
     */
    getConfidenceLevel(confidence) {
        if (confidence >= this.confidenceBands.high.min) return 'HIGH';
        if (confidence >= this.confidenceBands.medium.min) return 'MEDIUM';
        return 'LOW';
    }

    /**
     * Generate human-readable reasoning
     */
    generateReasoning(features, signal, protocolData) {
        const reasons = [];
        const { tvl, market, yield: yieldFeatures, revenue, sentiment, risk } = features;
        
        // TVL commentary
        if (tvl.tvlMomentum > 0.7) {
            reasons.push(`Strong TVL growth momentum indicates increasing capital inflows`);
        } else if (tvl.tvlMomentum < 0.3) {
            reasons.push(`TVL is declining, suggesting capital outflows`);
        }
        
        if (tvl.tvlAcceleration > 0.6) {
            reasons.push(`TVL growth is accelerating`);
        }
        
        // Price commentary
        if (market.priceStrength > 0.7) {
            reasons.push(`Token showing strong price momentum across timeframes`);
        } else if (market.priceStrength < 0.3) {
            reasons.push(`Price action is weak, potential accumulation zone`);
        }
        
        // Yield commentary
        if (yieldFeatures.yieldAttractiveness > 0.7) {
            reasons.push(`Yields are highly attractive vs risk-free rate`);
        }
        if (yieldFeatures.yieldSustainability < 0.3) {
            reasons.push(`Current yields may be unsustainable`);
        }
        
        // Revenue commentary
        if (revenue.revenueGrowth > 0.7) {
            reasons.push(`Protocol fees/revenue growing rapidly`);
        }
        if (revenue.feeEfficiency > 0.7) {
            reasons.push(`Efficient fee generation relative to TVL`);
        }
        
        // Sentiment commentary
        if (sentiment.categoryMomentum > 1.15) {
            reasons.push(`${protocolData.mapping.category} category is trending (hot narrative)`);
        }
        
        // Risk commentary
        if (risk.riskScore < 0.4) {
            reasons.push(`Elevated risk factors present`);
        }
        
        return {
            summary: this.generateSummary(signal, reasons),
            points: reasons,
            outlook: this.generateOutlook(features, signal)
        };
    }

    /**
     * Generate analysis summary
     */
    generateSummary(signal, reasons) {
        const strength = signal.action.includes('STRONG') ? 'strongly' : 'moderately';
        const direction = signal.action.includes('BUY') ? 'bullish' : 
                          signal.action.includes('SELL') ? 'bearish' : 'neutral';
        
        return `Analysis is ${strength} ${direction} based on ${reasons.length} key factors. ` +
               `Confidence: ${(signal.confidence * 100).toFixed(0)}%`;
    }

    /**
     * Generate market outlook
     */
    generateOutlook(features, signal) {
        if (signal.action.includes('BUY')) {
            if (features.technical?.trendStrength > 0.6) {
                return 'Momentum favors continuation. Consider entry on pullbacks.';
            }
            return 'Fundamentals positive but monitor for trend confirmation.';
        } else if (signal.action.includes('SELL')) {
            return 'Deteriorating metrics suggest reducing exposure.';
        }
        return 'Mixed signals suggest patience. Wait for clearer direction.';
    }

    /**
     * Identify key risks
     */
    identifyRisks(features, protocolData) {
        const risks = [];
        
        if (features.risk.riskScore < 0.5) {
            risks.push({
                type: 'PROTOCOL',
                level: 'MEDIUM',
                description: 'Limited audit history or protocol age'
            });
        }
        
        if (features.risk.liquidityRisk < 0.4) {
            risks.push({
                type: 'LIQUIDITY',
                level: 'HIGH',
                description: 'Low trading volume may impact exit ability'
            });
        }
        
        if (features.tvl.tvlMomentum < 0.3) {
            risks.push({
                type: 'TVL',
                level: 'MEDIUM',
                description: 'Declining TVL may indicate loss of confidence'
            });
        }
        
        if (features.yield?.yieldSustainability < 0.3) {
            risks.push({
                type: 'YIELD',
                level: 'HIGH',
                description: 'Current yields appear unsustainably high'
            });
        }
        
        if (features.market.relativeStrength < 0.2) {
            risks.push({
                type: 'PRICE',
                level: 'MEDIUM',
                description: 'Significant distance from ATH, may face selling pressure'
            });
        }
        
        return risks;
    }

    /**
     * Identify positive catalysts
     */
    identifyCatalysts(features, protocolData) {
        const catalysts = [];
        
        if (features.tvl.tvlAcceleration > 0.6) {
            catalysts.push({
                type: 'MOMENTUM',
                description: 'TVL growth accelerating, potential breakout'
            });
        }
        
        if (features.revenue.revenueGrowth > 0.7) {
            catalysts.push({
                type: 'FUNDAMENTALS',
                description: 'Revenue growth exceeding sector average'
            });
        }
        
        if (features.sentiment.categoryMomentum > 1.15) {
            catalysts.push({
                type: 'NARRATIVE',
                description: `${protocolData.mapping.category} sector gaining attention`
            });
        }
        
        if (features.market.priceStrength > 0.7 && features.market.volumeMomentum > 0.6) {
            catalysts.push({
                type: 'TECHNICAL',
                description: 'Strong price action with volume confirmation'
            });
        }
        
        if (features.yield.yieldAttractiveness > 0.7 && features.yield.yieldRiskAdjusted > 0.6) {
            catalysts.push({
                type: 'YIELD',
                description: 'Attractive risk-adjusted yields drawing capital'
            });
        }
        
        return catalysts;
    }

    /**
     * Get feature category summary
     */
    getFeatureSummary(features) {
        const calcAvg = (obj) => {
            const vals = Object.values(obj).filter(v => typeof v === 'number');
            return vals.reduce((s, v) => s + v, 0) / vals.length;
        };
        
        return {
            tvl: { score: calcAvg(features.tvl), label: this.getScoreLabel(calcAvg(features.tvl)) },
            market: { score: calcAvg(features.market), label: this.getScoreLabel(calcAvg(features.market)) },
            yield: { score: calcAvg(features.yield), label: this.getScoreLabel(calcAvg(features.yield)) },
            revenue: { score: calcAvg(features.revenue), label: this.getScoreLabel(calcAvg(features.revenue)) },
            technical: { score: calcAvg(features.technical), label: this.getScoreLabel(calcAvg(features.technical)) },
            sentiment: { score: calcAvg(features.sentiment), label: this.getScoreLabel(calcAvg(features.sentiment)) },
            risk: { score: calcAvg(features.risk), label: this.getScoreLabel(calcAvg(features.risk)) }
        };
    }

    /**
     * Get score label
     */
    getScoreLabel(score) {
        if (score >= 0.7) return 'BULLISH';
        if (score >= 0.55) return 'POSITIVE';
        if (score >= 0.45) return 'NEUTRAL';
        if (score >= 0.3) return 'NEGATIVE';
        return 'BEARISH';
    }

    /**
     * Assess data quality
     */
    assessDataQuality(protocolData) {
        let quality = 0;
        let maxQuality = 0;
        const sources = [];
        
        // Check each data source
        if (protocolData.protocol?.tvl) {
            quality += 25;
            sources.push('DeFiLlama TVL');
        }
        maxQuality += 25;
        
        if (protocolData.market?.price) {
            quality += 25;
            sources.push('CoinGecko Markets');
        }
        maxQuality += 25;
        
        if (protocolData.yields?.pools > 0) {
            quality += 20;
            sources.push('DeFiLlama Yields');
        }
        maxQuality += 20;
        
        if (protocolData.volume?.volume24h > 0) {
            quality += 15;
            sources.push('DeFiLlama DEX Volumes');
        }
        maxQuality += 15;
        
        if (protocolData.fees?.fees24h > 0) {
            quality += 15;
            sources.push('DeFiLlama Fees');
        }
        maxQuality += 15;
        
        return {
            score: Math.round((quality / maxQuality) * 100),
            sources,
            status: quality >= 70 ? 'COMPLETE' : quality >= 40 ? 'PARTIAL' : 'LIMITED'
        };
    }

    /**
     * Create error analysis object
     */
    createErrorAnalysis(protocolSlug, errorMessage) {
        return {
            protocol: { id: protocolSlug },
            error: true,
            errorMessage,
            signal: { action: 'NO SIGNAL', confidence: 0 },
            timestamp: new Date().toISOString()
        };
    }
}

// Export singleton
const researchAgent = new ResearchAnalystAgent();

module.exports = { ResearchAnalystAgent, researchAgent };
