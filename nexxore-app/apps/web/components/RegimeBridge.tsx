'use client';

import { useCallback, type ReactNode } from 'react';
import { RegimeProvider, type Regime } from '@nexxore/ui';

const API_TO_UI: Record<string, Regime> = {
  risk_on: 'risk-on',
  transition: 'transition',
  risk_off: 'risk-off',
};

/**
 * Prompt 05 regime propagation: feeds RegimeProvider from /v1/index/current so
 * the whole site's accent tracks the live Escalation Index (polled every 60s,
 * matching the endpoint's cache). On failure the last known regime is kept.
 */
export function RegimeBridge({ children }: { children: ReactNode }) {
  const fetchRegime = useCallback(async (): Promise<Regime> => {
    const base = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
    const res = await fetch(`${base}/v1/index/current`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`index/current ${res.status}`);
    const data = (await res.json()) as { regime: string };
    const regime = API_TO_UI[data.regime];
    if (!regime) throw new Error(`unknown regime "${data.regime}"`);
    return regime;
  }, []);

  return (
    <RegimeProvider initialRegime="transition" fetchRegime={fetchRegime} pollMs={60_000}>
      {children}
    </RegimeProvider>
  );
}
