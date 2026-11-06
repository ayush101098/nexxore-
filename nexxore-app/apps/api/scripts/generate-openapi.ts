/**
 * Emit the OpenAPI spec from the live route schemas → openapi.json.
 * The SDK generates its types from this file (pnpm --filter @nexxore/sdk generate),
 * so a schema change here propagates to (and can break) the web build. CI
 * regenerates and fails on drift.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../src/app';

const scriptDir = fileURLToPath(new URL('.', import.meta.url));

async function main() {
  const app = await buildApp({ databaseUrl: undefined, redisUrl: undefined });
  await app.ready();
  const spec = app.swagger();
  writeFileSync(join(scriptDir, '..', 'openapi.json'), JSON.stringify(spec, null, 2) + '\n');
  await app.close();
  console.log('openapi.json written.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
