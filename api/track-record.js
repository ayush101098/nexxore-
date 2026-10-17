const { createClient } = require('@supabase/supabase-js');

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 60;
const rateBuckets = new Map();

/* Ledger row (Supabase table `alerts`). Each call stores, at the same timestamp:
 *   model_prob    model probability that the market resolves YES (0–1)
 *   market_prob   market-implied YES probability (midpoint) when the call was made
 *   side          'YES' or 'NO' — the side the call would take
 *   entry_price   price actually payable for that side (the ask), so the spread is included
 *   fee_bps       venue fee on the stake, in basis points (0 where the market charges none)
 *   resolved_yes  1 if the market resolved YES, 0 if NO, null while open
 * There is no sample data: an empty ledger is reported as empty. */
const DEFAULT_FEE_BPS = 0;

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

function applyCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  return Array.isArray(forwarded) ? forwarded[0] : (forwarded || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
}

function isRateLimited(req) {
  const ip = getClientIp(req);
  const now = Date.now();
  const bucket = rateBuckets.get(ip) || { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };

  if (now > bucket.resetAt) {
    rateBuckets.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }

  bucket.count += 1;
  rateBuckets.set(ip, bucket);
  return bucket.count > RATE_LIMIT_MAX;
}

function getCutoff(range) {
  const now = Date.now();
  const days = { '7d': 7, '30d': 30, '90d': 90 }[range];
  return days ? new Date(now - days * 24 * 60 * 60 * 1000) : null;
}

function num(v) {
  const n = Number(v);
  return v == null || v === '' || Number.isNaN(n) ? null : n;
}

function normalizeAlert(row) {
  const modelProb = num(row.model_prob);
  const marketProb = num(row.market_prob);
  const side = String(row.side || (modelProb != null && marketProb != null && modelProb < marketProb ? 'NO' : 'YES')).toUpperCase();
  const entry = num(row.entry_price);
  const feeBps = num(row.fee_bps) ?? DEFAULT_FEE_BPS;
  const y = row.resolved_yes == null ? null : (Number(row.resolved_yes) ? 1 : 0);
  const resolved = y != null;

  // Probability that the chosen side wins, per the model, and its cost per $1 payout
  const pSide = modelProb == null ? null : (side === 'YES' ? modelProb : 1 - modelProb);
  const cost = entry != null ? entry : (marketProb == null ? null : (side === 'YES' ? marketProb : 1 - marketProb));
  const feeFrac = feeBps / 10000;

  // Edge at entry after spread (cost uses the ask) and fees, in cents per $1 share
  const netEdge = pSide != null && cost != null ? (pSide - cost - cost * feeFrac) * 100 : null;
  // Realized return on stake after spread and fees
  let netPnlBps = null;
  if (resolved && cost) {
    const won = (side === 'YES' ? y : 1 - y) === 1;
    netPnlBps = ((won ? 1 : 0) - cost - cost * feeFrac) / cost * 10000;
  }

  return {
    id: String(row.id || ''),
    market_url: row.market_url || '#',
    market_name: row.market_name || 'Unnamed market',
    flagged_at: row.flagged_at || row.created_at,
    resolved_at: row.resolved_at || null,
    side,
    model_prob: modelProb,
    market_prob: marketProb,
    entry_price: cost,
    fee_bps: feeBps,
    net_edge_c: netEdge == null ? null : Number(netEdge.toFixed(2)),
    resolved_yes: y,
    outcome: resolved ? ((side === 'YES' ? y : 1 - y) === 1 ? 'WIN' : 'LOSS') : 'OPEN',
    brier_model: resolved && modelProb != null ? Number(Math.pow(modelProb - y, 2).toFixed(4)) : null,
    brier_market: resolved && marketProb != null ? Number(Math.pow(marketProb - y, 2).toFixed(4)) : null,
    net_pnl_bps: netPnlBps == null ? null : Number(netPnlBps.toFixed(1))
  };
}

async function loadAlerts(range) {
  const cutoff = getCutoff(range);
  const supabase = getSupabase();

  if (!supabase) return [];

  let query = supabase
    .from('alerts')
    .select('*')
    .order('flagged_at', { ascending: false })
    .limit(1000);

  if (cutoff) query = query.gte('flagged_at', cutoff.toISOString());

  const { data, error } = await query;
  if (error) throw error;

  return data || [];
}

