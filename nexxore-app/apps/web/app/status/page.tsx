import type { Metadata } from 'next';
import { buildMeta } from '@nexxore/ui';

export const metadata: Metadata = buildMeta({
  title: 'Status',
  description: 'Live measured status of NEXXORE services.',
  path: '/status',
});

// Live checks — measured at request time, never cached.
export const dynamic = 'force-dynamic';

interface Check {
  name: string;
  url: string;
  ok: boolean;
  ms: number | null;
}

async function check(name: string, url: string): Promise<Check> {
  const started = Date.now();
  try {
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(3000) });
    return { name, url, ok: res.ok, ms: Date.now() - started };
  } catch {
    return { name, url, ok: false, ms: null };
  }
}

export default async function StatusPage() {
  const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
  const checks = await Promise.all([check('API gateway', `${apiBase}/v1/health`)]);
  // Historical uptime comes from a hosted monitor (BetterStack/UptimeRobot)
  // once STATUS_MONITOR_URL is configured — never a marketing "99.9%" claim.
  const monitorConfigured = Boolean(process.env.STATUS_MONITOR_URL);
  const now = new Date().toISOString();

  return (
    <section className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="mb-3 text-2xl font-semibold text-fg-primary">Status</h1>
      <p className="mb-8 text-sm text-fg-secondary">
        Checks below are measured live at page load ({now}).
      </p>

      <ul className="mb-10 space-y-3">
        <li className="flex items-center justify-between rounded-lg border border-line bg-base-800 p-4">
          <span className="font-medium text-fg-primary">Web</span>
          <span className="font-mono text-xs text-fg-secondary">
            operational — serving this page
          </span>
        </li>
        {checks.map((c) => (
          <li
            key={c.name}
            className="flex items-center justify-between rounded-lg border border-line bg-base-800 p-4"
          >
            <span className="font-medium text-fg-primary">{c.name}</span>
            <span className="font-mono text-xs text-fg-secondary">
              {c.ok ? `operational — ${c.ms}ms` : 'unreachable'}
            </span>
          </li>
        ))}
      </ul>

      <p className="text-sm text-fg-muted">
        {monitorConfigured
          ? 'Historical uptime is sourced from the external monitor.'
          : 'Historical uptime metrics will appear here once the external monitor (BetterStack/UptimeRobot) is connected. Until then only live-measured checks are shown — no unmeasured uptime claims.'}
      </p>
    </section>
  );
}
