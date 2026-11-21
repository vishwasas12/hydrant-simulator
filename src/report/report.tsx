import { renderToStaticMarkup } from 'react-dom/server';
import type { CapacityResult, Combo } from '../analysis/capacity';
import { requirementCheck, type RequirementRow } from '../analysis/requirement';
import { compareScenarios } from '../analysis/scenarios';
import { CUSTOM_CLASS, DIAMETER_CLASSES, diameterClass, STATUS } from '../canvas/colors';
import { reportDetails } from '../model/defaults';
import { countedFittings, type AutoFitting } from '../model/junctions';
import { COMPANY } from './company';
import type { Fitting, NodeKind, Outlet, Project, Pump, ReportDetails, Scenario } from '../model/types';
import { PressureProfileChart, profileData } from '../panels/charts';
import type { Column } from '../panels/DataTable';
import {
  criticalPath,
  lookupBySize,
  VALVE_FITTING,
  type CriticalPath,
  type CriticalPathSegment,
  type NodeResult,
  type PipeResult,
  type SolveResults,
} from '../solver';
import {
  calculationFittings,
  fittingSchedule,
  fittingTotals,
  junctionSchedule,
  naturalCompare,
  nodeConnections,
  pipeSchedule,
  pipeSize,
  STRAIGHT_TOLERANCE_DEG,
  valveSchedule,
  type CalcFittingRow,
  type FittingScheduleRow,
  type NodeConnection,
  type PipeScheduleRow,
  type ValveScheduleRow,
} from './inventory';
import { networkSnapshot } from './snapshot';

type Cell = string | number | null;

const esc = (v: unknown): string =>
  String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

/** A quoted CSS string that cannot close the style element. */
const cssString = (s: string): string => `"${s.replace(/[\\"]/g, '\\$&').replace(/</g, '\\3c ').replace(/[\r\n]+/g, ' ')}"`;

/** A number with fixed decimals and Indian digit grouping, e.g. 3,847 or 1,23,456.5. */
const num = (v: number, decimals = 0): string =>
  v.toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

/** A fraction as a percentage with a true minus sign: −12.5 %. */
const percent = (fraction: number): string => `${(fraction * 100).toFixed(1).replace(/^-/, '−')} %`;

/** Fixed decimals, or null when there is no value. */
const fix = (v: number | null | undefined, d: number): string | null =>
  v === null || v === undefined || !Number.isFinite(v) ? null : v.toFixed(d);

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/**
 * Labels in natural order with runs of three or more consecutive numbers
 * written as a range: "HV 1–HV 17, HV 19–HV 26".
 */
function labelRanges(labels: string[]): string {
  const sorted = [...labels].sort(naturalCompare);
  const parts: string[] = [];
  let run: { prefix: string; start: number; end: number; first: string; last: string } | null = null;
  const flush = () => {
    if (!run) return;
    const length = run.end - run.start + 1;
    if (length >= 3) parts.push(`${run.first}–${run.last}`);
    else if (length === 2) parts.push(run.first, run.last);
    else parts.push(run.first);
    run = null;
  };
  for (const label of sorted) {
    const m = label.match(/^(.*?)(\d+)$/);
    if (!m) {
      flush();
      parts.push(label);
      continue;
    }
    const [prefix, n] = [m[1], Number(m[2])];
    if (run && run.prefix === prefix && n === run.end + 1) {
      run.end = n;
      run.last = label;
    } else {
      flush();
      run = { prefix, start: n, end: n, first: label, last: label };
    }
  }
  flush();
  return parts.join(', ');
}

function listText(labels: string[], max = 12): string {
  return labels.length <= max ? labels.join(', ') : `${labels.slice(0, max).join(', ')} and ${labels.length - max} more`;
}

const col = <T,>(key: string, label: string, value: (r: T) => Cell, right = false): Column<T> => ({
  key,
  label,
  value,
  align: right ? 'right' : 'left',
});

interface TableOptions {
  /** Leave out columns that are blank in every row. */
  dropEmpty?: boolean;
  /** Cells of a totals row, keyed by column. */
  totals?: Record<string, Cell>;
  className?: string;
}

function table<T>(columns: Column<T>[], rows: T[], opts: TableOptions = {}): string {
  const blank = (v: Cell) => v === null || v === '';
  const cols = opts.dropEmpty ? columns.filter((c) => rows.some((r) => !blank(c.value(r)))) : columns;
  const attr = (c: Column<T>, extra = '') => {
    const names = [c.align === 'right' ? 'num' : '', extra].filter(Boolean).join(' ');
    return names ? ` class="${names}"` : '';
  };
  const tone = (v: Cell) => (v === 'Pass' ? 'pass' : v === 'Fail' ? 'fail' : '');
  const head = cols.map((c) => `<th${attr(c)}>${esc(c.label)}</th>`).join('');
  const body = rows
    .map(
      (r) =>
        `<tr>${cols
          .map((c) => {
            const v = c.value(r);
            return `<td${attr(c, tone(v))}>${v === null ? '–' : esc(v)}</td>`;
          })
          .join('')}</tr>`,
    )
    .join('');
  const foot = opts.totals
    ? `<tfoot><tr>${cols.map((c) => `<td${attr(c)}>${esc(opts.totals?.[c.key] ?? '')}</td>`).join('')}</tr></tfoot>`
    : '';
  const cls = opts.className ? ` class="${opts.className}"` : '';
  return `<table${cls}><thead><tr>${head}</tr></thead><tbody>${body}</tbody>${foot}</table>`;
}

/** Two-column label and value table. */
function keyValue(rows: [string, string][]): string {
  return `<table class="kv"><tbody>${rows
    .map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td>${esc(v)}</td></tr>`)
    .join('')}</tbody></table>`;
}

const RESULT_TEXT = { pass: 'Pass', fail: 'Fail', off: 'Closed' } as const;
const resultText = (s: NodeResult['status']): string => (s ? RESULT_TEXT[s] : '');
const passFail = (pass: boolean): string => (pass ? 'Pass' : 'Fail');
const KIND_TEXT = { junction: 'Junction', hydrant: 'Hydrant', hoseReel: 'Hose reel' } as const;

/** "hydrant(s)", "hose reel(s)" or "outlet(s)", whichever fits the set. */
function outletNoun(kinds: string[], count: number): string {
  const [one, many] = kinds.every((k) => k === 'hydrant')
    ? ['hydrant', 'hydrants']
    : kinds.every((k) => k === 'hoseReel')
      ? ['hose reel', 'hose reels']
      : ['outlet', 'outlets'];
  return count === 1 ? one : many;
}

function dischargeText(o: Outlet): string {
  if (o.model === 'fixed') return `Fixed ${o.fixedFlowLpm} LPM per outlet`;
  const hose = o.hoseLengthM > 0 ? `, ${o.hoseLengthM} m × ${o.hoseDiameterMm} mm hose` : ', no hose';
  return `${o.nozzleMm} mm nozzle, Cd ${o.cd}, ${o.valveDiameterMm} mm landing valve${hose}`;
}

function curveText(p: Pump): string {
  const c = p.curve;
  if (c.kind === 'threePoint') {
    return `Shut-off ${c.shutoffHeadM} m; rated ${c.ratedHeadM} m at ${num(c.ratedFlowLpm)} LPM; ${c.overloadHeadM} m at ${num(c.overloadFlowLpm)} LPM`;
  }
  if (c.kind === 'constant') return `Constant head ${c.headM} m`;
  return c.points.map((x) => `${x.headM} m at ${num(x.flowLpm)} LPM`).join('; ');
}

/** "1 × 90° elbow", or "Tee (branch) at J3" for one found in the drawing. */
function fittingText(project: Project, f: Fitting | AutoFitting): string {
  if (f.type === 'custom') {
    return `${f.quantity} × other (${f.customMode === 'k' ? `K ${f.customValue}` : `${f.customValue} m`})`;
  }
  const name = project.tables.fittings.find((r) => r.type === f.type)?.name ?? f.type;
  if ('nodeId' in f) {
    const at = project.nodes.find((n) => n.id === f.nodeId)?.label ?? '';
    return `${f.quantity > 1 ? `${f.quantity} × ` : ''}${name} at ${at}`;
  }
  return `${f.quantity} × ${name}`;
}

/** Drops instructions meant for the app user, such as "Use the Pump tool". */
function clientMessage(message: string): string {
  return message
    .split(/(?<=\.)\s+/)
    .filter((s) => !/^(Use the|Check )/.test(s))
    .join(' ');
}

/* ------------------------------------------------------------------ */
/* Introduction                                                        */
/* ------------------------------------------------------------------ */

/** Purpose and scope, naming only the analyses the report contains. */
function introductionSection(
  project: Project,
  details: ReportDetails,
  flowing: string[],
  requirement: RequirementRow[],
  hasCapacity: boolean,
  hasScenarios: boolean,
): string {
  const kinds = project.nodes.filter((n) => n.outlet).map((n) => n.kind);
  const many = outletNoun(kinds.length ? kinds : ['hydrant'], 2);
  // Trailing full stops are dropped so "Pvt. Ltd." does not end the sentence twice.
  const where = [details.site.trim(), details.client.trim() ? `prepared for ${details.client.trim()}` : '']
    .filter(Boolean)
    .join(', ')
    .replace(/\.+$/, '');
  const checked = requirement.length;
  const checkedNoun = outletNoun(requirement.map((r) => r.kind), checked);
  const scope = [
    flowing.length === 0
      ? `the network with all ${many} closed, giving the static pressures (Section {{section:results}})`
      : flowing.length === kinds.length
        ? `the operating case with all ${many} flowing (Section {{section:results}})`
        : `the operating case with ${labelRanges(flowing)} flowing and the other ${many} closed (Section {{section:results}})`,
    ...(checked > 0
      ? [`${checked === 1 ? `the ${checkedNoun}` : `each of the ${checked} ${checkedNoun}`} flowing on its own (Section {{section:requirement}})`]
      : []),
    ...(hasCapacity ? ['combinations of hydrants flowing at the same time (Section {{section:capacity}})'] : []),
    ...(hasScenarios ? [`${project.scenarios.length === 1 ? 'one further operating scenario' : `${project.scenarios.length} further operating scenarios`} (Section {{section:scenarios}})`] : []),
  ];
  return `<p>This report presents the steady-state hydraulic analysis of the fire hydrant network for ${esc(project.name)}${where ? `, ${esc(where)}` : ''}. Its purpose is to establish whether the fire pump and pipework deliver the minimum residual pressure and flow required at the ${esc(many)}, and to report the pressures, flows and velocities throughout the network.</p>
