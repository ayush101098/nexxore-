/**
 * Local test server for perps intelligence API
 */

const http = require('http');
const url = require('url');
const perpsIntelligence = require('./api/perps-intelligence');

const PORT = 3020;

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  
  if (parsedUrl.pathname === '/api/perps-intelligence') {
    // Mock Express-like req/res for Vercel function
    const mockReq = {
      method: req.method,
      query: parsedUrl.query,
      headers: req.headers
    };
    
    const mockRes = {
      setHeader: (key, value) => res.setHeader(key, value),
      status: (code) => {
        res.statusCode = code;
        return mockRes;
      },
      json: (data) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(data, null, 2));
      },
      end: () => res.end()
    };
    
    await perpsIntelligence(mockReq, mockRes);
  } else {
    res.statusCode = 404;
    res.end('Not Found');
  }
});

server.listen(PORT, () => {
  console.log(`🚀 Perps Intelligence API test server running on http://localhost:${PORT}`);
  console.log(`📊 Test: http://localhost:${PORT}/api/perps-intelligence?market=BTC`);
});
