import type { Metadata } from 'next';
import { buildMeta, ProductShell } from '@nexxore/ui';
import { LegacyFrame } from '@/components/LegacyFrame';
import { productShellProps } from '@/lib/product';
import { loadStats } from '@/lib/stats';

export const metadata: Metadata = buildMeta({
  title: 'Strategy Builder',
  description: 'Compose and backtest regime-aware allocation strategies.',
  path: '/strategy',
});

export const revalidate = 30;

export default async function StrategyPage() {
  const stats = await loadStats();
  // Chrome migrated to ProductShell; the builder body is still the legacy
  // surface pending its full design-system rebuild.
  return (
    <ProductShell {...productShellProps('strategy', stats)}>
      <LegacyFrame
        src="/legacy/strategy-builder.html"
        title="NEXXORE Strategy Builder"
        // Keep functional header (asset tabs, wallet connect); drop only the
        // duplicated brand link.
        hide={['.logo-link']}
      />
    </ProductShell>
  );
}
