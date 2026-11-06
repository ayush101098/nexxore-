import { describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { bus } from '../bus.js';
import { canonicalJson, computeReading, deriveRegime } from './compute.js';
import { MockIndexInputPort } from './input-port.js';
import { MemoryIndexRepo, downsample } from './repo.js';
import { parseBackfillCsv } from './backfill.js';
import { runIndexWorkerOnce } from './worker.js';
import { DEFAULT_WEIGHTS, type ComponentInput } from './types.js';

const T = { riskOff: 0.7, riskOnBelow: 0.45 };

const inputs = (v: Record<string, number>): ComponentInput[] =>
  (['conflict', 'sanctions', 'energy', 'macro'] as const).map((key) => ({
    key,
    value: v[key] ?? 0.5,
    topDriverNote: 'n',
    events: [],
  }));

describe('computeReading', () => {
  it('is deterministic: same inputs → identical reading and hash (snapshot)', () => {
    const args = {
      ts: '2026-01-01T00:00:00.000Z',
      inputs: inputs({ conflict: 0.8, sanctions: 0.6, energy: 0.5, macro: 0.4 }),
      weights: DEFAULT_WEIGHTS,
      thresholds: T,
    };
    const a = computeReading(args);
    const b = computeReading(args);
    expect(a).toEqual(b);
    expect(a.composite).toBe(0.61); // .35*.8+.25*.6+.2*.5+.2*.4
    expect(a.regime).toBe('transition');
    expect(a.contentHash).toMatchInlineSnapshot(
      `"988a1cf0bc3b9d68b1e2d8e225325e29ac12a3897236d30a0191c5701e129c97"`,
    );
  });

  it('canonicalJson sorts keys so property order cannot change the hash', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it('regime thresholds are configuration, not constants', () => {
    expect(deriveRegime(0.61, T)).toBe('transition');
    expect(deriveRegime(0.61, { riskOff: 0.6, riskOnBelow: 0.3 })).toBe('risk_off');
    expect(deriveRegime(0.61, { riskOff: 0.9, riskOnBelow: 0.65 })).toBe('risk_on');
  });
});

describe('worker', () => {
  it('inserts readings and emits index.threshold_crossed on regime change', async () => {
    const repo = new MemoryIndexRepo();
    const crossings: string[] = [];
    bus.on('index.threshold_crossed', (e) => crossings.push(`${e.from}->${e.to}`));

    class ScriptedPort {
      private values = [0.3, 0.8];
      private i = 0;
      async fetchComponentScores() {
        const v = this.values[this.i++] ?? 0.8;
        return inputs({ conflict: v, sanctions: v, energy: v, macro: v });
      }
    }
    const port = new ScriptedPort();
    let tick = 0;
    const now = () => new Date(Date.UTC(2026, 0, 1, tick++));

    await runIndexWorkerOnce({ input: port, repo, thresholds: T, now });
    await runIndexWorkerOnce({ input: port, repo, thresholds: T, now });

    expect(crossings).toEqual(['risk_on->risk_off']);
    expect((await repo.latest())?.regime).toBe('risk_off');
  });
});

describe('history downsampling', () => {
  it('caps any range at 2000 points and keeps the last point', () => {
    const pts = Array.from({ length: 12_345 }, (_, i) => i);
    const out = downsample(pts);
    expect(out.length).toBe(2000);
    expect(out[0]).toBe(0);
    expect(out[out.length - 1]).toBe(12_344);
  });
});

describe('backfill CSV validation', () => {
  const header = 'ts,conflict,sanctions,energy,macro';
  it('accepts a valid file', () => {
    const rows = parseBackfillCsv(
      `${header}\n2024-01-01T00:00:00Z,0.5,0.4,0.3,0.2\n2024-01-02T00:00:00Z,0.6,0.4,0.3,0.2`,
    );
    expect(rows).toHaveLength(2);
    expect(rows[1]?.values.conflict).toBe(0.6);
  });
  it('rejects non-monotonic timestamps', () => {
    expect(() =>
      parseBackfillCsv(
        `${header}\n2024-01-02T00:00:00Z,0.5,0.4,0.3,0.2\n2024-01-01T00:00:00Z,0.5,0.4,0.3,0.2`,
      ),
    ).toThrow(/strictly increasing/);
  });
  it('rejects out-of-bounds values', () => {
    expect(() =>
      parseBackfillCsv(`${header}\n2024-01-01T00:00:00Z,1.5,0.4,0.3,0.2`),
    ).toThrow(/outside \[0,1\]/);
  });
});

describe('index routes', () => {
  const makeApp = async () => {
    const repo = new MemoryIndexRepo();
    await runIndexWorkerOnce({ input: new MockIndexInputPort(), repo, thresholds: T });
    return buildApp({
      databaseUrl: undefined,
      redisUrl: undefined,
      rateLimitMax: 1000,
      indexRepo: repo,
      apiKeys: ['test-key'],
    });
  };

  it('GET /v1/index/current returns composite/regime/components, cached 60s', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/v1/index/current' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toContain('max-age=60');
    const body = res.json();
    expect(body.composite).toBeGreaterThanOrEqual(0);
    expect(body.composite).toBeLessThanOrEqual(1);
    expect(['risk_on', 'transition', 'risk_off']).toContain(body.regime);
    expect(body.components).toHaveLength(4);
    expect(body.contentHash).toMatch(/^[0-9a-f]{64}$/);
    await app.close();
  });

  it('history is public, but component-level requires an API key (401 + hint)', async () => {
    const app = await makeApp();
    const pub = await app.inject({ method: 'GET', url: '/v1/index/history?granularity=day' });
    expect(pub.statusCode).toBe(200);
    expect(pub.json().count).toBeGreaterThan(0);

    const gated = await app.inject({
      method: 'GET',
      url: '/v1/index/history?components=true',
    });
    expect(gated.statusCode).toBe(401);
    expect(gated.json().hint).toBeTruthy();

    const keyed = await app.inject({
      method: 'GET',
      url: '/v1/index/history?components=true',
      headers: { 'x-api-key': 'test-key' },
    });
    expect(keyed.statusCode).toBe(200);
    expect(keyed.json().points[0].components).toHaveLength(4);
    await app.close();
  });

  it('events require an API key and return the driver events', async () => {
    const app = await makeApp();
    const anon = await app.inject({ method: 'GET', url: '/v1/index/events?readingId=1' });
    expect(anon.statusCode).toBe(401);

    const keyed = await app.inject({
      method: 'GET',
      url: '/v1/index/events?readingId=1',
      headers: { 'x-api-key': 'test-key' },
    });
    expect(keyed.statusCode).toBe(200);
    expect(keyed.json().events.length).toBeGreaterThan(0);
    await app.close();
  });
});
