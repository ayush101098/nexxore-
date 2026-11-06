import { computeReading } from './compute.js';
import { MockIndexInputPort } from './input-port.js';
import type { IndexRepo } from './repo.js';
import {
  COMPONENT_KEYS,
  DEFAULT_WEIGHTS,
  thresholdsFromEnv,
  type ComponentInput,
  type ComponentKey,
} from './types.js';

export interface BackfillRow {
  ts: string;
  values: Record<ComponentKey, number>;
}

/**
 * Parse + validate the founder-provided backtest CSV
 * (header: ts,conflict,sanctions,energy,macro). Rejects non-monotonic
 * timestamps and out-of-bounds values (Prompt 05 acceptance).
 */
export function parseBackfillCsv(csv: string): BackfillRow[] {
  const lines = csv.trim().split('\n');
  const header = lines[0]?.trim();
  const expected = `ts,${COMPONENT_KEYS.join(',')}`;
  if (header !== expected) {
    throw new Error(`Invalid header: expected "${expected}", got "${header}"`);
  }

  const rows: BackfillRow[] = [];
  let prevTs = -Infinity;
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i]!.trim().split(',');
    if (parts.length !== 5) throw new Error(`Line ${i + 1}: expected 5 columns`);
    const ts = new Date(parts[0]!);
    if (Number.isNaN(ts.getTime())) throw new Error(`Line ${i + 1}: invalid timestamp "${parts[0]}"`);
    if (ts.getTime() <= prevTs) {
      throw new Error(`Line ${i + 1}: timestamps must be strictly increasing`);
    }
    prevTs = ts.getTime();

    const values = {} as Record<ComponentKey, number>;
    COMPONENT_KEYS.forEach((key, j) => {
      const v = Number(parts[j + 1]);
      if (!Number.isFinite(v) || v < 0 || v > 1) {
        throw new Error(`Line ${i + 1}: ${key} value "${parts[j + 1]}" outside [0,1]`);
      }
      values[key] = v;
    });
    rows.push({ ts: ts.toISOString(), values });
  }
  return rows;
}

/** Import validated rows: compute regime + hash via the same pure core. */
export async function importBackfill(repo: IndexRepo, rows: BackfillRow[]): Promise<number> {
  const thresholds = thresholdsFromEnv();
  for (const row of rows) {
    const inputs: ComponentInput[] = COMPONENT_KEYS.map((key) => ({
      key,
      value: row.values[key],
      topDriverNote: 'backfill import',
      events: [],
    }));
    const reading = computeReading({ ts: row.ts, inputs, weights: DEFAULT_WEIGHTS, thresholds });
    await repo.insertReading(reading, []);
  }
  return rows.length;
}

/**
 * Dev-mode fixture backfill (memory repo only): deterministic daily readings
 * Jan 2024 → now from the mock input port, so /history has a full series
 * before the founder CSV lands. Clearly fixture data — never real claims.
 */
export async function backfillFixtures(repo: IndexRepo, until: Date = new Date()): Promise<void> {
  const port = new MockIndexInputPort();
  const thresholds = thresholdsFromEnv();
  const day = 24 * 3600 * 1000;
  for (let t = Date.UTC(2024, 0, 1); t <= until.getTime() - day; t += day) {
    const at = new Date(t);
    const inputs = await port.fetchComponentScores(at);
    const reading = computeReading({
      ts: at.toISOString(),
      inputs,
      weights: DEFAULT_WEIGHTS,
      thresholds,
    });
    await repo.insertReading(reading, []);
  }
}
