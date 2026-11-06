import { createClient, type Stat } from '@nexxore/sdk';
import { STAT_PRESENTATION, type StatKey } from '@/content/stats';

/**
 * Server-side stats loader — every number the site renders flows through here
 * from /v1/stats. On API failure it returns an empty map and the UI omits the
 * numbers entirely ("if the API doesn't expose it, the number does not ship").
 */

export type StatsMap = Partial<Record<StatKey, Stat>>;

const client = createClient({
  baseUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000',
  // Let Next's fetch cache own revalidation (30s) — disable the SDK layer.
  cacheTtlMs: 0,
  retries: 1,
  retryBackoffMs: 100,
  fetchImpl: (input, init) =>
    fetch(input, { ...init, next: { revalidate: 30 } } as RequestInit),
});

export async function loadStats(): Promise<StatsMap> {
  try {
    const res = await client.stats();
    const map: StatsMap = {};
    for (const stat of res.stats) {
      if (stat.key in STAT_PRESENTATION) map[stat.key as StatKey] = stat;
    }
    return map;
  } catch {
    // API unreachable — ship no numbers rather than stale/invented ones.
    return {};
  }
}

/** "52 data streams · 750+ prediction markets" — only for keys the API returned. */
export function strap(stats: StatsMap, keys: readonly StatKey[]): string | undefined {
  const parts = keys
    .filter((k): k is StatKey => Boolean(stats[k]))
    .map((k) => {
      const p = STAT_PRESENTATION[k];
      const s = stats[k as StatKey]!;
      return `${s.value}${p.suffix ?? ''} ${p.short}`;
    });
  return parts.length ? parts.join(' · ') : undefined;
}
