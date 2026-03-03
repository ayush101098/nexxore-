/**
 * Nexxore Perps API — Production Market Data & Trading Gateway
 * 
 * Architecture: Fully decentralized
 * - Market data: Vercel serverless → HyperLiquid/Binance/CoinGecko APIs
 * - Order execution: Client-side signing → direct to exchange (HyperLiquid L1 / Drift / dYdX)
 * - No custodial backend — users always hold their own keys
 * 
 * Endpoints:
 *   GET  /api/perps/markets          — All supported markets with live data
 *   GET  /api/perps/market/:symbol   — Single market deep data
 *   GET  /api/perps/prices           — Real-time prices for all markets
 *   GET  /api/perps/orderbook/:sym   — L2 order book
 *   GET  /api/perps/funding          — Funding rates across venues
 *   GET  /api/perps/account/:addr    — User account state (positions, orders, margin)
 *   POST /api/perps/validate-order   — Server-side order validation (no execution)
 *   GET  /api/perps/exchange-config  — Exchange endpoints & signing config
 *   POST /api/perps/log-trade       — Persist trade to protocol database
 *   GET  /api/perps/trade-history/:addr — User trade history from protocol DB
 *   GET  /api/perps/health           — API health check
 */

const axios = require('axios');
let supabase = null;
try {
  const { createClient } = require('@supabase/supabase-js');
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (supabaseUrl && supabaseKey) {
    supabase = createClient(supabaseUrl, supabaseKey);
    console.log('[Perps API] Supabase connected for trade persistence');
  } else {
    console.warn('[Perps API] Supabase credentials missing — trade logging disabled');
  }
} catch (e) {
  console.warn('[Perps API] @supabase/supabase-js not available — trade logging disabled');
}

// ─── Configuration ───────────────────────────────────────────────────────────

const HYPERLIQUID_INFO = 'https://api.hyperliquid.xyz/info';
const HYPERLIQUID_EXCHANGE = 'https://api.hyperliquid.xyz/exchange';
const BINANCE_FAPI = 'https://fapi.binance.com/fapi/v1';
const COINGECKO_API = 'https://api.coingecko.com/api/v3';

const SUPPORTED_MARKETS = [
  'BTC', 'ETH', 'SOL', 'HYPE', 'ARB', 'OP', 'AVAX', 'MATIC',
  'DOGE', 'LINK', 'UNI', 'ATOM', 'LTC', 'BCH', 'ETC',
  'FIL', 'APT', 'STX', 'INJ', 'TIA'
];

