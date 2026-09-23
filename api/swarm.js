// GET /api/swarm?symbol=BTCUSDT — stateless server-side swarm verdict.
// Mirrors the deterministic fusion tier that runs on /swarm: eight sources
// vote on live Binance + Polymarket data, a logistic squash turns the
// weighted score into P(up), and a separate sizer emits the risk plan.
// Routed through api/site.js (Hobby plan caps deployments at 12 functions).

const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
const PM_TAGS = { BTCUSDT: 'bitcoin', ETHUSDT: 'ethereum', SOLUSDT: 'solana' };

const sma = (a, n) => (a.length < n ? null : a.slice(-n).reduce((s, x) => s + x, 0) / n);
function emaSeries(a, n) {
  const k = 2 / (n + 1);
  let e = null;
  return a.map((x) => (e = e === null ? x : x * k + e * (1 - k)));
}
function rsi(a, n) {
  let g = 0, l = 0;
  for (let i = 1; i <= n; i++) { const d = a[i] - a[i - 1]; d > 0 ? (g += d) : (l -= d); }
  g /= n; l /= n;
  for (let i = n + 1; i < a.length; i++) {
    const d = a[i] - a[i - 1];
    g = (g * (n - 1) + Math.max(d, 0)) / n;
    l = (l * (n - 1) + Math.max(-d, 0)) / n;
  }
  return l === 0 ? 100 : 100 - 100 / (1 + g / l);
}
function realizedVol(c, n) {
  const rets = [];
  for (let i = Math.max(1, c.length - n); i < c.length; i++) rets.push(Math.log(c[i] / c[i - 1]));
  const m = rets.reduce((a, b) => a + b, 0) / rets.length;
  const v = rets.reduce((a, b) => a + (b - m) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(v) * Math.sqrt(24 * 365);
}
function atr(h, l, c, n) {
  const trs = [];
  for (let i = 1; i < c.length; i++)
    trs.push(Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1])));
  return sma(trs, Math.min(n, trs.length));
}

