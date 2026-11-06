import type { ReactNode } from 'react';

export interface DataTableColumn<Row> {
  key: string;
  header: string;
  /** Cell renderer. Defaults to `String(row[key])`. */
  render?: (row: Row) => ReactNode;
  align?: 'left' | 'right' | 'center';
  /** Render numerics in the mono font (default true for right-aligned). */
  numeric?: boolean;
}

export interface DataTableProps<Row> {
  columns: DataTableColumn<Row>[];
  rows: Row[];
  getRowKey: (row: Row, index: number) => string;
  caption?: string;
  empty?: ReactNode;
}

/** Terminal-style table. Numeric columns render in the mono font. */
export function DataTable<Row extends Record<string, unknown>>({
  columns,
  rows,
  getRowKey,
  caption,
  empty = 'No data',
}: DataTableProps<Row>) {
  return (
    <div className="nx-table__wrap">
      <table className="nx-table">
        {caption ? <caption className="nx-table__caption">{caption}</caption> : null}
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key} data-align={col.align ?? 'left'} scope="col">
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td className="nx-table__empty" colSpan={columns.length}>
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row, i) => (
              <tr key={getRowKey(row, i)}>
                {columns.map((col) => {
                  const align = col.align ?? 'left';
                  const numeric = col.numeric ?? align === 'right';
                  return (
                    <td key={col.key} data-align={align} data-numeric={numeric}>
                      {col.render ? col.render(row) : String(row[col.key] ?? '')}
                    </td>
                  );
                })}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
