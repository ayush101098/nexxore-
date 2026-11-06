import type { Meta, StoryObj } from '@storybook/react';
import { GaugeDial } from './GaugeDial';

const meta: Meta<typeof GaugeDial> = {
  title: 'Core/GaugeDial',
  component: GaugeDial,
  argTypes: {
    value: { control: { type: 'range', min: 0, max: 1, step: 0.01 } },
    threshold: { control: { type: 'range', min: 0, max: 1, step: 0.01 } },
  },
};
export default meta;

type Story = StoryObj<typeof GaugeDial>;

export const Default: Story = {
  args: { value: 0.58, threshold: 0.7, label: 'Escalation Index' },
};

export const NearThreshold: Story = {
  args: { value: 0.72, threshold: 0.7, label: 'Escalation Index' },
};

export const Calm: Story = {
  args: { value: 0.22, threshold: 0.7, label: 'Escalation Index' },
};
