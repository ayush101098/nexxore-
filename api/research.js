// Research API Handler - Consolidates research endpoints
const insights = require('./research/insights.js');
const alphaScan = require('./research/alpha-scan.js');

module.exports = async (req, res) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host}`);
  
  if (pathname === '/api/research/insights') {
    return insights(req, res);
  } else if (pathname === '/api/research/alpha-scan') {
    return alphaScan(req, res);
  } else {
    res.status(404).json({ error: 'Not Found' });
  }
};
