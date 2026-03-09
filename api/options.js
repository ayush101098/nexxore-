/**
 * Options Chain API — Deribit Integration + Black-Scholes Greeks
 * ═══════════════════════════════════════════════════════════════
 *
 * Endpoints:
 *   GET /api/options?action=expiries&asset=BTC              → Available expiry dates
 *   GET /api/options?action=chain&asset=BTC&expiry=2025-06-27  → Options chain with greeks
 *   GET /api/options?action=spot&asset=BTC                  → Current spot/index price
 *   GET /api/options?action=funding&asset=BTC               → Perp funding rate (Hyperliquid)
 *
 * Data Sources:
 *   - Deribit Public API (options chain, IV, prices)  — no auth required
 *   - Hyperliquid API (perp funding rates)
 *   - Black-Scholes model (greeks calculated server-side from IV)
 *
 * Assets: BTC, ETH, SOL
 */

const DERIBIT = 'https://www.deribit.com/api/v2/public';
const HYPERLIQUID = 'https://api.hyperliquid.xyz/info';

// ═══════════════════════════════════════════
//  CACHE
// ═══════════════════════════════════════════
const cache = new Map();
const CACHE_TTL = 30_000; // 30s for fast-moving options data

function getCached(key) {
  const c = cache.get(key);
  if (c && Date.now() - c.ts < CACHE_TTL) return c.data;
  return null;
}
function setCache(key, data) {
  cache.set(key, { data, ts: Date.now() });
}

async function fetchJSON(url, opts = {}) {
  const cacheKey = opts.cacheKey || url;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  try {
    const fetchOpts = {
      method: opts.method || 'GET',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', ...(opts.headers || {}) },
    };
    if (opts.body) fetchOpts.body = JSON.stringify(opts.body);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    fetchOpts.signal = controller.signal;

    const r = await fetch(url, fetchOpts);
    clearTimeout(timeout);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    const result = d.result !== undefined ? d.result : d;
    setCache(cacheKey, result);
    return result;
  } catch (e) {
    console.error(`[Options API] fetch error (${url}):`, e.message);
    return null;
  }
}

// ═══════════════════════════════════════════
//  BLACK-SCHOLES GREEKS CALCULATOR
// ═══════════════════════════════════════════

/** Standard normal CDF (Abramowitz & Stegun approximation) */
function N(x) {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + p * ax);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return 0.5 * (1 + sign * y);
}

/** Standard normal PDF */
function Nprime(x) {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

/**
 * Calculate Black-Scholes option price + greeks
 * @param {number} S  – Spot price
 * @param {number} K  – Strike price
 * @param {number} T  – Time to expiry (years)
 * @param {number} r  – Risk-free rate (e.g. 0.05)
 * @param {number} iv – Implied volatility (decimal, e.g. 0.55 = 55%)
 * @param {boolean} isCall
 */
function bsGreeks(S, K, T, r, iv, isCall) {
  if (T <= 0 || iv <= 0 || S <= 0 || K <= 0) {
    // At or past expiry — intrinsic value only
    const intrinsic = isCall ? Math.max(0, S - K) : Math.max(0, K - S);
    return { price: intrinsic, delta: isCall ? (S > K ? 1 : 0) : (S < K ? -1 : 0), gamma: 0, theta: 0, vega: 0 };
  }

  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + 0.5 * iv * iv) * T) / (iv * sqrtT);
  const d2 = d1 - iv * sqrtT;

  const nd1 = N(d1);
  const nd2 = N(d2);
  const npd1 = Nprime(d1);
  const erfT = Math.exp(-r * T);

  let price, delta, theta;

  if (isCall) {
    price = S * nd1 - K * erfT * nd2;
    delta = nd1;
    theta = (-S * npd1 * iv / (2 * sqrtT) - r * K * erfT * nd2) / 365;
  } else {
    price = K * erfT * N(-d2) - S * N(-d1);
    delta = nd1 - 1;
    theta = (-S * npd1 * iv / (2 * sqrtT) + r * K * erfT * N(-d2)) / 365;
  }

  const gamma = npd1 / (S * iv * sqrtT);
  const vega = S * npd1 * sqrtT / 100; // per 1% IV move

  return {
    price: Math.max(0, price),
    delta: +delta.toFixed(4),
    gamma: +gamma.toFixed(6),
    theta: +theta.toFixed(2),
    vega: +vega.toFixed(2)
  };
}

// ═══════════════════════════════════════════
//  DERIBIT HELPERS
// ═══════════════════════════════════════════

const VALID_ASSETS = ['BTC', 'ETH', 'SOL'];

function defaultSpot(c) {
  return { BTC: 105000, ETH: 3800, SOL: 180 }[c] || 100;
}

async function deribitGet(endpoint, params) {
  const qs = new URLSearchParams(params).toString();
  return fetchJSON(`${DERIBIT}/${endpoint}?${qs}`, { cacheKey: `deribit:${endpoint}:${qs}` });
}

