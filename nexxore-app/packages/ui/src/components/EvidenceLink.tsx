import type { AnchorHTMLAttributes } from 'react';

export interface EvidenceLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
  /** Link text. Defaults to "verify". A "↗" affordance is always appended. */
  label?: string;
}

/**
 * The canonical "link to evidence" affordance (GLOBAL RULE 4). Every external
 * claim routes through this so the styling + the "↗" cue are consistent.
 */
export function EvidenceLink({ href, label = 'verify', className, ...rest }: EvidenceLinkProps) {
  const external = /^https?:\/\//.test(href);
  return (
    <a
      href={href}
      className={['nx-evidence', className].filter(Boolean).join(' ')}
      {...(external ? { target: '_blank', rel: 'noreferrer noopener' } : {})}
      {...rest}
    >
      {label} <span aria-hidden="true">↗</span>
    </a>
  );
}
