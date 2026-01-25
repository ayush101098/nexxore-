/**
 * Integrated Web3 Intelligence Agent Server
 * 
 * Serves research dashboard + API endpoints for:
 * - News aggregation & LLM analysis
 * - Alpha detection & DeFi scanning
 * - Web3 intelligence & market trends
 * - Alert system (Telegram, X)
 * - Token hub
 */

require('dotenv').config();

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const ResearchAgent = require('./research/agent');
const AlphaDetectionAgent = require('./alpha/agent');
const Web3IntelligenceAgent = require('./web3-intelligence/agent');
const RealNewsFetcher = require('./shared/newsFetcher');
const LLMEngine = require('./shared/llmEngine');

// Refined Research Agent (institutional-grade signals)
const { RefinedResearchAgent } = require('./research/refinedResearchAgent');

// On-Chain Analyst modules
const { EcosystemIntelligence } = require('./research/ecosystemIntelligence');
const { AirdropTracker } = require('./research/airdropTracker');
const { MacroIntelligence } = require('./research/macroIntelligence');

// Alert system
const AlertSystem = require('./shared/alertSystem');
const { createTelegramHandler } = require('./shared/telegramHandler');
const XAutomationHandler = require('./shared/xAutomation');
const Web3TokenHub = require('./web3-intelligence/tokenHub');

// Initialize On-Chain Analyst modules
const ecosystemIntel = new EcosystemIntelligence();
const airdropTracker = new AirdropTracker();
const macroIntel = new MacroIntelligence();

const PORT = process.env.PORT || 3000;

// Initialize agents
const researchAgent = new ResearchAgent({
  apiKeys: {
    coingecko: process.env.COINGECKO_API_KEY,
    newsapi: process.env.NEWS_API_KEY
  }
});

const alphaAgent = new AlphaDetectionAgent({
  apiKeys: {
    coingecko: process.env.COINGECKO_API_KEY,
    newsapi: process.env.NEWS_API_KEY
  }
});

const web3Agent = new Web3IntelligenceAgent({
  apiKeys: {
    coingecko: process.env.COINGECKO_API_KEY,
    newsapi: process.env.NEWS_API_KEY
  }
});

// Alert system
const alertSystem = new AlertSystem();
const tokenHub = new Web3TokenHub();

const newsFetcher = new RealNewsFetcher({
  newsApiKey: process.env.NEWS_API_KEY
});

const llmEngine = new LLMEngine({
  apiKey: process.env.OPENAI_API_KEY
});

// Register alert handlers
(async () => {
  if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
    const telegramHandler = await createTelegramHandler(
      process.env.TELEGRAM_BOT_TOKEN,
      process.env.TELEGRAM_CHAT_ID
    );
    alertSystem.registerHandler('telegram', (alert) => telegramHandler.handle(alert));
  }
  
  if (process.env.X_API_KEY) {
    const xHandler = new XAutomationHandler({
      xApiKey: process.env.X_API_KEY,
      xApiSecret: process.env.X_API_SECRET,
      xAccessToken: process.env.X_ACCESS_TOKEN,
      xAccessTokenSecret: process.env.X_ACCESS_TOKEN_SECRET
    });
    alertSystem.registerHandler('x', (alert) => xHandler.handle(alert));
  }
})();

