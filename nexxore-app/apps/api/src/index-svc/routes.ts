import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import type { IndexRepo, Granularity } from './repo.js';
import { COMPONENT_LABELS, type ComponentKey } from './types.js';

const RegimeSchema = Type.Union([
  Type.Literal('risk_on'),
  Type.Literal('transition'),
  Type.Literal('risk_off'),
]);

const ComponentReadingSchema = Type.Object({
  key: Type.String(),
  label: Type.String(),
  value: Type.Number(),
  weight: Type.Number(),
  topDriverNote: Type.String(),
});

const IndexCurrentSchema = Type.Object({
  ts: Type.String({ format: 'date-time' }),
  composite: Type.Number(),
  regime: RegimeSchema,
  contentHash: Type.String(),
  components: Type.Array(ComponentReadingSchema),
});

const HistoryPointSchema = Type.Object({
  ts: Type.String({ format: 'date-time' }),
  composite: Type.Number(),
  regime: RegimeSchema,
  components: Type.Optional(Type.Array(ComponentReadingSchema)),
});

const HistorySchema = Type.Object({
  from: Type.String(),
  to: Type.String(),
  granularity: Type.String(),
  count: Type.Integer(),
  points: Type.Array(HistoryPointSchema),
});

const DriverEventSchema = Type.Object({
  ts: Type.String(),
  componentKey: Type.String(),
  headline: Type.String(),
  sourceCategory: Type.String(),
  scoreDelta: Type.Number(),
});

const EventsSchema = Type.Object({
  readingId: Type.Integer(),
  events: Type.Array(DriverEventSchema),
});

const UnauthorizedSchema = Type.Object({
  error: Type.String(),
  hint: Type.String(),
});

export interface IndexRoutesOptions {
  repo: IndexRepo;
  /** Valid API keys (per-key entitlements arrive with Prompt 13). */
  apiKeys: string[];
}

const API_KEY_HINT =
  'This data requires an API key. Request access via /company — plans arrive with the pricing launch.';

export async function indexRoutes(app: FastifyInstance, opts: IndexRoutesOptions): Promise<void> {
  const { repo, apiKeys } = opts;

  const hasValidKey = (header: unknown): boolean =>
    typeof header === 'string' && apiKeys.includes(header);

  const withLabels = (components: { key: string; value: number; weight: number; topDriverNote: string }[]) =>
    components.map((c) => ({ ...c, label: COMPONENT_LABELS[c.key as ComponentKey] ?? c.key }));

  app.get(
    '/v1/index/current',
    {
      schema: {
        operationId: 'getIndexCurrent',
        description: 'Current Escalation Index composite, regime, and component breakdown.',
        response: { 200: IndexCurrentSchema },
      },
    },
    async (_req, reply) => {
      const latest = await repo.latest();
      if (!latest) return reply.code(503).send();
      reply.header('cache-control', 'public, max-age=60');
      return {
        ts: latest.ts,
        composite: latest.composite,
        regime: latest.regime,
        contentHash: latest.contentHash,
        components: withLabels(latest.components),
      };
    },
  );

  app.get(
    '/v1/index/history',
    {
      schema: {
        operationId: 'getIndexHistory',
        description:
          'Composite time series (public, rate-limited, ≤2000 points). Component-level history requires an API key.',
        querystring: Type.Object({
          from: Type.Optional(Type.String()),
          to: Type.Optional(Type.String()),
          granularity: Type.Optional(
            Type.Union([Type.Literal('raw'), Type.Literal('hour'), Type.Literal('day')]),
          ),
          components: Type.Optional(Type.Boolean()),
        }),
        response: { 200: HistorySchema, 401: UnauthorizedSchema },
      },
    },
    async (req, reply) => {
      const q = req.query as {
        from?: string;
        to?: string;
        granularity?: Granularity;
        components?: boolean;
      };
      const wantComponents = q.components === true;
      if (wantComponents && !hasValidKey(req.headers['x-api-key'])) {
        return reply.code(401).send({ error: 'API key required for component-level history', hint: API_KEY_HINT });
      }
      const from = q.from ? new Date(q.from) : new Date('2024-01-01T00:00:00Z');
      const to = q.to ? new Date(q.to) : new Date();
      const granularity = q.granularity ?? 'day';
      const readings = await repo.history(from, to, granularity);
      return {
        from: from.toISOString(),
        to: to.toISOString(),
        granularity,
        count: readings.length,
        points: readings.map((r) => ({
          ts: r.ts,
          composite: r.composite,
          regime: r.regime,
          ...(wantComponents ? { components: withLabels(r.components) } : {}),
        })),
      };
    },
  );

  app.get(
    '/v1/index/events',
    {
      schema: {
        operationId: 'getIndexEvents',
        description: 'Driver events behind a reading (API key required).',
        querystring: Type.Object({ readingId: Type.Integer() }),
        response: { 200: EventsSchema, 401: UnauthorizedSchema },
      },
    },
    async (req, reply) => {
      if (!hasValidKey(req.headers['x-api-key'])) {
        return reply.code(401).send({ error: 'API key required', hint: API_KEY_HINT });
      }
      const { readingId } = req.query as { readingId: number };
      return { readingId, events: await repo.eventsByReading(readingId) };
    },
  );
}