const MARKET_CONFIG = {
  BTC:   { maxLeverage: 50, tickSize: 0.1,   minSize: 0.001,  stepSize: 0.001,  makerFee: 0.0002, takerFee: 0.0005 },
  ETH:   { maxLeverage: 50, tickSize: 0.01,  minSize: 0.01,   stepSize: 0.01,   makerFee: 0.0002, takerFee: 0.0005 },
  SOL:   { maxLeverage: 20, tickSize: 0.001, minSize: 0.1,    stepSize: 0.1,    makerFee: 0.0002, takerFee: 0.0005 },
  HYPE:  { maxLeverage: 20, tickSize: 0.001, minSize: 1,      stepSize: 1,      makerFee: 0.0002, takerFee: 0.0005 },
  ARB:   { maxLeverage: 20, tickSize: 0.0001,minSize: 1,      stepSize: 1,      makerFee: 0.0002, takerFee: 0.0005 },
  OP:    { maxLeverage: 20, tickSize: 0.0001,minSize: 1,      stepSize: 1,      makerFee: 0.0002, takerFee: 0.0005 },
  AVAX:  { maxLeverage: 20, tickSize: 0.01,  minSize: 0.1,    stepSize: 0.1,    makerFee: 0.0002, takerFee: 0.0005 },
  MATIC: { maxLeverage: 20, tickSize: 0.0001,minSize: 10,     stepSize: 10,     makerFee: 0.0002, takerFee: 0.0005 },
  DOGE:  { maxLeverage: 20, tickSize: 0.00001,minSize: 10,    stepSize: 10,     makerFee: 0.0002, takerFee: 0.0005 },
  LINK:  { maxLeverage: 20, tickSize: 0.001, minSize: 0.1,    stepSize: 0.1,    makerFee: 0.0002, takerFee: 0.0005 },
  UNI:   { maxLeverage: 20, tickSize: 0.001, minSize: 0.1,    stepSize: 0.1,    makerFee: 0.0002, takerFee: 0.0005 },
  ATOM:  { maxLeverage: 20, tickSize: 0.001, minSize: 0.1,    stepSize: 0.1,    makerFee: 0.0002, takerFee: 0.0005 },
  LTC:   { maxLeverage: 20, tickSize: 0.01,  minSize: 0.01,   stepSize: 0.01,   makerFee: 0.0002, takerFee: 0.0005 },
  BCH:   { maxLeverage: 20, tickSize: 0.01,  minSize: 0.01,   stepSize: 0.01,   makerFee: 0.0002, takerFee: 0.0005 },
  ETC:   { maxLeverage: 20, tickSize: 0.01,  minSize: 0.1,    stepSize: 0.1,    makerFee: 0.0002, takerFee: 0.0005 },
  FIL:   { maxLeverage: 20, tickSize: 0.001, minSize: 0.1,    stepSize: 0.1,    makerFee: 0.0002, takerFee: 0.0005 },
  APT:   { maxLeverage: 20, tickSize: 0.001, minSize: 0.1,    stepSize: 0.1,    makerFee: 0.0002, takerFee: 0.0005 },
  STX:   { maxLeverage: 20, tickSize: 0.0001,minSize: 1,      stepSize: 1,      makerFee: 0.0002, takerFee: 0.0005 },
  INJ:   { maxLeverage: 20, tickSize: 0.001, minSize: 0.1,    stepSize: 0.1,    makerFee: 0.0002, takerFee: 0.0005 },
  TIA:   { maxLeverage: 20, tickSize: 0.001, minSize: 0.1,    stepSize: 0.1,    makerFee: 0.0002, takerFee: 0.0005 }
};

// Binance symbol mapping (for fallback data)
const BINANCE_MAP = {
  BTC: 'BTCUSDT', ETH: 'ETHUSDT', SOL: 'SOLUSDT', ARB: 'ARBUSDT',
  OP: 'OPUSDT', AVAX: 'AVAXUSDT', MATIC: 'MATICUSDT', DOGE: 'DOGEUSDT',
  LINK: 'LINKUSDT', UNI: 'UNIUSDT', ATOM: 'ATOMUSDT', LTC: 'LTCUSDT',
  BCH: 'BCHUSDT', ETC: 'ETCUSDT', FIL: 'FILUSDT', APT: 'APTUSDT',
  STX: 'STXUSDT', INJ: 'INJUSDT', TIA: 'TIAUSDT'
};

// ─── Cache Layer ─────────────────────────────────────────────────────────────

const cache = new Map();
const CACHE_DURATIONS = {
  prices: 3000,       // 3s — price data refreshes fast
  markets: 15000,     // 15s — market overview
  orderbook: 2000,    // 2s — order book
  funding: 30000,     // 30s — funding rates
  account: 5000,      // 5s — account state
  meta: 300000        // 5min — exchange metadata
};

function getCached(key, maxAge) {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.ts < maxAge) return entry.data;
  return null;
}

function setCache(key, data) {
  cache.set(key, { data, ts: Date.now() });
  // Prevent cache from growing unbounded
  if (cache.size > 500) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].ts - b[1].ts);
    for (let i = 0; i < 100; i++) cache.delete(oldest[i][0]);
  }
}

// ─── Rate Limiter ────────────────────────────────────────────────────────────

const rateLimits = new Map();
const RATE_LIMIT = { window: 60000, maxRequests: 60 }; // 60 req/min per IP

function checkRateLimit(ip) {
  const now = Date.now();
  const record = rateLimits.get(ip);
  if (!record || now - record.windowStart > RATE_LIMIT.window) {
    rateLimits.set(ip, { windowStart: now, count: 1 });
    return true;
  }
  if (record.count >= RATE_LIMIT.maxRequests) return false;
  record.count++;
  return true;
}

