import type { Metadata } from 'next';
import { buildMeta, ProductShell } from '@nexxore/ui';
import { productShellProps } from '@/lib/product';
import { loadStats } from '@/lib/stats';
import { WaitlistForm } from '@/components/WaitlistForm';

export const metadata: Metadata = buildMeta({
  title: 'Vaults',
  description: 'Automated, risk-aware vault strategies that rotate on regime.',
  path: '/vaults',
});

export const revalidate = 30;

export default async function VaultsPage() {
  const stats = await loadStats();
  // Honest-minimal: PENDING badge (via ProductShell), roadmap copy, and a
  // waitlist. No fake vault cards.
  return (
    <ProductShell {...productShellProps('vaults', stats)}>
      <div className="nx-product-callout">
        <h2 className="text-lg font-semibold text-fg-primary">Simulated vaults, coming soon</h2>
        <p className="mt-2 max-w-2xl leading-relaxed text-fg-secondary">
          Vaults rotate capital defensively as the Escalation Index crosses regime thresholds, with
          circuit breakers and timelocks. They launch in simulation first — every result verifiable
          before real capital is ever involved.
        </p>
        <div className="mt-5">
          <WaitlistForm />
        </div>
      </div>
    </ProductShell>
  );
}
