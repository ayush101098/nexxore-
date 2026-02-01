/**
 * Refined Research Agent v2
 * Institutional-grade signal generation with:
 * 1. Regime Detection (what's the environment?)
 * 2. Signal Confirmation (multi-domain validation)
 * 3. Confidence Scoring (probabilistic output)
 * 
 * This is NOT a chat bot. This is an onchain research analyst.
 */

const { OrthogonalDataCollector } = require('./orthogonalCollectors');
const { AlphaFactoryIngestionPipeline } = require('./alphaFactory/dataIngestionPipeline');
const { CookieNarrativeIntelligence } = require('./alphaFactory/narrativeIntelligence');
const { TwitterIntelligence } = require('./alphaFactory/twitterIntelligence');
const { DerivativesIntelligence } = require('./alphaFactory/derivativesIntelligence');
const { SocialMomentumScorer } = require('./alphaFactory/socialMomentum');
const { OnChainSignals } = require('./alphaFactory/onChainSignals');
const { NarrativeClusteringEngine } = require('./alphaFactory/narrativeClustering');
const { HypothesisEngine } = require('./alphaFactory/hypothesisEngine');
const { buildHypothesisSchema } = require('./alphaFactory/hypothesisSchema');
const { ProcessingPipeline } = require('./alphaFactory/processingPipeline');
const { BacktestEngine } = require('./alphaFactory/backtestEngine');
const { AdaptiveLearningEngine } = require('./alphaFactory/adaptiveLearning');
const { HumanInLoopRefinement } = require('./alphaFactory/humanInLoopRefinement');
const { HypothesisAlertingEngine } = require('./alphaFactory/hypothesisAlerts');
const { IntegrationHub } = require('./alphaFactory/integrationHub');
const { LLMReasoningEngine } = require('./alphaFactory/llmReasoning');
const { ExperimentalSignalsLab } = require('./alphaFactory/experimentalSignals');
const { WorkflowOrchestrator } = require('./alphaFactory/workflowOrchestrator');
const { AuditTrail } = require('./alphaFactory/auditTrail');
const { QualityGate } = require('./alphaFactory/qualityGate');
const { MetricsReporter } = require('./alphaFactory/metricsReporter');
const AlertSystem = require('../shared/alertSystem');
const { SignalTransformation } = require('./signalTransformation');
const { SIGNAL_TYPES, SIGNAL_WEIGHTS, CONFIDENCE_LEVELS, TIME_HORIZONS } = require('./signalTypes');

class RefinedResearchAgent {
    constructor(config = {}) {
        this.dataCollector = new OrthogonalDataCollector();
        this.signalTransform = new SignalTransformation();
        this.ingestionPipeline = new AlphaFactoryIngestionPipeline(config.ingestion || {});
        this.narrativeIntel = new CookieNarrativeIntelligence();
        this.twitterIntel = new TwitterIntelligence(config.twitterIntel || {});
        this.derivativesIntel = new DerivativesIntelligence(config.derivativesIntel || {});
        this.socialMomentum = new SocialMomentumScorer();
        this.onchainSignals = new OnChainSignals();
        this.narrativeClustering = new NarrativeClusteringEngine(config.narrativeClustering || {});
        this.hypothesisEngine = new HypothesisEngine(config.hypothesisEngine || {});
        this.processingPipeline = new ProcessingPipeline(config.processingPipeline || {});
        this.backtestEngine = new BacktestEngine(config.backtestEngine || {});
        this.adaptiveLearning = new AdaptiveLearningEngine(config.adaptiveLearning || {});
        this.humanRefinement = new HumanInLoopRefinement(config.humanRefinement || {});
        this.alertSystem = new AlertSystem(config.alertSystem || {});
        this.hypothesisAlerting = new HypothesisAlertingEngine(config.hypothesisAlerting || {});
        this.integrationHub = new IntegrationHub(config.integrationHub || {});
        this.llmReasoning = new LLMReasoningEngine(config.llmReasoning || {});
        this.experimentalSignals = new ExperimentalSignalsLab(config.experimentalSignals || {});
        this.workflow = new WorkflowOrchestrator(config.workflow || {});
        this.auditTrail = new AuditTrail(config.auditTrail || {});
        this.qualityGate = new QualityGate(config.qualityGate || {});
        this.metricsReporter = new MetricsReporter(config.metricsReporter || {});
        
        this.config = {
            minConfidence: config.minConfidence || 0.50,
            defaultTimeHorizon: config.defaultTimeHorizon || '7d',
            riskSuppressionEnabled: config.riskSuppressionEnabled !== false,
            ...config
        };

        this.analysisHistory = [];
    }

