/**
 * Refined Research API Endpoint
 * Serves institutional-grade signals to the frontend
 */

const { RefinedResearchAgent } = require('../agents/research/refinedResearchAgent');

// Initialize agent
const researchAgent = new RefinedResearchAgent({
    minConfidence: 0.50,
    defaultTimeHorizon: '7d',
    riskSuppressionEnabled: true
});

// Top protocols to monitor
const TOP_PROTOCOLS = [
    'aave', 'uniswap', 'lido', 'makerdao', 'curve-dex',
    'eigenlayer', 'pendle', 'gmx', 'morpho', 'ethena',
    'jupiter', 'raydium', 'jito', 'aerodrome', 'hyperliquid'
];

/**
 * GET /api/research/signals
 * Get signals for a specific signal type
 */
async function getSignals(req, res) {
    try {
        const { type = 'DIRECTIONAL_ALPHA', limit = 10 } = req.query;

        // Analyze top protocols
        const result = await researchAgent.analyzeBatch(
            TOP_PROTOCOLS,
            type,
            { timeHorizon: '7d' }
        );

        // Get regime (use first signal's regime or fetch separately)
        const regime = result.signals[0]?.marketRegime || {
            state: 'RISK_ON',
            confidence: 0.7,
            impact: 'Supportive for risk assets'
        };

        res.json({
            success: true,
            timestamp: Date.now(),
            signalType: type,
            totalAnalyzed: result.totalAnalyzed,
            qualified: result.qualified,
            signals: result.signals.slice(0, limit),
            regime: regime
        });

    } catch (error) {
        console.error('Error fetching signals:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}

/**
 * POST /api/research/scan
 * Scan markets and return top opportunities
 */
async function scanMarkets(req, res) {
    try {
        const { signalType = 'DIRECTIONAL_ALPHA', protocols = TOP_PROTOCOLS } = req.body;

        // Run full scan
        const result = await researchAgent.analyzeBatch(
            protocols,
            signalType,
            { timeHorizon: '7d' }
        );

        // Get market regime
        const regime = result.signals[0]?.marketRegime || {
            state: 'RISK_ON',
            confidence: 0.7,
            indicators: {},
            impact: 'Supportive for risk assets'
        };

        res.json({
            success: true,
            timestamp: Date.now(),
            signalType,
            scanDuration: Date.now() - result.timestamp,
            totalAnalyzed: result.totalAnalyzed,
            qualified: result.qualified,
            signals: result.signals,
            regime: regime,
            summary: {
                strongLongs: result.signals.filter(s => s.signal === 'STRONG LONG').length,
                cautiousLongs: result.signals.filter(s => s.signal === 'CAUTIOUS LONG').length,
                strongShorts: result.signals.filter(s => s.signal === 'STRONG SHORT').length,
                cautiousShorts: result.signals.filter(s => s.signal === 'CAUTIOUS SHORT').length,
                monitors: result.signals.filter(s => s.signal === 'MONITOR').length
            }
        });

    } catch (error) {
        console.error('Error scanning markets:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}

/**
 * GET /api/research/signal/:protocol
 * Get detailed signal for a specific protocol
 */
async function getProtocolSignal(req, res) {
    try {
        const { protocol } = req.params;
        const { type = 'DIRECTIONAL_ALPHA', timeHorizon = '7d' } = req.query;

        const signal = await researchAgent.analyzeAsset(protocol, type, timeHorizon);

        res.json({
            success: true,
            timestamp: Date.now(),
            signal
        });

    } catch (error) {
        console.error(`Error fetching signal for ${req.params.protocol}:`, error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}

/**
 * GET /api/research/regime
 * Get current market regime
 */
async function getMarketRegime(req, res) {
    try {
        // In a real implementation, this would analyze market-wide data
        // For now, return a sample regime
        const regime = {
            state: 'RISK_ON',
            confidence: 0.75,
            indicators: {
                volatility: 'normalized',
                correlation: 'low',
                environment: 'constructive'
            },
            impact: 'Supportive for risk assets',
            timestamp: Date.now()
        };

        res.json({
            success: true,
            regime
        });

    } catch (error) {
        console.error('Error fetching market regime:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}

/**
 * GET /api/research/history
 * Get analysis history
 */
function getAnalysisHistory(req, res) {
    try {
        const { limit = 50 } = req.query;

        const history = researchAgent.analysisHistory
            .slice(-limit)
            .reverse();

        res.json({
            success: true,
            count: history.length,
            history
        });

    } catch (error) {
        console.error('Error fetching history:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}

module.exports = {
    getSignals,
    scanMarkets,
    getProtocolSignal,
    getMarketRegime,
    getAnalysisHistory
};
