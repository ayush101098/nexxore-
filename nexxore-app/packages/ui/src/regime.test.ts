import { describe, expect, it } from 'vitest';
import { REGIME_META, PLACEHOLDER_REGIME } from './regime';

describe('regime metadata', () => {
  it('exposes an uppercase label for every regime', () => {
    for (const key of ['risk-on', 'transition', 'risk-off'] as const) {
      expect(REGIME_META[key].label).toBe(REGIME_META[key].label.toUpperCase());
      expect(REGIME_META[key].regime).toBe(key);
    }
  });

  it('defaults the placeholder to transition', () => {
    expect(PLACEHOLDER_REGIME).toBe('transition');
    expect(REGIME_META[PLACEHOLDER_REGIME].label).toBe('TRANSITION');
  });
});
