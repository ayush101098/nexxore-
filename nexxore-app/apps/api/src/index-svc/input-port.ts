import {
  COMPONENT_KEYS,
  type ComponentInput,
  type ComponentKey,
  type DriverEvent,
} from './types.js';

/**
 * Port to the upstream signal-ingestion pipeline. The private pipeline's real
 * adapter is wired by the founder; the mock below produces DETERMINISTIC
 * scores from the timestamp so the worker is fully testable without it.
 */
export interface IndexInputPort {
  /** Latest component scores (0–1) + the driver events behind them. */
  fetchComponentScores(at: Date): Promise<ComponentInput[]>;
}

const BASE: Record<ComponentKey, number> = {
  conflict: 0.62,
  sanctions: 0.48,
  energy: 0.55,
  macro: 0.42,
};

const NOTES: Record<ComponentKey, string> = {
  conflict: 'Red Sea shipping disruption persists',
  sanctions: 'New export-control designations announced',
  energy: 'Suez transit volumes below seasonal norm',
  macro: 'Yield-curve inversion persists; liquidity neutral',
};

/** Deterministic pseudo-signal: smooth multi-frequency wave per component. */
export function mockScore(key: ComponentKey, at: Date): number {
  const t = at.getTime() / 3_600_000; // hours since epoch
  const phase = COMPONENT_KEYS.indexOf(key);
  const wave =
    0.12 * Math.sin(t / 26 + phase * 1.7) +
    0.06 * Math.sin(t / 7 + phase * 0.9) +
    0.03 * Math.sin(t / 2.3 + phase * 2.3);
  return Math.min(1, Math.max(0, BASE[key] + wave));
}

export class MockIndexInputPort implements IndexInputPort {
  async fetchComponentScores(at: Date): Promise<ComponentInput[]> {
    return COMPONENT_KEYS.map((key) => {
      const value = mockScore(key, at);
      const events: DriverEvent[] = [
        {
          ts: at.toISOString(),
          componentKey: key,
          headline: `[fixture] ${NOTES[key]}`,
          sourceCategory: 'fixture',
          scoreDelta: Math.round((value - BASE[key]) * 1000) / 1000,
        },
      ];
      return { key, value, topDriverNote: NOTES[key], events };
    });
  }
}
