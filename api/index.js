// Unified API Handler - Consolidates multiple endpoints to stay under Vercel Hobby limit
const news = require('./news.js');
const trending = require('./trending.js');
const chat = require('./chat.js');
const health = require('./health.js');
const signals = require('./signals.js');
const alphaScanner = require('./alpha-scanner.js');
const alphaScannerV2 = require('./alpha-scanner-v2.js');
const researchRefined = require('./research-refined.js');
const analyst = require('./analyst.js');
const analytics = require('./analytics.js');

module.exports = async (req, res) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host}`);
  
  // Route to appropriate handler
  if (pathname === '/api/news') {
    return news(req, res);
  } else if (pathname === '/api/trending') {
    return trending(req, res);
  } else if (pathname === '/api/chat') {
    return chat(req, res);
  } else if (pathname === '/api/health') {
    return health(req, res);
  } else if (pathname === '/api/signals') {
    return signals(req, res);
  } else if (pathname === '/api/alpha-scanner') {
    return alphaScanner(req, res);
  } else if (pathname === '/api/alpha-scanner-v2') {
    return alphaScannerV2(req, res);
  // Analytics Platform endpoints
  } else if (pathname === '/api/analytics/overview') {
    return analytics.getOverview(req, res);
  } else if (pathname === '/api/analytics/yields') {
    return analytics.getYields(req, res);
  } else if (pathname === '/api/analytics/protocols') {
    return analytics.getProtocols(req, res);
  } else if (pathname === '/api/analytics/chains') {
    return analytics.getChains(req, res);
  } else if (pathname === '/api/analytics/stablecoins') {
    return analytics.getStablecoins(req, res);
  } else if (pathname === '/api/analytics/trending') {
    return analytics.getTrending(req, res);
  } else if (pathname === '/api/analytics/raises') {
    return analytics.getRaises(req, res);
  } else if (pathname === '/api/analytics/fees') {
    return analytics.getFees(req, res);
  } else if (pathname === '/api/analytics/search') {
    return analytics.searchTokens(req, res);
  // Refined Research Agent endpoints
  } else if (pathname === '/api/research/signals') {
    return researchRefined.getSignals(req, res);
  } else if (pathname === '/api/research/scan') {
    return researchRefined.scanMarkets(req, res);
  } else if (pathname.startsWith('/api/research/signal/')) {
    req.params = { protocol: pathname.split('/').pop() };
    return researchRefined.getProtocolSignal(req, res);
  } else if (pathname === '/api/research/regime') {
    return researchRefined.getMarketRegime(req, res);
  } else if (pathname === '/api/research/history') {
    return researchRefined.getAnalysisHistory(req, res);
  // On-Chain Analyst endpoints
  } else if (pathname === '/api/analyst/ecosystem') {
    return analyst.getEcosystemOverview(req, res);
  } else if (pathname === '/api/analyst/narratives') {
    return analyst.getNarratives(req, res);
  } else if (pathname.startsWith('/api/analyst/narrative/')) {
    req.params = { key: pathname.split('/').pop() };
    return analyst.getNarrativeDetail(req, res);
  } else if (pathname === '/api/analyst/airdrops') {
    return analyst.getAirdrops(req, res);
  } else if (pathname === '/api/analyst/airdrops/farming') {
    return analyst.getFarmingOpportunities(req, res);
  } else if (pathname === '/api/analyst/macro') {
    return analyst.getMacroOverview(req, res);
  } else if (pathname === '/api/analyst/sentiment') {
    return analyst.getSentiment(req, res);
  } else if (pathname === '/api/analyst/full') {
    return analyst.getFullAnalysis(req, res);
  } else {
    res.status(404).json({ error: 'Not Found' });
  }
};
