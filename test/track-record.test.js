// /api/track-record: happy path, void exclusion, error shape, empty ledger.
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

function loadHandler(rows) {
  const origLoad = Module._load;
  Module._load = function (req, ...rest) {
    if (req === '@supabase/supabase-js') {
      return {
        createClient: () => ({
          from: () => {
            const q = { select: () => q, order: () => q, limit: () => q, gte: () => q,
              then: (ok) => Promise.resolve({ data: rows, error: null }).then(ok) };
            return q;
          }
        })
      };
    }
    return origLoad.call(this, req, ...rest);
  };
  delete require.cache[require.resolve('../api/track-record.js')];
  const h = require('../api/track-record.js');
  Module._load = origLoad;
  return h;
}

function call(handler, query, method = 'GET') {
  return new Promise((resolve) => {
    const res = {
      headers: {}, statusCode: 0,
      setHeader(k, v) { this.headers[k] = v; },
      status(c) { this.statusCode = c; return this; },
      json(b) { this.body = b; resolve(this); return this; },
      send(t) { this.text = t; resolve(this); return this; },
      end() { resolve(this); return this; }
    };
    handler({ method, query, headers: { 'x-forwarded-for': String(Math.random()) }, socket: {} }, res);
  });
}

const ROWS = [
  { id: 'a', market_id: 'm1', market_url: 'u', market_name: 'Won YES', flagged_at: '2026-10-01', status: 'resolved', is_call: true, side: 'YES', model_prob: 0.6, market_prob: 0.5, entry_price: 0.51, fee_bps: 0, resolved_yes: 1, resolved_at: '2026-10-05', prompt_version: 'v1' },
  { id: 'b', market_id: 'm2', market_url: 'u', market_name: 'Lost NO', flagged_at: '2026-10-02', status: 'resolved', is_call: true, side: 'NO', model_prob: 0.3, market_prob: 0.4, entry_price: 0.62, fee_bps: 100, resolved_yes: 1, resolved_at: '2026-10-06', prompt_version: 'v1' },
  { id: 'c', market_id: 'm3', market_url: 'u', market_name: 'Voided', flagged_at: '2026-10-03', status: 'void', is_call: true, side: 'YES', model_prob: 0.9, market_prob: 0.5, entry_price: 0.51, fee_bps: 0, resolved_yes: null, prompt_version: 'v1' },
  { id: 'd', market_id: 'm4', market_url: 'u', market_name: 'Open, not a call', flagged_at: '2026-10-04', status: 'open', is_call: false, side: 'YES', model_prob: 0.52, market_prob: 0.5, entry_price: 0.51, fee_bps: 0, resolved_yes: null, prompt_version: 'v1' }
];

test('happy path: scores resolved rows, excludes void', async () => {
  process.env.SUPABASE_URL = 'x'; process.env.SUPABASE_KEY = 'y';
  const res = await call(loadHandler(ROWS), { range: 'all' });
  assert.equal(res.statusCode, 200);
  const st = res.body.stats;
  assert.equal(st.totalSignals, 4);
  assert.equal(st.resolvedSignals, 2);
  assert.equal(st.voidSignals, 1);
  assert.equal(st.openSignals, 1);
  assert.equal(st.brierModel, 0.325);   // (0.16 + 0.49) / 2 — the void row's 0.9 is not included
  assert.equal(st.brierMarket, 0.305);
  assert.equal(st.brierSkill, -0.066);
  assert.ok(res.headers['X-RateLimit-Remaining']);
  const voided = res.body.signals.find((s) => s.id === 'c');
  assert.equal(voided.outcome, 'VOID');
  assert.equal(voided.brier_model, null);
});

test('CSV contains resolved rows only', async () => {
  const res = await call(loadHandler(ROWS), { range: 'all', format: 'csv' });
  const lines = res.text.trim().split('\n');
  assert.equal(lines.length, 3); // header + two resolved rows
  assert.ok(!res.text.includes('"Voided"'));
});

test('error shape on a wrong method', async () => {
  const res = await call(loadHandler(ROWS), {}, 'POST');
  assert.equal(res.statusCode, 405);
  assert.equal(res.body.error.code, 'method_not_allowed');
});

test('no database configured: empty ledger, never sample data', async () => {
  delete process.env.SUPABASE_URL; delete process.env.SUPABASE_KEY; delete process.env.SUPABASE_ANON_KEY;
  const res = await call(loadHandler(ROWS), { range: 'all' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.source, 'none');
  assert.equal(res.body.stats.totalSignals, 0);
});
