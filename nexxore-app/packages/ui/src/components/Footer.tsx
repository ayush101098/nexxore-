import { FOOTER_LINKS, SOCIAL_LINKS } from '../nav-links';

/**
 * Shared footer. Copyright year is computed at render time (GLOBAL RULE 5 /
 * PRD hygiene) — never typed as a literal.
 */
export function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="nx-footer">
      <div className="nx-footer__links">
        {FOOTER_LINKS.map((link) => (
          <a key={link.href} href={link.href}>
            {link.label}
          </a>
        ))}
        {SOCIAL_LINKS.map((link) => (
          <a key={link.href} href={link.href} target="_blank" rel="noreferrer noopener">
            {link.label}
          </a>
        ))}
      </div>
      <div>© {year} NEXXORE</div>
    </footer>
  );
}
