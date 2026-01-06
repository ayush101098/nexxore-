// Unified API Handler - Consolidates multiple endpoints to stay under Vercel Hobby limit
const news = require('./news.js');
const trending = require('./trending.js');
const chat = require('./chat.js');
const health = require('./health.js');
const signals = require('./signals.js');
const alphaScanner = require('./alpha-scanner.js');
const alphaScannerV2 = require('./alpha-scanner-v2.js');

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
  } else {
    res.status(404).json({ error: 'Not Found' });
  }
};
