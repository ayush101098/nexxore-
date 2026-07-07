const { createClient } = require('@supabase/supabase-js');

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 60;
const rateBuckets = new Map();

const SAMPLE_ALERTS = [
  {
    id: 'sig_001',
    market_url: 'https://polymarket.com/event/fed-rate-decision-june',
    market_name: 'Fed holds rates after June meeting',
    signal_type: 'PREDICTION_MARKET_EDGE',
    edge_score: 14,
    confidence: 72,
    flagged_at: '2026-06-17T08:21:00.000Z',
    resolved_at: null,
    outcome: 'OPEN',
    pnl_bps: 0
  },
  {
    id: 'sig_002',
    market_url: 'https://polymarket.com/event/eth-above-3800',
    market_name: 'ETH above $3,800 by Friday',
    signal_type: 'ON_CHAIN_ANOMALY',
    edge_score: 11,
    confidence: 64,
    flagged_at: '2026-06-15T13:04:00.000Z',
    resolved_at: '2026-06-17T00:00:00.000Z',
    outcome: 'WIN',
    pnl_bps: 186
  },
  {
    id: 'sig_003',
    market_url: 'https://polymarket.com/event/bitcoin-weekly-close',
    market_name: 'BTC weekly close above $106K',
    signal_type: 'MACRO_INDICATOR',
    edge_score: 9,
    confidence: 58,
    flagged_at: '2026-06-12T19:40:00.000Z',
    resolved_at: '2026-06-16T00:00:00.000Z',
    outcome: 'LOSS',
    pnl_bps: -74
  },
  {
    id: 'sig_004',
    market_url: 'https://polymarket.com/event/us-oil-shipping-risk',
    market_name: 'Energy shipping risk premium widens',
    signal_type: 'ESCALATION_INDEX',
    edge_score: 16,
    confidence: 79,
    flagged_at: '2026-06-10T06:12:00.000Z',
    resolved_at: '2026-06-14T00:00:00.000Z',
    outcome: 'WIN',
    pnl_bps: 238
  },
  {
    id: 'sig_005',
    market_url: 'https://polymarket.com/event/solana-spot-etf-june',
    market_name: 'Solana ETF approval before July',
    signal_type: 'COMBINED',
    edge_score: 8,
    confidence: 53,
    flagged_at: '2026-06-06T10:09:00.000Z',
    resolved_at: '2026-06-13T00:00:00.000Z',
    outcome: 'BREAKEVEN',
    pnl_bps: 8
  },
  {
    id: 'sig_006',
    market_url: 'https://polymarket.com/event/base-tvl-18b',
    market_name: 'Base TVL clears $18B',
    signal_type: 'ON_CHAIN_ANOMALY',
    edge_score: 13,
    confidence: 69,
    flagged_at: '2026-05-28T11:30:00.000Z',
    resolved_at: '2026-06-04T00:00:00.000Z',
    outcome: 'WIN',
    pnl_bps: 142
  },
  {
    id: 'sig_007',
    market_url: 'https://polymarket.com/event/us-cpi-below-consensus',
    market_name: 'US CPI below consensus',
    signal_type: 'MACRO_INDICATOR',
    edge_score: 12,
    confidence: 66,
    flagged_at: '2026-05-21T07:52:00.000Z',
    resolved_at: '2026-05-28T00:00:00.000Z',
    outcome: 'LOSS',
    pnl_bps: -92
  }
];

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

function normalizeAlert(alert) {
  return {
    id: String(alert.id || alert.signal_id || ''),
    market_url: alert.market_url || alert.verify_url || '#',
    market_name: alert.market_name || alert.asset || alert.protocol || 'Unnamed signal',
    signal_type: alert.signal_type || alert.trigger_source || 'SIGNAL',
    edge_score: Number(alert.edge_score || alert.alpha_score || 0),
    confidence: Number(alert.confidence || alert.confidence_score || 0),
    flagged_at: alert.flagged_at || alert.generated_at || alert.created_at,
    resolved_at: alert.resolved_at || null,
    outcome: (alert.outcome || alert.status || 'OPEN').toUpperCase(),
    pnl_bps: Number(alert.pnl_bps || alert.realized_pnl_pct * 100 || alert.return_24h * 100 || 0)
  };
}

