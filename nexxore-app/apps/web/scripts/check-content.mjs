#!/usr/bin/env node
/**
 * Content-truth gate (Prompts A + 03). Scans authored React source (app /
 * components / content / lib — not the ported public/legacy blobs) for:
 *
 *   • the Prompt-03 spec regex `[$][0-9]|[0-9]+(\.[0-9]+)?%` — dollar figures
 *     and percentages hardcoded in markup (all numbers must come from
 *     /v1/stats via the SDK). Excluded: /legal pages, test files, and lines
 *     that are CSS layout values (width: '100%' is not a claim).
 *   • the specific stale performance figures the legacy site shipped
 *   • href="#" dead links
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = fileURLToPath(new URL('..', import.meta.url));
const scanDirs = ['app', 'components', 'content', 'lib'].map((d) => join(webRoot, d));

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(tsx?|mdx?)$/.test(e)) out.push(full);
  }
  return out;
}

// Prompt 03 spec regex, applied outside /legal and test fixtures.
const SPEC_NUMBER_RE = /[$][0-9]|[0-9]+(\.[0-9]+)?%/;
// CSS layout values are not claims — skip lines that are clearly styling.
const CSS_CONTEXT_RE =
  /(width|height|inset|top|left|right|bottom|margin|padding|translate|scale|opacity|flex|radius|size)\s*[:=]/i;

const LEGACY_CHECKS = [
  { re: /\b18\.81\b/, msg: 'legacy ROI figure "18.81"' },
  { re: /\b1\.27\s*M\b|\$1\.27/i, msg: 'legacy P&L figure "1.27M"' },
  { re: /href=["']#["']/, msg: 'dead link href="#"' },
];

const errors = [];
for (const dir of scanDirs) {
  for (const file of walk(dir)) {
    const rel = relative(webRoot, file);
    const isLegal = rel.split(sep).includes('legal');
    const isTest = /\.(test|spec)\.tsx?$/.test(rel);
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        for (const c of LEGACY_CHECKS) {
          if (c.re.test(line)) errors.push(`${rel}:${i + 1}  ${c.msg}`);
        }
        if (isLegal || isTest) return;
        if (SPEC_NUMBER_RE.test(line) && !CSS_CONTEXT_RE.test(line)) {
          errors.push(
            `${rel}:${i + 1}  hardcoded $-figure or percentage — numbers must come from /v1/stats`,
          );
        }
      });
  }
}

if (errors.length) {
  console.error('Content gate failed:\n' + errors.map((e) => '  - ' + e).join('\n'));
  process.exit(1);
}
console.log(
  'Content gate passed: no hardcoded $-figures/percentages, no stale perf figures, no dead links.',
);
