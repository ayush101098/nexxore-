/**
 * On-Chain Analyst API
 * 
 * Serves ecosystem intelligence to the frontend:
 * - /api/analyst/ecosystem - Categories, narratives, top protocols
 * - /api/analyst/airdrops - Airdrop opportunities
 * - /api/analyst/macro - Macro overview & sentiment
 * - /api/analyst/narrative/:key - Specific narrative deep dive
 */

const { EcosystemIntelligence } = require('../agents/research/ecosystemIntelligence');
const { AirdropTracker } = require('../agents/research/airdropTracker');
const { MacroIntelligence } = require('../agents/research/macroIntelligence');

// Initialize modules
const ecosystem = new EcosystemIntelligence();
const airdrops = new AirdropTracker();
const macro = new MacroIntelligence();

// Helper functions for cross-platform compatibility
function getQuery(req) {
  if (req.query) return req.query;
  const url = new URL(req.url, `http://${req.headers.host}`);
  return Object.fromEntries(url.searchParams);
}

function sendJson(res, data, status = 200) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (res.json) {
    if (status !== 200) res.status(status);
    return res.json(data);
  }
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

/**
 * GET /api/analyst/ecosystem
 * Full ecosystem overview with narratives
 */
async function getEcosystemOverview(req, res) {
  try {
    const data = await ecosystem.getEcosystemOverview();
    sendJson(res, {
      success: true,
      ...data
    });
  } catch (error) {
    console.error('Ecosystem API error:', error);
    sendJson(res, { success: false, error: error.message }, 500);
  }
}

/**
 * GET /api/analyst/narratives
 * Get trending narratives with momentum
 */
async function getNarratives(req, res) {
  try {
    const overview = await ecosystem.getEcosystemOverview();
    sendJson(res, {
      success: true,
      timestamp: Date.now(),
      narratives: overview.narratives
    });
  } catch (error) {
    console.error('Narratives API error:', error);
    sendJson(res, { success: false, error: error.message }, 500);
  }
}

/**
 * GET /api/analyst/narrative/:key
 * Deep dive into specific narrative
 */
async function getNarrativeDetail(req, res) {
  try {
    const key = req.params?.key || getQuery(req).key;
    if (!key) {
      return sendJson(res, { success: false, error: 'Narrative key required' }, 400);
    }

    const data = await ecosystem.getNarrativeProtocols(key.toUpperCase());
    if (!data) {
      return sendJson(res, { success: false, error: 'Narrative not found' }, 404);
    }

    sendJson(res, {
      success: true,
      timestamp: Date.now(),
      ...data
    });
  } catch (error) {
    console.error('Narrative detail API error:', error);
    sendJson(res, { success: false, error: error.message }, 500);
  }
}

/**
 * GET /api/analyst/airdrops
 * All airdrop opportunities
 */
async function getAirdrops(req, res) {
  try {
    const query = getQuery(req);
    const status = query.status; // FARMING, LIVE, etc.
    
    let data = await airdrops.getAllAirdrops();
    
    // Filter by status if provided
    if (status) {
      data = {
        ...data,
        highConfidence: data.highConfidence.filter(a => a.status === status.toUpperCase()),
        mediumConfidence: data.mediumConfidence.filter(a => a.status === status.toUpperCase())
      };
    }

    sendJson(res, {
      success: true,
      ...data
    });
  } catch (error) {
    console.error('Airdrops API error:', error);
    sendJson(res, { success: false, error: error.message }, 500);
  }
}

/**
 * GET /api/analyst/airdrops/farming
 * Active farming opportunities only
 */
async function getFarmingOpportunities(req, res) {
  try {
    const data = airdrops.getFarmingOpportunities();
    sendJson(res, {
      success: true,
      timestamp: Date.now(),
      ...data
    });
  } catch (error) {
    console.error('Farming API error:', error);
    sendJson(res, { success: false, error: error.message }, 500);
  }
}

/**
 * GET /api/analyst/macro
 * Full macro overview
 */
async function getMacroOverview(req, res) {
  try {
    const data = await macro.getMacroOverview();
    sendJson(res, {
      success: true,
      ...data
    });
  } catch (error) {
    console.error('Macro API error:', error);
    sendJson(res, { success: false, error: error.message }, 500);
  }
}

/**
 * GET /api/analyst/sentiment
 * Quick sentiment check
 */
async function getSentiment(req, res) {
  try {
    const sentiment = await macro.getSentiment();
    sendJson(res, {
      success: true,
      timestamp: Date.now(),
      ...sentiment
    });
  } catch (error) {
    console.error('Sentiment API error:', error);
    sendJson(res, { success: false, error: error.message }, 500);
  }
}

/**
 * GET /api/analyst/full
 * Combined endpoint for all data
 */
async function getFullAnalysis(req, res) {
  try {
    const [ecosystemData, airdropData, macroData] = await Promise.all([
      ecosystem.getEcosystemOverview(),
      airdrops.getAllAirdrops(),
      macro.getMacroOverview()
    ]);

    sendJson(res, {
      success: true,
      timestamp: Date.now(),
      ecosystem: ecosystemData,
      airdrops: airdropData,
      macro: macroData
    });
  } catch (error) {
    console.error('Full analysis API error:', error);
    sendJson(res, { success: false, error: error.message }, 500);
  }
}

module.exports = {
  getEcosystemOverview,
  getNarratives,
  getNarrativeDetail,
  getAirdrops,
  getFarmingOpportunities,
  getMacroOverview,
  getSentiment,
  getFullAnalysis
};
