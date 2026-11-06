import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app';
import { STATS_SEED } from './stats/seed';

describe('api gateway', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ databaseUrl: undefined, redisUrl: undefined, rateLimitMax: 1000 });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /v1/health returns ok with ISO timestamp', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ok');
    expect(() => new Date(body.time).toISOString()).not.toThrow();
  });

  it('GET /v1/stats returns the seeded defensible stats in spec shape', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/stats' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toContain('max-age=30');
    const body = res.json();
    expect(() => new Date(body.generatedAt).toISOString()).not.toThrow();
    expect(body.stats).toHaveLength(STATS_SEED.length);
    for (const stat of body.stats) {
      expect(stat).toMatchObject({
        key: expect.any(String),
        value: expect.any(Number),
        label: expect.any(String),
        evidenceUrl: expect.any(String),
        verified: expect.any(Boolean),
      });
    }
    const keys = body.stats.map((s: { key: string }) => s.key);
    expect(keys).toContain('prediction_markets_scanned');
    // NO performance figures may be seeded (they arrive via the Proof Layer).
    expect(keys.join(',')).not.toMatch(/roi|pnl|p_l|win_rate|return/i);
  });

  it('serves an OpenAPI spec containing both routes', async () => {
    const spec = app.swagger();
    expect(Object.keys(spec.paths ?? {})).toEqual(
      expect.arrayContaining(['/v1/health', '/v1/stats']),
    );
  });
});

describe('rate limiting', () => {
  it('returns 429 with Retry-After after the per-IP limit', async () => {
    const app = await buildApp({ databaseUrl: undefined, redisUrl: undefined, rateLimitMax: 3 });
    await app.ready();
    for (let i = 0; i < 3; i++) {
      const ok = await app.inject({ method: 'GET', url: '/v1/stats' });
      expect(ok.statusCode).toBe(200);
    }
    const limited = await app.inject({ method: 'GET', url: '/v1/stats' });
    expect(limited.statusCode).toBe(429);
    expect(limited.headers['retry-after']).toBeDefined();
    await app.close();
  });

  it('scaffolds per-API-key limiting: distinct keys get distinct buckets', async () => {
    const app = await buildApp({ databaseUrl: undefined, redisUrl: undefined, rateLimitMax: 2 });
    await app.ready();
    for (let i = 0; i < 2; i++) {
      await app.inject({ method: 'GET', url: '/v1/stats', headers: { 'x-api-key': 'key-a' } });
    }
    const aLimited = await app.inject({
      method: 'GET',
      url: '/v1/stats',
      headers: { 'x-api-key': 'key-a' },
    });
    expect(aLimited.statusCode).toBe(429);
    const bFresh = await app.inject({
      method: 'GET',
      url: '/v1/stats',
      headers: { 'x-api-key': 'key-b' },
    });
    expect(bFresh.statusCode).toBe(200);
    await app.close();
  });
});
