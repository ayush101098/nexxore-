import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { StatCard } from './StatCard';

describe('StatCard conscience', () => {
  it('throws in development for a numeric value with no evidence link', () => {
    expect(() =>
      renderToStaticMarkup(<StatCard value={750} label="Markets scanned" />),
    ).toThrow(/requires an evidenceUrl/);
  });

  it('throws for numeric-looking string values too', () => {
    expect(() =>
      renderToStaticMarkup(<StatCard value="$1.27M" label="P&L" />),
    ).toThrow(/requires an evidenceUrl/);
  });

  it('renders a numeric value when an evidence link is provided', () => {
    const html = renderToStaticMarkup(
      <StatCard value={750} unit="markets" label="Scanned" evidenceUrl="/proof#coverage" verified />,
    );
    expect(html).toContain('750');
    expect(html).toContain('verify');
  });

  it('allows non-numeric values with no evidence link', () => {
    const html = renderToStaticMarkup(<StatCard value="Base" label="Anchoring chain" />);
    expect(html).toContain('Base');
  });
});