async function loadAlerts(range) {
  const cutoff = getCutoff(range);
  const supabase = getSupabase();

  if (!supabase) {
    return SAMPLE_ALERTS.filter((alert) => !cutoff || new Date(alert.flagged_at) >= cutoff);
  }

  let query = supabase
    .from('alerts')
    .select('id, market_url, market_name, signal_type, edge_score, confidence, flagged_at, resolved_at, outcome, pnl_bps')
    .order('flagged_at', { ascending: false })
    .limit(1000);

  if (cutoff) query = query.gte('flagged_at', cutoff.toISOString());

  const { data, error } = await query;
  if (error) throw error;

  return (data || []).map(normalizeAlert);
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[index];
}

function calculateStats(alerts) {
  const resolved = alerts.filter((alert) => ['WIN', 'LOSS', 'BREAKEVEN'].includes(alert.outcome));
  const returns = resolved.map((alert) => alert.pnl_bps / 10000);
  const wins = resolved.filter((alert) => alert.outcome === 'WIN' || alert.pnl_bps > 0).length;
  const avgReturn = returns.length ? returns.reduce((sum, value) => sum + value, 0) / returns.length : 0;
  const variance = returns.length > 1
    ? returns.reduce((sum, value) => sum + Math.pow(value - avgReturn, 2), 0) / (returns.length - 1)
    : 0;
  const sharpe = variance > 0 ? (avgReturn / Math.sqrt(variance)) * Math.sqrt(Math.min(252, returns.length || 1)) : 0;

  let cumulative = 0;
  let peak = 0;
  let maxDrawdown = 0;
  const equityCurve = [...resolved]
    .sort((a, b) => new Date(a.flagged_at) - new Date(b.flagged_at))
    .map((alert) => {
      cumulative += alert.pnl_bps / 100;
      peak = Math.max(peak, cumulative);
      maxDrawdown = Math.min(maxDrawdown, cumulative - peak);
      return {
        date: alert.resolved_at || alert.flagged_at,
        pnl: Number(cumulative.toFixed(2)),
        signal: alert.market_name
      };
    });

  return {
    totalSignals: alerts.length,
    resolvedSignals: resolved.length,
    openSignals: alerts.length - resolved.length,
    winRate: resolved.length ? Number(((wins / resolved.length) * 100).toFixed(1)) : 0,
    avgReturnBps: Number((avgReturn * 10000).toFixed(1)),
    sharpe: Number(sharpe.toFixed(2)),
    maxDrawdownPct: Number(maxDrawdown.toFixed(2)),
    totalPnlPct: Number(cumulative.toFixed(2)),
    p95ReturnBps: Number((percentile(resolved.map((alert) => alert.pnl_bps), 95)).toFixed(1)),
    equityCurve
  };
}

function calculateCalibration(alerts) {
  const tiers = [
    { label: '8-9c', min: 8, max: 9 },
    { label: '10-11c', min: 10, max: 11 },
    { label: '12-14c', min: 12, max: 14 },
    { label: '15c+', min: 15, max: Infinity }
  ];

  return tiers.map((tier) => {
    const tierAlerts = alerts.filter((alert) => (
      ['WIN', 'LOSS', 'BREAKEVEN'].includes(alert.outcome) &&
      alert.edge_score >= tier.min &&
      alert.edge_score <= tier.max
    ));
    const wins = tierAlerts.filter((alert) => alert.outcome === 'WIN' || alert.pnl_bps > 0).length;
    const predicted = tierAlerts.length
      ? tierAlerts.reduce((sum, alert) => sum + alert.confidence, 0) / tierAlerts.length
      : 0;

    return {
      tier: tier.label,
      count: tierAlerts.length,
      predictedWinRate: Number(predicted.toFixed(1)),
      actualWinRate: tierAlerts.length ? Number(((wins / tierAlerts.length) * 100).toFixed(1)) : 0
    };
  });
}

function toCsv(alerts) {
  const headers = ['id', 'flagged_at', 'market_name', 'signal_type', 'edge_score', 'confidence', 'outcome', 'pnl_bps', 'market_url'];
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
      source: getSupabase() ? 'supabase' : 'sample',
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
