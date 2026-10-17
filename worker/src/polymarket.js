// Polymarket reads: eligible markets, order books, resolution status.
const GAMMA = 'https://gamma-api.polymarket.com';
const CLOB = 'https://clob.polymarket.com';

async function getJson(fetchImpl, url) {
  const res = await fetchImpl(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.json();
}

function parseList(v) {
  if (Array.isArray(v)) return v;
  try { return JSON.parse(v || '[]'); } catch (e) { return []; }
}

/** Normalize a gamma market into what the forecaster needs. */
function toMarket(m) {
  const tokens = parseList(m.clobTokenIds);
  return {
    marketId: m.conditionId,
    question: m.question,
    rules: m.description || '',
    endDate: m.endDate,
    category: m.category || (m.events && m.events[0] && m.events[0].category) || null,
    slug: (m.events && m.events[0] && m.events[0].slug) || m.slug,
    liquidity: Number(m.liquidityNum ?? m.liquidity ?? 0),
    volume24h: Number(m.volume24hr ?? 0),
    yesToken: tokens[0] || null,
    noToken: tokens[1] || null,
    outcomes: parseList(m.outcomes),
    feesEnabled: !!m.feesEnabled,
    feeSchedule: m.feeSchedule || null,
    enableOrderBook: m.enableOrderBook !== false
  };
}

/** Spec F1.7: not resolved, 24h volume ≥ min, liquidity ≥ min, ends within maxDays. */
function isEligible(m, cfg, now = Date.now()) {
  if (!m.marketId || !m.yesToken || !m.noToken || !m.enableOrderBook) return false;
  if (m.outcomes.length !== 2) return false;
  const end = Date.parse(m.endDate);
  if (!Number.isFinite(end) || end <= now || end > now + cfg.maxDaysToEnd * 86400e3) return false;
  return m.volume24h >= cfg.minVolume24hUsd && m.liquidity >= cfg.minLiquidityUsd;
}

function makePolymarket({ fetchImpl = fetch } = {}) {
  async function listEligible(cfg, now = Date.now()) {
    const out = [];
    for (let offset = 0; offset < 2000; offset += 500) {
      const page = await getJson(fetchImpl, `${GAMMA}/markets?active=true&closed=false&order=volume24hr&ascending=false&limit=500&offset=${offset}`);
      if (!Array.isArray(page) || !page.length) break;
      for (const raw of page) {
        const m = toMarket(raw);
        if (isEligible(m, cfg, now)) out.push(m);
      }
      // sorted by volume: once a page's last market is under the floor, later pages are too
      if (Number(page[page.length - 1].volume24hr || 0) < cfg.minVolume24hUsd) break;
    }
    return out;
  }

  /** Best bid / best ask for one outcome token. */
  async function bestQuotes(tokenId) {
    const b = await getJson(fetchImpl, `${CLOB}/book?token_id=${encodeURIComponent(tokenId)}`);
    const bids = (b.bids || []).map((l) => Number(l.price)).filter((p) => p > 0 && p < 1);
    const asks = (b.asks || []).map((l) => ({ price: Number(l.price), size: Number(l.size) })).filter((l) => l.price > 0 && l.price < 1 && l.size > 0);
    return {
      bestBid: bids.length ? Math.max(...bids) : null,
      bestAsk: asks.length ? Math.min(...asks.map((l) => l.price)) : null,
      asks
    };
  }

  /** YES midpoint plus the ask for each side, read together. */
  async function snapshot(m) {
    const [yes, no] = await Promise.all([bestQuotes(m.yesToken), bestQuotes(m.noToken)]);
    if (yes.bestBid == null || yes.bestAsk == null || no.bestAsk == null) return null;
    return { mid: (yes.bestBid + yes.bestAsk) / 2, yesAsk: yes.bestAsk, noAsk: no.bestAsk, at: new Date() };
  }

  /** Resolution state for the resolver: open, resolved (yes 1/0) or void. */
  async function resolution(marketId) {
    const list = await getJson(fetchImpl, `${GAMMA}/markets?condition_ids=${encodeURIComponent(marketId)}`);
    const m = Array.isArray(list) ? list[0] : null;
    if (!m) return { state: 'unknown' };
    return classifyResolution(m);
  }

  return { listEligible, snapshot, resolution };
}

/** Spec F2.5–F2.6. Resolved only once UMA reports it; 50/50 or anything else
 *  that is not a clean 1/0 counts as void. */
function classifyResolution(m) {
  if (!m.closed || String(m.umaResolutionStatus || '').toLowerCase() !== 'resolved') return { state: 'open' };
  const prices = parseList(m.outcomePrices).map(Number);
  const at = m.closedTime ? new Date(m.closedTime.replace(' ', 'T').replace(/\+00$/, 'Z')) : new Date();
  if (prices[0] === 1 && prices[1] === 0) return { state: 'resolved', yes: 1, at };
  if (prices[0] === 0 && prices[1] === 1) return { state: 'resolved', yes: 0, at };
  return { state: 'void', at };
}

module.exports = { makePolymarket, toMarket, isEligible, classifyResolution };