async function getJSON(url) {
  const r = await fetch(url, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r.json();
}

async function pmSignal(symbol) {
  try {
    const rows = await getJSON(
      'https://gamma-api.polymarket.com/markets?active=true&closed=false&order=volume24hr&ascending=false&limit=60'
    );
    const re = new RegExp(`\\b(${PM_TAGS[symbol]}|${symbol.replace('USDT', '')})\\b`, 'i');
    const upRe = /(above|reach|hit|exceed|higher|all.?time high|new high|\bup\b)/i;
    const dnRe = /(below|under|lower|dip|fall|drop|crash)/i;
    for (const m of rows) {
      const q = m.question || m.title || '';
      if (!re.test(q) || (!upRe.test(q) && !dnRe.test(q))) continue;
      let yp = null;
      try { yp = parseFloat(JSON.parse(m.outcomePrices)[0]); } catch {}
      if (!isFinite(yp)) yp = parseFloat(m.lastTradePrice);
      if (!isFinite(yp) || yp <= 0.05 || yp >= 0.95) continue; // skip near-resolved books — no forward info
      return { question: q, prob: dnRe.test(q) ? 1 - yp : yp };
    }
  } catch {}
  return null;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const url = new URL(req.url, `http://${req.headers.host}`);
  const symbol = (url.searchParams.get('symbol') || 'BTCUSDT').toUpperCase();
  if (!SYMBOLS.includes(symbol)) {
    return res.status(400).json({ error: 'symbol must be one of ' + SYMBOLS.join(', ') });
  }

  try {
    const [kl, funding, pm] = await Promise.all([
      getJSON(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1h&limit=200`),
      getJSON(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`)
        .then((d) => parseFloat(d.lastFundingRate)).catch(() => null),
      pmSignal(symbol)
    ]);

    const c = kl.map((r) => parseFloat(r[4]));
    const h = kl.map((r) => parseFloat(r[2]));
    const l = kl.map((r) => parseFloat(r[3]));
    const v = kl.map((r) => parseFloat(r[5]));
    const px = c[c.length - 1];

    const ma20 = sma(c, 20), ma50 = sma(c, 50);
    const roc = (px / c[c.length - 25] - 1) * 100;
    const r14 = rsi(c, 14);
    const f12 = emaSeries(c, 12), s26 = emaSeries(c, 26);
    const macdLine = c.map((_, i) => f12[i] - s26[i]);
    const sig9 = emaSeries(macdLine, 9);
    const hist = macdLine.at(-1) - sig9.at(-1);
    const histPrev = macdLine.at(-2) - sig9.at(-2);
    const rv = realizedVol(c, 24), rvLong = realizedVol(c, 168);
    const volRatio = rv / rvLong;
    const vr = sma(v.slice(-24), 24) / sma(v, Math.min(120, v.length));
    const drift = px >= c[c.length - 7];

    const clamp = (x) => Math.max(-1, Math.min(1, x));
    const sources = [
      { key: 'trend', vote: ma20 > ma50 && px > ma20 ? 1 : ma20 < ma50 && px < ma20 ? -1 : ma20 > ma50 ? 0.4 : -0.4,
        conf: Math.min(1, Math.abs(ma20 - ma50) / ma50 * 60) },
      { key: 'momentum', vote: clamp(roc / 4), conf: Math.min(1, Math.abs(roc) / 5) },
      { key: 'rsi', vote: clamp(r14 > 70 ? -((r14 - 70) / 30) : r14 < 30 ? (30 - r14) / 30 : (r14 - 50) / 40),
        conf: Math.min(1, Math.abs(r14 - 50) / 35) },
      { key: 'macd', vote: clamp((hist > 0 ? 0.6 : -0.6) + (hist > histPrev ? 0.4 : -0.4)),
        conf: Math.min(1, Math.abs(hist) / px * 800) },
      { key: 'volregime', vote: volRatio > 1.4 ? -0.6 : volRatio < 0.8 ? 0.3 : 0,
        conf: Math.min(1, Math.abs(volRatio - 1)) },
      { key: 'volume', vote: clamp((vr - 1) * 1.5) * (drift ? 1 : -1), conf: Math.min(1, Math.abs(vr - 1) * 1.2) },
      { key: 'funding', vote: isFinite(funding) ? clamp(-funding * 8000) : 0,
        conf: isFinite(funding) ? Math.min(1, Math.abs(funding) * 6000) : 0.15 },
      { key: 'predmkt', vote: pm ? (pm.prob - 0.5) * 2 : 0,
        conf: pm ? Math.min(1, Math.abs(pm.prob - 0.5) * 2.5 + 0.2) : 0.1 }
    ];

    // Stateless endpoint: equal weights here; the browser tier adapts weights
    // from its local calibration log, the hosted log ships with track-record.
    const score = sources.reduce((s, x) => s + (x.vote * x.conf) / sources.length, 0);
    const pUp = 1 / (1 + Math.exp(-3.4 * score));
    const verdict = pUp > 0.58 ? 'BUY' : pUp < 0.42 ? 'SELL' : 'HOLD';

    const a14 = atr(h, l, c, 14);
    const dir = pUp >= 0.5 ? 1 : -1;
    const size = Math.min(0.05, Math.abs(2 * pUp - 1) * 0.5 * Math.min(1, 0.4 / rv));

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
    return res.status(200).json({
      symbol, price: px, verdict,
      pUp: +pUp.toFixed(4), score: +score.toFixed(4),
      sources: sources.map((s) => ({ key: s.key, vote: +(s.vote * s.conf).toFixed(3) })),
      riskPlan: {
        entry: px,
        stop: +(px - dir * 1.5 * a14).toFixed(2),
        target: +(px + dir * 2.5 * a14).toFixed(2),
        sizeFraction: +size.toFixed(4),
        realizedVolAnn: +rv.toFixed(3)
      },
      predictionMarket: pm,
      paperOnly: true,
      disclaimer: 'Deterministic research signal. Not financial advice.',
      asOf: new Date().toISOString()
    });
  } catch (e) {
    return res.status(502).json({ error: 'Upstream data unreachable', detail: e.message });
  }
};
