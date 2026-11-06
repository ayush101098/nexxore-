/** All homepage copy. Page components render this — no inline strings/numbers. */

export const HERO = {
  h1: "Markets don't crash on candles. They crash on regimes.",
  sub: 'NEXXORE reads geopolitical, macro, and prediction-market signals — and rotates on-chain capital defensively, automatically.',
  primaryCta: { label: 'Explore the Terminal', href: '/terminal' },
  gaugeLabel: 'Escalation Index',
} as const;

export const PROBLEMS = [
  {
    title: 'Flying blind to regimes',
    body: 'Most tools watch price. None tell you when the macro and geopolitical backdrop has turned against you.',
  },
  {
    title: 'Unverifiable performance claims',
    body: 'Screenshots and cherry-picked returns. No way to check what actually happened.',
  },
  {
    title: 'Fragmented execution',
    body: 'Signals in one place, risk in another, execution somewhere else — nothing acts on its own.',
  },
] as const;

/**
 * The loop — Sense → Decide → Act. Figures reference stat keys resolved by the
 * component from content/stats.ts (never hardcoded here).
 */
export const LOOP = {
  kicker: 'The loop',
  title: 'Sense. Decide. Act. Continuously.',
  stages: [
    {
      id: 'sense',
      name: 'Sense',
      route: '/predictions',
      points: ['Data streams', 'Escalation Index', 'Prediction markets'],
      statKeys: ['data_streams', 'prediction_markets_scanned'] as const,
    },
    {
      id: 'decide',
      name: 'Decide',
      route: '/strategy',
      points: ['Regime engine', 'CVaR risk limits', 'Backtesting'],
      statKeys: [] as const,
    },
    {
      id: 'act',
      name: 'Act',
      route: '/vaults',
      points: ['Multi-chain execution', 'Circuit breakers', 'Timelocks'],
      statKeys: ['chains_supported'] as const,
    },
  ],
} as const;

export const PRODUCTS_SECTION = {
  kicker: 'Products',
  title: 'The surfaces that run the loop',
} as const;

export const SEQUENCING = {
  headline: 'The signals business funds the trust the capital business requires.',
  body: 'We earn revenue selling regime intelligence today. That funds the audited, on-chain track record our capital products need before they ever touch your money.',
} as const;
