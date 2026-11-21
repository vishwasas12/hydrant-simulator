import { DEFAULT_C, DEFAULT_HOSE_REEL, DEFAULT_HYDRANT, DEFAULT_ROUGHNESS_MM, DEFAULT_SETTINGS } from '../model/defaults';
import { countedFittings, pipeSize } from '../model/junctions';
import { C_FACTORS, FITTING_TABLE, internalDiameterFor, MATERIAL_TABLE } from '../model/tables';
import type { Outlet, Project } from '../model/types';
import { curvePoints, fitPumpCurve, lookupBySize, VALVE_FITTING } from '../solver';

export interface Assumption {
  group: string;
  name: string;
  value: string;
  source: string;
  overridden: boolean;
}

const SPEC = 'Program default';
const ENGINEERING = 'Engineering assumption';

const OUTLET_FIELDS: { key: keyof Outlet; name: string; unit: string; source: string }[] = [
  { key: 'model', name: 'Discharge model', unit: '', source: SPEC },
  { key: 'outlets', name: 'Outlets per node', unit: '', source: SPEC },
  { key: 'fixedFlowLpm', name: 'Fixed demand per outlet', unit: 'LPM', source: SPEC },
  { key: 'nozzleMm', name: 'Nozzle bore', unit: 'mm', source: SPEC },
  { key: 'cd', name: 'Nozzle Cd', unit: '', source: SPEC },
  { key: 'hoseLengthM', name: 'Hose length', unit: 'm', source: SPEC },
  { key: 'hoseDiameterMm', name: 'Hose bore', unit: 'mm', source: SPEC },
  { key: 'hoseC', name: 'Hose Hazen-Williams C', unit: '', source: `${ENGINEERING}: lined hose` },
  { key: 'valveDiameterMm', name: 'Landing valve bore', unit: 'mm', source: SPEC },
  { key: 'valveK', name: 'Landing valve K', unit: '', source: `${ENGINEERING}: oblique valve` },
  { key: 'minPressureBar', name: 'Minimum residual pressure', unit: 'bar', source: `${SPEC}. Confirm against NBC 2016 Part 4, TAC, IS 13039, NFPA 14/24` },
  { key: 'minFlowLpm', name: 'Minimum flow per outlet', unit: 'LPM', source: `${SPEC}. Confirm against NBC 2016 Part 4, TAC, IS 13039, NFPA 14/24` },
];

function listLabels(labels: string[]): string {
  return labels.length <= 8 ? labels.join(', ') : `${labels.slice(0, 8).join(', ')} and ${labels.length - 8} more`;
}

