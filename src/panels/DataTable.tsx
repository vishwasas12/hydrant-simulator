import { useMemo, useState, type ReactNode } from 'react';

export interface Column<T> {
  key: string;
  label: string;
  /** Value used for sorting, filtering and CSV. */
  value: (row: T) => string | number | null;
  /** Optional cell renderer. Defaults to the value. */
  render?: (row: T) => ReactNode;
  align?: 'left' | 'right';
}

export function toCsv<T>(columns: Column<T>[], rows: T[]): string {
  const escape = (v: string | number | null): string => {
    if (v === null) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = columns.map((c) => escape(c.label)).join(',');
  const body = rows.map((r) => columns.map((c) => escape(c.value(r))).join(','));
  return [head, ...body].join('\r\n');
}

export function downloadCsv(name: string, csv: string): void {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  csvName,
  onRowClick,
  selectedKey,
  toolbar,
  testId,
  maxRows,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  csvName: string;
  onRowClick?: (row: T) => void;
  selectedKey?: string | null;
  toolbar?: ReactNode;
  testId?: string;
  /** Rows rendered at once. All rows still sort, filter and export. */
  maxRows?: number;
}) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [ascending, setAscending] = useState(true);
  const [filter, setFilter] = useState('');

  const filtered = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) =>
      columns.some((c) => String(c.value(r) ?? '').toLowerCase().includes(needle)),
    );
  }, [rows, columns, filter]);

  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sortKey);
    if (!col) return filtered;
    const out = [...filtered];
    out.sort((a, b) => {
      const va = col.value(a);
      const vb = col.value(b);
      if (va === null) return 1;
      if (vb === null) return -1;
      const cmp =
        typeof va === 'number' && typeof vb === 'number'
          ? va - vb
          : String(va).localeCompare(String(vb), undefined, { numeric: true });
      return ascending ? cmp : -cmp;
    });
    return out;
  }, [filtered, columns, sortKey, ascending]);

  const visible = maxRows ? sorted.slice(0, maxRows) : sorted;

  return (
    <div className="table-wrap" data-testid={testId}>
      <div className="table-tools">
        <input
          className="filter-input"
          placeholder="Filter rows"
          aria-label="Filter rows"
          value={filter}
          data-testid={testId ? `${testId}-filter` : undefined}
          onChange={(e) => setFilter(e.target.value)}
        />
        <span className="muted" data-testid={testId ? `${testId}-count` : undefined}>
          {maxRows && sorted.length > maxRows ? `First ${maxRows} of ${sorted.length}` : `${sorted.length} of ${rows.length}`} rows
        </span>
        {toolbar}
        <span className="viewbar-fill" />
        <button type="button" className="btn" data-testid={testId ? `${testId}-csv` : undefined} onClick={() => downloadCsv(csvName, toCsv(columns, sorted))}>
          Export CSV
        </button>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={c.align === 'right' ? 'num' : ''}
                  aria-sort={sortKey === c.key ? (ascending ? 'ascending' : 'descending') : 'none'}
                >
                  <button
                    type="button"
                    onClick={() => {
                      if (sortKey === c.key) setAscending(!ascending);
                      else {
                        setSortKey(c.key);
                        setAscending(true);
                      }
                    }}
                  >
                    {c.label}
                    {sortKey === c.key ? (ascending ? ' ↑' : ' ↓') : ''}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => {
              const key = rowKey(r);
              return (
                <tr
                  key={key}
                  className={`${onRowClick ? 'clickable' : ''}${selectedKey === key ? ' selected' : ''}`}
                  onClick={onRowClick ? () => onRowClick(r) : undefined}
                >
                  {columns.map((c) => (
                    <td key={c.key} className={c.align === 'right' ? 'num' : ''}>
                      {c.render ? c.render(r) : c.value(r)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function StatusBadge({ status }: { status: 'pass' | 'fail' | 'off' | null }) {
  if (status === 'pass') return <span className="badge pass">✓ Pass</span>;
  if (status === 'fail') return <span className="badge fail">✕ Fail</span>;
  if (status === 'off') return <span className="badge off">Closed</span>;
  return <span className="muted">–</span>;
}
