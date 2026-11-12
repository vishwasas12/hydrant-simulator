import { useMemo, useState } from 'react';
import { applyScenario, compareScenarios, type CompareRow } from '../analysis/scenarios';
import { captureState, uid } from '../model/edit';
import type { Project } from '../model/types';
import { useStore } from '../state/store';
import { downloadCsv } from './DataTable';

function csvOf(names: string[], rows: CompareRow[]): string {
  const cell = (v: string | number | null) => (v === null ? '' : `"${String(v).replace(/"/g, '""')}"`);
  return [
    ['Metric', ...names].map(cell).join(','),
    ...rows.map((r) => [r.label, ...r.values].map(cell).join(',')),
  ].join('\r\n');
}

export function ScenariosTab() {
  const project = useStore((s) => s.project);
  const update = useStore((s) => s.update);
  const showToast = useStore((s) => s.showToast);
  const [name, setName] = useState('');

  const comparison = useMemo(
    () => compareScenarios(project, project.scenarios),
    // Scenario results depend on the network and the scenario list only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project.nodes, project.pipes, project.pumps, project.settings, project.tables, project.scenarios],
  );

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    update((d) => {
      d.scenarios.push({ id: uid('s'), name: trimmed, ...captureState(d as Project) });
    });
    setName('');
  };

  const groups: CompareRow['group'][] = ['System', 'Open outlets'];

  return (
    <div className="table-wrap" data-testid="scenarios">
      <div className="table-tools">
        <input
          className="filter-input"
          placeholder="Scenario name"
          aria-label="Scenario name"
          value={name}
          data-testid="scenario-name"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save();
          }}
        />
        <button type="button" className="btn" onClick={save} disabled={!name.trim()} data-testid="scenario-save">
          Save current state
        </button>
        <span className="muted">Captures hydrant states, valves and C values.</span>
        <span className="viewbar-fill" />
        <button
          type="button"
          className="btn"
          disabled={project.scenarios.length === 0}
          onClick={() => downloadCsv('scenarios.csv', csvOf(comparison.columns.map((c) => c.name), comparison.rows))}
        >
          Export CSV
        </button>
      </div>
      {project.scenarios.length === 0 ? (
        <p className="empty">Save a scenario to compare it here.</p>
      ) : (
        <div className="table-scroll">
          <table className="compare">
            <thead>
              <tr>
                <th><button type="button" tabIndex={-1}>Metric</button></th>
                {project.scenarios.map((s) => (
                  <th key={s.id} className="num scenario-head">
                    <input
                      aria-label="Scenario name"
                      value={s.name}
                      onChange={(e) =>
                        update((d) => {
                          const t = d.scenarios.find((x) => x.id === s.id);
                          if (t) t.name = e.target.value;
                        }, `sn-${s.id}`)
                      }
                    />
                    <div className="scenario-actions">
                      <label>
                        Global C
                        <input
                          type="number"
                          min="1"
                          aria-label={`Global C for ${s.name}`}
                          value={s.globalC ?? ''}
                          placeholder="–"
                          onChange={(e) =>
                            update((d) => {
                              const t = d.scenarios.find((x) => x.id === s.id);
                              if (!t) return;
                              const v = Number(e.target.value);
                              if (e.target.value === '' || !(v > 0)) delete t.globalC;
                              else t.globalC = v;
                            }, `sc-${s.id}`)
                          }
                        />
                      </label>
                      <button
                        type="button"
                        className="link"
                        data-testid={`scenario-load-${s.name}`}
                        onClick={() => {
                          update((d) => applyScenario(d as Project, s));
                          showToast(`Loaded scenario: ${s.name}.`);
                        }}
                      >
                        Load
                      </button>
                      <button
                        type="button"
                        className="link danger"
                        onClick={() => update((d) => void (d.scenarios = d.scenarios.filter((x) => x.id !== s.id)))}
                      >
                        Delete
                      </button>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => {
                const rows = comparison.rows.filter((r) => r.group === group);
                if (rows.length === 0) return null;
                return [
                  <tr key={group} className="group-row">
                    <td colSpan={project.scenarios.length + 1}>{group}</td>
                  </tr>,
                  ...rows.map((r) => (
                    <tr key={r.key}>
                      <td>{r.label}</td>
                      {r.values.map((v, i) => (
                        <td key={comparison.columns[i].id} className="num">
                          {v === null ? '–' : v}
                        </td>
                      ))}
                    </tr>
                  )),
                ];
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
