import type { Meta, StoryObj } from '@storybook/react';
import { StatCard } from './StatCard';

const meta: Meta<typeof StatCard> = {
  title: 'Core/StatCard',
  component: StatCard,
};
export default meta;

type Story = StoryObj<typeof StatCard>;

export const Verified: Story = {
  args: {
    value: 750,
    unit: 'markets',
    label: 'Prediction markets scanned / cycle',
    evidenceUrl: '/proof#coverage',
    verified: true,
  },
};

export const Reported: Story = {
  args: {
    value: 12,
    unit: 'chains',
    label: 'Chains covered',
    evidenceUrl: '/proof#coverage',
    verified: false,
  },
};

export const NonNumeric: Story = {
  args: { value: 'Base', label: 'Anchoring chain' },
};

/**
 * Demonstrates the conscience: a numeric value with no evidenceUrl throws in
 * development. Storybook shows the thrown error in the preview pane.
 */
export const ThrowsWithoutEvidence: Story = {
  args: { value: 1_270_000, label: 'Unsourced P&L (should crash)' },
};
