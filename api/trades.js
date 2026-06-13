const { getTrades } = require('./trade-logger');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ success: false, code: 'METHOD_NOT_ALLOWED', error: 'GET required' });

  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const walletAddress = url.searchParams.get('walletAddress');
    const venue = url.searchParams.get('venue');
    if (!walletAddress) return res.status(400).json({ success: false, code: 'BAD_REQUEST', error: 'walletAddress required' });
    const trades = await getTrades(walletAddress, venue || undefined);
    return res.status(200).json({ success: true, trades });
  } catch (e) {
    return res.status(500).json({ success: false, code: 'TRADES_ERROR', error: e.message });
  }
};
