import type { ReactNode } from 'react';
import { GaugeDial } from '../components/GaugeDial';
import { LiveBadge, type LiveBadgeStatus } from '../components/LiveBadge';
import { SectionHeader } from '../components/SectionHeader';
import { LoopAnimator } from './LoopAnimator';

/** Presentational homepage sections. All copy/numbers arrive as props (the app
 *  resolves them from content/*), so page components stay string/number-free. */

interface Cta {
  label: string;
  href: string;
}

// ── Hero ────────────────────────────────────────────────────────────
export interface HeroProps {
  h1: string;
  sub: string;
  primaryCta: Cta;
  secondaryCta?: Cta;
  gauge: { value: number; threshold: number; label: string; caption: string };
}

export function Hero({ h1, sub, primaryCta, secondaryCta, gauge }: HeroProps) {
  return (
    <section className="nx-hero">
      <div className="nx-hero__copy">
        <h1 className="nx-hero__h1">{h1}</h1>
        <p className="nx-hero__sub">{sub}</p>
        <div className="nx-hero__ctas">
          <a className="nx-btn nx-btn--primary" href={primaryCta.href}>
            {primaryCta.label}
          </a>
          {secondaryCta ? (
            <a className="nx-btn nx-btn--secondary" href={secondaryCta.href}>
              {secondaryCta.label}
            </a>
          ) : null}
        </div>
      </div>
      <div className="nx-hero__gauge">
        <GaugeDial value={gauge.value} threshold={gauge.threshold} label={gauge.label} size={280} />
        <p className="nx-hero__caption">{gauge.caption}</p>
      </div>
    </section>
  );
}

// ── Problem section ─────────────────────────────────────────────────
export interface ProblemCard {
  title: string;
  body: string;
}
export function ProblemSection({ items }: { items: readonly ProblemCard[] }) {
  return (
    <section className="nx-section">
      <div className="nx-problem-grid">
        {items.map((p) => (
          <div key={p.title} className="nx-problem-card">
            <h2 className="nx-problem-card__title">{p.title}</h2>
            <p className="nx-problem-card__body">{p.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

// ── Loop section ("The Loop") ───────────────────────────────────────
export interface LoopStageView {
  id: string;
  name: string;
  route: string;
  /** Numeric strap line, pre-composed by the app from content/stats.ts. */
  metric?: string;
  points: readonly string[];
}
export interface LoopSectionProps {
  kicker: string;
  title: string;
  stages: readonly LoopStageView[];
}

/** Three stages Sense→Decide→Act. Animation (Prompt C) mounts on the
 *  `data-loop-stage` / `data-loop-path` attributes; static until then. */
export function LoopSection({ kicker, title, stages }: LoopSectionProps) {
  return (
    <section className="nx-section" data-loop-root>
      <SectionHeader kicker={kicker} title={title} />
      <div className="nx-loop">
        <svg className="nx-loop__path" data-loop-path aria-hidden="true" preserveAspectRatio="none">
          <path d="M 0 0" fill="none" />
        </svg>
        <div className="nx-loop__stages">
          {stages.map((s, i) => (
            <a
              key={s.id}
              href={s.route}
              className="nx-loop__stage"
              data-loop-stage={s.id}
              data-loop-index={i}
            >
              <span className="nx-loop__stage-name">{s.name}</span>
              {s.metric ? <span className="nx-loop__stage-metric">{s.metric}</span> : null}
              <ul className="nx-loop__points">
                {s.points.map((pt) => (
                  <li key={pt}>{pt}</li>
                ))}
              </ul>
            </a>
          ))}
        </div>
        <LoopAnimator />
      </div>
    </section>
  );
}

// ── Products grid ───────────────────────────────────────────────────
export interface ProductCardView {
  name: string;
  valueProp: string;
  href: string;
  status: LiveBadgeStatus;
  microStat?: string;
}
export interface ProductsGridProps {
  kicker: string;
  title: string;
  products: readonly ProductCardView[];
}
export function ProductsGrid({ kicker, title, products }: ProductsGridProps) {
  return (
    <section className="nx-section">
      <SectionHeader kicker={kicker} title={title} />
      <div className="nx-products-grid">
        {products.map((p) => (
          <a key={p.name} href={p.href} className="nx-product-card">
            <div className="nx-product-card__head">
              <span className="nx-product-card__name">{p.name}</span>
              <LiveBadge status={p.status} />
            </div>
            <p className="nx-product-card__prop">{p.valueProp}</p>
            {p.microStat ? <span className="nx-product-card__stat">{p.microStat}</span> : null}
          </a>
        ))}
      </div>
    </section>
  );
}

// ── Sequencing strip ────────────────────────────────────────────────
export function SequencingStrip({ headline, body }: { headline: string; body: ReactNode }) {
  return (
    <section className="nx-sequencing">
      <p className="nx-sequencing__headline">{headline}</p>
      <p className="nx-sequencing__body">{body}</p>
    </section>
  );
}
