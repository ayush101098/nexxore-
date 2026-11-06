/**
 * Regime model — the spine of the regime-accent system (GLOBAL RULE 3).
 * The full RegimeProvider + live wiring arrives in Prompt 02 / Prompt 05.
 * For Prompt 01 the nav chip is a static placeholder ("TRANSITION").
 */
export type Regime = 'risk-on' | 'transition' | 'risk-off';

export interface RegimeMeta {
  regime: Regime;
  /** Short uppercase label shown in the chip. */
  label: string;
}

export const REGIME_META: Record<Regime, RegimeMeta> = {
  'risk-on': { regime: 'risk-on', label: 'RISK-ON' },
  transition: { regime: 'transition', label: 'TRANSITION' },
  'risk-off': { regime: 'risk-off', label: 'RISK-OFF' },
};

/** Placeholder regime used until live data is wired in Prompt 05. */
export const PLACEHOLDER_REGIME: Regime = 'transition';
