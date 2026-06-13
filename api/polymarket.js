const { savePolymarketCredential, loadPolymarketCredential } = require('./secure-store');
const pm = require('./polymarket-client');
const { checkPolymarketOrder } = require('./risk-guard');
const { logTrade } = require('./trade-logger');

function json(res, status, payload) {
  res.status(status).json(payload);
}

function fail(res, status, code, error, details) {
  return json(res, status, { success: false, code, error, details: details || null });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const urlObj = new URL(req.url, `http://${req.headers.host}`);
  const url = urlObj.pathname;
  const parts = url.split('/').filter(Boolean);
  const action = parts[2] || '';

  let body = req.body;
  if (!body || typeof body === 'string') {
    try { body = JSON.parse(body || '{}'); } catch (_) { body = {}; }
  }

  try {
    if (process.env.POLYMARKET_TRADING_ENABLED === 'false' && ['order'].includes(action)) {
      return fail(res, 503, 'KILL_SWITCH', 'Polymarket trading disabled');
    }

    if (action === 'auth' && req.method === 'POST') {
      const { walletAddress, l2Key } = body;
      if (!walletAddress || !l2Key) return fail(res, 400, 'BAD_REQUEST', 'walletAddress and l2Key required');
      const credentialId = await savePolymarketCredential(walletAddress, { walletAddress, l2Key });
      return json(res, 200, { success: true, credentialId });
    }

    if (action === 'book' && req.method === 'GET') {
      const tokenId = urlObj.searchParams.get('tokenId');
      if (!tokenId) return fail(res, 400, 'BAD_REQUEST', 'tokenId required');
      const book = await pm.getBook(tokenId);
      return json(res, 200, { success: true, book });
    }

    if (action === 'order' && req.method === 'POST') {
      const { walletAddress, credentialId, tokenId, side, size, orderType, price, edgeBps = 0, liquidityUsd = 0 } = body;
      if (!walletAddress || !credentialId || !tokenId || !size) {
        return fail(res, 400, 'BAD_REQUEST', 'walletAddress, credentialId, tokenId and size are required');
      }
      const credential = await loadPolymarketCredential(credentialId, walletAddress);
      if (!credential) return fail(res, 401, 'INVALID_CREDENTIAL', 'Invalid credentialId');
      const orderUsd = Number(size || 0) * Number(price || 1);
      const risk = checkPolymarketOrder({
        marketLiquidityUsd: Number(liquidityUsd || 0),
        orderUsd,
        edgeBps: Number(edgeBps || 0),
        dailyPnlUsd: Number(body.dailyPnlUsd || 0),
        tokenId
      });
      if (!risk.ok) return fail(res, 400, risk.code || 'RISK_BLOCK', risk.message || 'Risk guard blocked order', risk.details);

      const payload = {
        token_id: tokenId,
        side: String(side || 'YES').toUpperCase() === 'YES' ? 'BUY' : 'SELL',
        size: Number(size),
        order_type: orderType || 'market',
        price: price ? Number(price) : undefined
      };

      const placed = await pm.placeOrder(credential, payload);
      await logTrade({
        wallet_address: walletAddress,
        venue: 'polymarket',
        market: String(tokenId).slice(0, 32),
        side: payload.side === 'BUY' ? 'long' : 'short',
        order_type: payload.order_type,
        size: payload.size,
        price: payload.price || 0,
        execution_status: 'submitted',
        token_id: tokenId,
        raw_response: placed
      });
      return json(res, 200, { success: true, order: placed });
    }

    if (action === 'orders' && req.method === 'GET') {
      const walletAddress = urlObj.searchParams.get('walletAddress');
      const credentialId = urlObj.searchParams.get('credentialId');
      if (!walletAddress || !credentialId) return fail(res, 400, 'BAD_REQUEST', 'walletAddress and credentialId required');
      const credential = await loadPolymarketCredential(credentialId, walletAddress);
      if (!credential) return fail(res, 401, 'INVALID_CREDENTIAL', 'Invalid credentialId');
      const [orders, trades] = await Promise.all([pm.getOrders(credential), pm.getTrades(credential)]);
      return json(res, 200, { success: true, orders, trades });
    }

    return fail(res, 404, 'NOT_FOUND', 'Unknown Polymarket route');
  } catch (error) {
    return fail(res, 500, error.code || 'POLYMARKET_ERROR', error.message);
  }
};
