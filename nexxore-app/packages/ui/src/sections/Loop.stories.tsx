import type { Meta, StoryObj } from '@storybook/react';
import { LoopSection } from './home';

/** The Loop with its live pulse. Toggle OS reduced-motion (or the Storybook
 *  a11y setting) to see the no-motion fallback: stages highlight in sequence,
 *  the pulse is hidden, nothing changes position. */
const meta: Meta<typeof LoopSection> = {
  title: 'Sections/Loop',
  component: LoopSection,
};
export default meta;

export const Default: StoryObj<typeof LoopSection> = {
  args: {
    kicker: 'The loop',
    title: 'Sense. Decide. Act. Continuously.',
    stages: [
      {
        id: 'sense',
        name: 'Sense',
        route: '/predictions',
        metric: '52 data streams · 750+ prediction markets',
        points: ['Data streams', 'Escalation Index', 'Prediction markets'],
      },
      {
        id: 'decide',
        name: 'Decide',
        route: '/strategy',
        points: ['Regime engine', 'CVaR risk limits', 'Backtesting'],
      },
      {
        id: 'act',
        name: 'Act',
        route: '/vaults',
        metric: '6 chains',
        points: ['Multi-chain execution', 'Circuit breakers', 'Timelocks'],
      },
    ],
  },
};
