// pg is CJS — default-import then destructure for ESM compatibility.
import pg from 'pg';
import { STATS_SEED, type StatRow } from './seed.js';

const { Pool } = pg;

/**
 * Stats repository port. Postgres is the production backing store
 * (db/migrations/001_stats.sql + scripts/seed.ts); the seeded in-memory
 * implementation activates when DATABASE_URL is unset (local dev/CI without
 * infra) and serves the identical seed the migration would.
 */
export interface StatsRepo {
  all(): Promise<StatRow[]>;
  close(): Promise<void>;
}

export class MemoryStatsRepo implements StatsRepo {
  constructor(private readonly rows: StatRow[] = STATS_SEED) {}
  async all(): Promise<StatRow[]> {
    return this.rows;
  }
  async close(): Promise<void> {
    /* nothing to release */
  }
}

export class PgStatsRepo implements StatsRepo {
  private readonly pool: InstanceType<typeof Pool>;
  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl, max: 5 });
  }
  async all(): Promise<StatRow[]> {
    const res = await this.pool.query<StatRow>(
      'SELECT key, value, unit, label, evidence_url AS "evidenceUrl", verified FROM stats ORDER BY key',
    );
    return res.rows;
  }
  async close(): Promise<void> {
    await this.pool.end();
  }
}

export function createStatsRepo(databaseUrl: string | undefined): StatsRepo {
  return databaseUrl ? new PgStatsRepo(databaseUrl) : new MemoryStatsRepo();
}