    /**
     * Alpha Factory: Multi-source ingestion snapshot
     */
    async collectAlphaFactorySnapshot({ twitterAccounts = [] } = {}) {
        await this.ingestionPipeline.init();
        this.ingestionPipeline.connectPriceFeeds();
        const snapshot = await this.ingestionPipeline.fetchSnapshot({ twitterAccounts });
        const narrativeClusters = this.narrativeIntel.update(snapshot.cookie || []);
        const twitterAnalysis = this.twitterIntel.analyze(snapshot.twitter || []);
                const priceMap = new Map((snapshot.priceFeeds || []).map(p => [p.asset, p]));

                const derivativesAnalysis = Object.keys(snapshot.fundingRates || {}).reduce((acc, asset) => {
                    const fundingRates = snapshot.fundingRates[asset] || {};
                    const openInterest = snapshot.openInterest?.[asset] || {};
                    const perpPrice = priceMap.get(asset)?.close || priceMap.get(asset + '_PERP')?.close || 0;
                    const spotPrice = priceMap.get(asset + '_SPOT')?.close || perpPrice;
                    const prices = {
                        perp: perpPrice,
                        spot: spotPrice,
                        changePct: 0
                    };
                    acc[asset] = this.derivativesIntel.analyze({ fundingRates, openInterest: { current: openInterest.binance || 0, previous: 0 }, prices });
                    return acc;
                }, {});
        const socialMomentum = this.socialMomentum.analyze(
            { ...twitterAnalysis, tweets: snapshot.twitter || [] },
            narrativeClusters
        );

        const onchainAnalysis = this.onchainSignals.analyze(snapshot.onchain || {});
        const narrativeThemes = this.narrativeClustering.analyze({
            cookieItems: snapshot.cookie || [],
            socialMentions: snapshot.twitter || []
        });

        const experimental = this.experimentalSignals.evaluate({
            snapshot,
            narrativeThemes,
            derivativesAnalysis,
            socialMomentum,
            onchainAnalysis
        });

        const firstDerivatives = Object.values(derivativesAnalysis || {})[0] || {};
                const hypothesis = this.hypothesisEngine.build({
            asset: Object.keys(derivativesAnalysis || {})[0] || 'UNKNOWN',
            signals: {
                technical: 0.55,
                funding: this._normalizeSignal(firstDerivatives.fundingSkew, -2, 2),
                social: socialMomentum.compositeScore || 0.5,
                oi: this._normalizeSignal(firstDerivatives.oiChangePct || 0, -20, 20)
            },
            indicators: {
                fundingSkew: firstDerivatives.fundingSkew || 0,
                momentum: socialMomentum.compositeScore || 0,
                basis: firstDerivatives.basisPct || 0,
                rsi: 50,
                atr: 2,
                socialMomentum: socialMomentum.compositeScore || 0
            }
        });

                const reasoning = await this.llmReasoning.synthesize({
                    hypothesis,
                    signals: {
                        technical: hypothesis.compositeScore,
                        social: socialMomentum.compositeScore,
                        funding: this._normalizeSignal(firstDerivatives.fundingSkew, -2, 2),
                        oi: this._normalizeSignal(firstDerivatives.oiChangePct || 0, -20, 20),
                        narrative: (narrativeThemes?.themes?.[0]?.momentumScore || 0)
                    },
                    narratives: narrativeThemes?.themes || [],
                    derivatives: firstDerivatives,
                    social: socialMomentum,
                    onchain: onchainAnalysis
                });

                const quality = this.qualityGate.evaluate({
                    hypothesis,
                    signals: {
                        technical: hypothesis.compositeScore,
                        social: socialMomentum.compositeScore,
                        funding: this._normalizeSignal(firstDerivatives.fundingSkew, -2, 2),
                        oi: this._normalizeSignal(firstDerivatives.oiChangePct || 0, -20, 20),
                        narrative: (narrativeThemes?.themes?.[0]?.momentumScore || 0)
                    },
                    risks: hypothesis?.risks || []
                });

                const structuredHypothesis = buildHypothesisSchema({
                    asset: hypothesis.asset,
                    market: `${hypothesis.asset}-PERP`,
                    bias: hypothesis.bias,
                    strategy: hypothesis.strategy,
                    timeHorizon: hypothesis.timeHorizon,
                    entryRange: 'TBD',
                    target: 'TBD',
                    stopLoss: 'TBD',
                    signals: {
                        technical: hypothesis.compositeScore,
                        social: socialMomentum.compositeScore,
                        funding: this._normalizeSignal(firstDerivatives.fundingSkew, -2, 2),
                        oi: this._normalizeSignal(firstDerivatives.oiChangePct || 0, -20, 20),
                        narrative: (narrativeThemes?.themes?.[0]?.momentumScore || 0)
                    },
                    confidence: hypothesis.confidence,
                    invalidations: [
                        'Funding flips negative',
                        'Price breaks below 20D VWAP',
                        'Social momentum < 0.3',
                        'OI contracts > 10% in 24h'
                    ],
                    expectedMove: 'TBD',
                    positionSizing: '2-3% of portfolio',
                    related: [],
                    provenance: {
                        sources: ['cookie.fun', 'twitter', 'binance', 'bybit', 'okx', 'defillama'],
                        model_version: 'alpha-factory-v1'
                    },
                    summary: 'Auto-generated hypothesis pending enrichment.',
                    rationale: reasoning
                });

        const result = {
            ...snapshot,
            narrativeClusters,
                        twitterAnalysis,
            derivativesAnalysis,
            socialMomentum,
            onchainAnalysis,
            narrativeThemes,
            hypothesis,
            structuredHypothesis,
            reasoning
            ,experimental
            ,quality
        };

        this.auditTrail.record('alpha_factory_snapshot', {
            asset: hypothesis.asset,
            confidence: hypothesis.confidence,
            hypothesis: structuredHypothesis,
            reasoning
        });

        this.metricsReporter.record({
            confidence: hypothesis.confidence,
            signalStrength: hypothesis.compositeScore,
            qualityPassRate: quality?.passed ? 1 : 0
        });

        return result;
    }

