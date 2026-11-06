import { createHash } from 'node:crypto';
import {
  type ComponentInput,
  type ComponentReading,
  type IndexReading,
  type RegimeThresholds,
  type RegimeValue,
  type ComponentKey,
} from './types.js';

/** Stable stringify: recursively sorted object keys → deterministic hashes. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

export const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const round3 = (n: number) => Math.round(n * 1000) / 1000;

export function deriveRegime(composite: number, t: RegimeThresholds): RegimeValue {
  if (composite >= t.riskOff) return 'risk_off';
  if (composite < t.riskOnBelow) return 'risk_on';
  return 'transition';
}

/**
 * Pure reading computation: weighted composite over component scores, regime
 * from configurable thresholds, content hash over the canonical JSON of what
 * was measured. Same inputs → identical reading + hash, always.
 */
export function computeReading(args: {
  ts: string;
  inputs: ComponentInput[];
  weights: Record<ComponentKey, number>;
  thresholds: RegimeThresholds;
}): IndexReading {
  const { ts, inputs, weights, thresholds } = args;

  const components: ComponentReading[] = [...inputs]
    .sort((a, b) => (a.key < b.key ? -1 : 1))
    .map((c) => ({
      key: c.key,
      value: round3(clamp01(c.value)),
      weight: weights[c.key],
      topDriverNote: c.topDriverNote,
    }));

  const weightSum = components.reduce((s, c) => s + c.weight, 0);
  const composite = round3(
    clamp01(components.reduce((s, c) => s + c.value * c.weight, 0) / (weightSum || 1)),
  );
  const regime = deriveRegime(composite, thresholds);

  const contentHash = sha256(
    canonicalJson({
      ts,
      composite,
      components: components.map(({ key, value, weight }) => ({ key, value, weight })),
    }),
  );

  return { ts, composite, regime, contentHash, components };
}
