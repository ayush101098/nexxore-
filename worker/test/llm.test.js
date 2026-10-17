// F1: three passes, schema-checked output, one retry, never a 0.5 fallback.
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeForecaster } = require('../src/llm');

const MODELS = { bull: 'claude-sonnet-5-5', bear: 'claude-sonnet-5-5', judge: 'claude-opus-5-5' };
const EFFORT = { bull: 'low', bear: 'low', judge: 'medium' };
const MARKET = { question: 'Will X happen by Dec 31?', category: 'politics', endDate: '2026-12-31T23:59:00Z', rules: 'Resolves YES if X happens.' };

function reply(model, body, stop = 'end_turn') {
  return { model, stop_reason: stop, usage: { input_tokens: 1000, output_tokens: 500 }, content: [{ type: 'text', text: typeof body === 'string' ? body : JSON.stringify(body) }] };
}

function fakeClient(script) {
  const calls = [];
  return {
    calls,
    beta: { messages: { create: async (req) => {
      calls.push(req);
      const role = /resolves YES under/.test(req.messages[0].content) ? 'bull'
        : /resolves NO under/.test(req.messages[0].content) ? 'bear' : 'judge';
      const next = script[role].shift();
      if (next instanceof Error) throw next;
      return next;
    } } }
  };
}

const ok = () => ({
  bull: [reply('claude-sonnet-5-5', { case: 'Strong yes case' })],
  bear: [reply('claude-sonnet-5-5', { case: 'Strong no case' })],
  judge: [reply('claude-opus-5-5', { probability: 0.62, thesis: 'Because.', invalidation: 'If Y.' })]
});

test('produces probability, bull, bear, thesis and invalidation', async () => {
  const client = fakeClient(ok());
  const f = await makeForecaster({ client, models: MODELS, effort: EFFORT }).forecast(MARKET, '2026-10-18');
  assert.equal(f.probability, 0.62);
  assert.equal(f.bull, 'Strong yes case');
  assert.equal(f.bear, 'Strong no case');
  assert.equal(f.thesis, 'Because.');
  assert.equal(f.invalidation, 'If Y.');
  assert.ok(f.promptVersion);
  assert.equal(f.usages.length, 3);
});

test('the model never sees the market price', async () => {
  const client = fakeClient(ok());
  await makeForecaster({ client, models: MODELS, effort: EFFORT })
    .forecast({ ...MARKET, yesPrice: 0.45, mid: 0.45 }, '2026-10-18');
  for (const c of client.calls) assert.ok(!/0\.45|45¢|price/i.test(c.messages[0].content));
});

test('model IDs and effort come from config; fallback and JSON schema are set', async () => {
  const client = fakeClient(ok());
  await makeForecaster({ client, models: MODELS, effort: EFFORT }).forecast(MARKET, '2026-10-18');
  const judge = client.calls.find((c) => c.model === 'claude-opus-5-5');
  assert.equal(judge.output_config.effort, 'medium');
  assert.equal(judge.output_config.format.type, 'json_schema');
  assert.equal(judge.fallbacks, 'default');
  assert.deepEqual(judge.betas, ['server-side-fallback-2026-07-01']);
});

test('probability is clamped to 0.01–0.99', async () => {
  const s = ok(); s.judge = [reply('claude-opus-5-5', { probability: 1, thesis: 't', invalidation: 'i' })];
  const f = await makeForecaster({ client: fakeClient(s), models: MODELS, effort: EFFORT }).forecast(MARKET, '2026-10-18');
  assert.equal(f.probability, 0.99);
});

test('invalid JSON is retried once, then succeeds', async () => {
  const s = ok(); s.judge = [reply('claude-opus-5-5', 'not json'), reply('claude-opus-5-5', { probability: 0.4, thesis: 't', invalidation: 'i' })];
  const f = await makeForecaster({ client: fakeClient(s), models: MODELS, effort: EFFORT }).forecast(MARKET, '2026-10-18');
  assert.equal(f.probability, 0.4);
  assert.equal(f.usages.length, 4); // the failed attempt's tokens are still counted
});

test('two failures throw, with no 0.5 fallback, and keep the usage', async () => {
  const s = ok(); s.judge = [reply('claude-opus-5-5', { probability: 'high' }), reply('claude-opus-5-5', { probability: 2, thesis: 't', invalidation: 'i' })];
  await assert.rejects(
    makeForecaster({ client: fakeClient(s), models: MODELS, effort: EFFORT }).forecast(MARKET, '2026-10-18'),
    (err) => { assert.match(err.message, /judge/); assert.equal(err.usages.length, 4); return true; }
  );
});

test('a refusal counts as a failed pass', async () => {
  const s = ok(); s.bull = [reply('claude-sonnet-5-5', '', 'refusal'), reply('claude-sonnet-5-5', '', 'refusal')];
  await assert.rejects(makeForecaster({ client: fakeClient(s), models: MODELS, effort: EFFORT }).forecast(MARKET, '2026-10-18'), /bull pass refused/);
});


test('account and request errors are not retried', async () => {
  const Anthropic = require('@anthropic-ai/sdk');
  const billing = new Anthropic.BadRequestError(400, { error: { message: 'credit balance is too low' } }, 'credit balance is too low', new Headers());
  const s = ok(); s.bull = [billing, reply('claude-sonnet-5-5', { case: 'x' })];
  const client = fakeClient(s);
  await assert.rejects(makeForecaster({ client, models: MODELS, effort: EFFORT }).forecast(MARKET, '2026-10-18'), /credit balance/);
  assert.equal(client.calls.filter((c) => /resolves YES under/.test(c.messages[0].content)).length, 1);
});
