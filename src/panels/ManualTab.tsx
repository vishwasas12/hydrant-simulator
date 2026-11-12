import { useMemo } from 'react';
import { captureState } from '../model/edit';
import type { NodeResult } from '../solver';
import { baselineResultsFor, useResults, useStore } from '../state/store';
import { DataTable, StatusBadge, type Column } from './DataTable';
import { Toggle } from './fields';

export function ManualTab() {
  const project = useStore((s) => s.project);
  const update = useStore((s) => s.update);
  const select = useStore((s) => s.select);
  const selection = useStore((s) => s.selection);
  const showDelta = useStore((s) => s.view.showDelta);
  const setView = useStore((s) => s.setView);
  const results = useResults();
  const baseline = baselineResultsFor(project);

  const rows = useMemo(() => results.nodes.filter((n) => n.kind !== 'junction'), [results]);
  const baselineById = useMemo(
    () => new Map((baseline?.nodes ?? []).map((n) => [n.id, n])),
    [baseline],
  );

  const setOn = (id: string, on: boolean) =>
    update((d) => {
      const n = d.nodes.find((x) => x.id === id);
      if (n?.outlet) n.outlet.on = on;
    });

  const delta = (r: NodeResult): number | null => {
    const b = baselineById.get(r.id);
    if (!b || b.pressureBar === null || r.pressureBar === null) return null;
    return r.pressureBar - b.pressureBar;
  };

  const columns: Column<NodeResult>[] = [
    {
      key: 'on',
      label: 'On',
      value: (r) => (project.nodes.find((n) => n.id === r.id)?.outlet?.on ? 1 : 0),
      render: (r) => {
        const on = !!project.nodes.find((n) => n.id === r.id)?.outlet?.on;
        return (
          <span onClick={(e) => e.stopPropagation()}>
            <Toggle checked={on} label={`${r.label} on or off`} testId={`toggle-${r.label}`} onChange={(v) => setOn(r.id, v)} />
          </span>
        );
      },
    },
    { key: 'label', label: 'ID', value: (r) => r.label },
    {
      key: 'p',
      label: 'Pressure, bar',
      value: (r) => (r.pressureBar === null ? null : +r.pressureBar.toFixed(3)),
      render: (r) => (r.pressureBar === null ? '–' : r.pressureBar.toFixed(2)),
      align: 'right',
    },
    {
      key: 'd',
      label: 'Δ vs baseline, bar',
      value: (r) => {
        const d = delta(r);
        return d === null ? null : +d.toFixed(3);
      },
      render: (r) => {
        const d = delta(r);
        if (d === null) return '–';
        if (Math.abs(d) < 0.005) return '0.00';
        return <span className={d > 0 ? 'delta-up' : 'delta-down'}>{d > 0 ? '+' : '−'}{Math.abs(d).toFixed(2)}</span>;
      },
      align: 'right',
    },
    { key: 'q', label: 'Flow, LPM', value: (r) => +r.outletFlowLpm.toFixed(1), render: (r) => r.outletFlowLpm.toFixed(1), align: 'right' },
    { key: 'status', label: 'Check', value: (r) => r.status, render: (r) => <StatusBadge status={r.status} /> },
  ];

  const setAll = (on: boolean) =>
    update((d) => {
      for (const n of d.nodes) if (n.kind === 'hydrant' && n.outlet) n.outlet.on = on;
    });

  return (
    <DataTable
      testId="manual-table"
      rows={rows}
      columns={columns}
      rowKey={(r) => r.id}
      csvName="hydrant-states.csv"
      selectedKey={selection?.type === 'node' ? selection.id : null}
      onRowClick={(r) => select({ type: 'node', id: r.id })}
      toolbar={
        <>
          <button type="button" className="btn" onClick={() => setAll(true)} data-testid="all-on">All hydrants on</button>
          <button type="button" className="btn" onClick={() => setAll(false)} data-testid="all-off">All off</button>
          <span className="viewbar-sep" />
          <button
            type="button"
            className="btn"
            data-testid="pin-baseline"
            onClick={() => {
              update((d) => {
                d.baseline = { id: 'baseline', name: 'Baseline', ...captureState(d as typeof project) };
              });
              setView({ showDelta: true });
            }}
          >
            {project.baseline ? 'Re-pin baseline' : 'Pin baseline'}
          </button>
          {project.baseline && (
            <>
              <button
                type="button"
                className="btn"
                data-testid="clear-baseline"
                onClick={() => {
                  update((d) => void (d.baseline = null));
                  setView({ showDelta: false });
                }}
              >
                Clear
              </button>
              <label className="check">
                <input
                  type="checkbox"
                  checked={showDelta}
                  data-testid="show-delta"
                  onChange={(e) => setView({ showDelta: e.target.checked })}
                />
                Show Δ on drawing
              </label>
            </>
          )}
        </>
      }
    />
  );
}
