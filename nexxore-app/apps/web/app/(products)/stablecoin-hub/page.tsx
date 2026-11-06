import type { Metadata } from 'next';
import { buildMeta, ProductShell } from '@nexxore/ui';
import { LegacyFrame } from '@/components/LegacyFrame';
import { productShellProps } from '@/lib/product';
import { loadStats } from '@/lib/stats';

export const metadata: Metadata = buildMeta({
  title: 'Stablecoin Hub',
  description: 'Yield and risk across stablecoin markets, in one view.',
  path: '/stablecoin-hub',
});

export const revalidate = 30;

export default async function StablecoinHubPage() {
  const stats = await loadStats();
  // Chrome migrated to ProductShell; the data body is still the legacy surface
  // pending its full design-system rebuild.
  return (
    <ProductShell {...productShellProps('stablecoin-hub', stats)}>
      <LegacyFrame
        src="/legacy/stablecoin-hub.html"
        title="NEXXORE Stablecoin Hub"
        // Legacy header = logo + "Launch Perps" CTA; the shell owns chrome.
        // Also drop the dead "Deposit" action column (36 handler-less buttons):
        // hide the whole last column in any table containing .action-btn.
        hide={[
          'header.header',
          'table:has(.action-btn) th:last-child',
          'table:has(.action-btn) td:last-child',
        ]}
      />
    </ProductShell>
  );
}
