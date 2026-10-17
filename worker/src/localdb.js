// File-backed ledger for local runs (LEDGER_FILE=...). Same interface as db.js,
// append-only like the real table: rows are never edited except resolution fields.
const fs = require('fs');
const { utcDayStart } = require('./db');

function makeLocalDb(file) {
  const load = () => {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return { alerts: [], forecast_reasoning: [], llm_spend: [], markets: {} }; }
  };
  const save = (d) => fs.writeFileSync(file, JSON.stringify(d, null, 2));

  return {
    async spentToday(now = new Date()) {
      const day = utcDayStart(now).toISOString().slice(0, 10);
      return load().llm_spend.filter((s) => s.day === day).reduce((a, s) => a + s.cost_usd, 0);
    },
    async marketsForecastToday(now = new Date()) {
      const start = utcDayStart(now).toISOString();
      return new Set(load().alerts.filter((r) => r.flagged_at >= start).map((r) => r.market_id));
    },
    async latestByMarket(ids) {
      const want = new Set(ids), out = {};
      for (const r of [...load().alerts].sort((a, b) => b.flagged_at.localeCompare(a.flagged_at))) {
        if (want.has(r.market_id) && !out[r.market_id]) out[r.market_id] = r;
      }
      return out;
    },
    async upsertMarket(m) {
      const d = load();
      d.markets[m.marketId] = { question: m.question, rules_text: m.rules, end_date: m.endDate, category: m.category, liquidity: m.liquidity, volume_24h: m.volume24h, updated_at: new Date().toISOString() };
      save(d);
    },
    async insertForecast(row, reasoning, spends) {
      const d = load();
      d.alerts.push({ ...row, resolved_yes: null, resolved_at: null });
      d.forecast_reasoning.push({ alert_id: row.id, ...reasoning });
      save(d);
      await this.recordSpend(spends, row.id, row.flagged_at);
    },
    async recordSpend(spends, alertId = null, at = new Date().toISOString()) {
      if (!spends || !spends.length) return;
      const d = load();
      for (const s of spends) d.llm_spend.push({ day: at.slice(0, 10), alert_id: alertId, model_id: s.model, input_tokens: s.input_tokens, output_tokens: s.output_tokens, cost_usd: s.cost_usd });
      save(d);
    },
    async openMarketIds() {
      return [...new Set(load().alerts.filter((r) => r.status === 'open').map((r) => r.market_id))];
    },
    async resolveMarket(marketId, { status, resolvedYes, resolvedAt }) {
      const d = load();
      for (const r of d.alerts) {
        if (r.market_id === marketId && r.status === 'open') {
          r.status = status; r.resolved_yes = status === 'void' ? null : resolvedYes; r.resolved_at = resolvedAt.toISOString();
        }
      }
      save(d);
    }
  };
}

module.exports = { makeLocalDb };
