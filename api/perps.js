const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const HYPERLIQUID_API_URL = process.env.HYPERLIQUID_API_URL || 'https://api.hyperliquid.xyz';

const json = (res, status, payload) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
};

const parseBody = async (req) => {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
  });
};

const supabaseRequest = async (path, options = {}) => {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    throw new Error('Supabase credentials not configured');
  }
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(options.headers || {})
    }
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err || 'Supabase request failed');
  }
  return res.json();
};

const normalizeMarket = (market) => {
  if (!market) return null;
  const key = String(market).toUpperCase();
  if (['ETH', 'BTC', 'SOL'].includes(key)) return key;
  if (key === 'ETHUSDT') return 'ETH';
  if (key === 'BTCUSDT') return 'BTC';
  if (key === 'SOLUSDT') return 'SOL';
  return key;
};

const executeHyperliquid = async (payload) => {
  const action = payload?.hyperliquidAction;
  const signature = payload?.hyperliquidSignature;
  const nonce = payload?.hyperliquidNonce;
  if (!action || !signature || !nonce) {
    return { execution_status: 'queued', execution_mode: 'record-only' };
  }
  const res = await fetch(`${HYPERLIQUID_API_URL}/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action,
      nonce,
      signature,
      vaultAddress: payload?.vaultAddress || null,
      expiresAfter: payload?.expiresAfter || null
    })
  });
  const data = await res.json();
  return {
    execution_status: 'submitted',
    execution_mode: 'hyperliquid',
    execution_response: data
  };
};

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;

  try {
    const handleOpenOrder = async () => {
      const body = await parseBody(req);
      const orderId = Date.now();
      const orderType = body.type || body.orderType || 'market';
      const market = normalizeMarket(body.market);

      const trade = {
        id: orderId,
        wallet_address: body.walletAddress,
        chain: body.chain || 'multi',
        market,
        side: body.side,
        order_type: orderType,
        price: body.price || null,
        amount: body.amount,
        leverage: body.leverage,
        execution_model: body.executionModel || 'hybrid',
        status: orderType === 'market' ? 'filled' : 'open',
        route: body.route || null,
        fee_rate: body.feeRate || null,
        created_at: body.timestamp || new Date().toISOString()
      };

      const execution = await executeHyperliquid(body);
      const tradeRecord = { ...trade, execution_status: execution.execution_status, execution_mode: execution.execution_mode };

      const [globalTrade] = await supabaseRequest('perps_trades', {
        method: 'POST',
        body: JSON.stringify(tradeRecord)
      });

      await supabaseRequest('perps_user_trades', {
        method: 'POST',
        body: JSON.stringify(tradeRecord)
      });

      let position = null;
      if (trade.status === 'filled') {
        const [pos] = await supabaseRequest('perps_positions', {
          method: 'POST',
          body: JSON.stringify({
            wallet_address: trade.wallet_address,
            chain: trade.chain,
            market: trade.market,
            side: trade.side,
            size: (trade.amount * trade.leverage) / (trade.price || 1),
            entry_price: trade.price || 0,
            margin: trade.amount,
            leverage: trade.leverage,
            tp_price: body.tpPrice || null,
            sl_price: body.slPrice || null,
            created_at: trade.created_at
          })
        });
        position = pos;
      }

      return json(res, 200, {
        execution_status: execution.execution_status,
        execution_mode: execution.execution_mode,
        order: globalTrade,
        position
      });
    };

    if (path === '/api/perps/open' && req.method === 'POST') {
      return handleOpenOrder();
    }

    if (path === '/api/perps/order' && req.method === 'POST') {
      return handleOpenOrder();
    }

    if (path === '/api/perps/positions' && req.method === 'GET') {
      const address = url.searchParams.get('address');
      const data = await supabaseRequest(`perps_positions?wallet_address=eq.${address}&select=*`);
      return json(res, 200, { positions: data || [] });
    }

    if (path === '/api/perps/history' && req.method === 'GET') {
      const address = url.searchParams.get('address');
      const data = await supabaseRequest(`perps_user_trades?wallet_address=eq.${address}&select=*`);
      return json(res, 200, { trades: data || [] });
    }

    if (path === '/api/perps/close' && req.method === 'POST') {
      const body = await parseBody(req);
      const positionId = body.positionId || body.id;
      await supabaseRequest(`perps_positions?id=eq.${positionId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'closed', closed_at: new Date().toISOString() })
      });
      return json(res, 200, { status: 'closed', positionId });
    }

    return json(res, 404, { error: 'Not Found' });
  } catch (err) {
    return json(res, 500, { error: err.message || 'Server error' });
  }
};
