/**
 * Safe Yield API Router
 * Routes /api/safe-yield/* to individual handlers
 */
const status     = require('./safe-yield/status.js');
const strategies = require('./safe-yield/strategies.js');
const simulate   = require('./safe-yield/simulate.js');
const risk       = require('./safe-yield/risk.js');
const deposit    = require('./safe-yield/deposit.js');

module.exports = async (req, res) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host}`);

  if (pathname === '/api/safe-yield/status')     return status(req, res);
  if (pathname === '/api/safe-yield/strategies') return strategies(req, res);
  if (pathname === '/api/safe-yield/simulate')   return simulate(req, res);
  if (pathname === '/api/safe-yield/risk')       return risk(req, res);
  if (pathname === '/api/safe-yield/deposit')    return deposit(req, res);

  res.status(404).json({ error: 'Not Found' });
};
