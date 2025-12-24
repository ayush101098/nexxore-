/**
 * Dashboard API Server
 * Serves the research dashboard and provides API endpoints for news/analysis
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const ResearchAgent = require('./research/agent');
const RealNewsFetcher = require('./shared/newsFetcher');
const LLMEngine = require('./shared/llmEngine');

const PORT = process.env.PORT || 3000;

// Initialize services
const agent = new ResearchAgent({
  apiKeys: {
    coingecko: process.env.COINGECKO_API_KEY,
    newsapi: process.env.NEWS_API_KEY
  }
});

const newsFetcher = new RealNewsFetcher({
  newsApiKey: process.env.NEWS_API_KEY
});

const llmEngine = new LLMEngine({
  apiKey: process.env.OPENAI_API_KEY
});

// Simple router
const routes = {
  'GET /': serveDashboard,
  'GET /api/news': getNews,
  'POST /api/analyze-news': analyzeNews,
  'POST /api/chat': chatHandler,
  'GET /api/trending': getTrendingTokens,
  'GET /health': healthCheck
};

async function handleRequest(req, res) {
  const reqUrl = new url.URL(req.url, `http://${req.headers.host}`);
  const pathname = reqUrl.pathname;
  const method = req.method;

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Route handler
  const key = `${method} ${pathname}`;
  const handler = routes[key];

  if (!handler) {
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
    return;
  }

  try {
    await handler(req, res, reqUrl);
  } catch (err) {
    console.error('Handler error:', err);
    res.writeHead(500);
    res.end(JSON.stringify({ error: err.message }));
  }
}

async function serveDashboard(req, res) {
  const dashboardPath = path.join(__dirname, 'dashboard.html');
  const content = fs.readFileSync(dashboardPath, 'utf-8');
  
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(content);
}

async function getNews(req, res) {
  const news = await newsFetcher.fetchCryptoNews(
    ['crypto', 'defi', 'ethereum', 'aave', 'curve'],
    20
  );

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(news));
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
  const trending = await newsFetcher.fetchTrendingTokens();
  
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(trending));
}

async function healthCheck(req, res) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ 
    status: 'ok',
    agent: agent.getMetadata()
  }));
}

// Start server
const server = http.createServer(handleRequest);

server.listen(PORT, () => {
  console.log(`🚀 Research Dashboard running on http://localhost:${PORT}`);
  console.log(`📊 Open in browser: http://localhost:${PORT}`);
  console.log('');
  console.log('Environment:');
  console.log(`  NEWS_API_KEY: ${process.env.NEWS_API_KEY ? '✓ configured' : '✗ missing'}`);
  console.log(`  OPENAI_API_KEY: ${process.env.OPENAI_API_KEY ? '✓ configured' : '✗ missing'}`);
});

process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down...');
  server.close();
  process.exit(0);
});

module.exports = { handleRequest };
