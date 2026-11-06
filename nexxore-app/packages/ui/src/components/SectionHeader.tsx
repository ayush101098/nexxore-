import type { ReactNode } from 'react';

export interface SectionHeaderProps {
  title: string;
  kicker?: string;
  description?: ReactNode;
  /** Optional right-aligned slot (e.g. a LiveBadge or EvidenceLink). */
  aside?: ReactNode;
}

export function SectionHeader({ title, kicker, description, aside }: SectionHeaderProps) {
  return (
    <header className="nx-section-header">
      <div className="nx-section-header__text">
        {kicker ? <span className="nx-section-header__kicker">{kicker}</span> : null}
        <h2 className="nx-section-header__title">{title}</h2>
        {description ? <p className="nx-section-header__desc">{description}</p> : null}
      </div>
      {aside ? <div className="nx-section-header__aside">{aside}</div> : null}
    </header>
  );
}