// ═══════════════════════════════════════════
//  ACTION HANDLERS
// ═══════════════════════════════════════════

/** GET /api/options?action=spot&asset=BTC */
async function handleSpot(asset) {
  const data = await deribitGet('get_index_price', { index_name: `${asset.toLowerCase()}_usd` });
  const spot = data?.index_price || defaultSpot(asset);
  return { spot, asset };
}

/** GET /api/options?action=expiries&asset=BTC */
async function handleExpiries(asset) {
  const instruments = await deribitGet('get_instruments', { currency: asset, kind: 'option', expired: 'false' });

  if (!instruments || !Array.isArray(instruments) || instruments.length === 0) {
    return { expiries: syntheticExpiries(), synthetic: true, asset };
  }

  const map = new Map();
  for (const inst of instruments) {
    const ts = inst.expiration_timestamp;
    const key = new Date(ts).toISOString().split('T')[0];
    if (!map.has(key)) {
      const d = new Date(ts);
      map.set(key, {
        date: key,
        timestamp: ts,
        label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        daysToExpiry: Math.max(0, Math.ceil((ts - Date.now()) / 86400000)),
        strikeCount: 0
      });
    }
    map.get(key).strikeCount++;
  }

  return {
    expiries: Array.from(map.values()).sort((a, b) => a.timestamp - b.timestamp),
    asset
  };
}

/** GET /api/options?action=chain&asset=BTC&expiry=2025-06-27 */
async function handleChain(asset, expiry) {
  // Parallel fetch: instruments, book summaries, spot price
  const [instruments, summaries, spotData] = await Promise.all([
    deribitGet('get_instruments', { currency: asset, kind: 'option', expired: 'false' }),
    deribitGet('get_book_summary_by_currency', { currency: asset, kind: 'option' }),
    deribitGet('get_index_price', { index_name: `${asset.toLowerCase()}_usd` })
  ]);

  const spot = spotData?.index_price || defaultSpot(asset);

  // If Deribit data unavailable, generate synthetic chain
  if (!instruments || !Array.isArray(instruments) || instruments.length === 0) {
    return syntheticChain(asset, spot, expiry);
  }

  // Filter to requested expiry
  let filtered = instruments;
  if (expiry) {
    filtered = instruments.filter(inst => {
      const d = new Date(inst.expiration_timestamp).toISOString().split('T')[0];
      return d === expiry;
    });
    if (filtered.length === 0) filtered = instruments; // fallback to all
  }

  // Build summary lookup
  const sumMap = new Map();
  if (summaries && Array.isArray(summaries)) {
    summaries.forEach(s => sumMap.set(s.instrument_name, s));
  }

  // Build chain grouped by strike
  const chain = new Map();
  const r = 0.05;

  for (const inst of filtered) {
    const strike = inst.strike;
    const isCall = inst.option_type === 'call';
    const T = Math.max((inst.expiration_timestamp - Date.now()) / (365.25 * 24 * 3600000), 0.001);
    const summary = sumMap.get(inst.instrument_name) || {};

    const iv = (summary.mark_iv || 50) / 100;
    const greeks = bsGreeks(spot, strike, T, r, iv, isCall);

    // Deribit prices are in base currency → convert to USD
    const markUSD = (summary.mark_price || 0) * spot;
    const bidUSD = (summary.bid_price || 0) * spot;
    const askUSD = (summary.ask_price || 0) * spot;

    if (!chain.has(strike)) chain.set(strike, { strike, call: null, put: null });

    const optData = {
      instrument: inst.instrument_name,
      type: isCall ? 'call' : 'put',
      strike,
      expiry: new Date(inst.expiration_timestamp).toISOString().split('T')[0],
      dte: Math.ceil(T * 365.25),
      mark: +markUSD.toFixed(2),
      bid: +bidUSD.toFixed(2),
      ask: +askUSD.toFixed(2),
      iv: +(summary.mark_iv || 50).toFixed(1),
      volume: Math.round(summary.volume_usd || 0),
      oi: Math.round(summary.open_interest || 0),
      ...greeks
    };

    chain.get(strike)[isCall ? 'call' : 'put'] = optData;
  }

  // Filter to ±50% of spot, sort by strike
  const sorted = Array.from(chain.values())
    .filter(row => row.strike >= spot * 0.5 && row.strike <= spot * 1.5)
    .sort((a, b) => a.strike - b.strike);

  // Get available expiries from this chain
  const expiries = [...new Set(filtered.map(i => new Date(i.expiration_timestamp).toISOString().split('T')[0]))].sort();

  return { spot, chain: sorted, asset, expiry: expiry || expiries[0], expiries };
}

