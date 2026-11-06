import type { Metadata } from 'next';
import { buildMeta } from '@nexxore/ui';
import { PRODUCTS } from '@/content/products';

export const metadata: Metadata = buildMeta({
  title: 'Docs',
  description: 'Product overview while the full NEXXORE documentation is being written.',
  path: '/docs',
});

export default function DocsPage() {
  return (
    <section className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="mb-4 text-2xl font-semibold text-fg-primary">Documentation</h1>
      <p className="mb-8 leading-relaxed text-fg-secondary">
        The full docs are being written. Meanwhile, here is what each product surface does — they
        all run one loop: sense the regime, decide the allocation, act on-chain.
      </p>
      <ul className="space-y-3">
        {PRODUCTS.map((p) => (
          <li key={p.slug} className="rounded-lg border border-line bg-base-800 p-4">
            <a className="nx-link font-medium" href={p.route}>
              {p.name}
            </a>
            <p className="mt-1 text-sm text-fg-secondary">{p.valueProp}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