// Cleanup stale rate limit entries every 5 minutes
setInterval(() => {
  const cutoff = Date.now() - RATE_LIMIT.window * 2;
  for (const [ip, record] of rateLimits) {
    if (record.windowStart < cutoff) rateLimits.delete(ip);
  }
}, 300000);

// ─── HyperLiquid Data Fetchers ───────────────────────────────────────────────

async function fetchHyperliquidMeta() {
  const cached = getCached('hl_meta', CACHE_DURATIONS.meta);
  if (cached) return cached;

  const res = await axios.post(HYPERLIQUID_INFO, { type: 'metaAndAssetCtxs' }, { timeout: 8000 });
  const [meta, assetCtxs] = Array.isArray(res.data) ? res.data : [null, null];
  if (!meta?.universe) throw new Error('Invalid HyperLiquid meta response');

  const result = { universe: meta.universe, assetCtxs };
  setCache('hl_meta', result);
  return result;
}

async function fetchAllPrices() {
  const cached = getCached('all_prices', CACHE_DURATIONS.prices);
  if (cached) return cached;

  const [midsRes, metaData] = await Promise.all([
    axios.post(HYPERLIQUID_INFO, { type: 'allMids' }, { timeout: 5000 }),
    fetchHyperliquidMeta()
  ]);

  const mids = midsRes.data || {};
  const prices = {};

  for (const coin of SUPPORTED_MARKETS) {
    const idx = metaData.universe.findIndex(u => u.name === coin);
    const ctx = idx >= 0 ? metaData.assetCtxs[idx] : null;

    prices[coin] = {
      mid: parseFloat(mids[coin] || 0),
      mark: parseFloat(ctx?.markPx || mids[coin] || 0),
      index: parseFloat(ctx?.oraclePx || mids[coin] || 0),
      funding: parseFloat(ctx?.funding || 0),
      openInterest: parseFloat(ctx?.openInterest || 0),
      volume24h: parseFloat(ctx?.dayNtlVlm || 0),
      prevDayPx: parseFloat(ctx?.prevDayPx || 0),
      change24h: 0
    };

    // Calculate 24h change
    if (prices[coin].prevDayPx > 0 && prices[coin].mid > 0) {
      prices[coin].change24h = ((prices[coin].mid - prices[coin].prevDayPx) / prices[coin].prevDayPx) * 100;
    }
  }

  setCache('all_prices', prices);
  return prices;
}

async function fetchOrderbook(coin) {
  const cacheKey = `ob_${coin}`;
  const cached = getCached(cacheKey, CACHE_DURATIONS.orderbook);
  if (cached) return cached;

  const res = await axios.post(HYPERLIQUID_INFO, { type: 'l2Book', coin }, { timeout: 5000 });
  const levels = res.data?.levels || [[], []];

  const bids = (levels[0] || []).map(({ px, sz, n }) => ({
    price: parseFloat(px),
    size: parseFloat(sz),
    orders: n || 1
  }));

  const asks = (levels[1] || []).map(({ px, sz, n }) => ({
    price: parseFloat(px),
    size: parseFloat(sz),
    orders: n || 1
  }));

  const result = {
    coin,
    bids: bids.slice(0, 25),
    asks: asks.slice(0, 25),
    bestBid: bids[0]?.price || 0,
    bestAsk: asks[0]?.price || 0,
    spread: (asks[0]?.price || 0) - (bids[0]?.price || 0),
    spreadBps: bids[0]?.price > 0 ? ((asks[0]?.price - bids[0]?.price) / bids[0]?.price) * 10000 : 0,
    bidDepth: bids.reduce((s, b) => s + b.size * b.price, 0),
    askDepth: asks.reduce((s, a) => s + a.size * a.price, 0),
    timestamp: Date.now()
  };

  setCache(cacheKey, result);
  return result;
}

