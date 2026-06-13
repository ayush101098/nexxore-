const { auth, privateRpc } = require('./deribit-client');
const { saveDeribitCredential, loadDeribitCredential } = require('./secure-store');
const { checkDeribitOrder } = require('./risk-guard');
const { logTrade } = require('./trade-logger');

const fillsByWallet = new Map();

function json(res, status, payload) {
  res.status(status).json(payload);
}

function fail(res, status, code, error, details) {
  return json(res, status, { success: false, code, error, details: details || null });
}

async function loadSession(walletAddress, credentialId) {
  const credential = await loadDeribitCredential(credentialId, walletAddress);
  if (!credential) throw new Error('Credential not found');
  const token = await auth(credential.clientId, credential.clientSecret);
  return { credential, token };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const url = req.url.replace(/\?.*$/, '');
  const parts = url.split('/').filter(Boolean);
  const action = parts[2] || '';

  let body = req.body;
  if (!body || typeof body === 'string') {
    try { body = JSON.parse(body || '{}'); } catch (_) { body = {}; }
  }

  try {
    if (process.env.DERIBIT_TRADING_ENABLED === 'false' && ['order', 'cancel'].includes(action)) {
      return fail(res, 503, 'KILL_SWITCH', 'Deribit trading disabled');
    }

    if (action === 'auth' && req.method === 'POST') {
      const { walletAddress, clientId, clientSecret, mode } = body;
      if (!walletAddress || !clientId || !clientSecret) {
        return fail(res, 400, 'BAD_REQUEST', 'walletAddress, clientId and clientSecret required');
      }
      const token = await auth(clientId, clientSecret);
      const credentialId = await saveDeribitCredential(walletAddress, { clientId, clientSecret, mode: mode || 'trading' });
      return json(res, 200, {
        success: true,
        credentialId,
        account: token?.sid || token?.scope || 'deribit-user',
        expiresIn: token?.expires_in || 0
      });
    }

    if (action === 'positions' && req.method === 'GET') {
      const walletAddress = req.query?.walletAddress;
      const credentialId = req.query?.credentialId;
      if (!walletAddress || !credentialId) return fail(res, 400, 'BAD_REQUEST', 'walletAddress and credentialId required');
      const { token } = await loadSession(walletAddress, credentialId);
      const positions = await privateRpc('private/get_positions', token.access_token, { currency: 'BTC', kind: 'option' });
      const normalized = (positions || []).map(p => ({
        asset: p.instrument_name?.split('-')?.[0] || 'BTC',
        side: Number(p.size) >= 0 ? 'buy' : 'sell',
        size: Math.abs(Number(p.size || 0)),
        entryPrice: Number(p.average_price || 0),
        markPrice: Number(p.mark_price || 0),
        pnl: Number(p.total_profit_loss || 0),
        liquidationPrice: Number(p.estimated_liquidation_price || 0),
        instrument: p.instrument_name
      }));
      return json(res, 200, { success: true, positions: normalized });
    }

    if (action === 'order' && req.method === 'POST') {
      const { walletAddress, credentialId, legs = [] } = body;
      if (!walletAddress || !credentialId || !Array.isArray(legs) || legs.length === 0) {
        return fail(res, 400, 'BAD_REQUEST', 'walletAddress, credentialId and non-empty legs are required');
      }
      const { token } = await loadSession(walletAddress, credentialId);
      const risk = checkDeribitOrder({ legs });
      if (!risk.ok) return fail(res, 400, risk.code || 'RISK_BLOCK', risk.message || 'Risk guard blocked order', risk.details);

      const receipts = [];
      for (const leg of legs) {
        const method = leg.side === 'sell' ? 'private/sell' : 'private/buy';
        const payload = {
          instrument_name: leg.instrument_name || leg.instrument,
          amount: Number(leg.qty || leg.amount || 0),
          type: leg.orderType || 'market'
        };
        if (leg.price) payload.price = Number(leg.price);
        const result = await privateRpc(method, token.access_token, payload);
        receipts.push(result);
      }

      const fills = receipts.map(r => ({
        order_id: r.order?.order_id || r.order_id,
        instrument_name: r.order?.instrument_name,
        amount: r.order?.amount,
        average_price: r.trades?.[0]?.price || r.order?.price || 0
      }));
      fillsByWallet.set(String(walletAddress).toLowerCase(), [...(fillsByWallet.get(String(walletAddress).toLowerCase()) || []), ...fills]);

      await logTrade({
        wallet_address: walletAddress,
        venue: 'deribit',
        market: (legs[0]?.instrument_name || legs[0]?.instrument || 'MULTI').slice(0, 32),
        side: legs[0]?.side === 'sell' ? 'short' : 'long',
        order_type: 'strategy',
        size: legs.reduce((s, l) => s + Number(l.qty || l.amount || 0), 0),
        execution_status: 'submitted',
        raw_response: receipts
      });

      return json(res, 200, { success: true, receipts, fills });
    }

    if (action === 'cancel' && req.method === 'POST') {
      const { walletAddress, credentialId, deribitOrderId } = body;
      if (!walletAddress || !credentialId || !deribitOrderId) {
        return fail(res, 400, 'BAD_REQUEST', 'walletAddress, credentialId and deribitOrderId required');
      }
      const { token } = await loadSession(walletAddress, credentialId);
      const result = await privateRpc('private/cancel', token.access_token, { order_id: deribitOrderId });
      return json(res, 200, { success: true, result });
    }

    if (action === 'fills' && req.method === 'GET') {
      const walletAddress = String(req.query?.walletAddress || '').toLowerCase();
      return json(res, 200, { success: true, fills: fillsByWallet.get(walletAddress) || [] });
    }

    return fail(res, 404, 'NOT_FOUND', 'Unknown Deribit route');
  } catch (error) {
    const status = /Credential not found/i.test(error.message) ? 401 : 500;
    return fail(res, status, error.code || 'DERIBIT_ERROR', error.message);
  }
};
