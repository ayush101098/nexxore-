/**
 * Placeholder for routes that exist so nav/footer links never 404 (keeps the
 * CI link-check green) but whose real content ships in a later prompt. Uses
 * design-token classes only — no raw hex (enforced by check-tokens.mjs).
 */
export function ComingSoon({ title, note }: { title: string; note?: string }) {
  return (
    <section className="mx-auto max-w-3xl px-6 py-20 text-center">
      <h1 className="mb-3 text-2xl font-semibold text-fg-primary">{title}</h1>
      <p className="leading-relaxed text-fg-secondary">
        {note ?? 'This page is coming soon.'}
      </p>
    </section>
  );
}