    /**
     * Prompt 11: Event-driven processing pipeline
     */
    async processSignalBatch(rawEvents = []) {
        rawEvents.forEach(e => this.processingPipeline.ingest(e));

        return this.processingPipeline.processBatch(async (buffer) => {
            const normalized = buffer.map(e => ({
                ...e,
                normalizedAt: new Date().toISOString()
            }));

            const output = {
                processedAt: new Date().toISOString(),
                count: normalized.length,
                metrics: this.processingPipeline.metrics
            };

            return output;
        });
    }

    /**
     * Prompt 12: Backtesting framework
     */
    runBacktest({ hypotheses = [], priceSeries = [] } = {}) {
        return this.backtestEngine.backtest(hypotheses, priceSeries);
    }

    /**
     * Prompt 13: Adaptive learning updates
     */
    updateModelPerformance({ winRate, sharpe, outcome, signals }) {
        if (typeof winRate === 'number' && typeof sharpe === 'number') {
            this.adaptiveLearning.recordPerformance({ winRate, sharpe });
        }
        if (typeof outcome === 'number' && signals) {
            this.adaptiveLearning.updateWeights({ outcome, signals });
        }
        return {
            weights: this.adaptiveLearning.getWeights(),
            driftDetected: this.adaptiveLearning.detectDrift()
        };
    }

    /**
     * Prompt 15: Human-in-the-loop refinement
     */
    requestHumanReview(hypothesis, context = {}) {
        return this.humanRefinement.enqueueHypothesis(hypothesis, context);
    }

