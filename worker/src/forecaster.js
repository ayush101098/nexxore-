// One forecast run: pick due markets, read the book, forecast from that
// snapshot, and write every forecast to the ledger — calls or not.
const crypto = require('crypto');
const Edge = require('../../js/edge.js');

function isDue(last, snapMid, cfg, now) {
  if (!last) return true;
  if (now - Date.parse(last.flagged_at) >= cfg.reforecastHours * 3600e3) return true;
  return snapMid != null && Math.abs(snapMid - Number(last.market_prob)) * 100 >= cfg.reforecastMoveCents;
}

/** Build the ledger row from a forecast and a book snapshot taken right after it. */
function buildRow(m, f, snap, cfg) {
  const side = Edge.chooseSide(f.probability, snap.mid);
  const ask = side === 'YES' ? snap.yesAsk : snap.noAsk;
  const feeBps = Edge.polymarketFeeBps(m, ask);
  const ev = Edge.evaluate({ p: f.probability, m: snap.mid, side, ask, feeBps });
  return {
    id: crypto.randomUUID(),
    market_id: m.marketId,
    market_url: `https://polymarket.com/event/${m.slug}`,
    market_name: m.question,
    category: m.category,
    end_date: m.endDate,
    flagged_at: snap.at.toISOString(),
    side,
    model_prob: round(f.probability, 4),
    market_prob: round(snap.mid, 4),
    entry_price: round(ask, 4),
    fee_bps: round(feeBps, 2),
    is_call: ev.netEdgeC >= cfg.callThresholdCents,
    status: 'open',
    prompt_version: f.promptVersion,
    thesis: f.thesis,
    invalidation: f.invalidation
  };
}

function round(x, d) { return Number(x.toFixed(d)); }

// Stop the run after this many markets fail in a row: something systemic
// (an API outage) is wrong, and continuing only multiplies errors.
const MAX_CONSECUTIVE_FAILURES = 3;

async function runForecast({ cfg, pm, model, db, log, now = () => Date.now() }) {
  const stats = { eligible: 0, due: 0, forecast: 0, calls: 0, skipped: 0, stoppedBy: null };
  const today = await db.marketsForecastToday(new Date(now()));
  const markets = await pm.listEligible(cfg, now());
  stats.eligible = markets.length;
  let consecutiveFailures = 0;
  const latest = await db.latestByMarket(markets.map((m) => m.marketId));

  for (const m of markets) {
    const last = latest[m.marketId];
    const snap = await pm.snapshot(m).catch(() => null);
    if (!isDue(last, snap && snap.mid, cfg, now())) continue;
    stats.due++;
    if (!today.has(m.marketId) && today.size >= cfg.maxMarketsPerDay) { stats.stoppedBy = 'max_markets'; break; }
    if (!snap) {
      stats.skipped++;
      log.error(`no order book for ${m.marketId}; not forecast`);
      if (++consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) { stats.stoppedBy = 'consecutive_failures'; break; }
      continue;
    }
    consecutiveFailures = 0;

    // Probability and ledger row from the same book snapshot
    const f = model.forecast(m, snap, snap.at.getTime());
    const row = buildRow(m, f, snap, cfg);
    await db.upsertMarket(m);
    await db.insertForecast(row, { bull_case: null, bear_case: null, judge_output: f.reasoning, model_ids: f.modelIds });
    today.add(m.marketId);
    stats.forecast++;
    if (row.is_call) stats.calls++;
    log.info(`forecast ${m.marketId} p=${row.model_prob} mid=${row.market_prob} ${row.side} ${row.is_call ? 'CALL' : 'no call'}`);
  }
  return stats;
}

module.exports = { runForecast, buildRow, isDue };
