import type { Metadata } from 'next';
import { buildMeta, ProductShell } from '@nexxore/ui';
import { LegacyFrame } from '@/components/LegacyFrame';
import { productShellProps } from '@/lib/product';
import { loadStats } from '@/lib/stats';

export const metadata: Metadata = buildMeta({
  title: 'Predictions',
  description: 'Prediction-market intelligence across Polymarket and Manifold.',
  path: '/predictions',
});

export const revalidate = 30;

export default async function PredictionsPage() {
  const stats = await loadStats();
  // Chrome migrated to ProductShell; the rich markets body is still the legacy
  // surface pending its full design-system rebuild.
  return (
    <ProductShell {...productShellProps('predictions', stats)}>
      <LegacyFrame
        src="/legacy/predictions.html"
        title="NEXXORE Predictions"
        // Legacy header = duplicated brand + CTA buttons; the shell owns chrome.
        hide={['header.header']}
      />
    </ProductShell>
  );
}
