/**
 * Stat PRESENTATION metadata only — the numbers themselves live in the API
 * (`/v1/stats`, the single source of truth) and are fetched via the SDK in
 * lib/stats.ts. This file holds no values: if the API doesn't expose a key,
 * the number does not ship (GLOBAL RULE 2).
 */

/** Keys as exposed by /v1/stats. */
export type StatKey =
  | 'data_streams'
  | 'prediction_markets_scanned'
  | 'chains_supported'
  | 'products_live';

export interface StatPresentation {
  /** Compact noun for strap lines, e.g. "prediction markets". */
  short: string;
  /** Display suffix appended to the value, e.g. "+" for coverage floors. */
  suffix?: string;
}

export const STAT_PRESENTATION: Record<StatKey, StatPresentation> = {
  data_streams: { short: 'data streams' },
  prediction_markets_scanned: { short: 'prediction markets', suffix: '+' },
  chains_supported: { short: 'chains' },
  products_live: { short: 'product surfaces' },
};

/** Illustrative gauge value for the hero — honestly captioned as illustrative
 *  (never presented as live). Replaced by /v1/index/current in Prompt 05. */
export const ILLUSTRATIVE_INDEX = 0.58;
export const ILLUSTRATIVE_INDEX_THRESHOLD = 0.7;
