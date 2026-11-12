import { renderToStaticMarkup } from 'react-dom/server';
import { compareScenarios } from '../analysis/scenarios';
import { requirementCheck } from '../analysis/requirement';
import type { CapacityResult } from '../analysis/capacity';
import { DIAMETER_CLASSES, diameterClass } from '../canvas/colors';
import type { Fitting, Project } from '../model/types';
import { pathColumns } from '../panels/CriticalPathTab';
import { comboColumns, comboLabels } from '../panels/CapacityTab';
import { PressureProfileChart, profileData, pumpSystemData, PumpSystemChart } from '../panels/charts';
import type { Column } from '../panels/DataTable';
import { requirementColumns } from '../panels/RequirementTab';
import { VALVE_NAMES } from '../panels/ValvePanel';
import { hydrantColumns, nodeColumns, pipeColumnsFor } from '../panels/ResultsTables';
import { criticalPath, type SolveResults } from '../solver';
import { buildAssumptions } from './assumptions';
import { networkSnapshot } from './snapshot';

const esc = (v: unknown): string =>
  String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

function table<T>(columns: Column<T>[], rows: T[]): string {
  const head = columns.map((c) => `<th class="${c.align === 'right' ? 'num' : ''}">${esc(c.label)}</th>`).join('');
  const body = rows
    .map(
      (r) =>
        `<tr>${columns
          .map((c) => {
            const v = c.value(r);
            return `<td class="${c.align === 'right' ? 'num' : ''}">${v === null ? '–' : esc(v)}</td>`;
          })
          .join('')}</tr>`,
    )
    .join('');
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function fittingText(project: Project, f: Fitting): string {
  if (f.type === 'custom') {
    return `${f.quantity} × custom (${f.customMode === 'k' ? `K ${f.customValue}` : `${f.customValue} m`})`;
  }
  const row = project.tables.fittings.find((r) => r.type === f.type);
  return `${f.quantity} × ${row?.name ?? f.type}`;
}

function inputTables(project: Project): string {
  const labels = new Map(project.nodes.map((n) => [n.id, n.label]));
  const outlets = project.nodes.filter((n) => n.outlet);
  type N = (typeof outlets)[number];
  const outletColumns: Column<N>[] = [
    { key: 'id', label: 'ID', value: (n) => n.label },
    { key: 'state', label: 'State', value: (n) => (n.outlet?.on ? 'ON' : 'OFF') },
    { key: 'outlets', label: 'Outlets', value: (n) => n.outlet?.outlets ?? null, align: 'right' },
    {
      key: 'model',
      label: 'Discharge',
      value: (n) =>
        n.outlet?.model === 'fixed'
          ? `Fixed ${n.outlet.fixedFlowLpm} LPM`
          : `Emitter, ${n.outlet?.nozzleMm} mm nozzle, Cd ${n.outlet?.cd}, hose ${n.outlet?.hoseLengthM} m × ${n.outlet?.hoseDiameterMm} mm`,
    },
    { key: 'elev', label: 'Elev, m', value: (n) => n.elevationM, align: 'right' },
    { key: 'minp', label: 'Min, bar', value: (n) => n.outlet?.minPressureBar ?? null, align: 'right' },
    { key: 'minq', label: 'Min per outlet, LPM', value: (n) => n.outlet?.minFlowLpm ?? null, align: 'right' },
  ];
  type P = Project['pipes'][number];
  const pipeInputs: Column<P>[] = [
    { key: 'id', label: 'ID', value: (p) => p.label },
    { key: 'from', label: 'From', value: (p) => labels.get(p.from) ?? '' },
    { key: 'to', label: 'To', value: (p) => labels.get(p.to) ?? '' },
    { key: 'nom', label: 'Nominal', value: (p) => p.nominalMm, align: 'right' },
    { key: 'd', label: 'ID, mm', value: (p) => p.internalDiameterMm, align: 'right' },
    { key: 'l', label: 'L, m', value: (p) => +p.lengthM.toFixed(1), align: 'right' },
    { key: 'c', label: 'C', value: (p) => p.c, align: 'right' },
    { key: 'status', label: 'Status', value: (p) => p.status },
    { key: 'f', label: 'Fittings', value: (p) => p.fittings.map((f) => fittingText(project, f)).join(', ') },
    {
      key: 'v',
      label: 'Valves',
      value: (p) =>
        (p.valves ?? [])
          .map((v) => `${v.label} ${VALVE_NAMES[v.type].toLowerCase()}${v.status === 'closed' ? ' (CLOSED)' : ''}`)
          .join(', '),
    },
  ];
  const pumps = project.pumps
    .map((p) => {
      const curve =
        p.curve.kind === 'threePoint'
          ? `Shutoff ${p.curve.shutoffHeadM} m; rated ${p.curve.ratedHeadM} m @ ${p.curve.ratedFlowLpm} LPM; ${p.curve.overloadHeadM} m @ ${p.curve.overloadFlowLpm} LPM`
          : p.curve.kind === 'constant'
            ? `Constant ${p.curve.headM} m`
            : p.curve.points.map((x) => `${x.headM} m @ ${x.flowLpm} LPM`).join('; ');
      return `<p><strong>${esc(p.label)}</strong> at ${esc(labels.get(p.nodeId))}. ${esc(curve)}. Suction loss ${p.suctionLossM} m, water level ${p.waterLevelM} m.</p>`;
    })
    .join('');
  return `${pumps}<h3>Hydrants and hose reels</h3>${table(outletColumns, outlets)}<h3>Pipes</h3>${table(pipeInputs, project.pipes)}`;
}

function capacitySection(capacity: CapacityResult): string {
  const worst = capacity.worstForK;
  const farthest = capacity.kFarthest;
  const pct = (m: number) => `${(m * 100).toFixed(1)} %`;
  const summary = `<ul>
    <li>Most hydrants open at once: <strong>${capacity.maxSimultaneous}</strong>${capacity.maxExact || capacity.method === 'exhaustive' ? ' (exact)' : ' (at least, from greedy search)'}${capacity.bestCombo ? `: ${esc(comboLabels(capacity, capacity.bestCombo))}` : ''}</li>
    <li>Any combination of up to <strong>${capacity.guaranteedK}</strong> passes${capacity.guaranteedExact ? ' (exact)' : ' (upper estimate)'}</li>
    ${worst ? `<li>Worst case for k = ${capacity.chosenK}: ${worst.pass ? '✓ passes' : '✕ fails'}, margin ${pct(worst.margin)}: ${esc(comboLabels(capacity, worst))}</li>` : ''}
    ${farthest ? `<li>${capacity.chosenK} farthest together: ${farthest.pass ? '✓ passes' : '✕ fails'}, margin ${pct(farthest.margin)}: ${esc(comboLabels(capacity, farthest))}</li>` : ''}
    <li>${capacity.evaluated.toLocaleString()} combinations solved, method: ${capacity.method}.</li>
  </ul>`;
  const worstRows = capacity.combos.slice(0, 25);
  return `${summary}<h3>Lowest 25 margins</h3>${table(comboColumns(capacity), worstRows)}`;
}

function scenariosSection(project: Project): string {
  if (project.scenarios.length === 0) return '<p>No scenarios saved.</p>';
  const c = compareScenarios(project, project.scenarios);
  const head = ['Metric', ...c.columns.map((x) => x.name)]
    .map((h, i) => `<th class="${i ? 'num' : ''}">${esc(h)}</th>`)
    .join('');
  const body = c.rows
    .map(
      (r) =>
        `<tr><td>${esc(r.label)}</td>${r.values.map((v) => `<td class="num">${v === null ? '–' : esc(v)}</td>`).join('')}</tr>`,
    )
    .join('');
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

const STYLES = `
  * { box-sizing: border-box; }
  body { margin: 0 auto; max-width: 1040px; padding: 28px 32px 48px; color: #1c1b19; background: #fff;
    font: 13px/1.45 'Segoe UI', system-ui, sans-serif; }
  h1 { margin: 0; font-size: 24px; font-weight: 600; }
  h2 { margin: 28px 0 8px; padding-bottom: 4px; font-size: 16px; font-weight: 600; border-bottom: 2px solid #1c1b19; break-after: avoid; }
  h3 { margin: 16px 0 6px; font-size: 13px; font-weight: 600; break-after: avoid; }
  p { margin: 6px 0; }
  .meta { color: #52514e; }
  .toolbar { position: sticky; top: 0; display: flex; gap: 8px; padding: 8px 0; background: #fff; }
  .toolbar button { height: 30px; padding: 0 12px; font: inherit; cursor: pointer; background: #1c1b19; color: #fff; border: 0; border-radius: 4px; }
  .verdict { margin: 16px 0; padding: 12px 14px; border-radius: 4px; font-size: 15px; font-weight: 600; }
  .verdict.pass { background: #e4f4e4; color: #0a5f0a; }
  .verdict.fail { background: #fae5e5; color: #8f2020; }
  .verdict.none { background: #eeede8; color: #52514e; }
  .facts { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 10px 0; }
  .fact { padding: 8px 10px; background: #f6f5f1; border-radius: 3px; }
  .fact span { display: block; font-size: 11px; color: #52514e; }
  .fact strong { font-size: 15px; font-weight: 600; }
  .drawing { padding: 6px; border: 1px solid #d9d7cf; break-inside: avoid; }
  .legend { display: flex; flex-wrap: wrap; gap: 14px; margin: 6px 0; font-size: 11px; color: #52514e; }
  .legend i { display: inline-block; width: 22px; margin-right: 4px; vertical-align: middle; border-top-style: solid; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; margin: 4px 0 8px; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; }
  th { padding: 3px 6px; text-align: left; font-weight: 600; border-bottom: 1px solid #1c1b19; }
  td { padding: 2px 6px; border-bottom: 1px solid #e8e6df; vertical-align: top; }
  td:first-child { white-space: nowrap; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .dot { display: inline-block; width: 10px; height: 10px; margin-right: 4px; vertical-align: -1px; border-radius: 50%; border: 1.5px solid #52514e; }
  .chart { break-inside: avoid; margin: 6px 0 14px; }
  .chart svg { max-width: 100%; height: auto; }
  .override { color: #8a5a00; font-weight: 600; }
  .issues li { margin: 2px 0; }
  .disclaimer { margin-top: 28px; padding: 10px 12px; background: #fbf0d4; border-radius: 3px; font-size: 12px; color: #5e3f00; }
  @media print {
    body { max-width: none; padding: 0; }
    .toolbar { display: none; }
    @page { size: A4; margin: 14mm; }
  }
`;

export interface ReportInput {
  project: Project;
  results: SolveResults;
  /** Omitted when no current capacity search exists. */
  capacity: CapacityResult | null;
  generatedAt: Date;
}

/** Builds a self-contained, printable HTML report. */
export function buildReportHtml({ project, results, capacity, generatedAt }: ReportInput): string {
  const path = criticalPath(project, results);
  const assumptions = buildAssumptions(project);
  const pumpData = pumpSystemData(project, results);
  const profile = path ? profileData(path, results, project.pumps[0]?.label ?? 'Pump') : null;
  const outlets = results.nodes.filter((n) => n.kind !== 'junction');
  const open = outlets.filter((n) => n.status === 'pass' || n.status === 'fail');
  const failing = open.filter((n) => n.status === 'fail');
  const critical = results.nodes.find((n) => n.id === results.system.criticalNodeId);

  let verdict: string;
  let verdictClass: string;
  if (!results.ok) {
    verdict = '✕ The network could not be solved';
    verdictClass = 'fail';
  } else if (open.length === 0) {
    verdict = 'No outlets are open in this configuration';
    verdictClass = 'none';
  } else if (failing.length === 0) {
    verdict = `✓ PASS: all ${open.length} open outlets meet their minimum pressure and flow`;
    verdictClass = 'pass';
  } else {
    verdict = `✕ FAIL: ${failing.length} of ${open.length} open outlets miss their minimum (${failing.map((n) => n.label).join(', ')})`;
    verdictClass = 'fail';
  }

  const usedClasses = new Set(project.pipes.map((p) => diameterClass(p).label));
  const legend = DIAMETER_CLASSES.filter((c) => usedClasses.has(c.label))
    .map((c) => `<span><i style="border-top-width:${c.width}px;border-top-color:${c.color}"></i>${esc(c.label)} mm</span>`)
    .join('');

  const issues = results.issues.length
    ? `<h3>Solver messages</h3><ul class="issues">${results.issues.map((i) => `<li>${i.severity === 'error' ? '✕' : '▲'} ${esc(i.message)}</li>`).join('')}</ul>`
    : '';

  const assumptionRows = assumptions
    .map(
      (a) =>
        `<tr><td>${esc(a.group)}</td><td>${esc(a.name)}</td><td>${esc(a.value)}</td><td>${esc(a.source)}</td><td>${a.overridden ? '<span class="override">Overridden</span>' : ''}</td></tr>`,
    )
    .join('');

  const pumpChart = pumpData ? renderToStaticMarkup(<PumpSystemChart data={pumpData} width={900} height={320} />) : '<p>No pump curve available.</p>';
  const profileChart = profile ? renderToStaticMarkup(<PressureProfileChart data={profile} width={900} height={300} />) : '<p>No open outlet, so no critical path.</p>';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(project.name)} - hydraulic report</title>
<style>${STYLES}</style>
</head>
<body>
<div class="toolbar"><button onclick="window.print()">Print or save as PDF</button></div>
<h1>${esc(project.name)}</h1>
<p class="meta">Fire hydrant network hydraulic report. Generated ${esc(generatedAt.toLocaleString())}.</p>
<div class="verdict ${verdictClass}" id="verdict">${esc(verdict)}</div>
<div class="facts">
  <div class="fact"><span>Pump flow</span><strong>${results.system.pumpFlowLpm.toFixed(0)} LPM</strong></div>
  <div class="fact"><span>Pump head</span><strong>${results.system.pumpHeadM.toFixed(1)} m (${results.system.pumpPressureBar.toFixed(2)} bar)</strong></div>
  <div class="fact"><span>Critical outlet</span><strong>${critical ? `${esc(critical.label)}, ${critical.pressureBar?.toFixed(2)} bar` : 'None open'}</strong></div>
  <div class="fact"><span>Solver</span><strong>${results.iterations} iterations</strong></div>
</div>
${issues}

<h2>Drawing</h2>
<div class="drawing">${networkSnapshot(project, results, path)}</div>
<div class="legend">${legend}<span><b class="dot" style="background:#0ca30c"></b>Open, passes</span><span><b class="dot" style="background:#d03b3b"></b>Open, fails</span><span><b class="dot"></b>Off</span><span>◇ hollow bow-tie: valve open, filled: closed</span>${path ? '<span>Yellow band: critical path</span>' : ''}</div>

<h2>Inputs</h2>
${inputTables(project)}

<h2>Results</h2>
<h3>Hydrants and hose reels</h3>
${table(hydrantColumns, outlets)}
<h3>Nodes</h3>
${table(nodeColumns, results.nodes)}
<h3>Pipes</h3>
${table(pipeColumnsFor(project.nodes), results.pipes)}
${path ? `<h3>Critical path</h3>${table(pathColumns, path.segments)}` : ''}

<h2>Charts</h2>
<h3>Pump and system curves</h3>
<div class="chart" id="chart-pump">${pumpChart}</div>
<h3>Pressure along the critical path</h3>
<div class="chart" id="chart-profile">${profileChart}</div>

<h2>Requirement check: each hydrant alone</h2>
${project.pumps.length > 0 ? table(requirementColumns, requirementCheck(project)) : '<p>No pump defined.</p>'}

<h2>Simultaneous capacity</h2>
${capacity ? capacitySection(capacity) : '<p>No current capacity search. Run one on the Capacity tab to include it here.</p>'}

<h2>Scenario comparison</h2>
${scenariosSection(project)}

<h2>Assumptions</h2>
<table><thead><tr><th>Group</th><th>Item</th><th>Value used</th><th>Source</th><th></th></tr></thead><tbody>${assumptionRows}</tbody></table>

<div class="disclaimer">Steady-state analysis only. Transients and water hammer are not modelled. Default requirements must be checked against the applicable code (NBC 2016 Part 4, TAC, IS 13039, NFPA 14/24). Results need review by a qualified engineer before use.</div>
</body>
</html>`;
}
