#!/usr/bin/env node
/**
 * HTML validity gate (Prompt A). Validates the prerendered HTML for every real
 * content route against .htmlvalidate.json (one h1 / heading hierarchy, no
 * duplicate ids, labelled inputs, single <main>, etc.).
 *
 * Requires `next build` first (reads .next/server/app). The framework-owned
 * `_not-found` scaffold is excluded — it is not an authored content route.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const webRoot = fileURLToPath(new URL('..', import.meta.url));
const appDir = join(webRoot, '.next', 'server', 'app');

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (e.endsWith('.html')) out.push(full);
  }
  return out;
}

const files = walk(appDir).filter((f) => !f.endsWith('_not-found.html'));
if (files.length === 0) {
  console.error('No prerendered HTML found — run `next build` first.');
  process.exit(1);
}

console.log(`Validating ${files.length} route(s)…`);
try {
  execFileSync(
    join(webRoot, 'node_modules', '.bin', 'html-validate'),
    files.map((f) => relative(webRoot, f)),
    { cwd: webRoot, stdio: 'inherit' },
  );
} catch {
  process.exit(1);
}

// Exactly one <h1> per route, and unique <title>/description across routes.
const errors = [];
const titles = new Map();
const descriptions = new Map();
for (const file of files) {
  const html = readFileSync(file, 'utf8');
  const rel = relative(appDir, file);
  const h1s = html.match(/<h1[\s>]/g)?.length ?? 0;
  if (h1s !== 1) errors.push(`${rel}: expected exactly one <h1>, found ${h1s}`);

  const title = html.match(/<title[^>]*>([^<]*)<\/title>/)?.[1]?.trim() ?? '';
  if (!title) errors.push(`${rel}: missing <title>`);
  else if (titles.has(title)) errors.push(`${rel}: duplicate <title> "${title}" (also ${titles.get(title)})`);
  else titles.set(title, rel);

  const desc = html.match(/<meta name="description" content="([^"]*)"/)?.[1]?.trim() ?? '';
  if (!desc) errors.push(`${rel}: missing meta description`);
  else if (descriptions.has(desc)) errors.push(`${rel}: duplicate description (also ${descriptions.get(desc)})`);
  else descriptions.set(desc, rel);
}

if (errors.length) {
  console.error('HTML structure gate failed:\n' + errors.map((e) => '  - ' + e).join('\n'));
  process.exit(1);
}
console.log('HTML validation passed: valid markup, one h1/route, unique titles + descriptions.');
