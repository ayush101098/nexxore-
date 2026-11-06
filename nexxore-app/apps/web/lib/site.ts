/** Site-wide config. Absolute URLs come from env, never hardcoded (PRD hygiene). */
export const SITE = {
  name: 'NEXXORE',
  /** Canonical base URL. Set NEXT_PUBLIC_SITE_URL in every environment. */
  url: process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000',
  description:
    'Autonomous DeFi execution infrastructure for AI trading agents, prediction markets, and yield optimization.',
} as const;

/** Every internal route the app serves — the source of truth for sitemap + link-check. */
export const ROUTES = {
  home: '/',
  terminal: '/terminal',
  predictions: '/predictions',
  strategy: '/strategy',
  stablecoinHub: '/stablecoin-hub',
  vaults: '/vaults',
  proof: '/proof',
  docs: '/docs',
  company: '/company',
  status: '/status',
  legalPrivacy: '/legal/privacy',
  legalTerms: '/legal/terms',
  legalRisk: '/legal/risk',
} as const;

export const ALL_ROUTES: string[] = Object.values(ROUTES);