async function fetchFundingRates() {
  const cached = getCached('funding_all', CACHE_DURATIONS.funding);
  if (cached) return cached;

  const metaData = await fetchHyperliquidMeta();
  const funding = {};

  for (const coin of SUPPORTED_MARKETS) {
    const idx = metaData.universe.findIndex(u => u.name === coin);
    const ctx = idx >= 0 ? metaData.assetCtxs[idx] : null;

    const rate = parseFloat(ctx?.funding || 0);
    funding[coin] = {
      rate,
      annualized: rate * 3 * 365 * 100, // 8h funding × 3 × 365 × 100 for percentage
      premium: parseFloat(ctx?.premium || 0),
      markPrice: parseFloat(ctx?.markPx || 0),
      indexPrice: parseFloat(ctx?.oraclePx || 0),
      openInterest: parseFloat(ctx?.openInterest || 0),
      nextFundingTime: getNextFundingTime()
    };
  }

  // Fetch Binance funding as comparison
  try {
    const binanceRes = await axios.get(`${BINANCE_FAPI}/premiumIndex`, { timeout: 5000 });
    if (Array.isArray(binanceRes.data)) {
      for (const item of binanceRes.data) {
        const coin = Object.keys(BINANCE_MAP).find(k => BINANCE_MAP[k] === item.symbol);
        if (coin && funding[coin]) {
          funding[coin].binanceRate = parseFloat(item.lastFundingRate || 0);
          funding[coin].binanceAnnualized = parseFloat(item.lastFundingRate || 0) * 3 * 365 * 100;
          funding[coin].arbitrageSpread = Math.abs(funding[coin].rate - parseFloat(item.lastFundingRate || 0));
        }
      }
    }
  } catch (e) {
    // Binance funding is supplementary — don't fail
  }

  setCache('funding_all', funding);
  return funding;
}

function getNextFundingTime() {
  const now = new Date();
  const hours = now.getUTCHours();
  const nextFunding = [0, 8, 16].find(h => h > hours) ?? 24;
  const next = new Date(now);
  next.setUTCHours(nextFunding === 24 ? 0 : nextFunding, 0, 0, 0);
  if (nextFunding === 24) next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString();
}

async function fetchUserState(address) {
  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    throw new Error('Invalid Ethereum address');
  }

  const cacheKey = `user_${address.toLowerCase()}`;
  const cached = getCached(cacheKey, CACHE_DURATIONS.account);
  if (cached) return cached;

  const [clearingRes, openOrdersRes] = await Promise.all([
    axios.post(HYPERLIQUID_INFO, { type: 'clearinghouseState', user: address }, { timeout: 8000 }),
    axios.post(HYPERLIQUID_INFO, { type: 'openOrders', user: address }, { timeout: 8000 })
  ]);

  const state = clearingRes.data || {};
  const orders = openOrdersRes.data || [];

  const result = {
    address: address.toLowerCase(),
    marginSummary: {
      accountValue: parseFloat(state.marginSummary?.accountValue || 0),
      totalNtlPos: parseFloat(state.marginSummary?.totalNtlPos || 0),
      totalRawUsd: parseFloat(state.marginSummary?.totalRawUsd || 0),
      totalMarginUsed: parseFloat(state.marginSummary?.totalMarginUsed || 0),
      withdrawable: parseFloat(state.crossMarginSummary?.withdrawable || state.marginSummary?.withdrawable || 0)
    },
    positions: (state.assetPositions || []).map(pos => {
      const p = pos.position || pos;
      return {
        coin: p.coin,
        size: parseFloat(p.szi || 0),
        entryPrice: parseFloat(p.entryPx || 0),
        markPrice: parseFloat(p.markPx || 0),
        unrealizedPnl: parseFloat(p.unrealizedPnl || 0),
        liquidationPrice: parseFloat(p.liquidationPx || 0),
        leverage: parseFloat(p.leverage?.value || 0),
        leverageType: p.leverage?.type || 'cross',
        marginUsed: parseFloat(p.marginUsed || 0),
        returnOnEquity: parseFloat(p.returnOnEquity || 0),
        side: parseFloat(p.szi || 0) > 0 ? 'long' : 'short',
        notionalValue: Math.abs(parseFloat(p.szi || 0) * parseFloat(p.markPx || 0))
      };
    }).filter(p => p.size !== 0),
    openOrders: orders.map(o => ({
      oid: o.oid,
      coin: o.coin,
      side: o.side === 'B' ? 'buy' : 'sell',
      price: parseFloat(o.limitPx || 0),
      size: parseFloat(o.sz || 0),
      orderType: o.orderType || 'limit',
      reduceOnly: o.reduceOnly || false,
      timestamp: o.timestamp,
      cloid: o.cloid
    })),
    timestamp: Date.now()
  };

  setCache(cacheKey, result);
  return result;
}