    applyHumanFeedback({ id, reviewer, decision, edits, notes, confidenceDelta, tags } = {}) {
        return this.humanRefinement.submitReview({ id, reviewer, decision, edits, notes, confidenceDelta, tags });
    }

    /**
     * Prompt 16: Hypothesis alerting & monitoring
     */
    registerAlertHandler(type, handler) {
        this.alertSystem.registerHandler(type, handler);
    }

    async evaluateHypothesisAlerts(hypotheses = [], context = {}) {
        const alerts = this.hypothesisAlerting.evaluate(hypotheses, context);
        const results = [];

        for (const alert of alerts) {
            const dispatched = await this.alertSystem.createHypothesisAlert(alert);
            if (dispatched) results.push(dispatched);
        }

        return results;
    }

    /**
     * Prompt 17: Integration hub for downstream systems
     */
    registerIntegration(type, handler) {
        this.integrationHub.registerHandler(type, handler);
    }

    addWebhookIntegration(url, headers = {}) {
        this.integrationHub.addWebhookTarget(url, headers);
    }

    async publishIntegrations(payload, meta = {}) {
        return this.integrationHub.dispatch(payload, meta);
    }

    /**
     * Prompt 18: Reasoning synthesis on demand
     */
    async generateReasoning({ hypothesis, signals, narratives, derivatives, social, onchain } = {}) {
        return this.llmReasoning.synthesize({ hypothesis, signals, narratives, derivatives, social, onchain });
    }

    /**
     * Prompt 19: Experimental signals lab
     */
    registerExperimentalSignal(name, fn, meta = {}) {
        return this.experimentalSignals.registerSignal(name, fn, meta);
    }

    runExperimentalSignals(context = {}) {
        return this.experimentalSignals.evaluate(context);
    }

    /**
     * Prompt 20: End-to-end workflow
     */
    async runEndToEndWorkflow({ twitterAccounts = [], context = {} } = {}) {
        const result = await this.workflow.run({ agent: this, twitterAccounts, context });
        this.auditTrail.record('workflow_run', { context, resultSummary: {
            hypotheses: result.hypotheses?.length || 0,
            alerts: result.alerts?.length || 0
        }});
        return result;
    }

    /**
     * Prompt 23: Metrics & reporting
     */
    recordMetrics(sample = {}) {
        return this.metricsReporter.record(sample);
    }

    getMetricsSummary({ limit } = {}) {
        return this.metricsReporter.summary({ limit });
    }

    /**
     * Prompt 21: Audit trail access
     */
    recordAuditEvent(type, payload = {}, meta = {}) {
        return this.auditTrail.record(type, payload, meta);
    }

    getAuditTrail({ type, limit } = {}) {
        return this.auditTrail.list({ type, limit });
    }

    _normalizeSignal(value, min, max) {
        if (max === min) return 0.5;
        const normalized = (value - min) / (max - min);
        return Math.max(0, Math.min(1, normalized));
    }

    /**
     * Main Analysis Pipeline
     * 
     * Step 1: Regime Detection
     * Step 2: Collect Multi-Domain Signals
     * Step 3: Signal Confirmation
     * Step 4: Confidence Scoring
     * Step 5: Generate Actionable Output
     */
    async analyzeAsset(protocol, signalType = 'DIRECTIONAL_ALPHA', timeHorizon = '7d') {
        const startTime = Date.now();
        
        try {
            // Step 1: Detect Market Regime
            const regime = await this._detectRegime(protocol);
            
            // Step 2: Collect All Signal Classes
            const signals = await this.dataCollector.fetchAllSignals(protocol);
            
            if (!signals.liquidity || !signals.fundamentals) {
                return this._createErrorResponse(protocol, 'Insufficient data');
            }

            // Step 3: Transform Signals
            const transformedSignals = this._transformSignals(signals);
            
            // Step 4: Calculate Signal Strength by Type
            const signalAnalysis = this._analyzeSignalType(signalType, transformedSignals, signals);
            
            // Step 5: Multi-Domain Confirmation
            const confirmation = this._confirmSignal(signalAnalysis, transformedSignals, regime);
            
            // Step 6: Calculate Confidence
            const confidence = this._calculateConfidence(confirmation, regime, signals);
            
            // Step 7: Risk Suppression (if regime is risk-off)
            const finalSignal = this._applyRiskSuppression(signalAnalysis, regime, confidence);
            
            // Step 8: Generate Actionable Output
            const output = this._generateOutput(
                protocol,
                signalType,
                timeHorizon,
                finalSignal,
                confirmation,
                confidence,
                regime,
                transformedSignals,
                signals
            );

            // Store in history
            this.analysisHistory.push({
                protocol,
                timestamp: Date.now(),
                output,
                duration: Date.now() - startTime
            });

            return output;

        } catch (error) {
            console.error(`Analysis error for ${protocol}:`, error);
            return this._createErrorResponse(protocol, error.message);
        }
    }

