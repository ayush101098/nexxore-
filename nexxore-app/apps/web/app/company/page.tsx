import type { Metadata } from 'next';
import { buildMeta } from '@nexxore/ui';

export const metadata: Metadata = buildMeta({
  title: 'Company',
  description: 'The team and story behind NEXXORE.',
  path: '/company',
});

const TEAM = [
  {
    name: 'Ayush Mishra',
    role: 'Founder',
    note: 'Building the regime-intelligence and execution stack.',
  },
  {
    name: 'Aditya Dwivedi',
    role: 'Strategic advisor',
    note: 'Kriya DEX — on-chain derivatives and market structure.',
  },
];

export default function CompanyPage() {
  return (
    <section className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="mb-3 text-2xl font-semibold text-fg-primary">Company</h1>
      <p className="mb-10 max-w-2xl leading-relaxed text-fg-secondary">
        NEXXORE builds regime-aware capital allocation infrastructure: sense the regime, decide the
        allocation, act on-chain — with every step verifiable.
      </p>

      <h2 className="mb-4 text-lg font-semibold text-fg-primary">Team</h2>
      <ul className="mb-10 grid gap-3 sm:grid-cols-2">
        {TEAM.map((m) => (
          <li key={m.name} className="rounded-lg border border-line bg-base-800 p-4">
            <div className="font-medium text-fg-primary">{m.name}</div>
            <div className="font-mono text-xs uppercase tracking-wider text-accent">{m.role}</div>
            <p className="mt-2 text-sm text-fg-secondary">{m.note}</p>
          </li>
        ))}
      </ul>

      <h2 className="mb-4 text-lg font-semibold text-fg-primary">Contact</h2>
      <ul className="mb-10 space-y-1 text-sm text-fg-secondary">
        <li>
          Email:{' '}
          <a className="nx-link" href="mailto:contact@nexxore.xyz">
            contact@nexxore.xyz
          </a>
        </li>
        <li>
          X:{' '}
          <a
            className="nx-link"
            href="https://twitter.com/nexxore"
            target="_blank"
            rel="noreferrer noopener"
          >
            @nexxore
          </a>
        </li>
      </ul>

      <h2 className="mb-4 text-lg font-semibold text-fg-primary">Press kit</h2>
      <ul className="space-y-1 text-sm text-fg-secondary">
        <li>
          <a className="nx-link" href="/press/nexxore-logo.svg" download>
            Logo (SVG)
          </a>
        </li>
        <li>
          <a className="nx-link" href="/press/boilerplate.txt" download>
            One-paragraph boilerplate (TXT)
          </a>
        </li>
      </ul>
    </section>
  );
}
