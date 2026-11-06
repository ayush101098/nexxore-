#!/usr/bin/env node
/**
 * Offline internal-link checker (GLOBAL RULE 6 / Prompt 01 CI gate).
 *
 *   1. Fails on any `href="#"` in apps/web or the shared shell (dead link).
 *   2. Fails on any internal href ("/...") that does not resolve to a real
 *      App Router route.
 *
 * Valid routes are derived from the filesystem so the check never drifts from
 * the actual pages. A hosted `lychee` crawl of the deployed site is the
 * complementary online check documented in ci.yml.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = fileURLToPath(new URL('..', import.meta.url));
const appDir = join(webRoot, 'app');

/** Walk a dir, yielding absolute file paths matching the extension list. */
function walk(dir, exts) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full, exts));
    } else if (exts.some((e) => entry.endsWith(e))) {
      out.push(full);
    }
  }
  return out;
}

/** Convert an app-router directory path to a route, stripping route groups. */
function dirToRoute(fileAbs) {
  const rel = relative(appDir, fileAbs).replace(/\/page\.tsx$/, '');
  const segments = rel
    .split('/')
    .filter((s) => s && !(s.startsWith('(') && s.endsWith(')')));
  return '/' + segments.join('/');
}

// 1. Build the set of real routes from page.tsx files.
const routes = new Set(['/', '/sitemap.xml', '/robots.txt']);
for (const page of walk(appDir, ['.tsx'])) {
  if (page.endsWith('/page.tsx')) routes.add(dirToRoute(page) || '/');
}

// 2. Scan source for hrefs.
const sources = [
  ...walk(join(webRoot, 'app'), ['.tsx', '.ts']),
  ...walk(join(webRoot, 'components'), ['.tsx', '.ts']),
  ...walk(join(webRoot, '..', '..', 'packages', 'ui', 'src'), ['.tsx', '.ts']),
];

const hrefRe = /href[=:]\s*['"]([^'"]+)['"]/g;
const errors = [];

for (const file of sources) {
  const text = readFileSync(file, 'utf8');
  let m;
  while ((m = hrefRe.exec(text)) !== null) {
    const href = m[1];
    if (href === '#') {
      errors.push(`${relative(webRoot, file)}: forbidden href="#"`);
      continue;
    }
    if (
      href.startsWith('http://') ||
      href.startsWith('https://') ||
      href.startsWith('mailto:') ||
      href.startsWith('#') ||
      href.startsWith('/legacy/') // ported static pages served from public/
    ) {
      continue;
    }
    if (href.startsWith('/')) {
      const normalized = href.split(/[?#]/)[0].replace(/\/$/, '') || '/';
      if (!routes.has(normalized)) {
        errors.push(`${relative(webRoot, file)}: dead internal link "${href}"`);
      }
    }
  }
}

if (errors.length > 0) {
  console.error('Link check failed:\n' + errors.map((e) => '  - ' + e).join('\n'));
  process.exit(1);
}
console.log(`Link check passed: ${routes.size} routes, no dead internal links.`);
