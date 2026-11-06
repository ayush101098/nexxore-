import type { Metadata } from 'next';
import { buildMeta } from '@nexxore/ui';

export const metadata: Metadata = buildMeta({
  title: 'Not found',
  path: '/404',
  noindex: true,
});

export default function NotFound() {
  return (
    <section className="mx-auto max-w-3xl px-6 py-24 text-center">
      <h1 className="mb-3 text-2xl font-semibold text-fg-primary">Page not found</h1>
      <p className="mb-6 text-fg-secondary">That route does not exist.</p>
      <a className="nx-btn nx-btn--primary" href="/">
        Back to home
      </a>
    </section>
  );
}
