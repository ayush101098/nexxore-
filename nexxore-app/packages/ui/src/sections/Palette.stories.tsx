import type { Meta, StoryObj } from '@storybook/react';

/** Design-token reference. Use the toolbar "Regime" switch to see accent tokens
 *  recolor across risk-on / transition / risk-off. */
function Swatch({ name, varName }: { name: string; varName: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
      <span
        style={{
          width: 40,
          height: 40,
          borderRadius: 8,
          background: `var(${varName})`,
          border: '1px solid var(--line-strong)',
        }}
      />
      <div>
        <div style={{ color: 'var(--fg)', fontSize: 13 }}>{name}</div>
        <code style={{ color: 'var(--fg-muted)', fontSize: 11 }}>{varName}</code>
      </div>
    </div>
  );
}

function Palette() {
  const groups: [string, [string, string][]][] = [
    [
      'Surfaces',
      [
        ['Background', '--bg'],
        ['Surface 1', '--surface-1'],
        ['Surface 2', '--surface-2'],
        ['Surface 3', '--surface-3'],
      ],
    ],
    [
      'Regime accent (switch via toolbar)',
      [
        ['Accent', '--accent'],
        ['Accent muted', '--accent-muted'],
        ['Accent glow', '--accent-glow'],
      ],
    ],
    [
      'Brand (interactive only)',
      [
        ['Brand', '--brand'],
        ['Brand hover', '--brand-hover'],
        ['Brand muted', '--brand-muted'],
      ],
    ],
  ];
  return (
    <div style={{ display: 'grid', gap: '2rem' }}>
      {groups.map(([title, rows]) => (
        <section key={title}>
          <h3 style={{ color: 'var(--fg)', marginBottom: '1rem' }}>{title}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(160px, 1fr))', gap: '1rem' }}>
            {rows.map(([n, v]) => (
              <Swatch key={v} name={n} varName={v} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

const meta: Meta<typeof Palette> = {
  title: 'Foundations/Palette',
  component: Palette,
};
export default meta;

export const Tokens: StoryObj<typeof Palette> = {};
