import { useMemo, useState } from 'react';
import type { CapacityResult, Combo } from '../analysis/capacity';
import { useCapacity } from '../analysis/useCapacity';
import { networkKey, useStore } from '../state/store';
import { DataTable, StatusBadge, type Column } from './DataTable';

export const comboLabels = (r: CapacityResult, c: Combo): string =>
  c.members.map((m) => r.hydrants[m].label).join(', ');

export function comboColumns(r: CapacityResult): Column<Combo>[] {
  return [
    { key: 'k', label: 'Flowing', value: (c) => c.count, align: 'right' },
    { key: 'members', label: 'Hydrants', value: (c) => comboLabels(r, c) },
    { key: 'status', label: 'Result', value: (c) => (c.pass ? 'pass' : 'fail'), render: (c) => <StatusBadge status={c.pass ? 'pass' : 'fail'} /> },
    {
      key: 'margin',
      label: 'Margin',
      value: (c) => +(c.margin * 100).toFixed(1),
      render: (c) => `${(c.margin * 100).toFixed(1)} %`,
      align: 'right',
    },
    { key: 'crit', label: 'Critical hydrant', value: (c) => r.hydrants[c.critical].label },
    { key: 'q', label: 'Pump flow, LPM', value: (c) => +c.pumpFlowLpm.toFixed(0), align: 'right' },
    { key: 'h', label: 'Pump head, m', value: (c) => +c.pumpHeadM.toFixed(1), render: (c) => c.pumpHeadM.toFixed(1), align: 'right' },
    { key: 'why', label: 'Reason', value: (c) => c.reason },
  ];
}

function Stat({ label, value, note, testId }: { label: string; value: string; note?: string; testId?: string }) {
  return (
    <div className="stat" data-testid={testId}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {note && <span className="stat-note">{note}</span>}
    </div>
  );
}

type Show = 'all' | 'pass' | 'fail';