    /**
     * Step 1: Regime Detection
     * What's the market environment?
     */
    async _detectRegime(protocol) {
        // Fetch market-wide signals
        const signals = {
            volatility: 0, // Would fetch from market data
            volatilityHistory: [],
            assetCorrelation: 0.5,
            correlationHistory: [],
            volume: 0,
            volumeHistory: []
        };

        // Use transformation layer for regime detection
        return this.signalTransform.detectRegime(signals);
    }

    /**
     * Step 2: Transform Raw Signals
     * Convert to normalized, comparable features
     */
    _transformSignals(rawSignals) {
        const transformed = {
            timestamp: Date.now()
        };

        // Derivatives signals
        if (rawSignals.derivatives) {
            transformed.leverageStress = this.signalTransform.calculateLeverageStressIndex({
                fundingRate: rawSignals.derivatives.fundingRate,
                fundingHistory: rawSignals.derivatives.fundingHistory,
                oiChange: rawSignals.derivatives.oiChange24h,
                oiChangeHistory: rawSignals.derivatives.oiHistory,
                borrowUtilization: rawSignals.liquidity?.borrowUtilization || 0,
                borrowUtilHistory: rawSignals.liquidity?.utilizationHistory || []
            });
        }

        // Liquidity signals
        if (rawSignals.liquidity) {
            transformed.liquidityHealth = this.signalTransform.calculateLiquidityHealthIndex({
                tvlChange: rawSignals.liquidity.tvlChange7d,
                tvlHistory: rawSignals.liquidity.tvlHistory,
                currentDepth: rawSignals.liquidity.poolDepth,
                avgDepth30d: rawSignals.liquidity.avgDepth30d,
                volumeMean: rawSignals.liquidity.poolDepth * 0.1, // estimate
                volumeStdDev: rawSignals.liquidity.poolDepth * 0.05 // estimate
            });
        }

        // Fundamentals signals
        if (rawSignals.fundamentals) {
            transformed.yieldQuality = this.signalTransform.calculateYieldQualityIndex({
                feesApy: rawSignals.fundamentals.feesApy,
                totalApy: rawSignals.fundamentals.totalApy,
                tvlChangeOrganic: rawSignals.fundamentals.tvlChangeOrganic,
                incentiveRunway: rawSignals.fundamentals.incentiveRunway
            });
        }

        // Directional alpha (if derivatives + onchain available)
        if (rawSignals.derivatives && rawSignals.onchain) {
            transformed.directionalAlpha = this.signalTransform.calculateDirectionalAlpha({
                fundingRate: rawSignals.derivatives.fundingRate,
                fundingHistory: rawSignals.derivatives.fundingHistory,
                oiChange: rawSignals.derivatives.oiChange24h,
                oiHistory: rawSignals.derivatives.oiHistory,
                whaleNetFlows: rawSignals.onchain.whaleNetFlows7d,
                whaleHistory: rawSignals.onchain.whaleHistory,
                exchangeNetFlows: rawSignals.onchain.exchangeNetFlows,
                exchangeHistory: rawSignals.onchain.exchangeHistory,
                tvlChange: rawSignals.liquidity.tvlChange7d,
                tvlHistory: rawSignals.liquidity.tvlHistory,
                feeGrowth: rawSignals.fundamentals.feeGrowth7d,
                feeHistory: rawSignals.fundamentals.feeHistory
            });
        }

        return transformed;
    }

