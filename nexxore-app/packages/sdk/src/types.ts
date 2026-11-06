/**
 * Public SDK types — derived from the OpenAPI-generated `paths` (src/generated/
 * api.ts, regenerated from apps/api's spec via `pnpm --filter @nexxore/sdk
 * generate`). A schema change in the API regenerates these and breaks any
 * consumer using the old shape at compile time.
 */
import type { operations } from './generated/api';

type Json200<Op> = Op extends {
  responses: { 200: { content: { 'application/json': infer T } } };
}
  ? T
  : never;

export type HealthResponse = Json200<operations['getHealth']>;
export type StatsResponse = Json200<operations['getStats']>;
export type Stat = StatsResponse['stats'][number];
export type IndexCurrentResponse = Json200<operations['getIndexCurrent']>;
export type IndexHistoryResponse = Json200<operations['getIndexHistory']>;
export type ApiRegime = IndexCurrentResponse['regime'];