export function CapacityTab() {
  const project = useStore((s) => s.project);
  const update = useStore((s) => s.update);
  const running = useCapacity((s) => s.running);
  const done = useCapacity((s) => s.done);
  const total = useCapacity((s) => s.total);
  const phase = useCapacity((s) => s.phase);
  const result = useCapacity((s) => s.result);
  const resultKey = useCapacity((s) => s.resultKey);
  const error = useCapacity((s) => s.error);
  const run = useCapacity((s) => s.run);
  const cancel = useCapacity((s) => s.cancel);

  const [chosenK, setChosenK] = useState(3);
  const [respect, setRespect] = useState(true);
  const [show, setShow] = useState<Show>('all');
  const [sizeFilter, setSizeFilter] = useState(0);

  const hydrantCount = project.nodes.filter((n) => n.kind === 'hydrant').length;
  const current = networkKey(project);
  const stale = !!resultKey && (resultKey.length !== current.length || resultKey.some((v, i) => v !== current[i]));

  const rows = useMemo(() => {
    if (!result) return [];
    return result.combos.filter(
      (c) => (show === 'all' || (show === 'pass' ? c.pass : !c.pass)) && (sizeFilter === 0 || c.count === sizeFilter),
    );
  }, [result, show, sizeFilter]);
  const columns = useMemo(() => (result ? comboColumns(result) : []), [result]);

  const applyCombo = (r: CapacityResult, c: Combo) => {
    const open = new Set(c.members.map((m) => r.hydrants[m].id));
    update((d) => {
      for (const n of d.nodes) if (n.kind === 'hydrant' && n.outlet) n.outlet.on = open.has(n.id);
    });
  };

  const pct = total > 0 ? Math.min(100, (done / total) * 100) : 0;
  const passCount = result ? result.combos.filter((c) => c.pass).length : 0;

  return (
    <div className="table-wrap" data-testid="capacity">
      <div className="table-tools">
        <label className="check">
          Worst case for groups of
          <input
            className="k-input"
            type="number"
            min="1"
            max={hydrantCount || 1}
            value={chosenK}
            data-testid="capacity-k"
            onChange={(e) => setChosenK(Number(e.target.value))}
          />
        </label>
        <label className="check">
          <input type="checkbox" checked={respect} onChange={(e) => setRespect(e.target.checked)} data-testid="capacity-respect" />
          Fail if the pump runs beyond its curve
        </label>
        {running ? (
          <button type="button" className="btn" onClick={cancel} data-testid="capacity-cancel">
            Cancel
          </button>
        ) : (
          <button
            type="button"
            className="btn primary"
            disabled={hydrantCount === 0 || !(chosenK >= 1)}
            data-testid="capacity-run"
            onClick={() => run(project, { chosenK, respectPumpLimit: respect })}
          >
            Run search
          </button>
        )}
        <span className="muted">
          {hydrantCount <= 15
            ? `${hydrantCount} hydrants: every combination is checked (${Math.max(2 ** hydrantCount - 1, 0).toLocaleString()} in all).`
            : `${hydrantCount} hydrants: small groups are checked in full; larger groups follow the least favourable combinations.`}
        </span>
      </div>

      {running && (
        <div className="progress-row" data-testid="capacity-progress">
          <div className="progress" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
            <div style={{ width: `${pct}%` }} />
          </div>
          <span className="muted">
            {phase} · {done.toLocaleString()} of {total.toLocaleString()}
          </span>
        </div>
      )}
      {error && <p className="warn">▲ {error}</p>}
      {stale && !running && <p className="warn">▲ The network has changed since this search. Run it again for current results.</p>}

      {result ? (
        <>
          <div className="stats">
            <Stat
              testId="stat-max"
              label="Most hydrants flowing together"
              value={String(result.maxSimultaneous)}
              note={`${result.maxExact || result.method === 'exhaustive' ? 'Every combination checked' : 'Best combination found'}${result.bestCombo ? `: ${comboLabels(result, result.bestCombo)}` : ''}`}
            />
            <Stat
              testId="stat-guaranteed"
              label="Any combination of up to"
              value={String(result.guaranteedK)}
              note={result.guaranteedExact ? 'Every combination of this size passes' : 'Estimated from the least favourable combinations'}
            />
            <Stat
              testId="stat-worst"
              label={`Worst group of ${result.chosenK}`}
              value={result.worstForK ? `${result.worstForK.pass ? '✓' : '✕'} ${(result.worstForK.margin * 100).toFixed(1)} %` : '–'}
              note={result.worstForK ? `${comboLabels(result, result.worstForK)}${result.worstForKExact ? '' : ' (estimated)'}` : undefined}
            />
            <Stat
              testId="stat-farthest"
              label={`${result.chosenK} most remote together`}
              value={result.kFarthest ? `${result.kFarthest.pass ? '✓' : '✕'} ${(result.kFarthest.margin * 100).toFixed(1)} %` : '–'}
              note={result.kFarthest ? comboLabels(result, result.kFarthest) : undefined}
            />
          </div>
          {result.excluded.length > 0 && (
            <p className="warn">▲ Left out, no path to the pump: {result.excluded.join(', ')}.</p>
          )}
          <DataTable
            testId="combos-table"
            rows={rows}
            columns={columns}
            rowKey={(c) => c.members.join(',')}
            csvName="combinations.csv"
            maxRows={300}
            onRowClick={(c) => applyCombo(result, c)}
            toolbar={
              <>
                <select className="inline-select" aria-label="Show combinations" value={show} data-testid="combos-show" onChange={(e) => setShow(e.target.value as Show)}>
                  <option value="all">Passing and failing</option>
                  <option value="pass">Passing only</option>
                  <option value="fail">Failing only</option>
                </select>
                <select className="inline-select" aria-label="Combination size" value={sizeFilter} data-testid="combos-size" onChange={(e) => setSizeFilter(Number(e.target.value))}>
                  <option value={0}>Any size</option>
                  {Array.from(new Set(result.combos.map((c) => c.count)))
                    .sort((a, b) => a - b)
                    .map((k) => (
                      <option key={k} value={k}>
                        {k} open
                      </option>
                    ))}
                </select>
                <span className="muted">
                  {result.evaluated.toLocaleString()} solved, {passCount.toLocaleString()} pass. Worst margin first. Click a row to apply it.
                </span>
              </>
            }
          />
        </>
      ) : (
        !running && <p className="empty">Run the search to see how many hydrants can operate together.</p>
      )}
    </div>
  );
}
