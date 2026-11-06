import type { Preview, Decorator } from '@storybook/react';
import { RegimeProvider } from '../src/regime-context';
import type { Regime } from '../src/regime';
import '../src/styles/globals.css';

/**
 * Global "Regime" toolbar switch — drives RegimeProvider so every component can
 * be browsed in all three regime colors (like paint swatches). Both the accent
 * CSS variables and any `useRegime()` reads track the toolbar together.
 */
const withRegime: Decorator = (Story, context) => {
  const regime = (context.globals.regime ?? 'transition') as Regime;
  return (
    <RegimeProvider key={regime} initialRegime={regime} fetchRegime={async () => regime}>
      <div style={{ padding: '2rem', background: '#0A0B0E', minHeight: '100vh' }}>
        <Story />
      </div>
    </RegimeProvider>
  );
};

const preview: Preview = {
  parameters: {
    backgrounds: { disable: true },
    controls: { expanded: true },
  },
  globalTypes: {
    regime: {
      description: 'Market regime accent',
      defaultValue: 'transition',
      toolbar: {
        title: 'Regime',
        icon: 'circlehollow',
        items: [
          { value: 'risk-on', title: 'Risk-On (green)' },
          { value: 'transition', title: 'Transition (amber)' },
          { value: 'risk-off', title: 'Risk-Off (red)' },
        ],
        dynamicTitle: true,
      },
    },
  },
  decorators: [withRegime],
};

export default preview;