/** Every value the solver used, where it came from, and whether it was overridden. */
export function buildAssumptions(project: Project): Assumption[] {
  const out: Assumption[] = [];
  const s = project.settings;
  const add = (group: string, name: string, value: string, source: string, overridden = false) =>
    out.push({ group, name, value, source, overridden });

  const method = 'Method';
  add(method, 'Solution method', 'Global Gradient Algorithm (Todini-Pilati)', 'As used in EPANET');
  add(method, 'Friction model', s.frictionModel === 'hazenWilliams' ? 'Hazen-Williams' : 'Darcy-Weisbach with Swamee-Jain', SPEC, s.frictionModel !== DEFAULT_SETTINGS.frictionModel);
  add(method, 'Hazen-Williams form', 'hf = 10.67 Le Q^1.852 / (C^1.852 D^4.87), Le including fittings', 'SI form, Q in m³/s, D in m');
  add(method, 'Fitting method', s.fittingMethod === 'equivalentLength' ? 'Equivalent length' : 'K value, h = K V²/2g', SPEC, s.fittingMethod !== DEFAULT_SETTINGS.fittingMethod);
  add(
    method,
    'Tees, bends and reducers',
    s.autoFittings ? 'Found from the drawing at each junction' : 'Only those entered on each pipe',
    s.autoFittings ? `${ENGINEERING}: branch loss on the branch pipe, run loss on one run pipe, bend and reducer on the smaller pipe` : 'Project input',
    !s.autoFittings,
  );
  add(method, 'Adjust equivalent lengths for C other than 120', s.applyCFactorToFittings ? 'Yes' : 'No', 'NFPA 13 multipliers', s.applyCFactorToFittings !== DEFAULT_SETTINGS.applyCFactorToFittings);
  add(method, 'Velocity limit', `${s.velocityLimitMs} m/s`, SPEC, s.velocityLimitMs !== DEFAULT_SETTINGS.velocityLimitMs);
  add(method, 'Head convergence tolerance', `${s.headToleranceM} m`, ENGINEERING, s.headToleranceM !== DEFAULT_SETTINGS.headToleranceM);
  add(method, 'Maximum iterations', String(s.maxIterations), ENGINEERING, s.maxIterations !== DEFAULT_SETTINGS.maxIterations);
  add(method, 'Linear head-loss zone', 'Below 0.06 LPM', `${ENGINEERING}: keeps the gradient finite at zero flow`);

  const units = 'Units and constants';
  add(units, '1 bar', `${s.mPerBar} m of water`, SPEC, s.mPerBar !== DEFAULT_SETTINGS.mPerBar);
  add(units, '1 LPM', '1/60000 m³/s', SPEC);
  add(units, 'Gravity', `${s.gravity} m/s²`, 'Standard value', s.gravity !== DEFAULT_SETTINGS.gravity);
  add(units, 'Kinematic viscosity', `${s.kinematicViscosityM2s} m²/s`, 'Water near 20 °C. Darcy-Weisbach only', s.kinematicViscosityM2s !== DEFAULT_SETTINGS.kinematicViscosityM2s);
  add(units, 'Drawing scale', `1 unit = ${project.metersPerUnit.toPrecision(4)} m`, project.metersPerUnit === 1 ? 'Default' : 'Set by scale calibration', project.metersPerUnit !== 1);

  const material = 'Pipe internal diameters';
  for (const row of project.tables.material.rows) {
    const original = MATERIAL_TABLE.rows.find((r) => r.nominalMm === row.nominalMm);
    add(
      material,
      `${row.nominalMm} NB`,
      `OD ${row.outerDiameterMm}, wall ${row.wallMm}, ID ${row.internalDiameterMm} mm`,
      project.tables.material.source,
      !original || original.internalDiameterMm !== row.internalDiameterMm,
    );
  }

  const counted = countedFittings(project);
  const fittings = 'Fittings in use';
  for (const row of project.tables.fittings) {
    const pipesWith = project.pipes.filter(
      (p) => (counted.get(p.id) ?? []).some((f) => f.type === row.type) || (p.valves ?? []).some((v) => VALVE_FITTING[v.type] === row.type),
    );
    if (pipesWith.length === 0) continue;
    const sizes = [...new Set(pipesWith.map(pipeSize))].sort((a, b) => a - b);
    const original = FITTING_TABLE.find((r) => r.type === row.type);
    const changed = JSON.stringify(original?.leqM) !== JSON.stringify(row.leqM) || JSON.stringify(original?.k) !== JSON.stringify(row.k);
    const value = sizes.map((size) => `${size}: ${lookupBySize(row.leqM, size).toFixed(1)} m / K ${lookupBySize(row.k, size).toFixed(2)}`).join('; ');
    add(fittings, row.name, value, row.source, changed);
  }
  const customs = project.pipes.flatMap((p) => p.fittings.filter((f) => f.type === 'custom').map((f) => ({ p, f })));
  for (const { p, f } of customs) {
    add(fittings, `Custom on ${p.label}`, f.customMode === 'k' ? `K = ${f.customValue}` : `${f.customValue} m equivalent`, 'Project input', true);
  }

  const cGroup = 'C factors';
  for (const row of project.tables.cFactors) {
    const original = C_FACTORS.find((r) => r.c === row.c);
    add(cGroup, `Equivalent-length multiplier at C = ${row.c}`, String(row.multiplier), 'NFPA 13', !original || original.multiplier !== row.multiplier);
  }

  const pipesGroup = 'Pipes';
  const byC = new Map<number, string[]>();
  for (const p of project.pipes) byC.set(p.c, [...(byC.get(p.c) ?? []), p.label]);
  for (const [c, labels] of [...byC.entries()].sort((a, b) => a[0] - b[0])) {
    add(pipesGroup, `C = ${c}`, `${labels.length} pipe${labels.length > 1 ? 's' : ''}: ${listLabels(labels)}`, c === DEFAULT_C ? `${SPEC}: new steel` : 'Project input', c !== DEFAULT_C);
  }
  const editedId = project.pipes.filter(
    (p) => typeof p.nominalMm !== 'number' || internalDiameterFor(project.tables.material, p.nominalMm) !== p.internalDiameterMm,
  );
  for (const p of editedId) add(pipesGroup, `${p.label} internal diameter`, `${p.internalDiameterMm} mm`, 'Project input', true);
  const manual = project.pipes.filter((p) => p.lengthManual).map((p) => p.label);
  if (manual.length > 0) add(pipesGroup, 'Lengths entered directly', `${manual.length} pipes: ${listLabels(manual)}`, 'Project input', true);
  const valves = project.pipes.flatMap((p) => p.valves ?? []);
  if (valves.length > 0) {
    const closed = valves.filter((v) => v.status === 'closed').map((v) => v.label);
    add(
      pipesGroup,
      'Valves',
      `${valves.length} placed${closed.length ? `, closed: ${listLabels(closed)}` : ', all open'}`,
      'User entry. Head loss from the fitting table; a closed valve shuts its pipe; a non-return valve blocks reverse flow',
      closed.length > 0,
    );
  }
  const roughness = project.pipes.filter((p) => p.roughnessMm !== DEFAULT_ROUGHNESS_MM).map((p) => p.label);
  add(pipesGroup, 'Roughness ε', `${DEFAULT_ROUGHNESS_MM} mm${roughness.length ? `, except ${listLabels(roughness)}` : ''}`, 'Commercial steel, typical. Darcy-Weisbach only', roughness.length > 0);

  for (const [kind, title, defaults] of [
    ['hydrant', 'Hydrant model', DEFAULT_HYDRANT],
    ['hoseReel', 'Hose reel model', DEFAULT_HOSE_REEL],
  ] as const) {
    const outlets = project.nodes.filter((n) => n.kind === kind && n.outlet);
    if (outlets.length === 0) continue;
    for (const field of OUTLET_FIELDS) {
      const unit = field.unit ? ` ${field.unit}` : '';
      add(title, field.name, `${String(defaults[field.key])}${unit}`, field.source);
      const groups = new Map<string, string[]>();
      for (const n of outlets) {
        const v = (n.outlet as Outlet)[field.key];
        if (v !== defaults[field.key]) groups.set(String(v), [...(groups.get(String(v)) ?? []), n.label]);
      }
      for (const [value, labels] of groups) {
        add(title, `${field.name} (changed)`, `${value}${unit} on ${listLabels(labels)}`, 'Project input', true);
      }
    }
  }

  for (const pump of project.pumps) {
    const g = `Pump: ${pump.label}`;
    try {
      const fit = fitPumpCurve(pump.curve);
      add(g, 'Curve entry', pump.curve.kind === 'threePoint' ? 'Three points' : pump.curve.kind === 'table' ? 'Table' : 'Constant head', 'Project input');
      add(g, 'Curve points', curvePoints(pump.curve).map((p) => `${p.headM} m @ ${p.flowLpm} LPM`).join('; '), pump.curve.kind === 'threePoint' ? SPEC : 'Project input');
      add(g, 'Fitted polynomial', fit.coefficients.map((c, i) => `${c.toPrecision(5)} Q^${i}`).join(' + '), 'Least squares through the entered points. Q in LPM');
      add(g, 'Above the last point', 'Straight-line extrapolation', ENGINEERING);
    } catch {
      add(g, 'Curve', 'Invalid', 'Project input', true);
    }
    add(g, 'Suction / pump-room loss', `${pump.suctionLossM} m`, SPEC, pump.suctionLossM !== 0);
    add(g, 'Water level vs pump datum', `${pump.waterLevelM} m`, SPEC, pump.waterLevelM !== 0);
  }
  return out;
}
