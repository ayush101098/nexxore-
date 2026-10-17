// Bull / Bear / Judge passes (spec F1). The model never sees the market price,
// so it cannot anchor on the crowd. Each pass returns schema-checked JSON.
const Anthropic = require('@anthropic-ai/sdk');

const PROMPT_VERSION = 'v1.0-2026-10-18';

const SYSTEM = [
  'You forecast the outcome of prediction-market questions.',
  'Read the resolution rules literally: the market resolves on what the rules say, not on what the question title suggests.',
  'Your knowledge has a training cutoff. If the outcome depends on events after it, say so and lean on base rates and the time remaining instead of guessing at news you cannot see.',
  'Be specific and concise. Do not hedge every sentence.'
].join(' ');

const CASE_SCHEMA = {
  type: 'object',
  properties: {
    case: { type: 'string', description: 'The argument, at most 1,200 characters.' }
  },
  required: ['case'],
  additionalProperties: false
};

const JUDGE_SCHEMA = {
  type: 'object',
  properties: {
    probability: { type: 'number', description: 'Probability that the market resolves YES, between 0 and 1.' },
    thesis: { type: 'string', description: 'One line, at most 280 characters: why this probability.' },
    invalidation: { type: 'string', description: 'One line, at most 140 characters: the observable condition that would prove this forecast wrong.' }
  },
  required: ['probability', 'thesis', 'invalidation'],
  additionalProperties: false
};

function marketBrief(m, today) {
  return [
    `Question: ${m.question}`,
    `Category: ${m.category || 'unknown'}`,
    `Market closes: ${m.endDate}`,
    `Today: ${today}`,
    '',
    'Resolution rules (verbatim from Polymarket):',
    m.rules || '(none provided)'
  ].join('\n');
}

class PassError extends Error {}

function makeForecaster({ client, models, effort }) {
  client = client || new Anthropic();

  async function pass(role, model, eff, prompt, schema, validate) {
    const res = await client.beta.messages.create({
      model,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM,
      output_config: { effort: eff, format: { type: 'json_schema', schema } },
      messages: [{ role: 'user', content: prompt }]
    });
    const usage = {
      role,
      model: res.model,
      input_tokens: res.usage.input_tokens || 0,
      output_tokens: res.usage.output_tokens || 0
    };
    if (res.stop_reason === 'refusal') throw Object.assign(new PassError(`${role} pass refused`), { usage });
    if (res.stop_reason === 'max_tokens') throw Object.assign(new PassError(`${role} pass hit max_tokens`), { usage });
    const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    let out;
    try { out = JSON.parse(text); } catch (e) { throw Object.assign(new PassError(`${role} pass returned invalid JSON`), { usage }); }
    try { validate(out, role); } catch (e) { e.usage = usage; throw e; }
    return { out, usage };
  }

  /** Run a pass, retrying once on any failure (spec F1.10). Token usage from
   *  failed attempts is kept for the run log. */
  async function withRetry(fn, usages) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await fn();
        usages.push(r.usage);
        return r.out;
      } catch (err) {
        if (err.usage) usages.push(err.usage);
        if (attempt === 1 || isFatal(err)) throw err;
      }
    }
  }

  /** Forecast one market. Throws on failure; never falls back to 0.5. */
  async function forecast(market, today) {
    const brief = marketBrief(market, today);
    const usages = [];
    try {
      const [bull, bear] = await Promise.all([
        withRetry(() => pass('bull', models.bull, effort.bull,
          `${brief}\n\nMake the strongest honest case that this market resolves YES under these rules.`, CASE_SCHEMA, validateCase), usages),
        withRetry(() => pass('bear', models.bear, effort.bear,
          `${brief}\n\nMake the strongest honest case that this market resolves NO under these rules.`, CASE_SCHEMA, validateCase), usages)
      ]);

      const judge = await withRetry(() => pass('judge', models.judge, effort.judge,
          `${brief}\n\nBULL CASE:\n${bull.case}\n\nBEAR CASE:\n${bear.case}\n\n` +
          'Weigh both cases against the rules and the time remaining. Return a calibrated probability that the market resolves YES, a one-line thesis, and a one-line invalidation condition.',
          JUDGE_SCHEMA, validateJudge), usages);

      return {
        probability: Math.min(0.99, Math.max(0.01, judge.probability)),
        thesis: judge.thesis.slice(0, 280),
        invalidation: judge.invalidation.slice(0, 140),
        bull: bull.case,
        bear: bear.case,
        judgeOutput: judge,
        modelIds: [...new Set(usages.map((s) => s.model))],
        promptVersion: PROMPT_VERSION,
        usages
      };
    } catch (err) {
      err.usages = usages;
      throw err;
    }
  }

  return { forecast };
}

/** Request or account errors a retry can't fix (bad request, auth, billing).
 *  The SDK already retries 429 and 5xx on its own. */
function isFatal(err) {
  return err instanceof Anthropic.BadRequestError
    || err instanceof Anthropic.AuthenticationError
    || err instanceof Anthropic.PermissionDeniedError;
}

function validateCase(c, role) {
  if (!c || typeof c.case !== 'string' || !c.case.trim()) throw new PassError(`${role} pass returned an empty case`);
}
function validateJudge(j) {
  if (!j || typeof j.probability !== 'number' || !Number.isFinite(j.probability) || j.probability < 0 || j.probability > 1) {
    throw new PassError('judge pass returned an invalid probability');
  }
  if (typeof j.thesis !== 'string' || !j.thesis.trim()) throw new PassError('judge pass returned no thesis');
  if (typeof j.invalidation !== 'string' || !j.invalidation.trim()) throw new PassError('judge pass returned no invalidation');
}

module.exports = { makeForecaster, PROMPT_VERSION, PassError, marketBrief, isFatal };