// Router handler
async function handleRequest(req, res) {
  const reqUrl = new url.URL(req.url, `http://${req.headers.host}`);
  const pathname = reqUrl.pathname;
  const method = req.method;

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  try {
    // Routes
    if (pathname === '/' && method === 'GET') {
      return serveLandingPage(req, res);
    }
    
    if (pathname === '/research.html' && method === 'GET') {
      return serveResearchPage(req, res);
    }
    
    if (pathname === '/dashboard' && method === 'GET') {
      return serveDashboard(req, res);
    }
    
    // Health check
    if (pathname === '/api/health' && method === 'GET') {
      return healthCheck(req, res);
    }
    
    // Research agent
    if (pathname === '/api/news' && method === 'GET') {
      return getNews(req, res);
    }
    if (pathname === '/api/analyze-news' && method === 'POST') {
      return analyzeNews(req, res);
    }
    if (pathname === '/api/chat' && method === 'POST') {
      return chatHandler(req, res);
    }
    if (pathname === '/api/trending' && method === 'GET') {
      return getTrendingTokens(req, res);
    }
    if (pathname === '/api/research/insights' && method === 'GET') {
      return getResearchInsights(req, res, reqUrl);
    }
    
    // Refined Research Agent routes (institutional signals)
    if (pathname === '/api/research/signals' && method === 'GET') {
      return getRefinedSignals(req, res, reqUrl);
    }
    if (pathname === '/api/research/scan' && method === 'POST') {
      return scanMarkets(req, res);
    }
    if (pathname.startsWith('/api/research/signal/') && method === 'GET') {
      return getProtocolSignal(req, res, pathname);
    }
    if (pathname === '/api/research/regime' && method === 'GET') {
      return getMarketRegime(req, res);
    }
    if (pathname === '/api/research/history' && method === 'GET') {
      return getAnalysisHistory(req, res, reqUrl);
    }
    
    // On-Chain Analyst routes
    if (pathname === '/api/analyst/ecosystem' && method === 'GET') {
      return getEcosystemOverview(req, res);
    }
    if (pathname === '/api/analyst/narratives' && method === 'GET') {
      return getNarratives(req, res);
    }
    if (pathname.startsWith('/api/analyst/narrative/') && method === 'GET') {
      return getNarrativeDetail(req, res, pathname);
    }
    if (pathname === '/api/analyst/airdrops' && method === 'GET') {
      return getAirdrops(req, res, reqUrl);
    }
    if (pathname === '/api/analyst/airdrops/farming' && method === 'GET') {
      return getFarmingOpportunities(req, res);
    }
    if (pathname === '/api/analyst/macro' && method === 'GET') {
      return getMacroOverview(req, res);
    }
    if (pathname === '/api/analyst/sentiment' && method === 'GET') {
      return getSentiment(req, res);
    }
    if (pathname === '/api/analyst/full' && method === 'GET') {
      return getFullAnalysis(req, res);
    }
    
    // Alpha detection agent
    if (pathname === '/api/agents/alpha' && method === 'POST') {
      return alphaDetection(req, res);
    }
    
    // Web3 intelligence agent
    if (pathname === '/api/agents/web3' && method === 'POST') {
      return web3Intelligence(req, res);
    }
    
    // Token hub
    if (pathname.startsWith('/api/tokens/') && method === 'GET') {
      return getTokenInfo(req, res, pathname);
    }
    if (pathname === '/api/tokens/compare' && method === 'POST') {
      return compareTokens(req, res);
    }
    
    // Alert testing
    if (pathname === '/api/alerts/test' && method === 'POST') {
      return testAlert(req, res);
    }
    
    // Serve static files (CSS, JS, images, etc.)
    if (method === 'GET' && !pathname.startsWith('/api/')) {
      return serveStaticFile(req, res, pathname);
    }
    
    // Not found
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
  } catch (err) {
    console.error('Handler error:', err);
    res.writeHead(500);
    res.end(JSON.stringify({ error: err.message }));
  }
}

async function serveLandingPage(req, res) {
  const landingPath = path.join(__dirname, '..', 'index.html');
  const content = fs.readFileSync(landingPath, 'utf-8');
  
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(content);
}

async function serveDashboard(req, res) {
  const dashboardPath = path.join(__dirname, '..', 'dashboard.html');
  const content = fs.readFileSync(dashboardPath, 'utf-8');
  
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(content);
}

async function serveResearchPage(req, res) {
  const researchPath = path.join(__dirname, '..', 'research.html');
  const content = fs.readFileSync(researchPath, 'utf-8');
  
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(content);
}

