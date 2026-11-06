import type { Metadata } from 'next';
import { buildMeta } from '@nexxore/ui';
import { DraftDoc } from '@/components/DraftDoc';

export const metadata: Metadata = buildMeta({
  title: 'Privacy Policy',
  description: 'How NEXXORE collects and handles your data.',
  path: '/legal/privacy',
  noindex: true,
});

export default function PrivacyPage() {
  return (
    <DraftDoc title="Privacy Policy">
      <p>
        This is placeholder text. The final privacy policy, supplied by counsel, will describe what
        data NEXXORE collects, how it is used, and your rights over it.
      </p>
    </DraftDoc>
  );
}
