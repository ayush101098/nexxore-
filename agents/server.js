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

// Alert system
const AlertSystem = require('./shared/alertSystem');
const { createTelegramHandler } = require('./shared/telegramHandler');
const XAutomationHandler = require('./shared/xAutomation');
const Web3TokenHub = require('./web3-intelligence/tokenHub');

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
  const landingPath = path.join(__dirname, 'index.html');
  const content = fs.readFileSync(landingPath, 'utf-8');
  
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(content);
}

async function serveDashboard(req, res) {
  const dashboardPath = path.join(__dirname, 'dashboard.html');
  const content = fs.readFileSync(dashboardPath, 'utf-8');
  
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(content);
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
      
      // Use LLM to chat
      const response = await llmEngine.chat(message, context || {});
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ response }));
    } catch (err) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: err.message }));
    }
  });
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
          const result = await researchAgent.analyze({ protocol });
          return {
            protocol,
            success: true,
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