// Serve static files (CSS, JS, images)
async function serveStaticFile(req, res, pathname) {
  const rootDir = path.join(__dirname, '..');
  const filePath = path.join(rootDir, pathname);
  
  // Security check - prevent directory traversal
  if (!filePath.startsWith(rootDir)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  
  // Check if file exists
  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    return res.end('Not Found');
  }
  
  // Get MIME type
  const ext = path.extname(filePath);
  const mimeTypes = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
  };
  
  const contentType = mimeTypes[ext] || 'text/plain';
  
  try {
    const content = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  } catch (err) {
    res.writeHead(500);
    res.end('Error loading file');
  }
}

async function getNews(req, res) {
  try {
    const news = await newsFetcher.fetchCryptoNews(
      ['crypto', 'defi', 'ethereum', 'aave', 'curve'],
      20
    );

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ news }));
  } catch (err) {
    console.error('Error fetching news:', err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message, news: [] }));
  }
}

async function analyzeNews(req, res) {
  let body = '';
  req.on('data', chunk => { body += chunk; });

  req.on('end', async () => {
    try {
      const { news } = JSON.parse(body);
      
      // Use LLM to analyze news
      const analysis = await llmEngine.analyzeNews(news);
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(analysis));
    } catch (err) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: err.message }));
    }
  });
}

async function chatHandler(req, res) {
  let body = '';
  req.on('data', chunk => { body += chunk; });

  req.on('end', async () => {
    try {
      const { message, context } = JSON.parse(body);
      
      // Simple keyword-based chat (no OpenAI dependency)
      const response = generateChatResponse(message);
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ response }));
    } catch (err) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: err.message }));
    }
  });
}

// Simple chat response function
function generateChatResponse(message) {
  const lowerMessage = message.toLowerCase();
  
  if (lowerMessage.includes('aave') || lowerMessage.includes('protocol')) {
    return 'AAVE is a leading DeFi lending protocol with over $33B in TVL. It offers flash loans, variable and stable interest rates, and supports multiple blockchain networks.';
  }
  
  if (lowerMessage.includes('defi') || lowerMessage.includes('decentralized')) {
    return 'DeFi (Decentralized Finance) refers to financial services built on blockchain technology. Major protocols include AAVE, Curve, Uniswap, and Compound. The total value locked across DeFi protocols exceeds $100B.';
  }
  
  if (lowerMessage.includes('tvl')) {
    return 'TVL (Total Value Locked) measures the total amount of assets deposited in a DeFi protocol. It\'s a key metric for assessing protocol size and health.';
  }
  
  if (lowerMessage.includes('curve') || lowerMessage.includes('stablecoin')) {
    return 'Curve Finance specializes in stablecoin swaps with low slippage. It\'s optimized for trading between similarly-priced assets like USDC, USDT, and DAI.';
  }
  
  if (lowerMessage.includes('uniswap') || lowerMessage.includes('dex')) {
    return 'Uniswap is the largest decentralized exchange (DEX) built on Ethereum. It uses an automated market maker (AMM) model for token swaps.';
  }
  
  return 'I can help you with information about DeFi protocols like AAVE, Curve, and Uniswap. Ask me about TVL, yields, or specific protocols!';
}

async function getTrendingTokens(req, res) {
  try {
    const trending = await newsFetcher.fetchTrendingTokens();
    
    res.writeHead(200);
    res.end(JSON.stringify({ trending }));
  } catch (err) {
    console.error('Error fetching trending:', err);
    res.writeHead(500);
    res.end(JSON.stringify({ error: err.message, trending: [] }));
  }
}

