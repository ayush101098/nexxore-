import type { LiveBadgeStatus } from '@nexxore/ui';
import type { StatKey } from './stats';

/** The three loop stages every product maps to. */
export type LoopStage = 'sense' | 'decide' | 'act';

export interface ProductContent {
  slug: string;
  route: string;
  name: string;
  /** One-line value prop — sentence case, no exclamation marks. */
  valueProp: string;
  status: LiveBadgeStatus;
  stage: LoopStage;
  /** Stat keys surfaced in the product header band (max 3). */
  stats: StatKey[];
}

export const PRODUCTS: ProductContent[] = [
  {
    slug: 'terminal',
    route: '/terminal',
    name: 'Terminal',
    valueProp: 'One screen for regime, signals, and on-chain execution.',
    status: 'LIVE',
    stage: 'sense',
    stats: ['data_streams', 'chains_supported'],
  },
  {
    slug: 'predictions',
    route: '/predictions',
    name: 'Predictions',
    valueProp: 'Prediction-market intelligence across Polymarket and Manifold.',
    status: 'LIVE',
    stage: 'sense',
    stats: ['prediction_markets_scanned'],
  },
  {
    slug: 'strategy',
    route: '/strategy',
    name: 'Strategy Builder',
    valueProp: 'Compose and backtest regime-aware allocation strategies.',
    status: 'SIMULATED',
    stage: 'decide',
    stats: [],
  },
  {
    slug: 'stablecoin-hub',
    route: '/stablecoin-hub',
    name: 'Stablecoin Hub',
    valueProp: 'Yield and risk across stablecoin markets, in one view.',
    status: 'LIVE',
    stage: 'act',
    stats: ['chains_supported'],
  },
  {
    slug: 'vaults',
    route: '/vaults',
    name: 'Vaults',
    valueProp: 'Automated, risk-aware vault strategies that rotate on regime.',
    status: 'PENDING',
    stage: 'act',
    stats: [],
  },
];

export const getProduct = (slug: string): ProductContent | undefined =>
  PRODUCTS.find((p) => p.slug === slug);

/** Canonical loop stages for the ProductShell footer band. */
export const LOOP_STAGES = [
  { id: 'sense', label: 'Sense', href: '/predictions' },
  { id: 'decide', label: 'Decide', href: '/strategy' },
  { id: 'act', label: 'Act', href: '/vaults' },
] as const satisfies readonly { id: LoopStage; label: string; href: string }[];
