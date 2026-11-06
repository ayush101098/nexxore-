import type { Metadata } from 'next';
import { buildMeta, ProductShell } from '@nexxore/ui';
import { LegacyFrame } from '@/components/LegacyFrame';
import { productShellProps } from '@/lib/product';
import { loadStats } from '@/lib/stats';

export const metadata: Metadata = buildMeta({
  title: 'Terminal',
  description: 'One screen for regime, signals, and on-chain execution.',
  path: '/terminal',
});

export const revalidate = 30;

export default async function TerminalPage() {
  const stats = await loadStats();
  // Chrome migrated to ProductShell; the interactive body (map, charts, wallet)
  // is still the legacy surface pending its full design-system rebuild.
  return (
    <ProductShell {...productShellProps('terminal', stats)}>
      <LegacyFrame
        src="/legacy/terminal.html"
        title="NEXXORE Terminal"
        // Keep functional topbar (regime badge, region tabs, search, clock);
        // drop the duplicated page links + Trade CTA.
        hide={['.tb-nav', '.topbar-r .tb-btn']}
      />
    </ProductShell>
  );
}
