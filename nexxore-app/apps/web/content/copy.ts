/**
 * Shared microcopy — one voice everywhere (sentence case, no exclamation
 * marks, "regime" terminology only; see GLOSSARY.md). Written once so empty /
 * loading / error states read identically across all five products.
 */
export const STATES = {
  empty: 'No signals in this window.',
  loading: 'Loading…',
  error: 'Something went wrong loading this data. Try again shortly.',
} as const;

export const PROOF_PENDING =
  'Track record goes public soon — every number will be verifiable on-chain.';

export const ILLUSTRATIVE_CAPTION = 'Illustrative — live index launching soon.';
