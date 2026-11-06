import type { ReactNode } from 'react';
import { EvidenceLink } from './EvidenceLink';

export interface StatCardProps {
  /** The statistic. Numeric values REQUIRE an evidenceUrl (GLOBAL RULE 2/4). */
  value: number | string;
  label: string;
  unit?: string;
  /** Link to /proof, methodology, or a source. Required when `value` is numeric. */
  evidenceUrl?: string;
  /**
   * false → rendered with a distinct "reported" treatment;
   * true → shows a "verify ↗" evidence affordance.
   */
  verified?: boolean;
  footer?: ReactNode;
}

function isNumericValue(value: number | string): boolean {
  if (typeof value === 'number') return true;
  // Strings like "750", "$1.2M", "18.8%" count as numeric claims.
  return /[0-9]/.test(value);
}

/**
 * StatCard with a built-in conscience: in development it THROWS when given a
 * numeric value with no evidence link, so an unsourced number breaks the page
 * on the dev's machine before it can ship. Rules enforced by code beat rules
 * enforced by memory.
 */
export function StatCard({
  value,
  label,
  unit,
  evidenceUrl,
  verified = false,
  footer,
}: StatCardProps) {
  if (isNumericValue(value) && !evidenceUrl) {
    if (process.env.NODE_ENV !== 'production') {
      throw new Error(
        `StatCard: numeric value "${value}" (label "${label}") requires an evidenceUrl. ` +
          'Every number must link to evidence (GLOBAL RULE 2/4).',
      );
    }
    // Never render an unsourced number in production either.
    return null;
  }

  return (
    <div className="nx-stat" data-verified={verified}>
      <div className="nx-stat__value">
        <span className="nx-stat__number">{value}</span>
        {unit ? <span className="nx-stat__unit">{unit}</span> : null}
      </div>
      <div className="nx-stat__label">{label}</div>
      <div className="nx-stat__meta">
        {evidenceUrl ? (
          verified ? (
            <EvidenceLink href={evidenceUrl} label="verify" />
          ) : (
            <EvidenceLink href={evidenceUrl} label="reported" className="nx-evidence--reported" />
          )
        ) : null}
      </div>
      {footer ? <div className="nx-stat__footer">{footer}</div> : null}
    </div>
  );
}
