/**
 * Apply db/migrations/001_stats.sql and upsert the canonical seed.
 * Usage: DATABASE_URL=postgres://… pnpm --filter @nexxore/api exec tsx scripts/seed.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { STATS_SEED } from '../src/stats/seed';

const { Pool } = pg;
const scriptDir = fileURLToPath(new URL('.', import.meta.url));

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const pool = new Pool({ connectionString: url });
const migration = readFileSync(join(scriptDir, '..', 'db', 'migrations', '001_stats.sql'), 'utf8');

async function main() {
  await pool.query(migration);
  for (const s of STATS_SEED) {
    await pool.query(
      `INSERT INTO stats (key, value, unit, label, evidence_url, verified)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (key) DO UPDATE SET
         value = EXCLUDED.value, unit = EXCLUDED.unit, label = EXCLUDED.label,
         evidence_url = EXCLUDED.evidence_url, verified = EXCLUDED.verified,
         updated_at = now()`,
      [s.key, s.value, s.unit, s.label, s.evidenceUrl, s.verified],
    );
  }
  console.log(`Seeded ${STATS_SEED.length} stats.`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
