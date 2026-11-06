/**
 * Canonical token VALUES (Palette v2), mirrored from globals.css so tests and
 * tooling can reason about them. globals.css remains the runtime source; this
 * file is the machine-checkable copy the contrast test guards.
 */

export const BASE = {
  bg: '#07080B',
  surface1: '#0C0E12',
  surface2: '#12151B',
  surface3: '#191D25',
} as const;

/** Foreground tokens are white at these alphas, composited over a surface. */
export const FG_ALPHA = {
  primary: 0.92,
  secondary: 0.64,
  muted: 0.4,
} as const;

export const BRAND = {
  base: '#22D3EE',
  contrast: '#04141A',
} as const;

export type Regime = 'risk-on' | 'transition' | 'risk-off';

export const REGIME_ACCENT: Record<Regime, { accent: string; contrast: string }> = {
  'risk-on': { accent: '#10B981', contrast: '#04140D' },
  transition: { accent: '#F59E0B', contrast: '#1A1204' },
  'risk-off': { accent: '#EF4444', contrast: '#1A0606' },
};
