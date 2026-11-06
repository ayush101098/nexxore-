#!/usr/bin/env node
/**
 * Design-token gate (Prompt 02 acceptance): no raw hex color literals in
 * apps/web component/source code — colors must come from the shared token
 * classes in packages/config's Tailwind preset + packages/ui.
 *
 * Scans app/ and components/ (.ts/.tsx). The ported legacy pages under
 * public/ are static assets and intentionally excluded.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = fileURLToPath(new URL('..', import.meta.url));
const scanDirs = ['app', 'components', 'lib'].map((d) => join(webRoot, d));

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(tsx?|jsx?)$/.test(entry)) out.push(full);
  }
  return out;
}

// #rgb, #rrggbb, #rrggbbaa hex color literals.
const hexRe = /#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3}(?:[0-9a-fA-F]{2})?)?\b/g;
const errors = [];

for (const dir of scanDirs) {
  for (const file of walk(dir)) {
    const text = readFileSync(file, 'utf8');
    text.split('\n').forEach((line, i) => {
      const matches = line.match(hexRe);
      if (matches) {
        errors.push(`${relative(webRoot, file)}:${i + 1}  ${matches.join(', ')}`);
      }
    });
  }
}

if (errors.length > 0) {
  console.error(
    'Token gate failed — raw hex color literals found (use token classes):\n' +
      errors.map((e) => '  - ' + e).join('\n'),
  );
  process.exit(1);
}
console.log('Token gate passed: no raw hex color literals in apps/web source.');
