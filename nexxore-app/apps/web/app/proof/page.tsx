import type { Metadata } from 'next';
import { buildMeta } from '@nexxore/ui';
import { WaitlistForm } from '@/components/WaitlistForm';
import { PROOF_PENDING } from '@/content/copy';

export const metadata: Metadata = buildMeta({
  title: 'Proof Layer',
  description: 'Every NEXXORE number, verifiable on-chain. Track record going public.',
  path: '/proof',
});

export default function ProofPage() {
  return (
    <section className="mx-auto max-w-3xl px-6 py-20" id="coverage">
      <span className="mb-3 inline-block font-mono text-xs uppercase tracking-widest text-accent">
        Proof Layer
      </span>
      <h1 className="mb-4 text-3xl font-semibold tracking-tight text-fg-primary">
        Every number, verifiable on-chain.
      </h1>
      <p className="mb-8 max-w-2xl leading-relaxed text-fg-secondary">{PROOF_PENDING}</p>
      <WaitlistForm />
    </section>
  );
}
