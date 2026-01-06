// Safe Yield API Handler - Consolidates safe-yield endpoints
const status = require('./safe-yield/status.js');
const strategies = require('./safe-yield/strategies.js');
const simulate = require('./safe-yield/simulate.js');
const risk = require('./safe-yield/risk.js');

module.exports = async (req, res) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host}`);
  
  if (pathname === '/api/safe-yield/status') {
    return status(req, res);
  } else if (pathname === '/api/safe-yield/strategies') {
    return strategies(req, res);
  } else if (pathname === '/api/safe-yield/simulate') {
    return simulate(req, res);
  } else if (pathname === '/api/safe-yield/risk') {
    return risk(req, res);
  } else {
    res.status(404).json({ error: 'Not Found' });
  }
};
