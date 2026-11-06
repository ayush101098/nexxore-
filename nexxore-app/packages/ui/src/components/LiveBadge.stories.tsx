import type { Meta, StoryObj } from '@storybook/react';
import { LiveBadge, LIVE_BADGE_STATUSES } from './LiveBadge';

const meta: Meta<typeof LiveBadge> = {
  title: 'Core/LiveBadge',
  component: LiveBadge,
  argTypes: {
    status: { control: 'select', options: LIVE_BADGE_STATUSES },
  },
};
export default meta;

type Story = StoryObj<typeof LiveBadge>;

export const Live: Story = { args: { status: 'LIVE' } };
export const Simulated: Story = { args: { status: 'SIMULATED' } };
export const InAudit: Story = { args: { status: 'IN AUDIT' } };
export const Pending: Story = { args: { status: 'PENDING' } };

export const AllStatuses: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
      {LIVE_BADGE_STATUSES.map((s) => (
        <LiveBadge key={s} status={s} />
      ))}
    </div>
  ),
};
