import type { ReactNode } from 'react';
import { Nav } from './Nav';
import { Footer } from './Footer';

/** Unified shell: sticky nav + product switcher, main slot, shared footer. */
export function SiteShell({ children }: { children: ReactNode }) {
  return (
    <div className="nx-shell">
      <Nav />
      <main className="nx-main">{children}</main>
      <Footer />
    </div>
  );
}
