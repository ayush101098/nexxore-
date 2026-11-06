'use client';

import { useState } from 'react';
import { PRODUCT_LINKS } from '../nav-links';
import { RegimeChip } from './RegimeChip';

/** Top nav: logo home link, product switcher, and the regime status chip. */
export function Nav() {
  const [open, setOpen] = useState(false);
  return (
    <nav className="nx-nav">
      <a className="nx-nav__logo" href="/">
        NEXXORE
      </a>
      <div className="nx-nav__links" data-open={open}>
        {PRODUCT_LINKS.map((link) => (
          <a
            key={link.href}
            className="nx-nav__link"
            href={link.href}
            onClick={() => setOpen(false)}
          >
            {link.label}
          </a>
        ))}
      </div>
      <span className="nx-nav__spacer" />
      <RegimeChip />
      <button
        type="button"
        className="nx-nav__toggle"
        aria-expanded={open}
        aria-label="Toggle navigation"
        onClick={() => setOpen((v) => !v)}
      >
        ☰
      </button>
    </nav>
  );
}
