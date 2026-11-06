/** Single source of truth for shell navigation — used by Nav and Footer. */

export interface NavLink {
  href: string;
  label: string;
}

/** Product switcher — the five product surfaces only. /proof stays reachable
 *  as the evidence-link destination but is not a nav item. */
export const PRODUCT_LINKS: NavLink[] = [
  { href: '/terminal', label: 'Terminal' },
  { href: '/predictions', label: 'Predictions' },
  { href: '/strategy', label: 'Strategy' },
  { href: '/stablecoin-hub', label: 'Stablecoin Hub' },
  { href: '/vaults', label: 'Vaults' },
];

export const FOOTER_LINKS: NavLink[] = [
  { href: '/docs', label: 'Docs' },
  { href: '/legal/privacy', label: 'Privacy' },
  { href: '/legal/terms', label: 'Terms' },
  { href: '/legal/risk', label: 'Risk Disclosure' },
  { href: '/company', label: 'Company' },
  { href: '/status', label: 'Status' },
];

export const SOCIAL_LINKS: NavLink[] = [
  { href: 'https://twitter.com/nexxore', label: 'X' },
];
