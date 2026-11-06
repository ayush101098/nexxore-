/**
 * Import the founder-provided backtest CSV into index_readings.
 * Usage: DATABASE_URL=postgres://… pnpm --filter @nexxore/api exec tsx scripts/backfill-index.ts <file.csv>
 * CSV header: ts,conflict,sanctions,energy,macro — timestamps strictly
 * increasing, all values in [0,1]; the import rejects otherwise.
 */
import { readFileSync } from 'node:fs';
import { parseBackfillCsv, importBackfill } from '../src/index-svc/backfill';
import { PgIndexRepo } from '../src/index-svc/repo-pg';

const [file] = process.argv.slice(2);
const url = process.env.DATABASE_URL;
if (!file || !url) {
  console.error('Usage: DATABASE_URL=… tsx scripts/backfill-index.ts <file.csv>');
  process.exit(1);
}

async function main() {
  const rows = parseBackfillCsv(readFileSync(file, 'utf8'));
  const repo = new PgIndexRepo(url!);
  const n = await importBackfill(repo, rows);
  await repo.close();
  console.log(`Imported ${n} readings.`);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
