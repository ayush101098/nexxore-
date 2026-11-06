import type { ProductShellProps, ProductStat } from '@nexxore/ui';
import { getProduct, LOOP_STAGES } from '@/content/products';
import { STAT_PRESENTATION } from '@/content/stats';
import type { StatsMap } from './stats';

/**
 * Resolve the shared ProductShell chrome for a slug. Stat VALUES come from the
 * caller-supplied StatsMap (fetched from /v1/stats) — keys the API did not
 * return are simply omitted.
 */
export function productShellProps(
  slug: string,
  stats: StatsMap,
): Omit<ProductShellProps, 'children'> {
  const p = getProduct(slug);
  if (!p) throw new Error(`Unknown product slug: ${slug}`);
  const shellStats: ProductStat[] = p.stats.flatMap((key) => {
    const s = stats[key];
    if (!s) return [];
    const suffix = STAT_PRESENTATION[key].suffix ?? '';
    return [
      {
        value: `${s.value}${suffix}`,
        label: s.label,
        evidenceUrl: s.evidenceUrl,
        verified: s.verified,
      },
    ];
  });
  return {
    name: p.name,
    valueProp: p.valueProp,
    status: p.status,
    stage: p.stage,
    loop: LOOP_STAGES,
    stats: shellStats,
  };
}
