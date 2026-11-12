import type { Id, Network, Project, Scenario } from '../model/types';
import { solve, type SolveResults } from '../solver';

/** Writes a scenario's overrides into the working model. */
export function applyScenario(project: Project, scenario: Scenario): void {
  for (const n of project.nodes) {
    const on = scenario.hydrantOn?.[n.id];
    if (n.outlet && on !== undefined) n.outlet.on = on;
  }
  for (const p of project.pipes) {
    const status = scenario.pipeStatus?.[p.id];
    if (status !== undefined) p.status = status;
    const c = scenario.globalC ?? scenario.pipeC?.[p.id];
    if (c !== undefined) p.c = c;
    for (const v of p.valves ?? []) {
      const valveStatus = scenario.valveStatus?.[v.id];
      if (valveStatus !== undefined) v.status = valveStatus;
    }
  }
}

export interface ScenarioColumn {
  id: Id;
  name: string;
  results: SolveResults;
}

export interface CompareRow {
  key: string;
  label: string;
  group: 'System' | 'Open outlets';
  values: (string | number | null)[];
}

export interface ScenarioComparison {
  columns: ScenarioColumn[];
  rows: CompareRow[];
}

const round = (v: number | null | undefined, d: number): number | null =>
  v === null || v === undefined ? null : +v.toFixed(d);

/** Solves each scenario and lays the results out side by side. */
export function compareScenarios(network: Network, scenarios: Scenario[]): ScenarioComparison {
  const columns: ScenarioColumn[] = scenarios.map((s) => ({
    id: s.id,
    name: s.name,
    results: solve(network, s),
  }));

  const system = (
    key: string,
    label: string,
    pick: (r: SolveResults) => string | number | null,
  ): CompareRow => ({
    key,
    label,
    group: 'System',
    values: columns.map((c) => (c.results.ok ? pick(c.results) : null)),
  });

  const rows: CompareRow[] = [
    system('q', 'Pump flow, LPM', (r) => round(r.system.pumpFlowLpm, 0)),
    system('h', 'Pump head, m', (r) => round(r.system.pumpHeadM, 1)),
    system('pb', 'Pump pressure, bar', (r) => round(r.system.pumpPressureBar, 2)),
    system('total', 'Total outflow, LPM', (r) => round(r.system.totalOutflowLpm, 0)),
    system('crit', 'Critical outlet', (r) => r.nodes.find((n) => n.id === r.system.criticalNodeId)?.label ?? '–'),
    system('critp', 'Critical pressure, bar', (r) => round(r.system.criticalPressureBar, 2)),
    system('pass', 'Outlets passing', (r) => r.system.passingOutlets),
    system('fail', 'Outlets failing', (r) => r.system.failingOutlets),
    system('vmax', 'Highest velocity, m/s', (r) => round(Math.max(0, ...r.pipes.map((p) => p.velocityMs)), 2)),
  ];

  const openIds = new Set<Id>();
  for (const c of columns) {
    for (const n of c.results.nodes) {
      if (n.status === 'pass' || n.status === 'fail') openIds.add(n.id);
    }
  }
  for (const node of network.nodes) {
    if (!openIds.has(node.id)) continue;
    rows.push({
      key: `p-${node.id}`,
      label: `${node.label}, bar`,
      group: 'Open outlets',
      values: columns.map((c) => {
        const r = c.results.nodes.find((n) => n.id === node.id);
        if (!r || r.status === 'off' || r.status === null) return null;
        return round(r.pressureBar, 2);
      }),
    });
  }
  return { columns, rows };
}
