import { useMemo } from 'react';
import { requirementCheck, type RequirementRow } from '../analysis/requirement';
import { useStore } from '../state/store';
import { DataTable, StatusBadge, type Column } from './DataTable';

const num = (v: number | null, d: number): number | null => (v === null ? null : +v.toFixed(d));
const text = (v: number | null, d: number): string => (v === null ? '–' : v.toFixed(d));

export const requirementColumns: Column<RequirementRow>[] = [
  { key: 'label', label: 'ID', value: (r) => r.label },
  { key: 'res', label: 'Residual alone, bar', value: (r) => num(r.residualBar, 3), render: (r) => text(r.residualBar, 2), align: 'right' },
  { key: 'q', label: 'Flow alone, LPM', value: (r) => +r.flowLpm.toFixed(1), render: (r) => r.flowLpm.toFixed(1), align: 'right' },
  { key: 'minp', label: 'Min, bar', value: (r) => r.minPressureBar, align: 'right' },
  { key: 'minq', label: 'Min, LPM', value: (r) => r.minFlowLpm, align: 'right' },
  { key: 'reqp', label: 'Needed at hydrant, bar', value: (r) => +r.requiredPressureBar.toFixed(3), render: (r) => r.requiredPressureBar.toFixed(2), align: 'right' },
  { key: 'reqq', label: 'Flow then, LPM', value: (r) => +r.requiredFlowLpm.toFixed(1), render: (r) => r.requiredFlowLpm.toFixed(0), align: 'right' },
  { key: 'fr', label: 'Friction, m', value: (r) => num(r.frictionM, 2), render: (r) => text(r.frictionM, 2), align: 'right' },
  { key: 'need', label: 'Pump head needed, m', value: (r) => num(r.pumpHeadNeededM, 2), render: (r) => text(r.pumpHeadNeededM, 1), align: 'right' },
  { key: 'avail', label: 'Available, m', value: (r) => num(r.pumpHeadAvailableM, 2), render: (r) => (r.beyondCurve ? `${text(r.pumpHeadAvailableM, 1)} ▲` : text(r.pumpHeadAvailableM, 1)), align: 'right' },
  { key: 'margin', label: 'Margin, m', value: (r) => num(r.marginM, 2), render: (r) => text(r.marginM, 1), align: 'right' },
  { key: 'pass', label: 'Alone', value: (r) => (r.pass ? 'pass' : 'fail'), render: (r) => <StatusBadge status={r.pass ? 'pass' : 'fail'} /> },
];

export function RequirementTab() {
  const nodes = useStore((s) => s.project.nodes);
  const pipes = useStore((s) => s.project.pipes);
  const pumps = useStore((s) => s.project.pumps);
  const settings = useStore((s) => s.project.settings);
  const tables = useStore((s) => s.project.tables);
  const select = useStore((s) => s.select);

  const { rows, error } = useMemo(() => {
    try {
      return { rows: requirementCheck({ nodes, pipes, pumps, settings, tables }), error: null };
    } catch (e) {
      return { rows: [] as RequirementRow[], error: e instanceof Error ? e.message : 'Check failed.' };
    }
  }, [nodes, pipes, pumps, settings, tables]);

  if (error) return <p className="empty">{error}</p>;
  if (rows.length === 0) return <p className="empty">Add a pump and at least one hydrant to run the requirement check.</p>;
  return (
    <DataTable
      testId="requirement-table"
      rows={rows}
      columns={requirementColumns}
      rowKey={(r) => r.id}
      csvName="requirement-check.csv"
      onRowClick={(r) => select({ type: 'node', id: r.id })}
      toolbar={<span className="summary">Each hydrant alone, all others off. ▲ means beyond the last pump curve point.</span>}
    />
  );
}
