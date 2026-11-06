import { Type, type Static } from '@sinclair/typebox';

/** Route schemas — the single source the OpenAPI spec (and thus the SDK types)
 *  are generated from. Change a schema here → regenerated spec → regenerated
 *  SDK types → the web build breaks if it consumed the old shape. */

export const HealthResponseSchema = Type.Object(
  {
    status: Type.Literal('ok'),
    service: Type.String(),
    time: Type.String({ format: 'date-time' }),
  },
  { $id: 'HealthResponse' },
);
export type HealthResponse = Static<typeof HealthResponseSchema>;

export const StatSchema = Type.Object(
  {
    key: Type.String(),
    value: Type.Number(),
    unit: Type.Union([Type.String(), Type.Null()]),
    label: Type.String(),
    evidenceUrl: Type.String(),
    /** false → "reported" treatment; true → "verify ↗" (Proof-Layer anchored). */
    verified: Type.Boolean(),
  },
  { $id: 'Stat' },
);
export type Stat = Static<typeof StatSchema>;

export const StatsResponseSchema = Type.Object(
  {
    generatedAt: Type.String({ format: 'date-time' }),
    stats: Type.Array(StatSchema),
  },
  { $id: 'StatsResponse' },
);
export type StatsResponse = Static<typeof StatsResponseSchema>;
