import type { Metadata } from 'next';
import { buildMeta } from '@nexxore/ui';
import { DraftDoc } from '@/components/DraftDoc';

export const metadata: Metadata = buildMeta({
  title: 'Risk Disclosure',
  description: 'Risk disclosure for NEXXORE on-chain strategies.',
  path: '/legal/risk',
  noindex: true,
});

export default function RiskPage() {
  return (
    <DraftDoc title="Risk Disclosure">
      <p>
        This is placeholder text. The final risk disclosure, supplied by counsel, will describe the
        risks of on-chain strategies, including the potential loss of capital.
      </p>
    </DraftDoc>
  );
}
