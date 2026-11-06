import type { ReactNode } from 'react';

/**
 * DRAFT-watermarked wrapper for legal pages whose counsel-supplied final text
 * has not yet landed. Pages using this are `noindex` (set via buildMeta).
 */
export function DraftDoc({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="relative mx-auto max-w-3xl px-6 py-16">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 flex items-center justify-center text-[7rem] font-bold uppercase tracking-widest text-fg-muted opacity-10"
      >
        Draft
      </span>
      <div className="relative">
        <span className="mb-3 inline-block rounded border border-line-strong px-2 py-0.5 font-mono text-xs uppercase tracking-widest text-fg-muted">
          Draft — not final
        </span>
        <h1 className="mb-4 text-2xl font-semibold text-fg-primary">{title}</h1>
        <div className="space-y-4 leading-relaxed text-fg-secondary">{children}</div>
      </div>
    </section>
  );
}
