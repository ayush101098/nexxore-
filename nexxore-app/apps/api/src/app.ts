import Fastify, { type FastifyInstance } from 'fastify';
import swagger from '@fastify/swagger';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { Redis } from 'ioredis';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { HealthResponseSchema, StatsResponseSchema } from './schemas.js';
import { createStatsRepo, type StatsRepo } from './stats/repo.js';
import { indexRoutes } from './index-svc/routes.js';
import { MemoryIndexRepo, type IndexRepo } from './index-svc/repo.js';
import { PgIndexRepo } from './index-svc/repo-pg.js';
import { backfillFixtures } from './index-svc/backfill.js';

export interface AppOptions {
  /** Postgres URL; unset → seeded in-memory repos (local dev/CI). */
  databaseUrl?: string;
  /** Redis URL; unset → in-memory rate-limit store (single instance only). */
  redisUrl?: string;
  /** Requests per window per IP for public routes. */
  rateLimitMax?: number;
  rateLimitWindow?: string;
  statsRepo?: StatsRepo;
  indexRepo?: IndexRepo;
  /** Valid API keys for gated index routes (env API_KEYS, comma-separated). */
  apiKeys?: string[];
  /** Memory mode only: backfill fixture history Jan 2024 → now on boot. */
  backfillIndexFixtures?: boolean;
}

/**
 * API gateway (Prompt 03). /v1/stats is THE single source of truth for brand
 * stats; rate limiting is per-IP for public routes now, with per-API-key
 * scaffolding (keyGenerator reads x-api-key when present) for later prompts.
 */
export async function buildApp(opts: AppOptions = {}): Promise<FastifyInstance> {
  const {
    databaseUrl = process.env.DATABASE_URL,
    redisUrl = process.env.REDIS_URL,
    rateLimitMax = Number(process.env.RATE_LIMIT_MAX ?? 60),
    rateLimitWindow = process.env.RATE_LIMIT_WINDOW ?? '1 minute',
  } = opts;

  const app = Fastify({ logger: false }).withTypeProvider<TypeBoxTypeProvider>();
  const repo = opts.statsRepo ?? createStatsRepo(databaseUrl);
  const indexRepo =
    opts.indexRepo ?? (databaseUrl ? new PgIndexRepo(databaseUrl) : new MemoryIndexRepo());
  if (!databaseUrl && !opts.indexRepo && opts.backfillIndexFixtures !== false) {
    await backfillFixtures(indexRepo);
  }
  const apiKeys =
    opts.apiKeys ?? (process.env.API_KEYS ? process.env.API_KEYS.split(',') : []);
  const redis = redisUrl
    ? new Redis(redisUrl, { connectTimeout: 500, maxRetriesPerRequest: 1 })
    : undefined;

  // Plugins must be fully loaded BEFORE routes are declared, otherwise their
  // onRoute hooks (swagger collection, rate-limit preHandler) miss the routes.
  await app.register(cors, { origin: true });
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'NEXXORE API',
        description: 'Public API gateway — single source of truth for all stats.',
        version: '0.1.0',
      },
      servers: [{ url: process.env.API_PUBLIC_URL ?? 'http://localhost:4000' }],
    },
  });

  await app.register(rateLimit, {
    global: true,
    max: rateLimitMax,
    timeWindow: rateLimitWindow,
    ...(redis ? { redis } : {}),
    // Per-API-key scaffolding: keyed by API key when provided, else by IP.
    keyGenerator: (req) => (req.headers['x-api-key'] as string | undefined) ?? req.ip,
    addHeadersOnExceeding: { 'x-ratelimit-limit': true, 'x-ratelimit-remaining': true },
    addHeaders: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
      'retry-after': true,
    },
  });

  app.get(
    '/v1/health',
    {
      schema: {
        operationId: 'getHealth',
        response: { 200: HealthResponseSchema },
      },
      config: { rateLimit: false },
    },
    async () => ({
      status: 'ok' as const,
      service: 'nexxore-api',
      time: new Date().toISOString(),
    }),
  );

  app.get(
    '/v1/stats',
    {
      schema: {
        operationId: 'getStats',
        description:
          'Single source of truth for brand stats. verified=false renders as "reported"; verified=true (Proof-Layer anchored) renders as "verify ↗".',
        response: { 200: StatsResponseSchema },
      },
    },
    async (_req, reply) => {
      const stats = await repo.all();
      reply.header('cache-control', 'public, max-age=30');
      return {
        generatedAt: new Date().toISOString(),
        stats: stats.map((s) => ({ ...s, value: Number(s.value) })),
      };
    },
  );

  await indexRoutes(app, { repo: indexRepo, apiKeys });

  app.addHook('onClose', async () => {
    await repo.close();
    await indexRepo.close();
    redis?.disconnect();
  });

  // Exposed for the worker started in server.ts.
  app.decorate('indexRepo', indexRepo);

  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    indexRepo: IndexRepo;
  }
}
