import type { Meta, StoryObj } from '@storybook/react';
import { SectionHeader } from './SectionHeader';
import { LiveBadge } from './LiveBadge';

const meta: Meta<typeof SectionHeader> = {
  title: 'Core/SectionHeader',
  component: SectionHeader,
};
export default meta;

type Story = StoryObj<typeof SectionHeader>;

export const Basic: Story = {
  args: {
    kicker: 'Escalation Index',
    title: 'How vaults respond to regime',
    description: 'A weighted composite of conflict, sanctions, energy, and macro signals.',
  },
};

export const WithAside: Story = {
  args: {
    kicker: 'Vaults',
    title: 'Delta-neutral strategies',
    description: 'Automated, risk-aware onchain vault strategies.',
    aside: <LiveBadge status="PENDING" />,
  },
};
