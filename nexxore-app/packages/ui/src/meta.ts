import type { Metadata } from 'next';

const SITE_NAME = 'NEXXORE';
const DEFAULT_DESCRIPTION =
  'NEXXORE reads geopolitical, macro, and prediction-market signals and rotates on-chain capital defensively, automatically.';

function siteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
}

export interface BuildMetaOptions {
  /** Page name — becomes `{Page} — NEXXORE`. Ignored if `titleOverride` set. */
  title: string;
  description?: string;
  path: string;
  /** Full title, bypassing the `{Page} — NEXXORE` pattern (home page only). */
  titleOverride?: string;
  noindex?: boolean;
  /** Absolute or root-relative OG image path. Defaults to the branded card. */
  ogImage?: string;
}

/**
 * The ONE metadata helper (Prompt A). Every page's `metadata` export comes from
 * here — no page defines raw <meta>/<title> tags itself. Guarantees the title
 * pattern, canonical URL, and OG/Twitter tags are consistent everywhere.
 */
export function buildMeta(opts: BuildMetaOptions): Metadata {
  const title = opts.titleOverride ?? `${opts.title} — ${SITE_NAME}`;
  const description = opts.description ?? DEFAULT_DESCRIPTION;
  const canonical = new URL(opts.path, siteUrl()).toString();
  const image = new URL(opts.ogImage ?? '/og/default.svg', siteUrl()).toString();

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      title,
      description,
      url: canonical,
      siteName: SITE_NAME,
      type: 'website',
      images: [{ url: image }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [image],
    },
    robots: opts.noindex ? { index: false, follow: false } : undefined,
  };
}