/** GET /api/options?action=funding&asset=BTC */
async function handleFunding(asset) {
  try {
    // Hyperliquid funding rates
    const meta = await fetchJSON(HYPERLIQUID, {
      method: 'POST',
      body: { type: 'metaAndAssetCtxs' },
      cacheKey: `hl:meta`
    });

    if (!meta || !Array.isArray(meta) || meta.length < 2) {
      return { asset, fundingRate: 0, annualized: 0 };
    }

    const universe = meta[0]?.universe || [];
    const ctxs = meta[1] || [];
    const idx = universe.findIndex(u => u.name === asset);

    if (idx >= 0 && ctxs[idx]) {
      const funding = parseFloat(ctxs[idx].funding || '0');
      return {
        asset,
        fundingRate: +(funding * 100).toFixed(4),     // as percentage
        annualized: +(funding * 100 * 3 * 365).toFixed(2),  // 8h rate → annual
        markPrice: parseFloat(ctxs[idx].markPx || '0'),
        openInterest: parseFloat(ctxs[idx].openInterest || '0')
      };
    }
    return { asset, fundingRate: 0, annualized: 0 };
  } catch (e) {
    console.error('[Options API] Funding fetch error:', e.message);
    return { asset, fundingRate: 0, annualized: 0 };
  }
}

// ═══════════════════════════════════════════
//  SYNTHETIC DATA FALLBACK
// ═══════════════════════════════════════════

function syntheticExpiries() {
  const now = Date.now();
  return [7, 14, 30, 60, 90, 180, 365].map(days => {
    const ts = now + days * 86400000;
    const d = new Date(ts);
    return {
      date: d.toISOString().split('T')[0],
      timestamp: ts,
      label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      daysToExpiry: days,
      strikeCount: 20
    };
  });
}

function syntheticChain(asset, spot, expiry) {
  const chain = [];
  const T = expiry
    ? Math.max((new Date(expiry).getTime() - Date.now()) / (365.25 * 24 * 3600000), 0.01)
    : 30 / 365.25;
  const r = 0.05;
  const baseIV = 0.55;

  const intervals = { BTC: 5000, ETH: 100, SOL: 5 };
  const step = intervals[asset] || Math.round(spot / 20);
  const lo = Math.round((spot * 0.7) / step) * step;
  const hi = Math.round((spot * 1.3) / step) * step;

  for (let strike = lo; strike <= hi; strike += step) {
    const moneyness = Math.log(spot / strike);
    const skew = 0.06 * moneyness;
    const iv = Math.max(0.15, baseIV + skew);

    const cg = bsGreeks(spot, strike, T, r, iv, true);
    const pg = bsGreeks(spot, strike, T, r, iv, false);
    const spread = Math.max(cg.price * 0.04, spot * 0.0003);
    const expiryDate = expiry || new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];

    const buildOpt = (greeks, isCall) => ({
      instrument: `${asset}-SYN-${strike}-${isCall ? 'C' : 'P'}`,
      type: isCall ? 'call' : 'put',
      strike,
      expiry: expiryDate,
      dte: Math.round(T * 365.25),
      mark: +greeks.price.toFixed(2),
      bid: +Math.max(0, greeks.price - spread).toFixed(2),
      ask: +(greeks.price + spread).toFixed(2),
      iv: +(iv * 100).toFixed(1),
      volume: Math.round(Math.random() * 800 + 50) * 1000,
      oi: Math.round(Math.random() * 3000 + 200),
      ...greeks
    });

    chain.push({
      strike,
      call: buildOpt(cg, true),
      put: buildOpt(pg, false)
    });
  }

  return {
    spot,
    chain,
    asset,
    expiry: expiry || new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
    expiries: syntheticExpiries().map(e => e.date),
    synthetic: true
  };
}

// ═══════════════════════════════════════════
//  MAIN HANDLER
// ═══════════════════════════════════════════

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // Parse query
  const url = new URL(req.url, `http://${req.headers.host}`);
  const action = url.searchParams.get('action');
  const asset = (url.searchParams.get('asset') || 'BTC').toUpperCase();
  const expiry = url.searchParams.get('expiry');

  if (!VALID_ASSETS.includes(asset)) {
    return res.status(400).json({ error: `Invalid asset "${asset}". Use: ${VALID_ASSETS.join(', ')}` });
  }

  try {
    switch (action) {
      case 'spot':
        return res.json(await handleSpot(asset));
      case 'expiries':
        return res.json(await handleExpiries(asset));
      case 'chain':
        return res.json(await handleChain(asset, expiry));
      case 'funding':
        return res.json(await handleFunding(asset));
      default:
        return res.status(400).json({
          error: 'Missing or invalid "action" parameter',
          validActions: ['spot', 'expiries', 'chain', 'funding'],
          example: '/api/options?action=chain&asset=BTC&expiry=2025-06-27'
        });
    }
  } catch (e) {
    console.error('[Options API] Error:', e);
    return res.status(500).json({ error: 'Internal server error', message: e.message });
  }
};
