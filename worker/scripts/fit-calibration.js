// Fit the calibration model on resolved Polymarket markets and write
// worker/model/calibration.json. Out-of-sample Brier is reported against the
// market's own price on a held-out set of markets.
//
//   node worker/scripts/fit-calibration.js [maxMarkets=800]
const fs = require('fs');
const path = require('path');
const C = require('../src/calibration');

const GAMMA = 'https://gamma-api.polymarket.com';
const CLOB = 'https://clob.polymarket.com';
const MAX = Number(process.argv[2] || 800);
const MIN_VOLUME = 10000;
const SAMPLES_PER_MARKET = 3;
const DAY = 86400;

async function get(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(url).catch(() => null);
    if (r && r.ok) return r.json();
    await new Promise((res) => setTimeout(res, 500 * (attempt + 1)));
  }
  throw new Error(`fetch failed: ${url}`);
}

// Deterministic pseudo-random so a refit on the same data gives the same model
let seed = 42;
function rand() { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }

async function resolvedMarkets() {
  const out = [];
  const endMax = new Date(Date.now() - 2 * DAY * 1000).toISOString();
  const endMin = new Date(Date.now() - 270 * DAY * 1000).toISOString();
  for (let offset = 0; out.length < MAX && offset < 20000; offset += 100) {
    const page = await get(`${GAMMA}/markets?closed=true&limit=100&offset=${offset}&volume_num_min=${MIN_VOLUME}&end_date_min=${endMin}&end_date_max=${endMax}`);
    if (!Array.isArray(page) || !page.length) break;
    for (const m of page) {
      if (String(m.umaResolutionStatus).toLowerCase() !== 'resolved') continue;
      const prices = m.outcomePrices;
      const y = prices === '["1", "0"]' ? 1 : prices === '["0", "1"]' ? 0 : null;
      let tokens = []; try { tokens = JSON.parse(m.clobTokenIds || '[]'); } catch (e) {}
      if (y == null || tokens.length !== 2 || !m.endDate) continue;
      out.push({ id: m.conditionId, token: tokens[0], y, end: Date.parse(m.endDate) / 1000 });
    }
  }
  return out.slice(0, MAX);
}

/** Up to SAMPLES_PER_MARKET (price, days to end) points taken before the market's end. */
async function samples(m) {
  const h = await get(`${CLOB}/prices-history?market=${m.token}&interval=max&fidelity=720`).catch(() => null);
  const pts = (h && h.history || [])
    .map((p) => ({ price: Number(p.p), days: (m.end - p.t) / DAY }))
    .filter((p) => p.days >= 0.5 && p.days <= 90 && p.price >= 0.02 && p.price <= 0.98);
  const picked = [];
  for (let i = 0; i < SAMPLES_PER_MARKET && pts.length; i++) picked.push(pts.splice(Math.floor(rand() * pts.length), 1)[0]);
  return picked.map((p) => ({ ...p, y: m.y, market: m.id }));
}

async function main() {
  const markets = await resolvedMarkets();
  console.log(`resolved binary markets: ${markets.length}`);
  const rows = [];
  for (let i = 0; i < markets.length; i += 8) {
    const batch = await Promise.all(markets.slice(i, i + 8).map(samples));
    batch.forEach((b) => rows.push(...b));
  }
  const used = new Set(rows.map((r) => r.market));
  console.log(`samples: ${rows.length} from ${used.size} markets`);

  // Split by market, not by row, so no market is in both sets
  const ids = [...used].sort();
  const testIds = new Set(ids.filter((_, i) => i % 10 < 3));
  const train = rows.filter((r) => !testIds.has(r.market));
  const test = rows.filter((r) => testIds.has(r.market));

  const weights = C.fit(train);
  const model = { weights, trainMarkets: ids.length - testIds.size };
  const bModel = C.brier(test, (r) => C.predict(model, r.price, r.days));
  const bMarket = C.brier(test, (r) => r.price);
  const skill = 1 - bModel / bMarket;
  console.log(`weights ${weights.map((w) => w.toFixed(4)).join(', ')}`);
  console.log(`held-out: ${test.length} samples / ${testIds.size} markets · Brier model ${bModel.toFixed(4)} vs market ${bMarket.toFixed(4)} · skill ${(skill * 100).toFixed(2)}%`);

  // Refit on everything for the production model; keep the held-out score
  const final = C.fit(rows);
  const out = {
    version: `calibration-v1-${new Date().toISOString().slice(0, 10)}`,
    form: 'p = sigmoid(w0 + w1*logit(m) + w2*logit(m)*ln(1+days))',
    weights: final,
    trainMarkets: ids.length,
    samples: rows.length,
    heldOut: { markets: testIds.size, samples: test.length, brierModel: bModel, brierMarket: bMarket, skill },
    data: { minTotalVolume: MIN_VOLUME, window: 'markets that ended 2–270 days before fitting', samplesPerMarket: SAMPLES_PER_MARKET },
    fittedAt: new Date().toISOString()
  };
  const file = path.join(__dirname, '..', 'model', 'calibration.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`wrote ${file}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
