/**
 * Refined Research API Endpoint
 * Serves institutional-grade signals to the frontend
 * 
 * Compatible with both Vercel serverless and native http server
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

// Helper to get query params (works with both Express and Vercel)
function getQuery(req) {
    if (req.query) return req.query;
    const url = new URL(req.url, `http://${req.headers.host}`);
    return Object.fromEntries(url.searchParams);
}

// Helper to send JSON response
function sendJson(res, data, status = 200) {
    if (res.json) {
        if (status !== 200) res.status(status);
        return res.json(data);
    }
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
}

// Helper to parse body
async function parseBody(req) {
    if (req.body) return req.body;
    return new Promise((resolve) => {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try { resolve(JSON.parse(body || '{}')); }
            catch { resolve({}); }
        });
    });
}

/**
 * GET /api/research/signals
 * Get signals for a specific signal type
 */
async function getSignals(req, res) {
    try {
        const query = getQuery(req);
        const type = query.type || 'DIRECTIONAL_ALPHA';
        const limit = parseInt(query.limit || '10');

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

        sendJson(res, {
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
        sendJson(res, { success: false, error: error.message }, 500);
    }
}

/**
 * POST /api/research/scan
 * Scan markets and return top opportunities
 */
async function scanMarkets(req, res) {
    try {
        const body = await parseBody(req);
        const { signalType = 'DIRECTIONAL_ALPHA', protocols = TOP_PROTOCOLS } = body;

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

        sendJson(res, {
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
        sendJson(res, { success: false, error: error.message }, 500);
    }
}

/**
 * GET /api/research/signal/:protocol
 * Get detailed signal for a specific protocol
 */
async function getProtocolSignal(req, res) {
    try {
        // Get protocol from params or URL
        const protocol = req.params?.protocol || req.url.split('/').pop().split('?')[0];
        const query = getQuery(req);
        const type = query.type || 'DIRECTIONAL_ALPHA';
        const timeHorizon = query.timeHorizon || '7d';

        const signal = await researchAgent.analyzeAsset(protocol, type, timeHorizon);

        sendJson(res, {
            success: true,
            timestamp: Date.now(),
            signal
        });

    } catch (error) {
        console.error(`Error fetching signal:`, error);
        sendJson(res, { success: false, error: error.message }, 500);
    }
}

/**
 * GET /api/research/regime
 * Get current market regime
 */
async function getMarketRegime(req, res) {
    try {
        // Analyze one protocol to get regime
        const signal = await researchAgent.analyzeAsset('aave', 'DIRECTIONAL_ALPHA', '7d');
        
        const regime = signal.marketRegime || {
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

        sendJson(res, {
            success: true,
            regime
        });

    } catch (error) {
        console.error('Error fetching market regime:', error);
        sendJson(res, { success: false, error: error.message }, 500);
    }
}

/**
 * GET /api/research/history
 * Get analysis history
 */
function getAnalysisHistory(req, res) {
    try {
        const query = getQuery(req);
        const limit = parseInt(query.limit || '50');

        const history = researchAgent.analysisHistory
            .slice(-limit)
            .reverse();

        sendJson(res, {
            success: true,
            count: history.length,
            history
        });

    } catch (error) {
        console.error('Error fetching history:', error);
        sendJson(res, { success: false, error: error.message }, 500);
    }
}

module.exports = {
    getSignals,
    scanMarkets,
    getProtocolSignal,
    getMarketRegime,
    getAnalysisHistory
};
