import type { Meta, StoryObj } from '@storybook/react';
import { EvidenceLink } from './EvidenceLink';

const meta: Meta<typeof EvidenceLink> = {
  title: 'Core/EvidenceLink',
  component: EvidenceLink,
  args: { href: '/proof#coverage' },
};
export default meta;

type Story = StoryObj<typeof EvidenceLink>;

export const Verify: Story = { args: { label: 'verify' } };
export const Reported: Story = { args: { label: 'reported', className: 'nx-evidence--reported' } };
export const External: Story = { args: { href: 'https://basescan.org', label: 'on-chain' } };
