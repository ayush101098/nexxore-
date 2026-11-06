import { bus } from '../bus.js';
import { computeReading } from './compute.js';
import type { IndexInputPort } from './input-port.js';
import type { IndexRepo } from './repo.js';
import {
  DEFAULT_WEIGHTS,
  thresholdsFromEnv,
  type ComponentKey,
  type RegimeThresholds,
  type StoredReading,
} from './types.js';

export interface WorkerDeps {
  input: IndexInputPort;
  repo: IndexRepo;
  weights?: Record<ComponentKey, number>;
  thresholds?: RegimeThresholds;
  now?: () => Date;
}

/**
 * One computation tick: pull component scores through the input port, compute
 * the reading, persist it, and emit `index.threshold_crossed` when the regime
 * changed vs the previous reading.
 */
export async function runIndexWorkerOnce(deps: WorkerDeps): Promise<StoredReading> {
  const {
    input,
    repo,
    weights = DEFAULT_WEIGHTS,
    thresholds = thresholdsFromEnv(),
    now = () => new Date(),
  } = deps;

  const at = now();
  const inputs = await input.fetchComponentScores(at);
  const previous = await repo.latest();

  const reading = computeReading({ ts: at.toISOString(), inputs, weights, thresholds });
  const stored = await repo.insertReading(
    reading,
    inputs.flatMap((i) => i.events),
  );

  if (previous && previous.regime !== stored.regime) {
    bus.emit('index.threshold_crossed', { from: previous.regime, to: stored.regime, reading: stored });
  }
  return stored;
}

/** Cron loop (≤ hourly per PRD; default 1h, configurable). Runs once on boot. */
export function startIndexWorker(deps: WorkerDeps, intervalMs: number): () => void {
  void runIndexWorkerOnce(deps).catch((err) => console.error('[index-worker]', err));
  const id = setInterval(
    () => void runIndexWorkerOnce(deps).catch((err) => console.error('[index-worker]', err)),
    intervalMs,
  );
  return () => clearInterval(id);
}
