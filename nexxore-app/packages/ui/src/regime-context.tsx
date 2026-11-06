'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { PLACEHOLDER_REGIME, type Regime } from './regime';

interface RegimeContextValue {
  regime: Regime;
  /** Manually override the regime (used by Storybook + tests). */
  setRegime: (regime: Regime) => void;
}

const RegimeContext = createContext<RegimeContextValue | null>(null);

export interface RegimeProviderProps {
  children: ReactNode;
  /** Regime to render on first paint (server components can pass a value). */
  initialRegime?: Regime;
  /**
   * Source of truth for the live regime. Defaults to a stub that resolves to
   * "transition" — the real fetcher (built on the SDK's /v1/index/current)
   * is injected in Prompt 05.
   */
  fetchRegime?: () => Promise<Regime>;
  /** Poll interval in ms. Set 0 to disable polling (default). */
  pollMs?: number;
}

const stubFetchRegime = async (): Promise<Regime> => PLACEHOLDER_REGIME;

/**
 * Reads the current regime and reflects it onto `<html data-regime>` so the
 * whole site's accent (the `--accent*` CSS variables) shifts with the market.
 */
export function RegimeProvider({
  children,
  initialRegime = PLACEHOLDER_REGIME,
  fetchRegime = stubFetchRegime,
  pollMs = 0,
}: RegimeProviderProps) {
  const [regime, setRegime] = useState<Regime>(initialRegime);

  // Reflect regime onto the document root so accents update with no reload.
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-regime', regime);
    }
  }, [regime]);

  // Pull the live regime (stubbed until Prompt 05), optionally polling.
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetchRegime()
        .then((next) => {
          if (!cancelled) setRegime(next);
        })
        .catch(() => {
          /* keep last known regime on error */
        });
    };
    load();
    if (pollMs > 0) {
      const id = setInterval(load, pollMs);
      return () => {
        cancelled = true;
        clearInterval(id);
      };
    }
    return () => {
      cancelled = true;
    };
  }, [fetchRegime, pollMs]);

  return (
    <RegimeContext.Provider value={{ regime, setRegime }}>{children}</RegimeContext.Provider>
  );
}

/** Access the current regime. Returns the placeholder if no provider is mounted. */
export function useRegime(): RegimeContextValue {
  const ctx = useContext(RegimeContext);
  if (!ctx) {
    return { regime: PLACEHOLDER_REGIME, setRegime: () => undefined };
  }
  return ctx;
}
