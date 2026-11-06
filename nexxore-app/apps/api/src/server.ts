import { buildApp } from './app.js';
import { MockIndexInputPort } from './index-svc/input-port.js';
import { startIndexWorker } from './index-svc/worker.js';
import { bus } from './bus.js';

const port = Number(process.env.API_PORT ?? 4000);
const host = process.env.API_HOST ?? '0.0.0.0';
// Cron cadence ≤ hourly (PRD); default 1h, configurable without deploy.
const intervalMs = Number(process.env.INDEX_WORKER_INTERVAL_MS ?? 3_600_000);

bus.on('index.threshold_crossed', (e) => {
  // Consumed later by the bot (P14) + decision feed (P11); logged for now.
  // eslint-disable-next-line no-console
  console.log(`[index] threshold crossed: ${e.from} → ${e.to} @ ${e.reading.ts}`);
});

buildApp()
  .then(async (app) => {
    // The real IndexInputPort adapter (private pipeline) is wired by the
    // founder; until then the deterministic mock drives readings.
    startIndexWorker({ input: new MockIndexInputPort(), repo: app.indexRepo }, intervalMs);
    return app.listen({ port, host });
  })
  .then((address: string) => {
    // eslint-disable-next-line no-console
    console.log(`nexxore-api listening on ${address}`);
  })
  .catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
