import { describe, expect, it } from 'vitest';
import { buildMeta } from '@nexxore/ui';
import { ALL_ROUTES } from './site';

describe('buildMeta', () => {
  it('applies the "{Page} — NEXXORE" title pattern', () => {
    const meta = buildMeta({ title: 'Terminal', path: '/terminal' });
    expect(meta.title).toBe('Terminal — NEXXORE');
  });

  it('honors a full title override (home page)', () => {
    const meta = buildMeta({
      title: 'ignored',
      titleOverride: 'NEXXORE — Regime-Aware Capital Allocation',
      path: '/',
    });
    expect(meta.title).toBe('NEXXORE — Regime-Aware Capital Allocation');
  });

  it('produces an absolute canonical URL and marks noindex pages', () => {
    const meta = buildMeta({ title: 'Status', path: '/status', noindex: true });
    expect(String(meta.alternates?.canonical)).toMatch(/^https?:\/\/.*\/status$/);
    expect(meta.robots).toEqual({ index: false, follow: false });
  });
});

describe('route table', () => {
  it('lists the five product routes and home', () => {
    for (const path of ['/', '/terminal', '/predictions', '/strategy', '/stablecoin-hub', '/vaults']) {
      expect(ALL_ROUTES).toContain(path);
    }
  });
});