async function getResearchInsights(req, res, reqUrl) {
  try {
    const protocols = reqUrl.searchParams.get('protocols') || 'aave,curve,uniswap';
    const protocolList = protocols.split(',').map(p => p.trim());
    
    console.log('🔍 Analyzing protocols:', protocolList);
    
    const results = await Promise.all(
      protocolList.map(async (protocol) => {
        try {
          // Gather signals first
          const signals = await researchAgent.gatherSignals([protocol], 24);
          
          console.log(`📊 Signals for ${protocol}:`, signals.length, 'signals collected');
          
          // Group by type for better organization
          const groupedSignals = {
            news: signals.filter(s => s.type === 'news'),
            sentiment: signals.filter(s => s.type === 'social_sentiment'),
            defi: signals.filter(s => s.type === 'defi_metrics'),
            price: signals.filter(s => s.type === 'price_momentum')
          };
          
          // Run analysis
          const result = await researchAgent.analyze({ 
            protocol,
            keywords: [protocol],
            lookbackHours: 24
          });
          
          return {
            protocol,
            success: true,
            signals: groupedSignals,
            ...result
          };
        } catch (err) {
          console.error(`Error analyzing ${protocol}:`, err);
          return {
            protocol,
            success: false,
            error: err.message
          };
        }
      })
    );
    
    res.writeHead(200);
    res.end(JSON.stringify({ 
      insights: results.filter(r => r.success),
      timestamp: new Date().toISOString()
    }));
  } catch (err) {
    console.error('Error generating research insights:', err);
    res.writeHead(500);
    res.end(JSON.stringify({ error: err.message, insights: [] }));
  }
}

async function healthCheck(req, res) {
  res.writeHead(200);
  res.end(JSON.stringify({
    status: 'operational',
    timestamp: new Date().toISOString(),
    agents: {
      research: researchAgent.getMetadata(),
      alpha: alphaAgent.getMetadata(),
      web3: web3Agent.getMetadata()
    },
    alertHandlers: alertSystem.getStats()
  }));
}

// Alpha detection handler
async function alphaDetection(req, res) {
  try {
    const result = await alphaAgent.scanForAlpha();
    
    // Fire alerts for high-score alphas
    for (const signal of result.alphaOpportunities) {
      if (signal.alphaScore >= 80) {
        await alertSystem.createAlphaAlert(signal);
      }
    }
    
    res.writeHead(200);
    res.end(JSON.stringify(result));
  } catch (err) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: err.message }));
  }
}

// Web3 intelligence handler
async function web3Intelligence(req, res) {
  try {
    const result = await web3Agent.generateReport();
    res.writeHead(200);
    res.end(JSON.stringify(result));
  } catch (err) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: err.message }));
  }
}

// Token info handler
async function getTokenInfo(req, res, pathname) {
  try {
    const symbol = pathname.replace('/api/tokens/', '');
    const chain = 'ethereum'; // Default chain
    
    const tokenInfo = await tokenHub.getTokenInfo(symbol, chain);
    
    if (!tokenInfo) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Token not found' }));
      return;
    }
    
    res.writeHead(200);
    res.end(JSON.stringify(tokenInfo));
  } catch (err) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: err.message }));
  }
}

// Compare tokens handler
async function compareTokens(req, res) {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  
  req.on('end', async () => {
    try {
      const { tokens } = JSON.parse(body);
      const comparison = await tokenHub.compareTokens(tokens);
      
      res.writeHead(200);
      res.end(JSON.stringify(comparison));
    } catch (err) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: err.message }));
    }
  });
}

// Test alert handler
async function testAlert(req, res) {
  try {
    const testAlert = {
      id: `test_${Date.now()}`,
      type: 'alpha_opportunity',
      severity: 'high',
      protocol: 'AAVE',
      score: 82,
      category: 'yield_farming',
      title: '🎯 TEST ALPHA: AAVE - Score 82/100',
      message: 'This is a test alert from the Web3 Intelligence System',
      action: 'research_yield_terms',
      timestamp: new Date().toISOString(),
      metadata: {
        alphaScore: 82,
        metrics: { apy: 3.5, sentiment: 0.6 },
        category: 'yield_farming'
      }
    };
    
    const result = await alertSystem.dispatch(testAlert);
    
    res.writeHead(200);
    res.end(JSON.stringify({
      message: 'Test alert dispatched successfully',
      alert: testAlert,
      dispatchResult: result
    }));
  } catch (err) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: err.message }));
  }
}