async function fetchCandles(coin, interval = '1h', limit = 100) {
  const cacheKey = `candles_${coin}_${interval}`;
  const cached = getCached(cacheKey, 10000); // 10s cache for candles
  if (cached) return cached;

  const endTime = Date.now();
  const intervalMs = {
    '1m': 60000, '5m': 300000, '15m': 900000, '1h': 3600000, '4h': 14400000, '1d': 86400000
  };
  const startTime = endTime - (intervalMs[interval] || 3600000) * limit;

  const res = await axios.post(HYPERLIQUID_INFO, {
    type: 'candleSnapshot',
    req: { coin, interval, startTime, endTime }
  }, { timeout: 8000 });

  const candles = (res.data || []).map(c => ({
    time: c.t || c.T,
    open: parseFloat(c.o || 0),
    high: parseFloat(c.h || 0),
    low: parseFloat(c.l || 0),
    close: parseFloat(c.c || 0),
    volume: parseFloat(c.v || 0)
  }));

  setCache(cacheKey, candles);
  return candles;
}

// ─── Order Validation (Server-side safety check) ─────────────────────────────

function validateOrder(order) {
  const errors = [];

  // Required fields
  if (!order.coin || !SUPPORTED_MARKETS.includes(order.coin)) {
    errors.push(`Invalid market: ${order.coin}. Supported: ${SUPPORTED_MARKETS.join(', ')}`);
  }

  if (!['buy', 'sell'].includes(order.side)) {
    errors.push(`Invalid side: ${order.side}. Must be 'buy' or 'sell'`);
  }

  if (!['market', 'limit'].includes(order.orderType)) {
    errors.push(`Invalid order type: ${order.orderType}. Must be 'market' or 'limit'`);
  }

  const config = MARKET_CONFIG[order.coin];
  if (config) {
    const size = parseFloat(order.size);
    if (isNaN(size) || size <= 0) {
      errors.push('Size must be a positive number');
    } else if (size < config.minSize) {
      errors.push(`Size ${size} below minimum ${config.minSize} for ${order.coin}`);
    }

    if (order.orderType === 'limit') {
      const price = parseFloat(order.price);
      if (isNaN(price) || price <= 0) {
        errors.push('Limit orders require a valid price');
      }
    }

    const leverage = parseFloat(order.leverage || 1);
    if (leverage < 1 || leverage > config.maxLeverage) {
      errors.push(`Leverage must be between 1x and ${config.maxLeverage}x for ${order.coin}`);
    }
  }

  // TP/SL validation
  if (order.tpPrice) {
    const tp = parseFloat(order.tpPrice);
    if (isNaN(tp) || tp <= 0) errors.push('Invalid take-profit price');
  }
  if (order.slPrice) {
    const sl = parseFloat(order.slPrice);
    if (isNaN(sl) || sl <= 0) errors.push('Invalid stop-loss price');
  }

  return {
    valid: errors.length === 0,
    errors,
    marketConfig: config || null,
    sanitizedOrder: errors.length === 0 ? {
      coin: order.coin,
      side: order.side,
      orderType: order.orderType,
      size: parseFloat(order.size),
      price: order.price ? parseFloat(order.price) : null,
      leverage: parseFloat(order.leverage || 1),
      reduceOnly: !!order.reduceOnly,
      postOnly: !!order.postOnly,
      tpPrice: order.tpPrice ? parseFloat(order.tpPrice) : null,
      slPrice: order.slPrice ? parseFloat(order.slPrice) : null
    } : null
  };
}

// ─── Response Helpers ────────────────────────────────────────────────────────

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json'
  };
}

function success(res, data, cacheControl) {
  const headers = corsHeaders();
  if (cacheControl) headers['Cache-Control'] = cacheControl;
  Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
  return res.status(200).json({ success: true, data, timestamp: Date.now() });
}

