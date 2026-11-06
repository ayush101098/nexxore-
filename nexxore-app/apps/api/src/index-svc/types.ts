export type ComponentKey = 'conflict' | 'sanctions' | 'energy' | 'macro';
export type RegimeValue = 'risk_on' | 'transition' | 'risk_off';

export const COMPONENT_KEYS: ComponentKey[] = ['conflict', 'sanctions', 'energy', 'macro'];

/** Default component weights (mirrors migration seed; Pg reads the table). */
export const DEFAULT_WEIGHTS: Record<ComponentKey, number> = {
  conflict: 0.35,
  sanctions: 0.25,
  energy: 0.2,
  macro: 0.2,
};

export const COMPONENT_LABELS: Record<ComponentKey, string> = {
  conflict: 'Conflict',
  sanctions: 'Sanctions',
  energy: 'Energy',
  macro: 'Macro',
};

export interface RegimeThresholds {
  /** composite ≥ this → risk_off */
  riskOff: number;
  /** composite < this → risk_on (between the two → transition) */
  riskOnBelow: number;
}

/** Thresholds come from config (env override → config table → defaults) —
 *  never compile-time constants. */
export function thresholdsFromEnv(env: NodeJS.ProcessEnv = process.env): RegimeThresholds {
  return {
    riskOff: Number(env.REGIME_THRESHOLD_RISK_OFF ?? 0.7),
    riskOnBelow: Number(env.REGIME_THRESHOLD_RISK_ON_BELOW ?? 0.45),
  };
}

export interface ComponentInput {
  key: ComponentKey;
  /** 0–1 component score from the upstream pipeline. */
  value: number;
  topDriverNote: string;
  /** Ingestion events that drove this score (Attribution Feed later). */
  events: DriverEvent[];
}

export interface DriverEvent {
  ts: string;
  componentKey: ComponentKey;
  headline: string;
  sourceCategory: string;
  scoreDelta: number;
}

export interface ComponentReading {
  key: ComponentKey;
  value: number;
  weight: number;
  topDriverNote: string;
}

export interface IndexReading {
  ts: string;
  composite: number;
  regime: RegimeValue;
  contentHash: string;
  components: ComponentReading[];
}

export interface StoredReading extends IndexReading {
  id: number;
}
