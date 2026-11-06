'use client';

import { REGIME_META, type Regime } from '../regime';
import { useRegime } from '../regime-context';

export interface RegimeChipProps {
  /**
   * Regime to display. When omitted, reads the live regime from
   * RegimeProvider (falls back to the "transition" placeholder if no
   * provider is mounted).
   */
  regime?: Regime;
}

/** Nav status chip. Its color is driven by the `data-regime` accent variables. */
export function RegimeChip({ regime }: RegimeChipProps) {
  const { regime: contextRegime } = useRegime();
  const meta = REGIME_META[regime ?? contextRegime];
  return (
    <span className="nx-chip" role="status" aria-label={`Market regime: ${meta.label}`}>
      <span className="nx-chip__dot" aria-hidden="true" />
      {meta.label}
    </span>
  );
}
