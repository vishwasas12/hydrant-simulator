import { renderToStaticMarkup } from 'react-dom/server';
import type { CapacityResult, Combo } from '../analysis/capacity';
import { requirementCheck, type RequirementRow } from '../analysis/requirement';
import { compareScenarios } from '../analysis/scenarios';
import { CUSTOM_CLASS, DIAMETER_CLASSES, diameterClass, STATUS } from '../canvas/colors';
import { countedFittings, type AutoFitting } from '../model/junctions';
import type { Fitting, Outlet, Project, Pump, Scenario } from '../model/types';
import { PressureProfileChart, profileData, pumpSystemData, PumpSystemChart } from '../panels/charts';
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

/** Fixed decimals, or null when there is no value. */
const fix = (v: number | null | undefined, d: number): string | null =>
  v === null || v === undefined || !Number.isFinite(v) ? null : v.toFixed(d);

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

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
    return `Shut-off ${c.shutoffHeadM} m; rated ${c.ratedHeadM} m at ${c.ratedFlowLpm} LPM; ${c.overloadHeadM} m at ${c.overloadFlowLpm} LPM`;
  }
  if (c.kind === 'constant') return `Constant head ${c.headM} m`;
  return c.points.map((x) => `${x.headM} m at ${x.flowLpm} LPM`).join('; ');
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
    ['Pipework', `${totalLength.toFixed(0)} m`, plural(project.pipes.length, 'pipe')],
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
      col<PipeScheduleRow>('l', 'Total length, m', (r) => r.lengthM.toFixed(1), true),
    ],
    pipes,
    { totals: pipes.length > 1 ? { size: 'Total', n: project.pipes.length, l: totalLength.toFixed(1) } : undefined },
  );

  const fittingTable =
    fittings.length > 0
      ? table(
          [
            col<FittingScheduleRow>('name', 'Fitting', (r) => r.name),
            col<FittingScheduleRow>('size', 'Size, NB', (r) => r.size),
            col<FittingScheduleRow>('q', 'Quantity', (r) => r.quantity, true),
            col<FittingScheduleRow>('at', 'Location', (r) => r.locations.join(', ')),
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
    type N = (typeof outlets)[number];
    const o = (n: N) => n.outlet as Outlet;
    const mixedKinds = new Set(outlets.map((n) => n.kind)).size > 1;
    const anyDouble = outlets.some((n) => o(n).outlets !== 1);
    const elevations = new Set(outlets.map((n) => n.elevationM));
    const columns: Column<N>[] = [
      col<N>('id', mixedKinds ? 'Outlet' : KIND_TEXT[outlets[0].kind], (n) => n.label),
      ...(mixedKinds ? [col<N>('kind', 'Type', (n) => KIND_TEXT[n.kind])] : []),
      col<N>('state', 'In this case', (n) => (o(n).on ? 'Flowing' : 'Closed')),
      ...(anyDouble ? [col<N>('outlets', 'Outlets', (n) => o(n).outlets, true)] : []),
      col<N>('model', 'Discharge', (n) => dischargeText(o(n))),
      ...(elevations.size > 1 ? [col<N>('elev', 'Elevation, m', (n) => n.elevationM.toFixed(1), true)] : []),
      col<N>('minp', 'Min. pressure, bar', (n) => o(n).minPressureBar, true),
      col<N>('minq', 'Min. flow per outlet, LPM', (n) => o(n).minFlowLpm, true),
    ];
    const title = mixedKinds ? 'Hydrants and hose reels' : outlets[0].kind === 'hydrant' ? 'Hydrants' : 'Hose reels';
    const elevationNote = elevations.size === 1 ? `<p class="note">All ${outletNoun(outlets.map((n) => n.kind), 2)} are at elevation ${[...elevations][0]} m.</p>` : '';
    parts.push(`<h3>${title}</h3>${table(columns, outlets)}${elevationNote}`);
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
    col<P>('l', 'Length, m', (p) => p.lengthM.toFixed(1), true),
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
          col<NodeResult>('q', 'Flow, LPM', (r) => r.outletFlowLpm.toFixed(0), true),
          col<NodeResult>('rq', 'Required, LPM', (r) => r.requiredFlowLpm, true),
          col<NodeResult>('m', 'Margin', (r) => (r.margin === null ? null : `${(r.margin * 100).toFixed(1)} %`), true),
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
        col<NodeResult>('q', 'Outflow, LPM', (r) => (r.outflowLpm > 0.05 ? r.outflowLpm.toFixed(0) : ''), true),
        col<NodeResult>('s', 'Result', (r) => (r.status === 'pass' || r.status === 'fail' ? resultText(r.status) : '')),
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
        col<PipeResult>('q', 'Flow, LPM', (r) => Math.abs(r.flowLpm).toFixed(0), true),
        col<PipeResult>('v', 'Velocity, m/s', (r) => `${r.velocityMs.toFixed(2)}${r.velocityExceeded ? ' ▲' : ''}`, true),
        col<PipeResult>('hf', 'Head loss, m', (r) => r.headLossM.toFixed(2), true),
        col<PipeResult>('l100', 'Loss per 100 m', (r) => r.lossPer100M.toFixed(2), true),
        col<PipeResult>('l', 'Length, m', (r) => r.lengthM.toFixed(1), true),
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
          col<CriticalPathSegment>('l', 'Length, m', (r) => r.lengthM.toFixed(1), true),
          col<CriticalPathSegment>('leq', 'Equiv. length, m', (r) => r.equivalentLengthM.toFixed(1), true),
          col<CriticalPathSegment>('q', 'Flow, LPM', (r) => r.flowLpm.toFixed(0), true),
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
    col<RequirementRow>('q', 'Flow, LPM', (r) => r.flowLpm.toFixed(0), true),
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
  const pct = (m: number) => `${(m * 100).toFixed(1)} %`;
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
      `Least favourable combination of ${worst.count} hydrants (${esc(labels(worst))}): ${worst.pass ? 'meets' : 'does not meet'} the requirement, margin ${pct(worst.margin)}.`,
    );
  }
  const farthest = capacity.kFarthest;
  if (farthest) {
    items.push(
      `The ${farthest.count} most remote hydrants together (${esc(labels(farthest))}): ${farthest.pass ? 'meet' : 'do not meet'} the requirement, margin ${pct(farthest.margin)}.`,
    );
  }
  const excluded =
    capacity.excluded.length > 0
      ? `<p class="note">Not included, as they have no supply path from the pump: ${esc(capacity.excluded.join(', '))}.</p>`
      : '';
  const rows = capacity.combos.slice(0, 25);
  return `<p class="lead">Combinations of hydrants flowing together were analysed on the pump curve. ${capacity.evaluated.toLocaleString()} combinations were solved${capacity.method === 'exhaustive' ? ', covering every possible combination' : ''}.</p>
<ul class="findings">${items.map((i) => `<li>${i}</li>`).join('')}</ul>
${excluded}
<h3>Least favourable combinations</h3>
${table(
  [
    col<Combo>('k', 'Flowing', (c) => c.count, true),
    col<Combo>('members', 'Hydrants', (c) => labels(c)),
    col<Combo>('crit', 'Critical hydrant', (c) => capacity.hydrants[c.critical].label),
    col<Combo>('margin', 'Margin', (c) => pct(c.margin), true),
    col<Combo>('q', 'Pump flow, LPM', (c) => c.pumpFlowLpm.toFixed(0), true),
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
          .map((v) => `<td class="num">${v === null ? '–' : esc(v)}</td>`)
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
    if (results.ok && last !== null && results.system.pumpFlowLpm > last) extras.push(`extended in a straight line beyond ${last} LPM`);
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
/* Styles                                                              */
/* ------------------------------------------------------------------ */

const styles = (footer: string) => `
  :root { --ink: #1c1b19; --muted: #5d5c58; --line: #d9d7cf; --rule: #e8e6df; --soft: #f5f4ef; --accent: #b3261e; }
  * { box-sizing: border-box; }
  html { background: #e9e8e3; }
  body { margin: 24px auto; max-width: 1040px; padding: 0 48px 48px; color: var(--ink); background: #fff;
    font: 12.5px/1.5 'Segoe UI', system-ui, -apple-system, sans-serif; box-shadow: 0 1px 6px rgba(0,0,0,.08);
    -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .toolbar { position: sticky; top: 0; z-index: 2; display: flex; justify-content: flex-end; margin: 0 -48px 28px; padding: 10px 48px;
    background: rgba(255,255,255,.95); border-bottom: 1px solid var(--line); }
  .toolbar button { height: 30px; padding: 0 14px; font: inherit; cursor: pointer; background: var(--ink); color: #fff; border: 0; border-radius: 4px; }
  .doc-head { padding-bottom: 16px; border-bottom: 3px solid var(--ink); }
  .doc-kind { font-size: 11px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--accent); }
  h1 { margin: 4px 0 14px; font-size: 26px; font-weight: 600; line-height: 1.2; }
  .doc-meta { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px 18px; margin: 0; }
  .doc-meta dt { font-size: 10.5px; letter-spacing: .05em; text-transform: uppercase; color: var(--muted); }
  .doc-meta dd { margin: 0; font-weight: 600; }
  .contents { margin: 14px 0 0; padding: 0; list-style: none; columns: 2; column-gap: 32px; }
  .contents li { padding: 1px 0; break-inside: avoid; }
  .contents a { color: inherit; text-decoration: none; }
  .contents b { display: inline-block; width: 24px; font-weight: 600; color: var(--accent); }
  section { margin-top: 30px; }
  h2 { display: flex; gap: 10px; margin: 0 0 10px; padding-bottom: 5px; font-size: 17px; font-weight: 600; border-bottom: 1.5px solid var(--ink); break-after: avoid; }
  h2 b { color: var(--accent); font-weight: 600; }
  h3 { margin: 18px 0 6px; font-size: 13px; font-weight: 600; break-after: avoid; }
  p { margin: 6px 0; }
  .lead { margin-bottom: 10px; }
  .note { font-size: 11px; color: var(--muted); }
  .verdict { margin: 0 0 14px; padding: 12px 14px; border-left: 4px solid; font-size: 15px; font-weight: 600; }
  .verdict.pass { background: #e8f4e6; border-color: #0a7a0a; color: #0a5f0a; }
  .verdict.fail { background: #fbe9e8; border-color: #b3261e; color: #8f2020; }
  .facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin: 10px 0 14px; }
  .fact { padding: 9px 12px; background: var(--soft); border-left: 3px solid var(--ink); break-inside: avoid; }
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
  .basis tr.group th { padding-top: 12px; background: none; border-bottom: 1px solid var(--line); font-size: 11.5px; }
  .basis td:first-child { white-space: normal; width: 30%; }
  .basis td:last-child { width: 30%; color: var(--muted); }
  .chart { margin: 6px 0 14px; break-inside: avoid; }
  .chart svg { max-width: 100%; height: auto; }
  .issues { margin: 6px 0 12px; padding: 8px 12px 8px 30px; background: #fdf6e3; border-left: 3px solid #c98a00; }
  .issues li { margin: 2px 0; }
  .limitations { margin-top: 32px; padding: 12px 14px; font-size: 11px; color: var(--muted); border-top: 1px solid var(--line); }
  .limitations strong { color: var(--ink); }
  @media (max-width: 720px) {
    body { margin: 0; padding: 0 16px 32px; }
    .toolbar { margin: 0 -16px 20px; padding: 10px 16px; }
    .doc-meta { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .facts { grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); }
    .contents { columns: 1; }
    table { display: block; overflow-x: auto; }
  }
  @media print {
    html { background: none; }
    body { margin: 0; max-width: none; padding: 0; font-size: 11.5px; box-shadow: none; }
    .toolbar { display: none; }
    section { margin-top: 22px; }
  }
  @page {
    size: A4;
    margin: 14mm 12mm 16mm;
    @bottom-left { content: ${footer}; font: 9px 'Segoe UI', sans-serif; color: #777; }
    @bottom-right { content: "Page " counter(page) " of " counter(pages); font: 9px 'Segoe UI', sans-serif; color: #777; }
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
    facts.push(['Pump duty', `${results.system.pumpFlowLpm.toFixed(0)} LPM`, `at ${results.system.pumpHeadM.toFixed(1)} m (${results.system.pumpPressureBar.toFixed(2)} bar)`]);
  }
  if (results.ok && critical && open.length > 0) {
    facts.push([`Critical ${openNoun(1)}`, critical.label, `${fix(critical.pressureBar, 2)} bar, ${critical.outletFlowLpm.toFixed(0)} LPM`]);
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
            ? `It meets the minimum residual pressure and flow, with ${fix(open[0].pressureBar, 2)} bar and ${open[0].outletFlowLpm.toFixed(0)} LPM.`
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
    `<strong>Network:</strong> ${pipeLength.toFixed(0)} m of ${sizes} NB pipework with ${plural(totals.junctions, 'junction')}, ${plural(totals.tees, 'tee')} at junctions${totals.takeOffTees > 0 ? `, ${plural(totals.takeOffTees, 'outlet tee')}` : ''}${totals.crosses > 0 ? `, ${plural(totals.crosses, 'cross', 'crosses')}` : ''} and ${plural(totals.bends, 'bend')}.`,
  );

  const issues = results.issues.filter((i) => i.severity === 'error' || i.severity === 'warning');
  const issueHtml = issues.length
    ? `<ul class="issues">${issues.map((i) => `<li>${esc(clientMessage(i.message))}</li>`).join('')}</ul>`
    : '';

  add(
    'summary',
    'Summary',
    `${verdict}<div class="facts">${facts
      .map(([label, value, note]) => `<div class="fact"><span>${esc(label)}</span><strong>${esc(value)}</strong>${note ? `<small>${esc(note)}</small>` : ''}</div>`)
      .join('')}</div><ul class="findings">${findings.map((f) => `<li>${f}</li>`).join('')}</ul>${issueHtml}`,
  );

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

  const pumpData = pumpSystemData(project, results);
  const profile = path ? profileData(path, results, project.pumps[0]?.label ?? 'Pump') : null;
  const charts: string[] = [];
  if (pumpData) {
    charts.push(
      `<h3>Pump and system curves</h3><div class="chart" id="chart-pump">${renderToStaticMarkup(<PumpSystemChart data={pumpData} width={900} height={320} />)}</div>`,
    );
  }
  if (profile) {
    charts.push(
      `<h3>Pressure along the critical path</h3><div class="chart" id="chart-profile">${renderToStaticMarkup(<PressureProfileChart data={profile} width={900} height={300} />)}</div>`,
    );
  }
  if (charts.length > 0) add('charts', 'Performance charts', charts.join('\n'));

  if (requirement.length > 0) {
    add('requirement', `Each ${outletNoun(requirement.map((r) => r.kind), 1)} flowing alone`, requirementSection(requirement));
  }
  if (capacity) add('capacity', 'Simultaneous operation', capacitySection(capacity));
  if (project.scenarios.length > 0) add('scenarios', 'Operating scenarios', scenariosSection(project));
  add('basis', 'Design basis', basisTable(designBasis(project, results)));

  const hydrantCount = outlets.filter((n) => n.kind === 'hydrant').length;
  const reelCount = outlets.length - hydrantCount;
  const meta: [string, string][] = [
    ['Date', generatedAt.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })],
    [
      'Outlets',
      [hydrantCount ? plural(hydrantCount, 'hydrant') : '', reelCount ? plural(reelCount, 'hose reel') : ''].filter(Boolean).join(', ') || 'None',
    ],
    ['Pipework', `${pipeLength.toFixed(0)} m, ${sizes} NB`],
    ['Case analysed', open.length > 0 ? `${listText(open.map((n) => n.label), 4)} flowing` : 'All outlets closed'],
  ];

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(project.name)} - hydraulic report</title>
<style>${styles(cssString(`${project.name} · Hydraulic analysis report`))}</style>
</head>
<body>
<div class="toolbar"><button onclick="window.print()">Print or save as PDF</button></div>
<header class="doc-head">
  <div class="doc-kind">Fire hydrant system · Hydraulic analysis report</div>
  <h1>${esc(project.name)}</h1>
  <dl class="doc-meta">${meta.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
  <ol class="contents">${sections.map((s, i) => `<li><a href="#${s.id}"><b>${i + 1}</b>${esc(s.title)}</a></li>`).join('')}</ol>
</header>
${sections.map((s, i) => `<section id="${s.id}"><h2><b>${i + 1}</b>${esc(s.title)}</h2>\n${s.body}\n</section>`).join('\n')}
<div class="limitations"><strong>Limitations.</strong> This is a steady-state hydraulic analysis; transient effects such as water hammer are not included. The minimum pressures and flows used are listed under Design basis and should be confirmed against the applicable code (NBC 2016 Part 4, TAC, IS 13039, NFPA 14/24). Any change to the layout, pump or design criteria requires the analysis to be repeated.</div>
</body>
</html>`;
}
