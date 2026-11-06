import { describe, expect, it } from 'vitest';
import { BASE, BRAND, FG_ALPHA, REGIME_ACCENT, type Regime } from './tokens';

/** WCAG relative luminance + contrast ratio. */
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}
function lin(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}
function luminance([r, g, b]: [number, number, number]): number {
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function ratio(fg: [number, number, number], bg: [number, number, number]): number {
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}
/** Composite a white foreground at `alpha` over an opaque background. */
function whiteOver(bg: [number, number, number], alpha: number): [number, number, number] {
  return bg.map((c) => Math.round(255 * alpha + c * (1 - alpha))) as [number, number, number];
}

const SURFACES = Object.values(BASE).map(hexToRgb);
const REGIMES: Regime[] = ['risk-on', 'transition', 'risk-off'];

describe('WCAG AA contrast over the token palette', () => {
  it('primary + secondary body text ≥ 4.5:1 on every surface', () => {
    for (const surface of SURFACES) {
      expect(ratio(whiteOver(surface, FG_ALPHA.primary), surface)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(whiteOver(surface, FG_ALPHA.secondary), surface)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('muted text ≥ 3:1 (large/non-essential) on the base background', () => {
    const base = hexToRgb(BASE.bg);
    expect(ratio(whiteOver(base, FG_ALPHA.muted), base)).toBeGreaterThanOrEqual(3);
  });

  it('brand accent ≥ 3:1 on base; brand button text ≥ 4.5:1', () => {
    const base = hexToRgb(BASE.bg);
    expect(ratio(hexToRgb(BRAND.base), base)).toBeGreaterThanOrEqual(3);
    expect(ratio(hexToRgb(BRAND.contrast), hexToRgb(BRAND.base))).toBeGreaterThanOrEqual(4.5);
  });

  it('each regime accent ≥ 3:1 on base, and its contrast text ≥ 4.5:1 on the accent fill', () => {
    const base = hexToRgb(BASE.bg);
    for (const r of REGIMES) {
      const { accent, contrast } = REGIME_ACCENT[r];
      expect(ratio(hexToRgb(accent), base)).toBeGreaterThanOrEqual(3);
      expect(ratio(hexToRgb(contrast), hexToRgb(accent))).toBeGreaterThanOrEqual(4.5);
    }
  });
});
