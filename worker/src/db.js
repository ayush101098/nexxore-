// Supabase access with the service role key (server-side only, spec F2.3).
const { createClient } = require('@supabase/supabase-js');

function utcDayStart(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function makeDb({ url, serviceKey, client }) {
  const sb = client || createClient(url, serviceKey, { auth: { persistSession: false } });

  function check({ data, error }) {
    if (error) throw new Error(`Supabase: ${error.message}`);
    return data;
  }

  return {
    async spentToday(now = new Date()) {
      const day = utcDayStart(now).toISOString().slice(0, 10);
      const rows = check(await sb.from('llm_spend').select('cost_usd').eq('day', day));
      return rows.reduce((s, r) => s + Number(r.cost_usd || 0), 0);
    },

    async marketsForecastToday(now = new Date()) {
      const rows = check(await sb.from('alerts').select('market_id').gte('flagged_at', utcDayStart(now).toISOString()));
      return new Set(rows.map((r) => r.market_id));
    },

    /** Latest forecast per market: { [market_id]: { market_prob, flagged_at } } */
    async latestByMarket(marketIds) {
      const out = {};
      for (let i = 0; i < marketIds.length; i += 200) {
        const rows = check(await sb.from('alerts')
          .select('market_id, market_prob, flagged_at')
          .in('market_id', marketIds.slice(i, i + 200))
          .order('flagged_at', { ascending: false }));
        for (const r of rows) if (!out[r.market_id]) out[r.market_id] = r;
      }
      return out;
    },

    async upsertMarket(m) {
      check(await sb.from('markets').upsert({
        market_id: m.marketId, question: m.question, rules_text: m.rules, end_date: m.endDate,
        category: m.category, liquidity: m.liquidity, volume_24h: m.volume24h, updated_at: new Date().toISOString()
      }));
    },

    /** Ledger row, reasoning and spend. The alert row goes first so the
     *  forecast is on record even if a later insert fails. */
    async insertForecast(row, reasoning, spends) {
      check(await sb.from('alerts').insert(row));
      check(await sb.from('forecast_reasoning').insert({ alert_id: row.id, ...reasoning }));
      await this.recordSpend(spends, row.id, row.flagged_at);
    },

    async recordSpend(spends, alertId = null, at = new Date().toISOString()) {
      if (!spends || !spends.length) return;
      const day = at.slice(0, 10);
      check(await sb.from('llm_spend').insert(spends.map((s) => ({
        day, alert_id: alertId, model_id: s.model,
        input_tokens: s.input_tokens, output_tokens: s.output_tokens, cost_usd: s.cost_usd
      }))));
    },

    async openMarketIds() {
      const rows = check(await sb.from('alerts').select('market_id').eq('status', 'open'));
      return [...new Set(rows.map((r) => r.market_id).filter(Boolean))];
    },

    /** Only resolution fields change; the ledger trigger rejects anything else. */
    async resolveMarket(marketId, { status, resolvedYes, resolvedAt }) {
      check(await sb.from('alerts')
        .update({ status, resolved_yes: status === 'void' ? null : resolvedYes, resolved_at: resolvedAt.toISOString() })
        .eq('market_id', marketId)
        .eq('status', 'open'));
    }
  };
}

module.exports = { makeDb, utcDayStart };
