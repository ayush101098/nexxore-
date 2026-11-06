/**
 * Canonical seed for the stats table — ONLY numbers we can currently defend
 * (PRD §14). NO ROI / P&L / win-rate figures here: performance stats arrive
 * exclusively via the Proof Layer (Prompt 07+) and flip `verified: true` when
 * their underlying batch is anchored.
 */

export interface StatRow {
  key: string;
  value: number;
  unit: string | null;
  label: string;
  evidenceUrl: string;
  verified: boolean;
}

export const STATS_SEED: StatRow[] = [
  {
    key: 'data_streams',
    value: 52,
    unit: 'streams',
    label: 'Real-time data streams',
    evidenceUrl: '/proof#coverage',
    verified: false,
  },
  {
    key: 'prediction_markets_scanned',
    value: 750,
    unit: 'markets',
    label: 'Prediction markets scanned/cycle',
    evidenceUrl: '/proof#coverage',
    verified: false,
  },
  {
    key: 'chains_supported',
    value: 6,
    unit: 'chains',
    label: 'Chains supported',
    evidenceUrl: '/proof#coverage',
    verified: false,
  },
  {
    key: 'products_live',
    value: 5,
    unit: 'products',
    label: 'Product surfaces live',
    evidenceUrl: '/proof#coverage',
    verified: false,
  },
];