function mean(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}
function round(v, d) { return v == null ? null : Number(v.toFixed(d)); }

function calculateStats(rows) {
  const resolved = rows.filter((r) => r.outcome !== 'OPEN');
  const scored = resolved.filter((r) => r.brier_model != null && r.brier_market != null);
  const brierModel = mean(scored.map((r) => r.brier_model));
  const brierMarket = mean(scored.map((r) => r.brier_market));
  const pnl = resolved.filter((r) => r.net_pnl_bps != null);

  let cumulative = 0;
  const equityCurve = [...pnl]
    .sort((a, b) => new Date(a.resolved_at || a.flagged_at) - new Date(b.resolved_at || b.flagged_at))
    .map((r) => {
      cumulative += r.net_pnl_bps / 100; // equal stake per call, % of one stake
      return { date: r.resolved_at || r.flagged_at, pnl: Number(cumulative.toFixed(2)), signal: r.market_name };
    });

  return {
    totalSignals: rows.length,
    resolvedSignals: resolved.length,
    openSignals: rows.length - resolved.length,
    brierModel: round(brierModel, 4),
    brierMarket: round(brierMarket, 4),
    // > 0 means the model's probabilities beat the market's own on the same calls
    brierSkill: brierModel != null && brierMarket ? round(1 - brierModel / brierMarket, 3) : null,
    avgNetEdgeC: round(mean(rows.filter((r) => r.net_edge_c != null).map((r) => r.net_edge_c)), 2),
    hitRate: resolved.length ? round(resolved.filter((r) => r.outcome === 'WIN').length / resolved.length * 100, 1) : null,
    netPnlPct: pnl.length ? Number(cumulative.toFixed(2)) : null,
    equityCurve
  };
}

function calculateCalibration(rows) {
  const scored = rows.filter((r) => r.brier_model != null);
  const bins = [[0, 0.2], [0.2, 0.4], [0.4, 0.6], [0.6, 0.8], [0.8, 1.0001]];
  return bins.map(([lo, hi]) => {
    const inBin = scored.filter((r) => r.model_prob >= lo && r.model_prob < hi);
    return {
      tier: Math.round(lo * 100) + '–' + Math.min(100, Math.round(hi * 100)) + '%',
      count: inBin.length,
      predictedWinRate: inBin.length ? round(mean(inBin.map((r) => r.model_prob)) * 100, 1) : 0,
      actualWinRate: inBin.length ? round(mean(inBin.map((r) => r.resolved_yes)) * 100, 1) : 0
    };
  });
}

function toCsv(alerts) {
  const headers = ['id', 'flagged_at', 'resolved_at', 'market_name', 'side', 'model_prob', 'market_prob', 'entry_price', 'fee_bps', 'net_edge_c', 'resolved_yes', 'brier_model', 'brier_market', 'net_pnl_bps', 'market_url'];
  const rows = alerts.map((alert) => headers.map((key) => {
    const value = alert[key] == null ? '' : String(alert[key]);
    return `"${value.replace(/"/g, '""')}"`;
  }).join(','));
  return [headers.join(','), ...rows].join('\n');
}

module.exports = async (req, res) => {
  applyCors(res);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (isRateLimited(req)) return res.status(429).json({ error: 'Rate limit exceeded' });

  try {
    const range = req.query.range || '30d';
    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '50', 10), 1), 100);
    const alerts = await loadAlerts(range);
    const normalized = alerts.map(normalizeAlert).sort((a, b) => new Date(b.flagged_at) - new Date(a.flagged_at));

    if (req.query.format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="nexxore-track-record-${range}.csv"`);
      return res.status(200).send(toCsv(normalized.filter((alert) => alert.outcome !== 'OPEN')));
    }

    const offset = (page - 1) * limit;
    return res.status(200).json({
      range,
      generatedAt: new Date().toISOString(),
      source: getSupabase() ? 'supabase' : 'none',
      stats: calculateStats(normalized),
      calibration: calculateCalibration(normalized),
      signals: normalized.slice(offset, offset + limit),
      pagination: {
        page,
        limit,
        total: normalized.length,
        totalPages: Math.max(1, Math.ceil(normalized.length / limit))
      }
    });
  } catch (error) {
    console.error('Track record API error:', error);
    return res.status(500).json({ error: 'Failed to load track record' });
  }
};