// Advanced news analyzer handler
async function analyzeAllNews(req, res) {
  try {
    // Fetch latest news
    const news = await newsFetcher.fetchCryptoNews(
      ['crypto', 'defi', 'ethereum', 'aave', 'curve', 'uniswap'],
      20
    );
    
    // Analyze with custom analyzer
    const analysis = newsAnalyzer.analyzeNews(news);
    
    res.writeHead(200);
    res.end(JSON.stringify({
      timestamp: new Date().toISOString(),
      analysis,
      rawArticles: news.slice(0, 5) // Include top 5 articles
    }));
  } catch (err) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: err.message }));
  }
}

// Advanced news analyzer handler
async function analyzeAllNews(req, res) {
  try {
    // Fetch latest news
    const news = await newsFetcher.fetchCryptoNews(
      ['crypto', 'defi', 'ethereum', 'aave', 'curve', 'uniswap'],
      20
    );
    
    // Analyze with custom analyzer
    const analysis = newsAnalyzer.analyzeNews(news);
    
    res.writeHead(200);
    res.end(JSON.stringify({
      timestamp: new Date().toISOString(),
      analysis,
      rawArticles: news.slice(0, 5) // Include top 5 articles
    }));
  } catch (err) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: err.message }));
  }
}

// =====================================
// REFINED RESEARCH AGENT HANDLERS
// =====================================

