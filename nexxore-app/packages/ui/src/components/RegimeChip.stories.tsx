import type { Meta, StoryObj } from '@storybook/react';
import { RegimeChip } from './RegimeChip';

const meta: Meta<typeof RegimeChip> = {
  title: 'Core/RegimeChip',
  component: RegimeChip,
};
export default meta;

type Story = StoryObj<typeof RegimeChip>;

/** Follows the toolbar regime (via RegimeProvider). */
export const FromProvider: Story = {};

export const RiskOn: Story = { args: { regime: 'risk-on' } };
export const Transition: Story = { args: { regime: 'transition' } };
export const RiskOff: Story = { args: { regime: 'risk-off' } };
