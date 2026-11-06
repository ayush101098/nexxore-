import type { Metadata } from 'next';
import { buildMeta } from '@nexxore/ui';
import { DraftDoc } from '@/components/DraftDoc';

export const metadata: Metadata = buildMeta({
  title: 'Terms of Service',
  description: 'The terms that govern use of NEXXORE.',
  path: '/legal/terms',
  noindex: true,
});

export default function TermsPage() {
  return (
    <DraftDoc title="Terms of Service">
      <p>
        This is placeholder text. The final terms of service, supplied by counsel, will govern your
        use of NEXXORE products and surfaces.
      </p>
    </DraftDoc>
  );
}