    /**
     * Step 3: Analyze by Signal Type
     */
    _analyzeSignalType(signalType, transformedSignals, rawSignals) {
        const analysis = {
            type: signalType,
            timestamp: Date.now()
        };

        switch (signalType) {
            case 'DIRECTIONAL_ALPHA':
                analysis.result = transformedSignals.directionalAlpha;
                analysis.primaryMetric = 'probability';
                analysis.direction = analysis.result?.direction || 'NEUTRAL';
                break;

            case 'LEVERAGE_STRESS':
                analysis.result = transformedSignals.leverageStress;
                analysis.primaryMetric = 'level';
                analysis.level = analysis.result?.level || 'NORMAL';
                break;

            case 'LIQUIDITY_STRESS':
                analysis.result = transformedSignals.liquidityHealth;
                analysis.primaryMetric = 'level';
                analysis.level = analysis.result?.level || 'ADEQUATE';
                break;

            case 'YIELD_SUSTAINABILITY':
                analysis.result = transformedSignals.yieldQuality;
                analysis.primaryMetric = 'level';
                analysis.level = analysis.result?.level || 'MODERATE';
                break;

            default:
                analysis.result = transformedSignals.directionalAlpha;
                analysis.primaryMetric = 'probability';
        }

        return analysis;
    }

    /**
     * Step 4: Multi-Domain Confirmation
     * Require confirmation across signal classes
     */
    _confirmSignal(signalAnalysis, transformedSignals, regime) {
        const confirmation = {
            domains: {},
            confirmedCount: 0,
            totalDomains: 4
        };

        // Check each domain
        if (signalAnalysis.type === 'DIRECTIONAL_ALPHA') {
            const alpha = transformedSignals.directionalAlpha;
            
            // Derivatives confirmation
            const derivativesConfirmed = 
                (alpha?.components.derivatives.score > 0 && alpha.direction === 'LONG') ||
                (alpha?.components.derivatives.score < 0 && alpha.direction === 'SHORT');
            confirmation.domains.derivatives = derivativesConfirmed;
            
            // Onchain confirmation
            const onchainConfirmed = 
                (alpha?.components.onchain.score > 0.5 && alpha.direction === 'LONG') ||
                (alpha?.components.onchain.score < -0.5 && alpha.direction === 'SHORT');
            confirmation.domains.onchain = onchainConfirmed;
            
            // Liquidity confirmation (stable or improving)
            const liquidityConfirmed = 
                transformedSignals.liquidityHealth?.level === 'GOOD' ||
                transformedSignals.liquidityHealth?.level === 'EXCELLENT';
            confirmation.domains.liquidity = liquidityConfirmed;
            
            // Fundamentals confirmation (not deteriorating)
            const fundamentalsConfirmed = 
                alpha?.components.fundamentals.score > -0.5;
            confirmation.domains.fundamentals = fundamentalsConfirmed;
        }

        // Count confirmations
        confirmation.confirmedCount = Object.values(confirmation.domains).filter(Boolean).length;
        confirmation.confirmationRate = confirmation.confirmedCount / confirmation.totalDomains;

        return confirmation;
    }