function error(res, status, message, details) {
  Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));
  return res.status(status).json({ success: false, error: message, details, timestamp: Date.now() });
}

// ─── Route Handler ───────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));
    return res.status(204).end();
  }

  // Rate limiting
  const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
  if (!checkRateLimit(clientIp)) {
    return error(res, 429, 'Rate limit exceeded. Max 60 requests per minute.');
  }

  try {
    const url = req.url.replace(/\?.*$/, ''); // Strip query params for routing
    const parts = url.split('/').filter(Boolean); // ['api', 'perps', ...]
    
    // Parse route: /api/perps/{action}/{param}
    const action = parts[2] || '';
    const param = parts[3] || '';

    switch (action) {

      // ── GET /api/perps/markets ──────────────────────────────────────
      case 'markets': {
        const prices = await fetchAllPrices();
        const markets = SUPPORTED_MARKETS.map(coin => ({
          coin,
          ...MARKET_CONFIG[coin],
          price: prices[coin]?.mid || 0,
          markPrice: prices[coin]?.mark || 0,
          indexPrice: prices[coin]?.index || 0,
          fundingRate: prices[coin]?.funding || 0,
          openInterest: prices[coin]?.openInterest || 0,
          volume24h: prices[coin]?.volume24h || 0,
          change24h: prices[coin]?.change24h || 0,
          venue: 'hyperliquid'
        }));
        return success(res, { markets, count: markets.length }, 'public, max-age=10');
      }

      // ── GET /api/perps/market/:symbol ───────────────────────────────
      case 'market': {
        const coin = (param || '').toUpperCase();
        if (!SUPPORTED_MARKETS.includes(coin)) {
          return error(res, 400, `Unsupported market: ${coin}`);
        }

        const [prices, orderbook, funding, candles] = await Promise.all([
          fetchAllPrices(),
          fetchOrderbook(coin),
          fetchFundingRates(),
          fetchCandles(coin, req.query?.interval || '1h', parseInt(req.query?.limit) || 100)
        ]);

        return success(res, {
          coin,
          config: MARKET_CONFIG[coin],
          price: prices[coin],
          orderbook,
          funding: funding[coin],
          candles: candles.slice(-100),
          venue: 'hyperliquid'
        }, 'public, max-age=5');
      }

      // ── GET /api/perps/prices ───────────────────────────────────────
      case 'prices': {
        const prices = await fetchAllPrices();
        return success(res, prices, 'public, max-age=3');
      }

      // ── GET /api/perps/orderbook/:symbol ────────────────────────────
      case 'orderbook': {
        const coin = (param || '').toUpperCase();
        if (!SUPPORTED_MARKETS.includes(coin)) {
          return error(res, 400, `Unsupported market: ${coin}`);
        }
        const orderbook = await fetchOrderbook(coin);
        return success(res, orderbook, 'public, max-age=2');
      }

      // ── GET /api/perps/funding ──────────────────────────────────────
      case 'funding': {
        const funding = await fetchFundingRates();
        return success(res, funding, 'public, max-age=15');
      }

      // ── GET /api/perps/candles/:symbol ──────────────────────────────
      case 'candles': {
        const coin = (param || '').toUpperCase();
        if (!SUPPORTED_MARKETS.includes(coin)) {
          return error(res, 400, `Unsupported market: ${coin}`);
        }
        const interval = req.query?.interval || '1h';
        const limit = Math.min(parseInt(req.query?.limit) || 100, 500);
        const candles = await fetchCandles(coin, interval, limit);
        return success(res, { coin, interval, candles }, 'public, max-age=10');
      }

      // ── GET /api/perps/account/:address ─────────────────────────────
      case 'account': {
        if (!param) return error(res, 400, 'Address required');
        const userState = await fetchUserState(param);
        return success(res, userState, 'private, max-age=3');
      }

      // ── POST /api/perps/validate-order ──────────────────────────────
      case 'validate-order': {
        if (req.method !== 'POST') return error(res, 405, 'POST required');
        
        let body = req.body;
        if (!body || typeof body === 'string') {
          try { body = JSON.parse(body || '{}'); } catch { return error(res, 400, 'Invalid JSON body'); }
        }

        const validation = validateOrder(body);
        return res.status(validation.valid ? 200 : 400).json({
          success: validation.valid,
          ...validation,
          timestamp: Date.now()
        });
      }

      // ── GET /api/perps/exchange-config ──────────────────────────────
      case 'exchange-config': {
        const meta = await fetchHyperliquidMeta();
        const assetMap = {};
        meta.universe.forEach((item, idx) => {
          if (SUPPORTED_MARKETS.includes(item.name)) {
            assetMap[item.name] = { index: idx, szDecimals: item.szDecimals };
          }
        });

        return success(res, {
          venues: {
            hyperliquid: {
              name: 'Hyperliquid',
              chain: 'Hyperliquid L1',
              infoUrl: HYPERLIQUID_INFO,
              exchangeUrl: HYPERLIQUID_EXCHANGE,
              chainId: 42161, // Arbitrum for deposits
              bridgeContract: '0x2Df1c51E09aECF9cacB7bc98cB1742757f163dF7',
              signingDomain: {
                name: 'Exchange',
                version: '1',
                chainId: 1337,
                verifyingContract: '0x0000000000000000000000000000000000000000'
              },
              signingTypes: {
                Agent: [
                  { name: 'source', type: 'string' },
                  { name: 'connectionId', type: 'bytes32' }
                ]
              },
              assetMap,
              fees: { maker: 0.0002, taker: 0.0005 },
              minDeposit: 10, // $10 USDC minimum
              depositChains: ['arbitrum', 'optimism', 'base', 'polygon']
            },
            drift: {
              name: 'Drift Protocol',
              chain: 'Solana',
              programId: 'dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH',
              rpcUrl: 'https://api.mainnet-beta.solana.com',
              markets: ['SOL-PERP', 'BTC-PERP', 'ETH-PERP'],
              status: 'available'
            }
          },
          supportedMarkets: SUPPORTED_MARKETS,
          marketConfig: MARKET_CONFIG
        }, 'public, max-age=300');
      }

      // ── POST /api/perps/log-trade ────────────────────────────────
      case 'log-trade': {
        if (req.method !== 'POST') return error(res, 405, 'POST required');
        if (!supabase) return error(res, 503, 'Trade logging unavailable — database not configured');

        let body = req.body;
        if (!body || typeof body === 'string') {
          try { body = JSON.parse(body || '{}'); } catch { return error(res, 400, 'Invalid JSON body'); }
        }

        // Validate required fields
        if (!body.wallet_address || !body.market || !body.side) {
          return error(res, 400, 'Required fields: wallet_address, market, side');
        }

        // Sanitize wallet address
        const walletAddr = String(body.wallet_address).toLowerCase().trim();
        if (!/^0x[a-f0-9]{40}$/i.test(walletAddr) && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(walletAddr)) {
          return error(res, 400, 'Invalid wallet address format');
        }

        const tradeRecord = {
          wallet_address: walletAddr,
          chain: String(body.chain || 'arbitrum').slice(0, 20),
          market: String(body.market || '').toUpperCase().slice(0, 10),
          side: ['long', 'short'].includes(body.side) ? body.side : 'long',
          order_type: ['market', 'limit'].includes(body.order_type) ? body.order_type : 'market',
          price: parseFloat(body.price) || 0,
          amount: parseFloat(body.amount) || 0,
          size: parseFloat(body.size) || 0,
          leverage: Math.min(Math.max(parseFloat(body.leverage) || 1, 1), 100),
          execution_status: String(body.execution_status || 'unknown').slice(0, 20),
          venue: String(body.venue || 'hyperliquid').slice(0, 20),
          hl_oid: body.hl_oid ? String(body.hl_oid).slice(0, 100) : null,
          fee_rate: parseFloat(body.fee_rate) || 0,
          reduce_only: !!body.reduce_only,
          post_only: !!body.post_only,
          tp_price: body.tp_price ? parseFloat(body.tp_price) : null,
          sl_price: body.sl_price ? parseFloat(body.sl_price) : null,
          error_message: body.error_message ? String(body.error_message).slice(0, 500) : null,
          hl_response: body.hl_response ? String(body.hl_response).slice(0, 500) : null,
          created_at: new Date().toISOString()
        };

        try {
          const { data, error: dbErr } = await supabase
            .from('perps_trades')
            .insert(tradeRecord)
            .select();

          if (dbErr) {
            console.error('[log-trade] Supabase insert error:', dbErr.message);
            // If table doesn't exist, try to create it
            if (dbErr.message?.includes('relation') && dbErr.message?.includes('does not exist')) {
              return error(res, 503, 'Database table not initialized. Run the perps_schema migration.');
            }
            return error(res, 500, 'Failed to log trade', dbErr.message);
          }

          return success(res, { logged: true, id: data?.[0]?.id, trade: tradeRecord });
        } catch (err) {
          console.error('[log-trade] Exception:', err.message);
          return error(res, 500, 'Trade logging failed', err.message);
        }
      }

      // ── GET /api/perps/trade-history/:address ───────────────────
      case 'trade-history': {
        if (!supabase) return error(res, 503, 'Trade history unavailable — database not configured');
        if (!param) return error(res, 400, 'Wallet address required');

        const addr = param.toLowerCase().trim();
        const limit = Math.min(parseInt(req.query?.limit) || 50, 200);
        const offset = parseInt(req.query?.offset) || 0;

        try {
          const { data, error: dbErr, count } = await supabase
            .from('perps_trades')
            .select('*', { count: 'exact' })
            .eq('wallet_address', addr)
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

          if (dbErr) {
            console.error('[trade-history] Supabase query error:', dbErr.message);
            return error(res, 500, 'Failed to fetch trade history', dbErr.message);
          }

          return success(res, {
            trades: data || [],
            total: count || 0,
            limit,
            offset,
            wallet: addr
          });
        } catch (err) {
          console.error('[trade-history] Exception:', err.message);
          return error(res, 500, 'Trade history query failed', err.message);
        }
      }

      // ── GET /api/perps/health ───────────────────────────────────────
      case 'health': {
        let hlStatus = 'unknown';
        try {
          const hlRes = await axios.post(HYPERLIQUID_INFO, { type: 'allMids' }, { timeout: 3000 });
          hlStatus = Object.keys(hlRes.data || {}).length > 0 ? 'ok' : 'degraded';
        } catch { hlStatus = 'down'; }

        return success(res, {
          status: hlStatus === 'ok' ? 'healthy' : 'degraded',
          services: {
            hyperliquid: hlStatus,
            database: supabase ? 'connected' : 'not-configured',
            api: 'ok',
            cache: { entries: cache.size }
          },
          uptime: process.uptime(),
          version: '2.0.0'
        });
      }

      // ── Default / Root ──────────────────────────────────────────────
      default: {
        return success(res, {
          service: 'Nexxore Perps API',
          version: '2.0.0',
          architecture: 'Decentralized — client-side signing, direct-to-exchange execution',
          endpoints: [
            'GET  /api/perps/markets',
            'GET  /api/perps/market/:symbol',
            'GET  /api/perps/prices',
            'GET  /api/perps/orderbook/:symbol',
            'GET  /api/perps/candles/:symbol',
            'GET  /api/perps/funding',
            'GET  /api/perps/account/:address',
            'POST /api/perps/validate-order',
            'POST /api/perps/log-trade',
            'GET  /api/perps/trade-history/:address',
            'GET  /api/perps/exchange-config',
            'GET  /api/perps/health'
          ],
          venues: ['Hyperliquid L1', 'Drift (Solana)'],
          documentation: 'https://nexxore.xyz/docs'
        });
      }
    }

  } catch (err) {
    console.error('[Perps API Error]', err.message);
    
    // Distinguish between upstream API failures and internal errors
    if (err.response) {
      return error(res, 502, 'Upstream exchange API error', {
        exchange: err.config?.url || 'unknown',
        status: err.response.status,
        message: err.response.data?.message || err.message
      });
    }

    if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
      return error(res, 504, 'Exchange API timeout');
    }

    return error(res, 500, 'Internal server error', process.env.NODE_ENV === 'development' ? err.message : undefined);
  }
};
