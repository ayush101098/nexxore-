import type { Meta, StoryObj } from '@storybook/react';
import { ProductShell } from './ProductShell';

const loop = [
  { id: 'sense' as const, label: 'Sense', href: '/predictions' },
  { id: 'decide' as const, label: 'Decide', href: '/strategy' },
  { id: 'act' as const, label: 'Act', href: '/vaults' },
];

const meta: Meta<typeof ProductShell> = {
  title: 'Sections/ProductShell',
  component: ProductShell,
};
export default meta;

type Story = StoryObj<typeof ProductShell>;

export const SenseStage: Story = {
  args: {
    name: 'Predictions',
    valueProp: 'Prediction-market intelligence across Polymarket and Manifold.',
    status: 'LIVE',
    stage: 'sense',
    loop,
    stats: [
      {
        value: '750+',
        label: 'Prediction markets scanned / cycle',
        evidenceUrl: '/proof#coverage',
        verified: false,
      },
    ],
    children: <p style={{ color: 'var(--fg-secondary)' }}>Product body goes here.</p>,
  },
};

export const ActStagePending: Story = {
  args: {
    name: 'Vaults',
    valueProp: 'Automated, risk-aware vault strategies that rotate on regime.',
    status: 'PENDING',
    stage: 'act',
    loop,
    children: <p style={{ color: 'var(--fg-secondary)' }}>Coming soon.</p>,
  },
};
