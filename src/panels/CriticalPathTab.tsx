import { useMemo } from 'react';
import { criticalPath, type CriticalPathSegment } from '../solver';
import { useResults, useStore } from '../state/store';
import { DataTable, type Column } from './DataTable';

export const pathColumns: Column<CriticalPathSegment>[] = [
  { key: 'seg', label: 'Segment', value: (r) => `${r.fromLabel} → ${r.toLabel}` },
  { key: 'pipe', label: 'Pipe', value: (r) => r.label },
  { key: 'l', label: 'L, m', value: (r) => +r.lengthM.toFixed(1), render: (r) => r.lengthM.toFixed(1), align: 'right' },
  { key: 'leq', label: 'L_eq, m', value: (r) => +r.equivalentLengthM.toFixed(1), render: (r) => r.equivalentLengthM.toFixed(1), align: 'right' },
  { key: 'q', label: 'Q, LPM', value: (r) => +r.flowLpm.toFixed(1), render: (r) => r.flowLpm.toFixed(1), align: 'right' },
  { key: 'hf', label: 'hf, m', value: (r) => +r.headLossM.toFixed(3), render: (r) => r.headLossM.toFixed(3), align: 'right' },
  { key: 'p', label: 'Pressure after, bar', value: (r) => +r.pressureAfterBar.toFixed(3), render: (r) => r.pressureAfterBar.toFixed(2), align: 'right' },
];

export function CriticalPathTab() {
  const project = useStore((s) => s.project);
  const showPath = useStore((s) => s.view.showCriticalPath);
  const setView = useStore((s) => s.setView);
  const results = useResults();
  const path = useMemo(() => criticalPath(project, results), [project, results]);

  if (!path) {
    return <p className="empty">Open at least one hydrant to find a critical path.</p>;
  }
  const target = results.nodes.find((n) => n.id === path.targetId);
  const totalLoss = path.segments.reduce((s, x) => s + x.headLossM, 0);
  return (
    <DataTable
      testId="path-table"
      rows={path.segments}
      columns={pathColumns}
      rowKey={(r) => r.pipeId}
      csvName="critical-path.csv"
      toolbar={
        <>
          <span className="summary">
            Pump to <strong>{target?.label}</strong>, total loss {totalLoss.toFixed(2)} m
          </span>
          <label className="check">
            <input
              type="checkbox"
              checked={showPath}
              data-testid="show-path"
              onChange={(e) => setView({ showCriticalPath: e.target.checked })}
            />
            Highlight on drawing
          </label>
        </>
      }
    />
  );
}