    /**
     * Step 5: Calculate Confidence
     * How certain are we about this signal?
     */
    _calculateConfidence(confirmation, regime, signals) {
        let confidence = 0;

        // Base confidence from confirmation rate
        confidence += confirmation.confirmationRate * 0.50; // 50% weight

        // Regime bonus/penalty
        if (regime.regime === 'RISK_OFF') {
            confidence *= 0.7; // Reduce confidence in risk-off
        } else if (regime.regime === 'COMPRESSION') {
            confidence *= 1.1; // Higher confidence in compression (mean reversion)
        }

        // Data quality bonus
        const dataQuality = (
            (signals.derivatives ? 0.25 : 0) +
            (signals.onchain ? 0.25 : 0) +
            (signals.liquidity ? 0.25 : 0) +
            (signals.fundamentals ? 0.25 : 0)
        );
        confidence += dataQuality * 0.30; // 30% weight

        // Signal strength bonus
        const signalStrength = confirmation.confirmationRate > 0.75 ? 0.20 : 0;
        confidence += signalStrength;

        // Clamp to [0, 1]
        confidence = Math.max(0, Math.min(1, confidence));

        // Determine level
        let level = 'LOW';
        if (confidence >= CONFIDENCE_LEVELS.HIGH.threshold) {
            level = 'HIGH';
        } else if (confidence >= CONFIDENCE_LEVELS.MEDIUM.threshold) {
            level = 'MEDIUM';
        }

        return {
            score: confidence,
            level,
            description: CONFIDENCE_LEVELS[level].description,
            color: CONFIDENCE_LEVELS[level].color,
            components: {
                confirmationRate: confirmation.confirmationRate,
                regimeAdjustment: regime.regime,
                dataQuality
            }
        };
    }

    /**
     * Step 6: Risk Suppression
     * Automatically suppress long signals in risk-off
     */
    _applyRiskSuppression(signalAnalysis, regime, confidence) {
        if (!this.config.riskSuppressionEnabled) {
            return signalAnalysis;
        }

        // Suppress longs in RISK_OFF
        if (regime.regime === 'RISK_OFF' && signalAnalysis.direction === 'LONG') {
            return {
                ...signalAnalysis,
                suppressed: true,
                suppressionReason: 'Risk-off regime detected',
                originalDirection: signalAnalysis.direction,
                direction: 'NEUTRAL',
                recommendation: 'No position - wait for regime change'
            };
        }

        return signalAnalysis;
    }

    /**
     * Step 7: Generate Actionable Output
     * 10-second readable format
     */
    _generateOutput(protocol, signalType, timeHorizon, signal, confirmation, confidence, regime, transformed, raw) {
        // Core output structure
        const output = {
            // Header
            asset: protocol.toUpperCase(),
            signal: this._getSignalAction(signal, confidence),
            strength: signal.result?.strength || 0,
            confidence: confidence.score,
            confidenceLevel: confidence.level,
            timeHorizon: timeHorizon,
            timestamp: Date.now(),

            // Drivers (why this signal?)
            drivers: this._extractDrivers(signal, transformed, raw, confirmation),

            // Risks (what could go wrong?)
            risks: this._extractRisks(signal, transformed, regime, raw),

            // Regime context
            marketRegime: {
                state: regime.regime,
                confidence: regime.confidence,
                indicators: regime.indicators,
                impact: this._getRegimeImpact(regime)
            },

            // Invalidation criteria
            invalidation: this._getInvalidationCriteria(signalType, transformed),

            // Technical details (for power users)
            details: {
                signalType,
                confirmation: {
                    rate: confirmation.confirmationRate,
                    domains: confirmation.domains
                },
                compositeScores: {
                    leverageStress: transformed.leverageStress?.level,
                    liquidityHealth: transformed.liquidityHealth?.level,
                    yieldQuality: transformed.yieldQuality?.level
                }
            }
        };

        return output;
    }

    // Helper methods for output generation

    _getSignalAction(signal, confidence) {
        if (signal.suppressed) {
            return 'NO POSITION';
        }

        if (confidence.level === 'LOW') {
            return 'MONITOR';
        }

        if (signal.direction === 'LONG') {
            return confidence.level === 'HIGH' ? 'STRONG LONG' : 'CAUTIOUS LONG';
        }

        if (signal.direction === 'SHORT') {
            return confidence.level === 'HIGH' ? 'STRONG SHORT' : 'CAUTIOUS SHORT';
        }

        return 'NEUTRAL';
    }

