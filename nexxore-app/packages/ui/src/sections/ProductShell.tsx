import type { ReactNode } from 'react';
import { LiveBadge, type LiveBadgeStatus } from '../components/LiveBadge';
import { StatCard } from '../components/StatCard';

/**
 * The one page anatomy every product surface uses (Prompt D):
 *   • Header band — name, value prop, LiveBadge, up to 3 StatCards.
 *   • Body        — the product's own UI (design-system components).
 *   • Footer band — "Part of the loop": where this product sits in
 *                   Sense→Decide→Act, with links to the adjacent stages.
 */

export type LoopStageId = 'sense' | 'decide' | 'act';

export interface ProductStat {
  value: number | string;
  unit?: string;
  label: string;
  evidenceUrl?: string;
  verified?: boolean;
}

export interface ProductShellLoopStage {
  id: LoopStageId;
  label: string;
  href: string;
}

export interface ProductShellProps {
  name: string;
  valueProp: string;
  status: LiveBadgeStatus;
  stage: LoopStageId;
  loop: readonly ProductShellLoopStage[];
  stats?: readonly ProductStat[];
  children: ReactNode;
}

export function ProductShell({
  name,
  valueProp,
  status,
  stage,
  loop,
  stats = [],
  children,
}: ProductShellProps) {
  return (
    <div className="nx-product">
      <header className="nx-product__header">
        <div className="nx-product__intro">
          <div className="nx-product__title-row">
            <h1 className="nx-product__name">{name}</h1>
            <LiveBadge status={status} />
          </div>
          <p className="nx-product__prop">{valueProp}</p>
        </div>
        {stats.length > 0 ? (
          <div className="nx-product__stats">
            {stats.slice(0, 3).map((s) => (
              <StatCard
                key={s.label}
                value={s.value}
                unit={s.unit}
                label={s.label}
                evidenceUrl={s.evidenceUrl}
                verified={s.verified}
              />
            ))}
          </div>
        ) : null}
      </header>

      <div className="nx-product__body">{children}</div>

      <footer className="nx-product__loop">
        <span className="nx-product__loop-kicker">Part of the loop</span>
        <ol className="nx-product__loop-stages">
          {loop.map((s) => {
            const active = s.id === stage;
            return (
              <li key={s.id} className="nx-product__loop-item" data-active={active}>
                {active ? (
                  <span className="nx-product__loop-current">{s.label}</span>
                ) : (
                  <a href={s.href} className="nx-product__loop-link">
                    {s.label}
                  </a>
                )}
              </li>
            );
          })}
        </ol>
      </footer>
    </div>
  );
}