// Initialize refined research agent
const refinedResearchAgent = new RefinedResearchAgent({
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

async function getRefinedSignals(req, res, reqUrl) {
  try {
    const type = reqUrl.searchParams.get('type') || 'DIRECTIONAL_ALPHA';
    const limit = parseInt(reqUrl.searchParams.get('limit') || '10');

    const result = await refinedResearchAgent.analyzeBatch(
      TOP_PROTOCOLS,
      type,
      { timeHorizon: '7d' }
    );

    const regime = result.signals[0]?.marketRegime || {
      state: 'RISK_ON',
      confidence: 0.7,
      impact: 'Supportive for risk assets'
    };

    res.writeHead(200);
    res.end(JSON.stringify({
      success: true,
      timestamp: Date.now(),
      signalType: type,
      totalAnalyzed: result.totalAnalyzed,
      qualified: result.qualified,
      signals: result.signals.slice(0, limit),
      regime
    }));
  } catch (err) {
    console.error('Error fetching refined signals:', err);
    res.writeHead(500);
    res.end(JSON.stringify({ success: false, error: err.message }));
  }
}

async function scanMarkets(req, res) {
  let body = '';
  req.on('data', chunk => { body += chunk; });

  req.on('end', async () => {
    try {
      const { signalType = 'DIRECTIONAL_ALPHA', protocols = TOP_PROTOCOLS } = JSON.parse(body || '{}');

      const result = await refinedResearchAgent.analyzeBatch(
        protocols,
        signalType,
        { timeHorizon: '7d' }
      );

      const regime = result.signals[0]?.marketRegime || {
        state: 'RISK_ON',
        confidence: 0.7,
        indicators: {},
        impact: 'Supportive for risk assets'
      };

      res.writeHead(200);
      res.end(JSON.stringify({
        success: true,
        timestamp: Date.now(),
        signalType,
        scanDuration: Date.now() - result.timestamp,
        totalAnalyzed: result.totalAnalyzed,
        qualified: result.qualified,
        signals: result.signals,
        regime,
        summary: {
          strongLongs: result.signals.filter(s => s.signal === 'STRONG LONG').length,
          cautiousLongs: result.signals.filter(s => s.signal === 'CAUTIOUS LONG').length,
          strongShorts: result.signals.filter(s => s.signal === 'STRONG SHORT').length,
          cautiousShorts: result.signals.filter(s => s.signal === 'CAUTIOUS SHORT').length,
          monitors: result.signals.filter(s => s.signal === 'MONITOR').length
        }
      }));
    } catch (err) {
      console.error('Error scanning markets:', err);
      res.writeHead(500);
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
  });
}

async function getProtocolSignal(req, res, pathname) {
  try {
    const protocol = pathname.split('/').pop();
    const signal = await refinedResearchAgent.analyzeAsset(protocol, 'DIRECTIONAL_ALPHA', '7d');

    res.writeHead(200);
    res.end(JSON.stringify({
      success: true,
      timestamp: Date.now(),
      signal
    }));
  } catch (err) {
    console.error(`Error fetching signal for protocol:`, err);
    res.writeHead(500);
    res.end(JSON.stringify({ success: false, error: err.message }));
  }
}

async function getMarketRegime(req, res) {
  try {
    // Analyze a sample protocol to get current regime
    const signal = await refinedResearchAgent.analyzeAsset('aave', 'DIRECTIONAL_ALPHA', '7d');
    
    const regime = signal.marketRegime || {
      state: 'RISK_ON',
      confidence: 0.75,
      indicators: {
        volatility: 'normalized',
        correlation: 'low',
        environment: 'constructive'
      },
      impact: 'Supportive for risk assets'
    };

    res.writeHead(200);
    res.end(JSON.stringify({
      success: true,
      regime,
      timestamp: Date.now()
    }));
  } catch (err) {
    console.error('Error fetching market regime:', err);
    res.writeHead(500);
    res.end(JSON.stringify({ success: false, error: err.message }));
  }
}

async function getAnalysisHistory(req, res, reqUrl) {
  try {
    const limit = parseInt(reqUrl.searchParams.get('limit') || '50');

    const history = refinedResearchAgent.analysisHistory
      .slice(-limit)
      .reverse();

    res.writeHead(200);
    res.end(JSON.stringify({
      success: true,
      count: history.length,
      history
    }));
  } catch (err) {
    console.error('Error fetching history:', err);
    res.writeHead(500);
    res.end(JSON.stringify({ success: false, error: err.message }));
  }
}

// =====================================
// ON-CHAIN ANALYST HANDLERS
// =====================================

async function getEcosystemOverview(req, res) {
  try {
    const data = await ecosystemIntel.getEcosystemOverview();
    res.writeHead(200);
    res.end(JSON.stringify({ success: true, ...data }));
  } catch (err) {
    console.error('Ecosystem overview error:', err);
    res.writeHead(500);
    res.end(JSON.stringify({ success: false, error: err.message }));
  }
}

async function getNarratives(req, res) {
  try {
    const overview = await ecosystemIntel.getEcosystemOverview();
    res.writeHead(200);
    res.end(JSON.stringify({
      success: true,
      timestamp: Date.now(),
      narratives: overview.narratives
    }));
  } catch (err) {
    console.error('Narratives error:', err);
    res.writeHead(500);
    res.end(JSON.stringify({ success: false, error: err.message }));
  }
}

async function getNarrativeDetail(req, res, pathname) {
  try {
    const key = pathname.split('/').pop();
    const data = await ecosystemIntel.getNarrativeProtocols(key.toUpperCase());
    
    if (!data) {
      res.writeHead(404);
      return res.end(JSON.stringify({ success: false, error: 'Narrative not found' }));
    }
    
    res.writeHead(200);
    res.end(JSON.stringify({ success: true, timestamp: Date.now(), ...data }));
  } catch (err) {
    console.error('Narrative detail error:', err);
    res.writeHead(500);
    res.end(JSON.stringify({ success: false, error: err.message }));
  }
}

async function getAirdrops(req, res, reqUrl) {
  try {
    const status = reqUrl?.searchParams?.get('status');
    let data = await airdropTracker.getAllAirdrops();
    
    if (status) {
      data = {
        ...data,
        highConfidence: data.highConfidence.filter(a => a.status === status.toUpperCase()),
        mediumConfidence: data.mediumConfidence.filter(a => a.status === status.toUpperCase())
      };
    }
    
    res.writeHead(200);
    res.end(JSON.stringify({ success: true, ...data }));
  } catch (err) {
    console.error('Airdrops error:', err);
    res.writeHead(500);
    res.end(JSON.stringify({ success: false, error: err.message }));
  }
}

async function getFarmingOpportunities(req, res) {
  try {
    const data = airdropTracker.getFarmingOpportunities();
    res.writeHead(200);
    res.end(JSON.stringify({ success: true, timestamp: Date.now(), ...data }));
  } catch (err) {
    console.error('Farming opportunities error:', err);
    res.writeHead(500);
    res.end(JSON.stringify({ success: false, error: err.message }));
  }
}

async function getMacroOverview(req, res) {
  try {
    const data = await macroIntel.getMacroOverview();
    res.writeHead(200);
    res.end(JSON.stringify({ success: true, ...data }));
  } catch (err) {
    console.error('Macro overview error:', err);
    res.writeHead(500);
    res.end(JSON.stringify({ success: false, error: err.message }));
  }
}

async function getSentiment(req, res) {
  try {
    const sentiment = await macroIntel.getSentiment();
    res.writeHead(200);
    res.end(JSON.stringify({ success: true, timestamp: Date.now(), ...sentiment }));
  } catch (err) {
    console.error('Sentiment error:', err);
    res.writeHead(500);
    res.end(JSON.stringify({ success: false, error: err.message }));
  }
}

async function getFullAnalysis(req, res) {
  try {
    const [ecosystemData, airdropData, macroData] = await Promise.all([
      ecosystemIntel.getEcosystemOverview(),
      airdropTracker.getAllAirdrops(),
      macroIntel.getMacroOverview()
    ]);
    
    res.writeHead(200);
    res.end(JSON.stringify({
      success: true,
      timestamp: Date.now(),
      ecosystem: ecosystemData,
      airdrops: airdropData,
      macro: macroData
    }));
  } catch (err) {
    console.error('Full analysis error:', err);
    res.writeHead(500);
    res.end(JSON.stringify({ success: false, error: err.message }));
  }
}

// Start server
const server = http.createServer(handleRequest);

server.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════╗
║    🌐 Web3 Intelligence Agent Server              ║
╚════════════════════════════════════════════════════╝

🔌 API Endpoints:
  GET  http://localhost:${PORT}                      - Dashboard
  GET  http://localhost:${PORT}/api/health           - Health check
  
📊 Research Agent:
  GET  http://localhost:${PORT}/api/news             - Latest news
  POST http://localhost:${PORT}/api/chat             - Chat with AI
  GET  http://localhost:${PORT}/api/trending         - Trending tokens

🧠 On-Chain Analyst:
  GET  http://localhost:${PORT}/api/analyst/ecosystem   - Ecosystem overview
  GET  http://localhost:${PORT}/api/analyst/narratives  - Trending narratives
  GET  http://localhost:${PORT}/api/analyst/narrative/:key - Narrative deep dive
  GET  http://localhost:${PORT}/api/analyst/airdrops    - Airdrop opportunities
  GET  http://localhost:${PORT}/api/analyst/macro       - Macro overview
  GET  http://localhost:${PORT}/api/analyst/full        - Full analysis

🎯 Alpha Detection:
  POST http://localhost:${PORT}/api/agents/alpha     - Scan DeFi for alpha

🌐 Web3 Intelligence:
  POST http://localhost:${PORT}/api/agents/web3      - Ecosystem report

💰 Token Hub:
  GET  http://localhost:${PORT}/api/tokens/:symbol   - Token info
  POST http://localhost:${PORT}/api/tokens/compare   - Compare tokens

🚨 Alerts:
  POST http://localhost:${PORT}/api/alerts/test      - Test alerts

🔐 Configuration:
  NEWS_API_KEY: ${process.env.NEWS_API_KEY ? '✅' : '❌'}
  OPENAI_API_KEY: ${process.env.OPENAI_API_KEY ? '✅' : '❌'}
  TELEGRAM_BOT_TOKEN: ${process.env.TELEGRAM_BOT_TOKEN ? '✅' : '❌'}
  X_API_KEY: ${process.env.X_API_KEY ? '✅' : '❌'}
  `);
});

process.on('SIGINT', () => {
  console.log('\n👋 Shutting down gracefully...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

module.exports = { handleRequest };

