'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Renders a ported legacy HTML page inside a same-origin iframe and keeps its
 * height synced to the content. Prompt 01 wraps legacy markup as-is; each page
 * gets a proper React rewrite in later sprints, at which point this is removed.
 *
 * The shell (nav, ProductShell header, footer) already provides all chrome, so
 * on load we inject CSS that removes the legacy page's own duplicated nav/CTA
 * elements (passed per page via `hide`) and neutralizes any anchor that would
 * navigate the iframe to a dead legacy .html page.
 */
export function LegacyFrame({
  src,
  title,
  hide = [],
}: {
  src: string;
  title: string;
  /** CSS selectors of legacy chrome (nav bars, CTA buttons) to remove. */
  hide?: string[];
}) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(800);

  useEffect(() => {
    const iframe = ref.current;
    if (!iframe) return;

    const clean = () => {
      try {
        const doc = iframe.contentDocument;
        if (!doc?.head || doc.getElementById('nx-embed-clean')) return;
        const style = doc.createElement('style');
        style.id = 'nx-embed-clean';
        style.textContent = [
          // Page-specific duplicated chrome/CTAs.
          ...hide.map((sel) => `${sel} { display: none !important; }`),
          // Neutralize any leftover cross-page legacy links — the shell owns
          // navigation now. Visuals stay; clicks do nothing.
          'a[href$=".html"], a[href="index"], a[href="perps"], a[href="/"] {',
          '  pointer-events: none !important; cursor: default !important;',
          '}',
        ].join('\n');
        doc.head.appendChild(style);
      } catch {
        /* cross-origin guard — legacy pages are same-origin, so no-op */
      }
    };

    const sync = () => {
      clean();
      try {
        const doc = iframe.contentDocument;
        if (doc?.body) {
          const next = Math.max(doc.body.scrollHeight, doc.documentElement.scrollHeight);
          if (next > 0) setHeight(next);
        }
      } catch {
        /* cross-origin guard */
      }
    };

    iframe.addEventListener('load', sync);
    const interval = window.setInterval(sync, 750);
    return () => {
      iframe.removeEventListener('load', sync);
      window.clearInterval(interval);
    };
  }, [src, hide]);

  return (
    <iframe
      ref={ref}
      src={src}
      title={title}
      style={{ width: '100%', height, border: 'none', display: 'block' }}
      // Legacy pages run their own scripts (wallet, charts). Same-origin, so no sandbox.
    />
  );
}
