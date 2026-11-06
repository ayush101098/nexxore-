import type { Meta, StoryObj } from '@storybook/react';
import { DataTable, type DataTableColumn } from './DataTable';

interface Row extends Record<string, unknown> {
  component: string;
  value: number;
  weight: string;
}

const columns: DataTableColumn<Row>[] = [
  { key: 'component', header: 'Component' },
  { key: 'value', header: 'Value', align: 'right', render: (r) => r.value.toFixed(3) },
  { key: 'weight', header: 'Weight', align: 'right' },
];

const rows: Row[] = [
  { component: 'Conflict', value: 0.72, weight: '35%' },
  { component: 'Sanctions', value: 0.41, weight: '25%' },
  { component: 'Energy', value: 0.55, weight: '20%' },
  { component: 'Macro', value: 0.38, weight: '20%' },
];

const meta: Meta<typeof DataTable<Row>> = {
  title: 'Core/DataTable',
  component: DataTable,
};
export default meta;

type Story = StoryObj<typeof DataTable<Row>>;

export const Basic: Story = {
  args: {
    columns,
    rows,
    caption: 'Index component breakdown',
    getRowKey: (r: Row) => r.component,
  },
};

export const Empty: Story = {
  args: {
    columns,
    rows: [],
    caption: 'Index component breakdown',
    getRowKey: (r: Row) => r.component,
  },
};