    _extractDrivers(signal, transformed, raw, confirmation) {
        const drivers = [];

        // Check each confirmed domain
        if (confirmation.domains.derivatives) {
            if (raw.derivatives?.derived.compression) {
                drivers.push('Funding normalized after spike - derisking underway');
            }
            if (raw.derivatives?.derived.crowdedLong) {
                drivers.push('⚠️ Crowded long position - reversal risk');
            }
        }

        if (confirmation.domains.onchain) {
            if (raw.onchain?.derived.strongHands) {
                drivers.push('Whale accumulation + exchange outflows - strong conviction');
            }
            if (raw.onchain?.derived.distributionRisk) {
                drivers.push('⚠️ Exchange inflows rising - distribution detected');
            }
        }

        if (confirmation.domains.liquidity) {
            if (raw.liquidity?.derived.organicAdoption) {
                drivers.push('TVL growing organically - real demand signal');
            }
        }

        if (confirmation.domains.fundamentals) {
            if (raw.fundamentals?.derived.realDemand) {
                drivers.push('Fee growth accelerating - product-market fit');
            }
            if (raw.fundamentals?.derived.sustainable) {
                drivers.push('Yield is fee-driven (>30%) - sustainable model');
            }
        }

        return drivers.length > 0 ? drivers : ['Limited signal confirmation across domains'];
    }

    _extractRisks(signal, transformed, regime, raw) {
        const risks = [];

        // Leverage stress
        if (transformed.leverageStress?.level === 'HIGH' || transformed.leverageStress?.level === 'EXTREME') {
            risks.push(`Leverage stress ${transformed.leverageStress.level} - cascade risk elevated`);
        }

        // Liquidity stress
        if (transformed.liquidityHealth?.level === 'WEAK' || transformed.liquidityHealth?.level === 'STRESSED') {
            risks.push('Liquidity degrading - execution risk increasing');
        }

        // Regime risk
        if (regime.regime === 'RISK_OFF') {
            risks.push('Risk-off regime - systemic headwinds');
        }

        // Fundamentals risk
        if (raw.fundamentals?.derived.vampireRisk) {
            risks.push('⚠️ High emissions, low runway - vampire attack risk');
        }

        if (raw.fundamentals?.derived.fragile) {
            risks.push('Growth purely incentive-driven - fragile');
        }

        return risks.length > 0 ? risks : ['No major risks detected'];
    }

    _getRegimeImpact(regime) {
        const impacts = {
            'RISK_ON': 'Supportive for risk assets',
            'RISK_OFF': 'Headwinds for risk assets - defensive posture recommended',
            'COMPRESSION': 'Low volatility - breakout likely',
            'TRANSITION': 'Regime shifting - increased uncertainty'
        };
        return impacts[regime.regime] || 'Neutral';
    }

    _getInvalidationCriteria(signalType, transformed) {
        const criteria = [];
        
        if (signalType === 'DIRECTIONAL_ALPHA') {
            criteria.push('Funding rate z-score > +2 (crowded trade)');
            criteria.push('Exchange inflow spike (distribution)');
            criteria.push('Leverage stress moves to EXTREME');
        }

        if (signalType === 'LEVERAGE_STRESS') {
            criteria.push('Funding normalizes to <0.01%');
            criteria.push('OI declines >20%');
        }

        return criteria;
    }

    _createErrorResponse(protocol, error) {
        return {
            asset: protocol,
            signal: 'ERROR',
            confidence: 0,
            confidenceLevel: 'LOW',
            error,
            timestamp: Date.now()
        };
    }

    /**
     * Batch Analysis
     * Analyze multiple assets and return ranked list
     */
    async analyzeBatch(protocols, signalType = 'DIRECTIONAL_ALPHA', options = {}) {
        const results = await Promise.allSettled(
            protocols.map(protocol => 
                this.analyzeAsset(protocol, signalType, options.timeHorizon || '7d')
            )
        );

        const successful = results
            .filter(r => r.status === 'fulfilled' && r.value.signal !== 'ERROR')
            .map(r => r.value)
            .filter(r => r.confidence >= this.config.minConfidence);

        // Rank by confidence * strength
        successful.sort((a, b) => {
            const scoreA = a.confidence * (a.strength || 1);
            const scoreB = b.confidence * (b.strength || 1);
            return scoreB - scoreA;
        });

        return {
            timestamp: Date.now(),
            signalType,
            totalAnalyzed: protocols.length,
            qualified: successful.length,
            minConfidence: this.config.minConfidence,
            signals: successful
        };
    }
}

module.exports = { RefinedResearchAgent };
