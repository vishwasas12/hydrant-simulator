import { useMemo } from 'react';
import type { NodeResult, PipeResult } from '../solver';
import { useResults, useStore } from '../state/store';
import { DataTable, StatusBadge, type Column } from './DataTable';

const fix = (v: number | null, d: number): string => (v === null ? '–' : v.toFixed(d));
const round = (v: number | null, d: number): number | null => (v === null ? null : +v.toFixed(d));

export const KIND_LABEL = { junction: 'Junction', hydrant: 'Hydrant', hoseReel: 'Hose reel' } as const;

export const nodeColumns: Column<NodeResult>[] = [
  { key: 'label', label: 'Node', value: (r) => r.label },
  { key: 'kind', label: 'Type', value: (r) => KIND_LABEL[r.kind] },
  { key: 'elev', label: 'Elevation, m', value: (r) => r.elevationM, align: 'right' },
  { key: 'head', label: 'Total head, m', value: (r) => round(r.headM, 2), render: (r) => fix(r.headM, 2), align: 'right' },
  { key: 'pm', label: 'Pressure, m', value: (r) => round(r.pressureM, 2), render: (r) => fix(r.pressureM, 2), align: 'right' },
  { key: 'pb', label: 'Pressure, bar', value: (r) => round(r.pressureBar, 3), render: (r) => fix(r.pressureBar, 2), align: 'right' },
  { key: 'out', label: 'Outflow, LPM', value: (r) => +r.outflowLpm.toFixed(1), render: (r) => r.outflowLpm.toFixed(1), align: 'right' },
  { key: 'status', label: 'Result', value: (r) => r.status, render: (r) => <StatusBadge status={r.status} /> },
];

export const pipeColumns: Column<PipeResult>[] = [
  { key: 'label', label: 'Pipe', value: (r) => r.label },
  {
    key: 'state',
    label: 'State',
    value: (r) =>
      r.heldByCheckValve ? 'Held shut (non-return)' : r.connected ? 'Open' : r.status === 'open' ? 'Isolated' : 'Closed',
  },
  { key: 'd', label: 'Int. dia., mm', value: (r) => r.diameterMm, align: 'right' },
  { key: 'q', label: 'Flow, LPM', value: (r) => +Math.abs(r.flowLpm).toFixed(1), render: (r) => Math.abs(r.flowLpm).toFixed(1), align: 'right' },
  { key: 'dir', label: 'Flow direction', value: (r) => (Math.abs(r.flowLpm) < 0.05 ? '' : `${r.upstreamId}→${r.downstreamId}`) },
  {
    key: 'v',
    label: 'Velocity, m/s',
    value: (r) => +r.velocityMs.toFixed(2),
    render: (r) => (
      <span className={r.velocityExceeded ? 'bad' : ''}>
        {r.velocityMs.toFixed(2)}
        {r.velocityExceeded ? ' ▲' : ''}
      </span>
    ),
    align: 'right',
  },
  { key: 'hf', label: 'Head loss, m', value: (r) => +r.headLossM.toFixed(3), render: (r) => r.headLossM.toFixed(3), align: 'right' },
  { key: 'l100', label: 'Loss per 100 m', value: (r) => +r.lossPer100M.toFixed(2), render: (r) => r.lossPer100M.toFixed(2), align: 'right' },
  { key: 'l', label: 'Length, m', value: (r) => +r.lengthM.toFixed(1), render: (r) => r.lengthM.toFixed(1), align: 'right' },
  { key: 'leq', label: 'Equiv. length, m', value: (r) => +r.equivalentLengthM.toFixed(1), render: (r) => r.equivalentLengthM.toFixed(1), align: 'right' },
];

/** Pipe columns with node labels, rather than ids, in the direction column. */
export function pipeColumnsFor(nodes: { id: string; label: string }[]): Column<PipeResult>[] {
  const labels = new Map(nodes.map((n) => [n.id, n.label]));
  return pipeColumns.map((c) =>
    c.key === 'dir'
      ? {
          ...c,
          value: (r: PipeResult) =>
            Math.abs(r.flowLpm) < 0.05 ? '' : `${labels.get(r.upstreamId)} → ${labels.get(r.downstreamId)}`,
        }
      : c,
  );
}

export const hydrantColumns: Column<NodeResult>[] = [
  { key: 'label', label: 'Outlet', value: (r) => r.label },
  { key: 'kind', label: 'Type', value: (r) => KIND_LABEL[r.kind] },
  { key: 'pb', label: 'Residual pressure, bar', value: (r) => round(r.pressureBar, 3), render: (r) => fix(r.pressureBar, 2), align: 'right' },
  { key: 'req', label: 'Required, bar', value: (r) => r.requiredPressureBar, align: 'right' },
  { key: 'q', label: 'Flow, LPM', value: (r) => +r.outletFlowLpm.toFixed(1), render: (r) => r.outletFlowLpm.toFixed(1), align: 'right' },
  { key: 'reqq', label: 'Required, LPM', value: (r) => r.requiredFlowLpm, align: 'right' },
  {
    key: 'm',
    label: 'Margin',
    value: (r) => (r.margin === null ? null : +(r.margin * 100).toFixed(1)),
    render: (r) => (r.margin === null ? '–' : `${(r.margin * 100).toFixed(1)} %`),
    align: 'right',
  },
  { key: 'status', label: 'Result', value: (r) => r.status, render: (r) => <StatusBadge status={r.status} /> },
];

export function NodesTab() {
  const results = useResults();
  const selection = useStore((s) => s.selection);
  const select = useStore((s) => s.select);
  return (
    <DataTable
      testId="nodes-table"
      rows={results.nodes}
      columns={nodeColumns}
      rowKey={(r) => r.id}
      csvName="nodes.csv"
      selectedKey={selection?.type === 'node' ? selection.id : null}
      onRowClick={(r) => select({ type: 'node', id: r.id })}
    />
  );
}

export function PipesTab() {
  const results = useResults();
  const selection = useStore((s) => s.selection);
  const select = useStore((s) => s.select);
  const nodes = useStore((s) => s.project.nodes);
  const columns = useMemo(() => pipeColumnsFor(nodes), [nodes]);
  return (
    <DataTable
      testId="pipes-table"
      rows={results.pipes}
      columns={columns}
      rowKey={(r) => r.id}
      csvName="pipes.csv"
      selectedKey={selection?.type === 'pipe' ? selection.id : null}
      onRowClick={(r) => select({ type: 'pipe', id: r.id })}
    />
  );
}

export function HydrantsTab() {
  const results = useResults();
  const selection = useStore((s) => s.selection);
  const select = useStore((s) => s.select);
  const rows = useMemo(() => results.nodes.filter((n) => n.kind !== 'junction'), [results]);
  return (
    <DataTable
      testId="hydrants-table"
      rows={rows}
      columns={hydrantColumns}
      rowKey={(r) => r.id}
      csvName="hydrants.csv"
      selectedKey={selection?.type === 'node' ? selection.id : null}
      onRowClick={(r) => select({ type: 'node', id: r.id })}
    />
  );
}