<p>The analysis covers:</p>
<ul class="findings">${scope.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
<p>The design criteria are set out in Section {{section:basis}}, the network and its inputs in Sections {{section:layout}} to {{section:inputs}}, and the method of analysis, assumptions and limitations in Section {{section:method}}.</p>`;
}

/* ------------------------------------------------------------------ */
/* Network inventory                                                   */
/* ------------------------------------------------------------------ */

function inventorySection(project: Project, results: SolveResults): string {
  const connections = nodeConnections(project);
  const totals = fittingTotals(connections);
  const pipes = pipeSchedule(project);
  const fittings = fittingSchedule(connections);
  const junctions = junctionSchedule(connections);
  const valves = valveSchedule(project);
  const pressure = new Map(results.nodes.map((n) => [n.id, n.pressureBar]));
  const totalLength = pipes.reduce((s, r) => s + r.lengthM, 0);
  const outlets = project.nodes.filter((n) => n.outlet);
  const hydrants = outlets.filter((n) => n.kind === 'hydrant').length;
  const reels = outlets.length - hydrants;
  const allTees = totals.tees + totals.takeOffTees;

  const facts = [
    ['Junctions', String(totals.junctions), ''],
    ['Tees', String(allTees), totals.takeOffTees > 0 ? `${totals.tees} at junctions, ${totals.takeOffTees} for outlets` : ''],
    ['Bends', String(totals.bends), ''],
    ['Pipework', `${num(totalLength)} m`, plural(project.pipes.length, 'pipe')],
  ];
  if (totals.crosses > 0) facts.splice(2, 0, ['Crosses', String(totals.crosses), '']);
  if (hydrants > 0) facts.push(['Hydrants', String(hydrants), '']);
  if (reels > 0) facts.push(['Hose reels', String(reels), '']);
  if (valves.length > 0) facts.push(['Valves', String(valves.length), '']);
  const factHtml = `<div class="facts">${facts
    .map(([label, value, note]) => `<div class="fact"><span>${esc(label)}</span><strong>${esc(value)}</strong>${note ? `<small>${esc(note)}</small>` : ''}</div>`)
    .join('')}</div>`;

  const sizeLabel = (r: PipeScheduleRow) => (r.custom ? `Special, ${r.size} mm bore` : `${r.size} NB`);
  const pipeTable = table(
    [
      col<PipeScheduleRow>('size', 'Pipe size', sizeLabel),
      col<PipeScheduleRow>('id', 'Internal diameter, mm', (r) => r.internalDiameters.join(', '), true),
      col<PipeScheduleRow>('n', 'Number of pipes', (r) => r.count, true),
      col<PipeScheduleRow>('l', 'Total length, m', (r) => num(r.lengthM, 1), true),
    ],
    pipes,
    { totals: pipes.length > 1 ? { size: 'Total', n: project.pipes.length, l: num(totalLength, 1) } : undefined },
  );

  const fittingTable =
    fittings.length > 0
      ? table(
          [
            col<FittingScheduleRow>('name', 'Fitting', (r) => r.name),
            col<FittingScheduleRow>('size', 'Size, NB', (r) => r.size),
            col<FittingScheduleRow>('q', 'Quantity', (r) => r.quantity, true),
            col<FittingScheduleRow>('at', 'Location', (r) => labelRanges(r.locations)),
          ],
          fittings,
          { totals: { name: 'Total', q: fittings.reduce((s, r) => s + r.quantity, 0) }, className: 'schedule' },
        )
      : '<p>The layout is a single straight run with no tees or bends.</p>';

  const junctionTable =
    junctions.length > 0
      ? table(
          [
            col<NodeConnection>('j', 'Junction', (c) => c.node.label),
            col<NodeConnection>('what', 'Fitting', (c) => c.description),
            col<NodeConnection>('size', 'Size, NB', (c) => c.fittings[0]?.size ?? [...new Set(c.pipes.map(pipeSize))].join(' × ')),
            col<NodeConnection>('pipes', 'Pipes connected', (c) => c.pipes.map((p) => p.label).sort(naturalCompare).join(', ')),
            col<NodeConnection>('elev', 'Elevation, m', (c) => c.node.elevationM.toFixed(1), true),
            ...(results.ok
              ? [col<NodeConnection>('p', 'Pressure, bar', (c) => fix(pressure.get(c.node.id), 2), true)]
              : []),
          ],
          junctions,
        )
      : '';

  const valveTable =
    valves.length > 0
      ? table(
          [
            col<ValveScheduleRow>('v', 'Valve', (r) => r.label),
            col<ValveScheduleRow>('t', 'Type', (r) => r.type),
            col<ValveScheduleRow>('size', 'Size, NB', (r) => r.size),
            col<ValveScheduleRow>('pipe', 'On pipe', (r) => r.pipe),
            col<ValveScheduleRow>('s', 'Position', (r) => (r.closed ? 'Closed' : 'Open')),
          ],
          valves,
        )
      : '';

  const takeOffNote =
    totals.takeOffTees > 0
      ? ' A hydrant or hose reel placed on the main is counted as a tee, its outlet being the branch.'
      : '';
  const inCalc = project.settings.autoFittings
    ? ' The head loss of each tee, bend and reducer is included in the calculation.'
    : '';
  return `<p class="lead">Quantities are taken from the network drawing. Three pipes meeting form a tee, four a cross, and two pipes meeting at an angle a bend; pipes within ${STRAIGHT_TOLERANCE_DEG}° of a straight line are treated as one run.${takeOffNote} A junction with a single pipe is a dead end and is counted as an end cap.${inCalc}</p>
${factHtml}
<h3>Pipework</h3>
${pipeTable}
<h3>Fittings</h3>
${fittingTable}
${junctionTable ? `<h3>Junction schedule</h3>${junctionTable}` : ''}
${valveTable ? `<h3>Valves</h3>${valveTable}` : ''}`;
}

/* ------------------------------------------------------------------ */
/* Design inputs                                                       */
/* ------------------------------------------------------------------ */

function inputsSection(project: Project): string {
  const labels = new Map(project.nodes.map((n) => [n.id, n.label]));
  const parts: string[] = [];

  for (const pump of project.pumps) {
    parts.push(`<h3>${esc(pump.label)}</h3>`);
    parts.push(
      keyValue([
        ['Connected at', labels.get(pump.nodeId) ?? '–'],
        ['Performance curve', curveText(pump)],
        ['Suction and pump-room loss', `${pump.suctionLossM} m`],
        ['Water level relative to pump', `${pump.waterLevelM} m`],
      ]),
    );
  }

  const outlets = project.nodes.filter((n) => n.outlet).sort((a, b) => naturalCompare(a.label, b.label));
  if (outlets.length > 0) {
    // One row per distinct outlet arrangement, so identical hydrants share a line.
    interface Group {
      kind: NodeKind;
      labels: string[];
      outlets: number;
      discharge: string;
      elevation: number;
      minP: number;
      minQ: number;
    }
    const groups = new Map<string, Group>();
    for (const n of outlets) {
      const o = n.outlet as Outlet;
      const discharge = dischargeText(o);
      const key = [n.kind, o.outlets, discharge, n.elevationM, o.minPressureBar, o.minFlowLpm].join('|');
      const g = groups.get(key) ?? { kind: n.kind, labels: [], outlets: o.outlets, discharge, elevation: n.elevationM, minP: o.minPressureBar, minQ: o.minFlowLpm };
      g.labels.push(n.label);
      groups.set(key, g);
    }
    const rows = [...groups.values()];
    const kinds = outlets.map((n) => n.kind);
    const mixedKinds = new Set(kinds).size > 1;
    const elevations = new Set(rows.map((g) => g.elevation));
    const columns: Column<Group>[] = [
      col<Group>('ids', mixedKinds ? 'Outlets' : outletNoun(kinds, 2).replace(/^./, (c) => c.toUpperCase()), (g) => labelRanges(g.labels)),
      col<Group>('n', 'Number', (g) => g.labels.length, true),
      ...(mixedKinds ? [col<Group>('kind', 'Type', (g) => KIND_TEXT[g.kind])] : []),
      ...(rows.some((g) => g.outlets !== 1) ? [col<Group>('outlets', 'Outlets each', (g) => g.outlets, true)] : []),
      col<Group>('model', 'Discharge', (g) => g.discharge),
      ...(elevations.size > 1 ? [col<Group>('elev', 'Elevation, m', (g) => g.elevation.toFixed(1), true)] : []),
      col<Group>('minp', 'Min. pressure, bar', (g) => g.minP, true),
      col<Group>('minq', 'Min. flow per outlet, LPM', (g) => num(g.minQ), true),
    ];
    const flowing = outlets.filter((n) => n.outlet?.on).map((n) => n.label);
    const notes = [
      flowing.length > 0 ? `Flowing in the case analysed: ${labelRanges(flowing)}.` : `No ${outletNoun(kinds, 2)} flow in the case analysed.`,
      elevations.size === 1 ? `All are at elevation ${[...elevations][0]} m.` : '',
    ].filter(Boolean);
    const title = mixedKinds ? 'Hydrants and hose reels' : outletNoun(kinds, 2).replace(/^./, (c) => c.toUpperCase());
    parts.push(`<h3>${title}</h3>${table(columns, rows)}<p class="note">${esc(notes.join(' '))}</p>`);
  }

  type P = Project['pipes'][number];
  const pipes = [...project.pipes].sort((a, b) => naturalCompare(a.label, b.label));
  const anyClosed = pipes.some((p) => p.status === 'closed');
  const counted = countedFittings(project);
  const pipeColumns: Column<P>[] = [
    col<P>('id', 'Pipe', (p) => p.label),
    col<P>('from', 'From', (p) => labels.get(p.from) ?? ''),
    col<P>('to', 'To', (p) => labels.get(p.to) ?? ''),
    col<P>('nom', 'Size, NB', (p) => (typeof p.nominalMm === 'number' ? p.nominalMm : 'Special'), true),
    col<P>('d', 'Internal dia., mm', (p) => p.internalDiameterMm, true),
    col<P>('l', 'Length, m', (p) => num(p.lengthM, 1), true),
    col<P>('c', 'C', (p) => p.c, true),
    ...(anyClosed ? [col<P>('status', 'Status', (p) => (p.status === 'closed' ? 'Closed' : 'Open'))] : []),
    col<P>('f', 'Fittings', (p) => (counted.get(p.id) ?? []).map((f) => fittingText(project, f)).join(', ')),
    col<P>(
      'v',
      'Valves',
      (p) => (p.valves ?? []).map((v) => `${v.label}${v.status === 'closed' ? ' (closed)' : ''}`).join(', '),
    ),
  ];
  parts.push(`<h3>Pipes</h3>${table(pipeColumns, pipes, { dropEmpty: true })}`);

  // With fittings found from the drawing, the hand-entered ones are the extras worth listing.
  const auto = project.settings.autoFittings ?? false;
  const calc = calculationFittings(project);
  parts.push(
    `<p class="note">${
      auto
        ? `Fittings marked "at" a node are the tees, bends and reducers found in the drawing at that node${calc.length > 0 ? '; the others were added for fittings the drawing does not show' : ''}.`
        : 'Fittings listed are those entered for each pipe.'
    } Their losses are included in the calculation, with the values listed under Design basis.</p>`,
  );
  if (calc.length > 0) {
    parts.push(
      `<h3>${auto ? 'Additional fittings not shown in the drawing' : 'Fittings included in the friction-loss calculation'}</h3>${table(
        [
          col<CalcFittingRow>('n', 'Fitting', (r) => r.name),
          col<CalcFittingRow>('s', 'Size, NB', (r) => r.size, true),
          col<CalcFittingRow>('q', 'Quantity', (r) => r.quantity, true),
          col<CalcFittingRow>('p', 'Pipes', (r) => r.pipes.join(', ')),
        ],
        calc,
      )}`,
    );
  }
  return parts.join('\n');
}

/* ------------------------------------------------------------------ */
/* Results                                                             */
/* ------------------------------------------------------------------ */

function resultsSection(project: Project, results: SolveResults, path: CriticalPath | null): string {
  const labels = new Map(project.nodes.map((n) => [n.id, n.label]));
  const byLabel = <T extends { label: string }>(rows: T[]) => [...rows].sort((a, b) => naturalCompare(a.label, b.label));
  const open = byLabel(results.nodes.filter((n) => n.status === 'pass' || n.status === 'fail'));
  const outletCount = results.nodes.filter((n) => n.kind !== 'junction').length;
  const parts: string[] = [];

  if (open.length > 0) {
    const noun = outletNoun(open.map((n) => n.kind), open.length);
    const others = outletCount - open.length;
    const otherNoun = outletNoun(results.nodes.filter((n) => n.kind !== 'junction').map((n) => n.kind), others);
    const closedText = others === 0 ? '' : others === 1 ? ` The other ${otherNoun} is closed.` : ` The other ${others} ${otherNoun} are closed.`;
    parts.push(`<p class="lead">Flowing in this case: ${esc(open.map((n) => n.label).join(', '))}.${closedText}</p>`);
    parts.push(
      `<h3>Flowing ${noun}</h3>${table(
        [
          col<NodeResult>('id', open.every((n) => n.kind === 'hydrant') ? 'Hydrant' : 'Outlet', (r) => r.label),
          col<NodeResult>('p', 'Residual pressure, bar', (r) => fix(r.pressureBar, 2), true),
          col<NodeResult>('rp', 'Required, bar', (r) => r.requiredPressureBar, true),
          col<NodeResult>('q', 'Flow, LPM', (r) => num(r.outletFlowLpm), true),
          col<NodeResult>('rq', 'Required, LPM', (r) => r.requiredFlowLpm, true),
          col<NodeResult>('m', 'Margin', (r) => (r.margin === null ? null : percent(r.margin)), true),
          col<NodeResult>('s', 'Result', (r) => resultText(r.status)),
        ],
        open,
      )}<p class="note">Margin is the smaller surplus over the required pressure or flow. A negative margin means the requirement is not met.</p>`,
    );
  } else {
    parts.push('<p class="lead">All hydrants are closed in this case, so the pressures below are static pressures.</p>');
  }

  parts.push(
    `<h3>Pressure at each node</h3>${table(
      [
        col<NodeResult>('id', 'Node', (r) => r.label),
        col<NodeResult>('kind', 'Type', (r) => KIND_TEXT[r.kind]),
        col<NodeResult>('elev', 'Elevation, m', (r) => r.elevationM.toFixed(1), true),
        col<NodeResult>('pm', 'Pressure, m', (r) => fix(r.pressureM, 1), true),
        col<NodeResult>('pb', 'Pressure, bar', (r) => fix(r.pressureBar, 2), true),
        // Flowing outlets are reported above, so only other draw-offs (base demands) appear here.
        col<NodeResult>('q', 'Other draw-off, LPM', (r) =>
          r.status !== 'pass' && r.status !== 'fail' && r.outflowLpm > 0.05 ? num(r.outflowLpm) : '', true),
      ],
      byLabel(results.nodes),
      { dropEmpty: true },
    )}`,
  );

  const flowing = (r: PipeResult) => Math.abs(r.flowLpm) >= 0.05;
  const anyOdd = results.pipes.some((r) => r.heldByCheckValve || !r.connected);
  const velocityLimit = project.settings.velocityLimitMs;
  parts.push(
    `<h3>Flow in each pipe</h3>${table(
      [
        col<PipeResult>('id', 'Pipe', (r) => r.label),
        ...(anyOdd
          ? [
              col<PipeResult>('state', 'State', (r) =>
                r.heldByCheckValve ? 'Held shut by non-return valve' : r.connected ? 'Open' : r.status === 'open' ? 'Isolated' : 'Closed',
              ),
            ]
          : []),
        col<PipeResult>('dir', 'Flow direction', (r) => (flowing(r) ? `${labels.get(r.upstreamId)} → ${labels.get(r.downstreamId)}` : 'No flow')),
        col<PipeResult>('d', 'Internal dia., mm', (r) => r.diameterMm, true),
        col<PipeResult>('q', 'Flow, LPM', (r) => num(Math.abs(r.flowLpm)), true),
        col<PipeResult>('v', 'Velocity, m/s', (r) => `${r.velocityMs.toFixed(2)}${r.velocityExceeded ? ' ▲' : ''}`, true),
        col<PipeResult>('hf', 'Head loss, m', (r) => r.headLossM.toFixed(2), true),
        col<PipeResult>('l100', 'Loss per 100 m', (r) => r.lossPer100M.toFixed(2), true),
        col<PipeResult>('l', 'Length, m', (r) => num(r.lengthM, 1), true),
        col<PipeResult>('leq', 'Equiv. length, m', (r) => r.equivalentLengthM.toFixed(1), true),
      ],
      byLabel(results.pipes),
    )}${results.pipes.some((r) => r.velocityExceeded) ? `<p class="note">▲ Velocity above the ${velocityLimit} m/s limit.</p>` : ''}<p class="note">Equivalent length is the pipe length plus the allowance for fittings and valves on it.</p>`,
  );

  if (path) {
    const target = labels.get(path.targetId) ?? '';
    const totalLoss = path.segments.reduce((s, x) => s + x.headLossM, 0);
    parts.push(
      `<h3>Critical path</h3><p>The route from the pump to ${esc(target)}, the flowing outlet with the lowest margin. Total friction loss along it is ${totalLoss.toFixed(2)} m.</p>${table(
        [
          col<CriticalPathSegment>('seg', 'From → to', (r) => `${r.fromLabel} → ${r.toLabel}`),
          col<CriticalPathSegment>('pipe', 'Pipe', (r) => r.label),
          col<CriticalPathSegment>('l', 'Length, m', (r) => num(r.lengthM, 1), true),
          col<CriticalPathSegment>('leq', 'Equiv. length, m', (r) => r.equivalentLengthM.toFixed(1), true),
          col<CriticalPathSegment>('q', 'Flow, LPM', (r) => num(r.flowLpm), true),
          col<CriticalPathSegment>('hf', 'Head loss, m', (r) => r.headLossM.toFixed(2), true),
          col<CriticalPathSegment>('p', 'Pressure at end, bar', (r) => r.pressureAfterBar.toFixed(2), true),
        ],
        path.segments,
      )}`,
    );
  }
  return parts.join('\n');
}

function requirementSection(rows: RequirementRow[]): string {
  const beyond = rows.some((r) => r.beyondCurve);
  const noun = outletNoun(rows.map((r) => r.kind), 1);
  return `<p class="lead">Each ${noun} was analysed flowing on its own, with every other outlet closed, on the actual pump curve. The pump head needed is the head at which the ${noun} just meets both its minimum pressure and its minimum flow; the margin is the head available from the pump less the head needed.</p>
${table(
  [
    col<RequirementRow>('id', noun === 'hydrant' ? 'Hydrant' : 'Outlet', (r) => r.label),
    col<RequirementRow>('res', 'Residual pressure, bar', (r) => fix(r.residualBar, 2), true),
    col<RequirementRow>('q', 'Flow, LPM', (r) => num(r.flowLpm), true),
    col<RequirementRow>('minp', 'Min. pressure, bar', (r) => r.minPressureBar, true),
    col<RequirementRow>('minq', 'Min. flow, LPM', (r) => r.minFlowLpm, true),
    col<RequirementRow>('reqp', 'Pressure needed, bar', (r) => r.requiredPressureBar.toFixed(2), true),
    col<RequirementRow>('fr', 'Friction loss, m', (r) => fix(r.frictionM, 2), true),
    col<RequirementRow>('need', 'Pump head needed, m', (r) => fix(r.pumpHeadNeededM, 1), true),
    col<RequirementRow>('avail', 'Pump head available, m', (r) => {
      const v = fix(r.pumpHeadAvailableM, 1);
      return v !== null && r.beyondCurve ? `${v} ▲` : v;
    }, true),
    col<RequirementRow>('margin', 'Margin, m', (r) => fix(r.marginM, 1), true),
    col<RequirementRow>('pass', 'Result', (r) => passFail(r.pass)),
  ],
  [...rows].sort((a, b) => naturalCompare(a.label, b.label)),
)}
${beyond ? '<p class="note">▲ Beyond the last point of the pump curve; the head is extrapolated.</p>' : ''}`;
}

const PUMP_LIMIT_REASON = 'Pump beyond last curve point';

/** Combination failure reasons in report wording. */
function comboReason(reason: string): string {
  if (reason === PUMP_LIMIT_REASON) return 'Pump beyond the end of its curve';
  if (reason === 'Did not converge') return 'Analysis did not converge';
  return reason;
}

/** Why a single hydrant fails in the capacity search, when every one fails the same way. */
function singleHydrantFailure(capacity: CapacityResult): string {
  const singles = capacity.combos.filter((c) => c.count === 1 && !c.pass);
  if (singles.length > 0 && singles.every((c) => c.reason === PUMP_LIMIT_REASON)) {
    return ', because a single hydrant already draws more flow than the last point of the pump curve';
  }
  return '';
}

/** One-line result of the capacity search for the summary. */
function capacityFinding(capacity: CapacityResult): string {
  if (capacity.maxSimultaneous === 0) {
    return `no combination of hydrants meets the requirement${singleHydrantFailure(capacity)}.`;
  }
  const any = capacity.guaranteedK > 0 ? `; any ${plural(capacity.guaranteedK, 'hydrant')} together ${capacity.guaranteedK === 1 ? 'meets' : 'meet'} it, whichever are chosen` : '';
  return `up to ${plural(capacity.maxSimultaneous, 'hydrant')} can flow together and meet the requirement${any}.`;
}

function capacitySection(capacity: CapacityResult): string {
  const labels = (c: Combo): string => c.members.map((m) => capacity.hydrants[m].label).join(', ');
  const items: string[] = [];
  if (capacity.maxSimultaneous > 0) {
    const exact = capacity.maxExact || capacity.method === 'exhaustive';
    items.push(
      `Up to <strong>${capacity.maxSimultaneous}</strong> hydrants can flow at the same time and all meet the minimum pressure and flow${capacity.bestCombo ? `, for example ${esc(labels(capacity.bestCombo))}` : ''}.${exact ? '' : ' This is the best combination found; a better one may exist.'}`,
    );
    if (capacity.guaranteedK > 0) {
      items.push(
        `Any combination of up to <strong>${capacity.guaranteedK}</strong> hydrants meets the requirement, whichever hydrants are chosen.${capacity.guaranteedExact ? '' : ' This figure is estimated from the least favourable combinations.'}`,
      );
    } else {
      items.push('Some hydrants do not meet the requirement even when flowing alone.');
    }
  } else {
    items.push(`No combination of hydrants meets the minimum pressure and flow${esc(singleHydrantFailure(capacity))}.`);
  }
  const worst = capacity.worstForK;
  if (worst) {
    items.push(
      `Least favourable combination of ${worst.count} hydrants (${esc(labels(worst))}): ${worst.pass ? 'meets' : 'does not meet'} the requirement, margin ${percent(worst.margin)}.`,
    );
  }
  const farthest = capacity.kFarthest;
  if (farthest) {
    items.push(
      `The ${farthest.count} most remote hydrants together (${esc(labels(farthest))}): ${farthest.pass ? 'meet' : 'do not meet'} the requirement, margin ${percent(farthest.margin)}.`,
    );
  }
  const excluded =
    capacity.excluded.length > 0
      ? `<p class="note">Not included, as they have no supply path from the pump: ${esc(capacity.excluded.join(', '))}.</p>`
      : '';
  const rows = capacity.combos.slice(0, 25);
  return `<p class="lead">Combinations of hydrants flowing together were analysed on the pump curve. ${num(capacity.evaluated)} combinations were solved${capacity.method === 'exhaustive' ? ', covering every possible combination' : ''}.</p>
<ul class="findings">${items.map((i) => `<li>${i}</li>`).join('')}</ul>
${excluded}
<h3>Least favourable combinations</h3>
${table(
  [
    col<Combo>('k', 'Flowing', (c) => c.count, true),
    col<Combo>('members', 'Hydrants', (c) => labels(c)),
    col<Combo>('crit', 'Critical hydrant', (c) => capacity.hydrants[c.critical].label),
    col<Combo>('margin', 'Margin', (c) => percent(c.margin), true),
    col<Combo>('q', 'Pump flow, LPM', (c) => num(c.pumpFlowLpm), true),
    col<Combo>('h', 'Pump head, m', (c) => c.pumpHeadM.toFixed(1), true),
    col<Combo>('status', 'Result', (c) => passFail(c.pass)),
    col<Combo>('why', 'Reason', (c) => comboReason(c.reason)),
  ],
  rows,
  { dropEmpty: true },
)}
<p class="note">${rows.length < capacity.combos.length ? `The ${rows.length} combinations with the lowest margin are shown. ` : ''}Margin is the smallest surplus over the required pressure or flow among the flowing hydrants.</p>`;
}

function scenarioChanges(project: Project, s: Scenario): string {
  const parts: string[] = [];
  const closedPipes = project.pipes.filter((p) => s.pipeStatus?.[p.id] === 'closed' && p.status !== 'closed').map((p) => p.label);
  const openedPipes = project.pipes.filter((p) => s.pipeStatus?.[p.id] === 'open' && p.status === 'closed').map((p) => p.label);
  const valves = project.pipes.flatMap((p) => p.valves ?? []);
  const closedValves = valves.filter((v) => s.valveStatus?.[v.id] === 'closed' && v.status !== 'closed').map((v) => v.label);
  const openedValves = valves.filter((v) => s.valveStatus?.[v.id] === 'open' && v.status === 'closed').map((v) => v.label);
  if (closedPipes.length) parts.push(`${listText(closedPipes, 6)} closed`);
  if (openedPipes.length) parts.push(`${listText(openedPipes, 6)} opened`);
  if (closedValves.length) parts.push(`valve ${listText(closedValves, 6)} closed`);
  if (openedValves.length) parts.push(`valve ${listText(openedValves, 6)} opened`);
  if (s.globalC !== undefined) parts.push(`C = ${s.globalC} on all pipes`);
  else if (s.pipeC && Object.keys(s.pipeC).length > 0) parts.push(`C changed on ${plural(Object.keys(s.pipeC).length, 'pipe')}`);
  return parts.join('; ');
}

/** A comparison value with the decimals its unit calls for: 7.53 bar, 3,847 LPM, 110.0 m. */
function compareValue(label: string, v: string | number): string {
  if (typeof v !== 'number') return v;
  if (label.endsWith(', bar')) return v.toFixed(2);
  if (label.endsWith(', m/s')) return v.toFixed(2);
  if (label.endsWith(', LPM')) return num(v);
  if (label.endsWith(', m')) return v.toFixed(1);
  return num(v);
}

function scenariosSection(project: Project): string {
  const flowing = (s: Scenario) =>
    project.nodes
      .filter((n) => n.outlet && (s.hydrantOn?.[n.id] ?? n.outlet.on))
      .map((n) => n.label)
      .sort(naturalCompare);
  const list = table(
    [
      col<Scenario>('name', 'Scenario', (s) => s.name),
      col<Scenario>('open', 'Flowing', (s) => listText(flowing(s), 10) || 'None'),
      col<Scenario>('changes', 'Other changes', (s) => scenarioChanges(project, s)),
      col<Scenario>('notes', 'Description', (s) => s.notes ?? ''),
    ],
    project.scenarios,
    { dropEmpty: true },
  );
  const c = compareScenarios(project, project.scenarios);
  const outletKinds = project.nodes.filter((n) => n.outlet).map((n) => n.kind);
  const one = outletNoun(outletKinds, 1);
  const many = outletNoun(outletKinds, 2);
  const capital = (s: string) => s[0].toUpperCase() + s.slice(1);
  const head = ['', ...c.columns.map((x) => x.name)]
    .map((h, i) => `<th class="${i ? 'num' : ''}">${esc(h)}</th>`)
    .join('');
  const body = c.rows
    .map(
      (r) =>
        `<tr><td>${esc(
          r.label
            .replace('Critical outlet', `Critical ${one}`)
            .replace('Outlets passing', `${capital(many)} meeting requirement`)
            .replace('Outlets failing', `${capital(many)} below requirement`),
        )}</td>${r.values
          .map((v) => `<td class="num">${v === null ? '–' : esc(compareValue(r.label, v))}</td>`)
          .join('')}</tr>`,
    )
    .join('');
  return `<p class="lead">The following operating scenarios were analysed in addition to the case above.</p>
${list}
<h3>Comparison</h3>
<table class="compare"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

/* ------------------------------------------------------------------ */
/* Design basis                                                        */
/* ------------------------------------------------------------------ */

interface BasisRow {
  item: string;
  value: string;
  source: string;
}

/** One value when every item shares it, otherwise each value with where it applies. */
function valueOrList(entries: { value: string; label: string }[]): string {
  const groups = new Map<string, string[]>();
  for (const e of entries) groups.set(e.value, [...(groups.get(e.value) ?? []), e.label]);
  if (groups.size === 1) return [...groups.keys()][0];
  return [...groups.entries()].map(([v, labels]) => `${v} (${listText(labels.sort(naturalCompare), 6)})`).join('; ');
}

function outletText(o: Outlet): string {
  const double = o.outlets === 2 ? 'Double outlet, each ' : '';
  if (o.model === 'fixed') return `${double}${o.fixedFlowLpm} LPM fixed flow`;
  const hose = o.hoseLengthM > 0 ? `${o.hoseLengthM} m × ${o.hoseDiameterMm} mm hose (C ${o.hoseC})` : 'no hose';
  return `${double}${o.nozzleMm} mm nozzle (Cd ${o.cd}), ${o.valveDiameterMm} mm landing valve (K ${o.valveK}), ${hose}`;
}

/**
 * The parts of a material-table source that cover the sizes in use, so
 * "IS 1239 (to 150 NB); IS 3589 (200 NB)" reads "IS 1239 (to 150 NB)" for 150 NB pipe.
 */
function materialSource(source: string, sizes: number[]): string {
  const parts = source.split(/;\s*/).filter((part) => {
    const upTo = part.match(/\(to (\d+) NB\)/);
    if (upTo) return sizes.some((s) => s <= Number(upTo[1]));
    const exact = part.match(/\((\d+) NB\)/);
    if (exact) return sizes.includes(Number(exact[1]));
    return true;
  });
  return parts.length > 0 ? parts.join('; ') : source;
}

/** Highest flow on the entered pump curve, or null for a constant-head pump. */
function lastCurveFlow(p: Pump): number | null {
  if (p.curve.kind === 'threePoint') return p.curve.overloadFlowLpm;
  if (p.curve.kind === 'table') return Math.max(...p.curve.points.map((x) => x.flowLpm));
  return null;
}

/** The values the analysis rests on, limited to what this network uses. */
function designBasis(project: Project, results: SolveResults): BasisRow[] {
  const s = project.settings;
  const rows: BasisRow[] = [];
  const add = (item: string, value: string, source = '') => rows.push({ item, value, source });
  const hw = s.frictionModel === 'hazenWilliams';
  const leq = s.fittingMethod === 'equivalentLength';
  const pipes = [...project.pipes].sort((a, b) => naturalCompare(a.label, b.label));

  add(
    'Calculation',
    `Steady-state network analysis, ${hw ? 'Hazen-Williams' : 'Darcy-Weisbach (Swamee-Jain)'} friction`,
    'Global Gradient Algorithm, as used in EPANET',
  );
  add('Pressure', `1 bar = ${s.mPerBar} m of water`);

  const sizes = pipeSchedule(project);
  add(
    'Pipe internal diameter',
    sizes.map((r) => `${r.custom ? `special ${r.size} mm` : `${r.size} NB`}: ${r.internalDiameters.join(' / ')} mm`).join('; '),
    sizes.every((r) => r.custom) ? 'Project data' : materialSource(project.tables.material.source, sizes.filter((r) => !r.custom).map((r) => r.size)),
  );
  if (hw) {
    const cs = new Set(pipes.map((p) => p.c));
    add('Hazen-Williams C', valueOrList(pipes.map((p) => ({ value: String(p.c), label: p.label }))), cs.size === 1 && cs.has(120) ? 'New steel' : 'Project data');
  } else {
    add('Pipe roughness', valueOrList(pipes.map((p) => ({ value: `${p.roughnessMm} mm`, label: p.label }))));
    add('Water viscosity', `${s.kinematicViscosityM2s} m²/s`, 'Water near 20 °C');
  }

  const counted = countedFittings(project);
  const valves = pipes.flatMap((p) => (p.valves ?? []).map((v) => ({ p, type: VALVE_FITTING[v.type] })));
  const used = project.tables.fittings.filter(
    (row) => pipes.some((p) => (counted.get(p.id) ?? []).some((f) => f.type === row.type)) || valves.some((v) => v.type === row.type),
  );
  const customs = pipes.flatMap((p) => p.fittings.filter((f) => f.type === 'custom').map((f) => ({ p, f })));
  if (used.length > 0 || customs.length > 0) {
    const scaled = leq && hw && s.applyCFactorToFittings && pipes.some((p) => p.c !== 120);
    add(
      'Fitting losses',
      leq ? `Equivalent length of pipe for each fitting${scaled ? ', adjusted for C other than 120' : ''}` : 'Loss coefficient K for each fitting, h = K V²/2g',
      scaled ? 'NFPA 13' : '',
    );
    if (s.autoFittings) add('Tees and bends', 'Found from the drawing at each junction and added to the pipes they join');
    for (const row of used) {
      const sizesUsed = [
        ...new Set([
          ...pipes.filter((p) => (counted.get(p.id) ?? []).some((f) => f.type === row.type)).map(pipeSize),
          ...valves.filter((v) => v.type === row.type).map((v) => pipeSize(v.p)),
        ]),
      ].sort((a, b) => b - a);
      const value = sizesUsed
        .map((size) => (leq ? `${lookupBySize(row.leqM, size).toFixed(1)} m at ${size} NB` : `K ${lookupBySize(row.k, size).toFixed(2)} at ${size} NB`))
        .join('; ');
      add(row.name, value, row.source.replace(/L_eq/g, 'equivalent length'));
    }
    for (const { p, f } of customs) {
      add(`Other fitting on ${p.label}`, f.customMode === 'k' ? `K ${f.customValue}` : `${f.customValue} m equivalent length`, 'Project data');
    }
  }
  add('Velocity limit', `${s.velocityLimitMs} m/s`);

  for (const [kind, name] of [
    ['hydrant', 'Hydrant'],
    ['hoseReel', 'Hose reel'],
  ] as const) {
    const outlets = project.nodes.filter((n) => n.kind === kind && n.outlet).sort((a, b) => naturalCompare(a.label, b.label));
    if (outlets.length === 0) continue;
    const o = (n: (typeof outlets)[number]) => n.outlet as Outlet;
    add(`${name} outlet`, valueOrList(outlets.map((n) => ({ value: outletText(o(n)), label: n.label }))));
    add(
      `${name} requirement`,
      valueOrList(outlets.map((n) => ({ value: `${o(n).minPressureBar} bar residual pressure and ${o(n).minFlowLpm} LPM per outlet`, label: n.label }))),
    );
  }

  for (const pump of project.pumps) {
    const extras: string[] = [];
    if (pump.suctionLossM) extras.push(`suction loss ${pump.suctionLossM} m`);
    if (pump.waterLevelM) extras.push(`water level ${pump.waterLevelM} m relative to the pump`);
    const last = lastCurveFlow(pump);
    if (results.ok && last !== null && results.system.pumpFlowLpm > last) extras.push(`extended in a straight line beyond ${num(last)} LPM`);
    add(pump.label, [curveText(pump), ...extras].join('; '), 'Project data');
  }
  return rows;
}

function basisTable(rows: BasisRow[]): string {
  const body = rows.map((r) => `<tr><td>${esc(r.item)}</td><td>${esc(r.value)}</td><td>${esc(r.source)}</td></tr>`).join('');
  return `<table class="basis"><thead><tr><th>Item</th><th>Value used</th><th>Source</th></tr></thead><tbody>${body}</tbody></table>`;
}

/* ------------------------------------------------------------------ */
/* Drawing legend                                                      */
/* ------------------------------------------------------------------ */

function legendHtml(project: Project, results: SolveResults, path: CriticalPath | null): string {
  const icon = (svg: string) => `<svg width="24" height="14" viewBox="0 0 24 14" aria-hidden="true">${svg}</svg>`;
  const items: string[] = [];
  const used = new Set(project.pipes.map((p) => diameterClass(p).label));
  for (const c of [...DIAMETER_CLASSES, CUSTOM_CLASS]) {
    if (!used.has(c.label)) continue;
    items.push(`${icon(`<line x1="1" y1="7" x2="23" y2="7" stroke="${c.color}" stroke-width="${c.width}" stroke-linecap="round"/>`)}${esc(c.label === 'Custom' ? 'Special size' : `${c.label} NB`)}`);
  }
  if (project.pipes.some((p) => p.status === 'closed' || (p.valves ?? []).some((v) => v.status === 'closed'))) {
    items.push(`${icon(`<line x1="1" y1="7" x2="23" y2="7" stroke="${STATUS.muted}" stroke-width="3" stroke-dasharray="5 4"/>`)}Closed pipe`);
  }
  if (path) items.push(`${icon('<line x1="2" y1="7" x2="22" y2="7" stroke="#f7c948" stroke-width="9" stroke-linecap="round"/>')}Critical path`);
  if (project.pumps.length > 0) {
    items.push(`${icon('<circle cx="12" cy="7" r="6" fill="#1c1b19"/><path d="M 9.5 3.8 L 15.8 7 L 9.5 10.2 Z" fill="#fff"/>')}Pump`);
  }
  if (project.nodes.some((n) => n.kind === 'junction')) items.push(`${icon('<circle cx="12" cy="7" r="2.6" fill="#52514e"/>')}Junction`);
  const statuses = new Set(results.nodes.filter((n) => n.kind !== 'junction').map((n) => n.status ?? 'off'));
  const kinds = new Set(project.nodes.map((n) => n.kind));
  const shape = (fill: string) =>
    kinds.has('hydrant')
      ? `<circle cx="12" cy="7" r="5.5" fill="${fill}" stroke="#52514e" stroke-width="1.5"/>`
      : `<rect x="8" y="3" width="8" height="8" transform="rotate(45 12 7)" fill="${fill}" stroke="#52514e" stroke-width="1.5"/>`;
  if (statuses.has('pass')) items.push(`${icon(shape(STATUS.good))}Flowing, meets requirement`);
  if (statuses.has('fail')) items.push(`${icon(shape(STATUS.critical))}Flowing, below requirement`);
  if (statuses.has('off')) items.push(`${icon(shape('#ffffff'))}Closed`);
  if (kinds.has('hydrant') && kinds.has('hoseReel')) {
    items.push(`${icon('<circle cx="12" cy="7" r="5.5" fill="#fff" stroke="#52514e" stroke-width="1.5"/>')}Hydrant`);
    items.push(`${icon('<rect x="8" y="3" width="8" height="8" transform="rotate(45 12 7)" fill="#fff" stroke="#52514e" stroke-width="1.5"/>')}Hose reel`);
  }
  const valves = project.pipes.flatMap((p) => p.valves ?? []);
  if (valves.some((v) => v.type !== 'nonReturn')) {
    items.push(`${icon('<path d="M 5 1.5 L 19 12.5 L 19 1.5 L 5 12.5 Z" fill="#fff" stroke="#1c1b19" stroke-width="1.4"/>')}Valve, open (filled when closed)`);
  }
  if (valves.some((v) => v.type === 'nonReturn')) {
    items.push(`${icon('<path d="M 6 1.5 L 17 7 L 6 12.5 Z" fill="#fff" stroke="#1c1b19" stroke-width="1.4"/><path d="M 18.5 1 L 18.5 13" stroke="#1c1b19" stroke-width="2"/>')}Non-return valve`);
  }
  return `<div class="legend">${items.map((i) => `<span>${i}</span>`).join('')}</div>`;
}

/* ------------------------------------------------------------------ */
/* Method, assumptions and limitations                                 */
/* ------------------------------------------------------------------ */

const sub = (s: string) => `<sub>${s}</sub>`;
const sup = (s: string) => `<sup>${s}</sup>`;

/** Formulas, assumptions and limitations, limited to the methods this project uses. */
function methodSection(project: Project, results: SolveResults, client: string): string {
  const s = project.settings;
  const hw = s.frictionModel === 'hazenWilliams';
  const leq = s.fittingMethod === 'equivalentLength';
  const outlets = project.nodes.filter((n) => n.outlet).map((n) => n.outlet as Outlet);
  const nozzles = outlets.some((o) => o.model === 'emitter');
  const fixed = outlets.some((o) => o.model === 'fixed');
  const hose = outlets.some((o) => o.model === 'emitter' && o.hoseLengthM > 0);
  const scaled = leq && hw && s.applyCFactorToFittings && project.pipes.some((p) => p.c !== 120);
  const elevations = new Set(project.nodes.map((n) => n.elevationM));
  const pump = project.pumps[0];
  const lastFlow = pump ? lastCurveFlow(pump) : null;
  const beyond = results.ok && lastFlow !== null && results.system.pumpFlowLpm > lastFlow;
  const totals = fittingTotals(nodeConnections(project));
  const valves = project.pipes.some((p) => (p.valves ?? []).length > 0);
  const allNewSteel = project.pipes.every((p) => p.c === 120);

  const formulas: [string, string][] = [
    ['Flow continuity at each node', `Σ Q${sub('in')} − Σ Q${sub('out')} = q${sub('node')}`],
    ['Energy balance along each pipe', `H${sub('i')} − H${sub('j')} = h${sub('f')}${leq ? '' : ` + h${sub('m')}`}`],
  ];
  if (hw) {
    formulas.push(['Pipe friction, Hazen-Williams', `h${sub('f')} = 10.67 · L${sub('e')} · Q${sup('1.852')} / (C${sup('1.852')} · D${sup('4.87')})`]);
  } else {
    formulas.push(['Pipe friction, Darcy-Weisbach', `h${sub('f')} = f · (L${sub('e')} / D) · V${sup('2')} / 2g`]);
    formulas.push(['Friction factor, Swamee-Jain', `f = 0.25 / [log${sub('10')}(ε / 3.7D + 5.74 / Re${sup('0.9')})]${sup('2')},  Re = V D / ν`]);
  }
  formulas.push(
    leq
      ? ['Fitting losses as equivalent length', `L${sub('e')} = L + Σ n${sub('i')} · L${sub('i')}${scaled ? ' · m(C)' : ''}`]
      : ['Fitting losses by loss coefficient', `h${sub('m')} = Σ K · V${sup('2')} / 2g`],
  );
  formulas.push(['Flow velocity', `V = 4Q / (π D${sup('2')})`]);
  if (nozzles) {
    formulas.push([
      'Hydrant discharge through landing valve and nozzle',
      `H = (q${sup('2')} / 2g) · [1 / (C${sub('d')}${sup('2')} A${sub('n')}${sup('2')}) + K${sub('v')} / A${sub('v')}${sup('2')}]${hose ? ` + h${sub('hose')}` : ''}`,
    ]);
  }
  if (fixed) formulas.push(['Fixed-demand outlet', `q = q${sub('fixed')} for any positive pressure`]);
  formulas.push(['Residual pressure', `p = (H − z) / ${s.mPerBar}`]);
  if (pump) formulas.push(['Pump head', `H${sub('p')}(Q) fitted by least squares through the curve points${beyond ? ', extended in a straight line beyond the last point' : ''}`]);
  formulas.push(['Acceptance', `p ≥ p${sub('min')} and q ≥ q${sub('min')};  margin = min[(p − p${sub('min')}) / p${sub('min')}, (q − q${sub('min')}) / q${sub('min')}]`]);

  const notation: [string, string][] = [
    ['H, z', 'Total head and elevation at a node, m'],
    ['Q, q', 'Flow in a pipe, and flow per outlet, m³/s'],
    ['h' + sub('f'), 'Friction head loss in a pipe, m'],
    ...(leq ? [] : ([['h' + sub('m'), 'Head loss through fittings, m']] as [string, string][])),
    ['L, L' + sub('e'), 'Pipe length, and length including fitting allowance, m'],
    ...(leq
      ? ([[`n${sub('i')}, L${sub('i')}`, 'Number of fittings of each type, and the equivalent length of one, m']] as [string, string][])
      : ([['K', 'Loss coefficient of a fitting']] as [string, string][])),
    ...(scaled ? ([['m(C)', 'NFPA 13 multiplier for C other than 120']] as [string, string][]) : []),
    ['D, V', 'Internal diameter, m, and mean velocity, m/s'],
    ...(hw
      ? ([['C', 'Hazen-Williams roughness coefficient']] as [string, string][])
      : ([
          ['f, ε', 'Darcy friction factor, and pipe roughness, m'],
          ['Re, ν', 'Reynolds number, and kinematic viscosity of water, m²/s'],
        ] as [string, string][])),
    ['g', `Gravitational acceleration, ${s.gravity} m/s²`],
    ...(nozzles
      ? ([
          [`C${sub('d')}, A${sub('n')}`, 'Nozzle discharge coefficient and bore area, m²'],
          [`K${sub('v')}, A${sub('v')}`, 'Landing valve loss coefficient and bore area, m²'],
        ] as [string, string][])
      : []),
    ...(hose ? ([[`h${sub('hose')}`, 'Friction loss in the hose, by Hazen-Williams, m']] as [string, string][]) : []),
    ['p', 'Residual pressure, bar'],
    [`p${sub('min')}, q${sub('min')}`, 'Minimum residual pressure and flow per outlet'],
  ];

  const assumptions = [
    'The network operates in steady state with water at about 20 °C; every pipe runs full.',
    `Pipe sizes, internal diameters, lengths and C values are as listed in Design inputs and Design basis${allNewSteel && hw ? '; C = 120 represents new steel pipe' : ''}. No further allowance is made for deterioration of the pipe.`,
    s.autoFittings
      ? `Tees, bends and reducers are taken from the network drawing, and each adds its ${leq ? 'equivalent length' : 'loss coefficient'} to an adjoining pipe as listed in Design inputs.${totals.takeOffTees > 0 ? ' Each hydrant on the main is connected through a tee.' : ''}`
      : 'Fitting losses are those entered for each pipe, as listed in Design inputs.',
    elevations.size === 1
      ? `All nodes are at the same level (${[...elevations][0]} m), so no static head difference is included.`
      : 'Node elevations are as listed, and the static head difference between them is included.',
    ...(pump
      ? [
          `The pump delivers the head-flow curve given in Design basis${pump.suctionLossM ? `, less a suction loss of ${pump.suctionLossM} m` : ''}${pump.waterLevelM ? `, with the water level ${pump.waterLevelM} m relative to the pump` : ''}.${beyond ? ' In the case analysed the pump runs beyond the last point of its curve, where the curve is extended in a straight line.' : ''}`,
        ]
      : []),
    'Only the outlets stated as flowing draw water. No other demand, such as sprinklers or process use, is taken from the network at the same time.',
    ...(nozzles ? ['Each flowing hydrant discharges to atmosphere through its landing valve and nozzle as listed in Design basis.'] : []),
    ...(valves ? ['Valves are in the positions shown in Design inputs.'] : []),
  ];

  const limitations = [
    'The analysis is steady state. Transient effects such as water hammer from pump start, pump stop or valve closure are not assessed.',
    'Results are only as accurate as the input data. Pipe routes, lengths, fittings and elevations should be verified against the installation as built.',
    ...(pump ? ['Pump performance should be confirmed against the manufacturer’s certified test curve.'] : []),
    'The minimum residual pressure and flow used are listed in Design basis. They are to be confirmed against the applicable code (NBC 2016 Part 4, TAC, IS 13039, NFPA 14/24) and the requirements of the local fire authority.',
    'Ageing of the pipe, partly closed valves and blockages reduce capacity and are covered only to the extent of the C values used.',
    'Water storage capacity, the pump room and suction arrangement, pipe supports and thrust restraint, and electrical and control systems are outside the scope of this report.',
  ];

  const list = (items: string[]) => `<ol class="numbered">${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ol>`;
  const [mantissa, exponent] = s.headToleranceM.toExponential().split('e');
  const tolerance =
    s.headToleranceM >= 0.001 ? String(s.headToleranceM) : `${mantissa === '1' ? '' : `${mantissa} × `}10${sup(String(Number(exponent)).replace('-', '−'))}`;
  return `<p class="lead">The network is solved as a steady-state pipe network by the Global Gradient Algorithm (Todini and Pilati, 1988), the method used in EPANET. Flow continuity is satisfied at every node and energy balance along every pipe, and iteration continues until heads change by less than ${tolerance} m${results.ok ? `; this case converged in ${plural(results.iterations, 'iteration')}` : ''}.</p>
<h3>Formulas used</h3>
<table class="formulas"><tbody>${formulas
    .map(([what, f], i) => `<tr><td class="num">${i + 1}</td><td>${esc(what)}</td><td class="expr">${f}</td></tr>`)
    .join('')}</tbody></table>
<h3>Notation</h3>
<table class="notation"><tbody>${notation.map(([sym, meaning]) => `<tr><td class="expr">${sym}</td><td>${esc(meaning)}</td></tr>`).join('')}</tbody></table>
<h3>Assumptions</h3>
${list(assumptions)}
<h3>Limitations</h3>
${list(limitations)}
<p class="statement">This report has been prepared by ${esc(COMPANY)}${client ? ` for ${esc(client)}` : ''} on the basis of the data, assumptions and methods stated above, for the project named on the cover. It should be read as a whole.</p>`;
}

/* ------------------------------------------------------------------ */
/* Styles                                                              */
/* ------------------------------------------------------------------ */

/** Page styles. The two arguments are CSS strings for the running page header and footer. */
const styles = (pageHeader: string, footer: string) => `
  :root { --ink: #1c1b19; --muted: #5d5c58; --line: #d4d2ca; --rule: #e6e4dd; --soft: #f4f4f1; --brand: #16325c; }
  * { box-sizing: border-box; }
  html { background: #e9e8e3; }
  body { margin: 24px auto; max-width: 1040px; padding: 0 52px 52px; color: var(--ink); background: #fff;
    font: 12.5px/1.55 'Segoe UI', system-ui, -apple-system, sans-serif; box-shadow: 0 1px 6px rgba(0,0,0,.08);
    -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .toolbar { position: sticky; top: 0; z-index: 2; display: flex; justify-content: flex-end; margin: 0 -52px 28px; padding: 10px 52px;
    background: rgba(255,255,255,.95); border-bottom: 1px solid var(--line); }
  .toolbar button { height: 30px; padding: 0 14px; font: inherit; cursor: pointer; background: var(--brand); color: #fff; border: 0; border-radius: 4px; }

  .letterhead { display: flex; justify-content: space-between; align-items: flex-end; gap: 24px; padding-bottom: 12px; border-bottom: 3px solid var(--brand); }
  .company { font-size: 28px; font-weight: 700; letter-spacing: .24em; color: var(--brand); line-height: 1; }
  .doc-type { text-align: right; font-size: 11px; font-weight: 600; letter-spacing: .12em; text-transform: uppercase; color: var(--brand); }
  .doc-type span { display: block; font-weight: 400; letter-spacing: .06em; color: var(--muted); }
  .title-block { padding: 22px 0 6px; }
  .title-block .eyebrow { font-size: 11px; letter-spacing: .1em; text-transform: uppercase; color: var(--muted); }
  h1 { margin: 4px 0 4px; font-size: 26px; font-weight: 600; line-height: 1.25; }
  .doc-control { margin: 16px 0 0; }
  .doc-control th { width: 17%; background: var(--soft); font-weight: 600; border: 1px solid var(--line); }
  .doc-control td { width: 33%; border: 1px solid var(--line); }
  .doc-control th, .doc-control td { padding: 5px 8px; vertical-align: middle; }
  .contents-block { margin-top: 22px; padding-top: 10px; border-top: 1px solid var(--line); }
  .contents-block h2 { border: 0; margin-bottom: 4px; }
  .contents { margin: 0; padding: 0; list-style: none; columns: 2; column-gap: 32px; }
  .contents li { padding: 2px 0; break-inside: avoid; border-bottom: 1px dotted var(--rule); }
  .contents a { color: inherit; text-decoration: none; }
  .contents b { display: inline-block; width: 26px; font-weight: 600; color: var(--brand); }

  section { margin-top: 32px; }
  h2 { display: flex; gap: 12px; margin: 0 0 10px; padding-bottom: 5px; font-size: 14.5px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase;
    color: var(--brand); border-bottom: 1.5px solid var(--brand); break-after: avoid; }
  h2 b { font-weight: 700; }
  h3 { margin: 18px 0 6px; font-size: 12.5px; font-weight: 600; break-after: avoid; }
  p { margin: 6px 0; }
  .lead { margin-bottom: 10px; }
  .note { font-size: 11px; color: var(--muted); }
  .verdict { margin: 0 0 14px; padding: 11px 14px; border-left: 4px solid; font-size: 14.5px; font-weight: 600; }
  .verdict.pass { background: #e9f3e7; border-color: #0a7a0a; color: #0a5f0a; }
  .verdict.fail { background: #fbe9e8; border-color: #b3261e; color: #8f2020; }
  .facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin: 10px 0 14px; }
  .fact { padding: 9px 12px; background: var(--soft); border-left: 3px solid var(--brand); break-inside: avoid; }
  .fact span { display: block; font-size: 10.5px; letter-spacing: .04em; text-transform: uppercase; color: var(--muted); }
  .fact strong { display: block; font-size: 16px; font-weight: 600; }
  .fact small { display: block; font-size: 11px; color: var(--muted); }
  .findings { margin: 6px 0 10px; padding-left: 18px; }
  .findings li { margin: 4px 0; }
  .drawing { padding: 6px; border: 1px solid var(--line); break-inside: avoid; }
  .legend { display: flex; flex-wrap: wrap; gap: 6px 16px; margin: 8px 0; font-size: 11px; color: var(--muted); }
  .legend span { display: inline-flex; align-items: center; gap: 5px; }

  table { width: 100%; border-collapse: collapse; font-size: 11px; margin: 4px 0 8px; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; }
  th { padding: 5px 6px; text-align: left; vertical-align: bottom; font-weight: 600; background: var(--soft); border-bottom: 1px solid var(--ink); }
  td { padding: 3px 6px; vertical-align: top; border-bottom: 1px solid var(--rule); }
  td:first-child { white-space: nowrap; }
  tfoot td { font-weight: 600; border-top: 1px solid var(--ink); border-bottom: 0; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  td.pass { color: #0a6b0a; font-weight: 600; }
  td.fail { color: #a32020; font-weight: 600; }
  .schedule td:last-child { width: 50%; }
  .kv { width: auto; min-width: 55%; }
  .kv th { width: 230px; padding: 3px 24px 3px 0; font-weight: 400; color: var(--muted); background: none; border-bottom: 1px solid var(--rule); vertical-align: top; }
  .basis td:first-child { white-space: normal; width: 24%; font-weight: 600; }
  .basis td:last-child { width: 32%; color: var(--muted); }
  .formulas, .notation, .basis { break-inside: avoid; }
  .formulas td { padding: 5px 6px; vertical-align: middle; }
  .formulas td.num { width: 28px; color: var(--muted); }
  .formulas td:nth-child(2) { width: 34%; white-space: normal; }
  .expr { font-family: 'Cambria Math', Cambria, 'Times New Roman', serif; font-size: 13px; font-style: italic; }
  .notation { width: auto; min-width: 60%; }
  .notation td.expr { width: 110px; }
  .numbered { margin: 4px 0 10px; padding-left: 22px; }
  .numbered li { margin: 4px 0; padding-left: 2px; }
  .statement { margin-top: 18px; padding: 10px 12px; font-size: 11.5px; background: var(--soft); border-left: 3px solid var(--brand); }
  .chart { margin: 6px 0 14px; break-inside: avoid; }
  .chart svg { max-width: 100%; height: auto; }
  .issues { margin: 6px 0 12px; padding: 8px 12px 8px 30px; background: #fdf6e3; border-left: 3px solid #c98a00; }
  .issues li { margin: 2px 0; }
  .end { margin-top: 28px; text-align: center; font-size: 10.5px; letter-spacing: .14em; text-transform: uppercase; color: var(--muted); }

  @media (max-width: 720px) {
    body { margin: 0; padding: 0 16px 32px; }
    .toolbar { margin: 0 -16px 20px; padding: 10px 16px; }
    .letterhead { flex-direction: column; align-items: flex-start; }
    .doc-type { text-align: left; }
    .company { font-size: 22px; }
    .facts { grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); }
    .contents { columns: 1; }
    table { display: block; overflow-x: auto; }
  }
  @media print {
    html { background: none; }
    body { margin: 0; max-width: none; padding: 0; font-size: 11.5px; box-shadow: none; }
    .toolbar { display: none; }
    section { margin-top: 22px; }
    .contents-block { break-after: page; }
  }
  @page {
    size: A4;
    margin: 16mm 13mm 16mm;
    @top-left { content: ${cssString(COMPANY)}; font: 700 9px 'Segoe UI', sans-serif; letter-spacing: .2em; color: #16325c; }
    @top-right { content: ${pageHeader}; font: 9px 'Segoe UI', sans-serif; color: #777; }
    @bottom-left { content: ${footer}; font: 9px 'Segoe UI', sans-serif; color: #777; }
    @bottom-right { content: "Page " counter(page) " of " counter(pages); font: 9px 'Segoe UI', sans-serif; color: #777; }
  }
  @page :first {
    @top-left { content: none; }
    @top-right { content: none; }
  }
`;

/* ------------------------------------------------------------------ */
/* Report                                                              */
/* ------------------------------------------------------------------ */

export interface ReportInput {
  project: Project;
  results: SolveResults;
  /** Omitted when no current capacity search exists. */
  capacity: CapacityResult | null;
  generatedAt: Date;
}

interface Section {
  id: string;
  title: string;
  body: string;
}

/** Builds a self-contained, printable HTML report. Analyses that were not run are left out. */
export function buildReportHtml({ project, results, capacity, generatedAt }: ReportInput): string {
  const details = reportDetails(project);
  const path = results.ok ? criticalPath(project, results) : null;
  const outlets = results.nodes.filter((n) => n.kind !== 'junction');
  const open = outlets.filter((n) => n.status === 'pass' || n.status === 'fail').sort((a, b) => naturalCompare(a.label, b.label));
  const failing = open.filter((n) => n.status === 'fail');
  const critical = results.nodes.find((n) => n.id === results.system.criticalNodeId);
  const totals = fittingTotals(nodeConnections(project));
  const pipeLength = project.pipes.reduce((s, p) => s + p.lengthM, 0);
  const sizes = [...new Set(project.pipes.map((p) => (typeof p.nominalMm === 'number' ? `${p.nominalMm}` : 'special')))].join(', ');

  let requirement: RequirementRow[] = [];
  if (project.pumps.length > 0) {
    try {
      requirement = requirementCheck(project);
    } catch {
      requirement = [];
    }
  }
  const sections: Section[] = [];
  const add = (id: string, title: string, body: string) => sections.push({ id, title, body });

  /* Summary */
  const openNoun = (n: number) => outletNoun(open.map((x) => x.kind), n);
  let verdict = '';
  if (!results.ok) {
    verdict = '<div class="verdict fail" id="verdict">✕ The analysis did not reach a valid solution. Results in this report are not valid.</div>';
  } else if (open.length > 0) {
    verdict =
      failing.length === 0
        ? `<div class="verdict pass" id="verdict">✓ PASS: ${open.length === 1 ? `the flowing ${openNoun(1)} meets` : `all ${open.length} flowing ${openNoun(2)} meet`} the minimum residual pressure and flow</div>`
        : `<div class="verdict fail" id="verdict">✕ FAIL: ${failing.length} of ${open.length} flowing ${openNoun(open.length)} ${failing.length === 1 ? 'is' : 'are'} below the minimum (${esc(failing.map((n) => n.label).join(', '))})</div>`;
  } else if (requirement.length > 0) {
    const short = requirement.filter((r) => !r.pass);
    const noun = outletNoun(requirement.map((r) => r.kind), 2);
    verdict =
      short.length === 0
        ? `<div class="verdict pass" id="verdict">✓ PASS: every one of the ${requirement.length} ${noun} meets the minimum residual pressure and flow when flowing alone</div>`
        : `<div class="verdict fail" id="verdict">✕ FAIL: ${short.length} of ${requirement.length} ${noun} fall below the minimum when flowing alone</div>`;
  }

  const fastest = results.ok && results.pipes.length > 0 ? results.pipes.reduce((a, b) => (b.velocityMs > a.velocityMs ? b : a)) : null;
  const facts: [string, string, string][] = [];
  if (results.ok && project.pumps.length > 0) {
    facts.push(['Pump operating point', `${num(results.system.pumpFlowLpm)} LPM`, `at ${results.system.pumpHeadM.toFixed(1)} m (${results.system.pumpPressureBar.toFixed(2)} bar)`]);
  }
  if (results.ok && critical && open.length > 0) {
    facts.push([`Critical ${openNoun(1)}`, critical.label, `${fix(critical.pressureBar, 2)} bar, ${num(critical.outletFlowLpm)} LPM`]);
  }
  if (fastest && fastest.velocityMs > 0) {
    facts.push(['Highest velocity', `${fastest.velocityMs.toFixed(2)} m/s`, `in ${fastest.label}, limit ${project.settings.velocityLimitMs} m/s`]);
  }
  facts.push(['Network', plural(totals.junctions, 'junction'), `${plural(totals.tees + totals.takeOffTees, 'tee')}, ${plural(totals.bends, 'bend')}`]);

  const findings: string[] = [];
  if (results.ok && open.length > 0) {
    findings.push(
      `<strong>Case analysed:</strong> ${esc(listText(open.map((n) => n.label), 10))} flowing. ${
        failing.length > 0
          ? `${esc(failing.map((n) => n.label).join(', '))} ${failing.length === 1 ? 'is' : 'are'} below the minimum.`
          : open.length === 1
            ? `It meets the minimum residual pressure and flow, with ${fix(open[0].pressureBar, 2)} bar and ${num(open[0].outletFlowLpm)} LPM.`
            : `All meet the minimum residual pressure and flow; the critical ${openNoun(1)} is ${esc(critical?.label ?? '')} at ${fix(critical?.pressureBar, 2)} bar.`
      }`,
    );
  }
  if (requirement.length > 0) {
    const short = requirement.filter((r) => !r.pass).map((r) => r.label).sort(naturalCompare);
    const noun = outletNoun(requirement.map((r) => r.kind), 2);
    const minP = new Set(requirement.map((r) => r.minPressureBar));
    const minQ = new Set(requirement.map((r) => r.minFlowLpm));
    const criteria = minP.size === 1 && minQ.size === 1 ? `${[...minP][0]} bar and ${[...minQ][0]} LPM` : 'their minimum pressure and flow';
    findings.push(
      `<strong>Each ${outletNoun(requirement.map((r) => r.kind), 1)} alone:</strong> ${
        short.length === 0
          ? `all ${requirement.length} ${noun} meet ${criteria}.`
          : `${requirement.length - short.length} of ${requirement.length} ${noun} meet ${criteria}; ${esc(listText(short, 10))} ${short.length === 1 ? 'does' : 'do'} not.`
      }`,
    );
  }
  if (capacity) findings.push(`<strong>Simultaneous operation:</strong> ${esc(capacityFinding(capacity))}`);
  if (fastest && fastest.velocityMs > 0) {
    const limit = project.settings.velocityLimitMs;
    const over = results.pipes.filter((p) => p.velocityExceeded).length;
    findings.push(
      `<strong>Velocity:</strong> ${
        over === 0
          ? `the highest is ${fastest.velocityMs.toFixed(2)} m/s in ${esc(fastest.label)}, within the ${limit} m/s limit.`
          : `${plural(over, 'pipe')} ${over === 1 ? 'exceeds' : 'exceed'} the ${limit} m/s limit; the highest is ${fastest.velocityMs.toFixed(2)} m/s in ${esc(fastest.label)}.`
      }`,
    );
  }
  findings.push(
    `<strong>Network:</strong> ${num(pipeLength)} m of ${sizes} NB pipework with ${plural(totals.junctions, 'junction')}, ${plural(totals.tees, 'tee')} at junctions${totals.takeOffTees > 0 ? `, ${plural(totals.takeOffTees, 'outlet tee')}` : ''}${totals.crosses > 0 ? `, ${plural(totals.crosses, 'cross', 'crosses')}` : ''} and ${plural(totals.bends, 'bend')}.`,
  );

  const issues = results.issues.filter((i) => i.severity === 'error' || i.severity === 'warning');
  const issueHtml = issues.length
    ? `<ul class="issues">${issues.map((i) => `<li>${esc(clientMessage(i.message))}</li>`).join('')}</ul>`
    : '';

  add(
    'summary',
    'Executive summary',
    `${verdict}<div class="facts">${facts
      .map(([label, value, note]) => `<div class="fact"><span>${esc(label)}</span><strong>${esc(value)}</strong>${note ? `<small>${esc(note)}</small>` : ''}</div>`)
      .join('')}</div><ul class="findings">${findings.map((f) => `<li>${f}</li>`).join('')}</ul>${issueHtml}`,
  );

  const includeScenarios = project.scenarios.length > 0 && details.includeScenarios;
  add(
    'introduction',
    'Introduction',
    introductionSection(project, details, open.map((n) => n.label), requirement, capacity !== null, includeScenarios),
  );
  add('basis', 'Design basis', basisTable(designBasis(project, results)));

  add(
    'layout',
    'Network layout',
    `<div class="drawing">${networkSnapshot(project, results, path)}</div>${legendHtml(project, results, path)}${
      open.length > 0 ? '<p class="note">Pressures shown next to flowing outlets are residual pressures in the case analysed.</p>' : ''
    }`,
  );
  add('inventory', 'Network inventory', inventorySection(project, results));
  add('inputs', 'Design inputs', inputsSection(project));
  if (results.ok) add('results', 'Hydraulic results', resultsSection(project, results, path));

  const profile = path ?profileData(path, results, project.pumps[0]?.label ?? 'Pump') : null;
  if (profile) {
    add(
      'charts',
      'Pressure along the critical path',
      `<div class="chart" id="chart-profile">${renderToStaticMarkup(<PressureProfileChart data={profile} width={900} height={330} />)}</div>`,
    );
  }

  if (requirement.length > 0) {
    add('requirement', `Individual ${outletNoun(requirement.map((r) => r.kind), 1)} check`, requirementSection(requirement));
  }
  if (capacity) add('capacity', 'Simultaneous operation', capacitySection(capacity));
  if (includeScenarios) add('scenarios', 'Operating scenarios', scenariosSection(project));
  add('method', 'Method, assumptions and limitations', methodSection(project, results, details.client.trim()));

  // Cross-references such as "Section {{section:basis}}" take the final numbering.
  // A reference to a section the report leaves out is dropped with its brackets.
  const numbers = new Map(sections.map((s, i) => [s.id, String(i + 1)]));
  for (const s of sections) {
    s.body = s.body
      .replace(/ \(Section \{\{section:(\w+)\}\}\)/g, (_, id: string) => (numbers.has(id) ? ` (Section ${numbers.get(id)})` : ''))
      .replace(/\{\{section:(\w+)\}\}/g, (_, id: string) => numbers.get(id) ?? '–');
  }

  const date = generatedAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const text = (v: string) => v.trim();
  const revision = text(details.revision);
  // Only what has been entered, so a report with no details shows just the date.
  const control: [string, string][] = [
    ['Client', text(details.client)],
    ['Document no.', text(details.documentNo)],
    ['Site / location', text(details.site)],
    ['Revision', revision],
    ['Date of issue', date],
  ].filter(([, v]) => v !== '') as [string, string][];
  const controlRows: string[] = [];
  for (let i = 0; i < control.length; i += 2) {
    const [a, b] = [control[i], control[i + 1]];
    controlRows.push(
      b
        ? `<tr><th>${esc(a[0])}</th><td>${esc(a[1])}</td><th>${esc(b[0])}</th><td>${esc(b[1])}</td></tr>`
        : `<tr><th>${esc(a[0])}</th><td colspan="3">${esc(a[1])}</td></tr>`,
    );
  }
  const pageHeader = [project.name, text(details.documentNo), revision ? `Rev. ${revision}` : ''].filter(Boolean).join(' · ');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(project.name)} - hydraulic analysis report - ${esc(COMPANY)}</title>
<style>${styles(cssString(pageHeader), cssString(`${COMPANY} · Hydraulic analysis report`))}</style>
</head>
<body>
<div class="toolbar"><button onclick="window.print()">Print or save as PDF</button></div>
<header class="letterhead" id="letterhead">
  <div class="company">${esc(COMPANY)}</div>
  <div class="doc-type">Hydraulic analysis report<span>Fire hydrant system</span></div>
</header>
<div class="title-block">
  <div class="eyebrow">Project</div>
  <h1>${esc(project.name)}</h1>
  <table class="doc-control"><tbody>${controlRows.join('')}</tbody></table>
</div>
<div class="contents-block">
  <h2>Contents</h2>
  <ol class="contents">${sections.map((s, i) => `<li><a href="#${s.id}"><b>${i + 1}</b>${esc(s.title)}</a></li>`).join('')}</ol>
</div>
${sections.map((s, i) => `<section id="${s.id}"><h2><b>${i + 1}</b>${esc(s.title)}</h2>\n${s.body}\n</section>`).join('\n')}
<p class="end">End of report</p>
</body>
</html>`;
}
