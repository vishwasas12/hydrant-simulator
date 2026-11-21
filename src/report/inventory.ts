import { naturalCompare, pipeSize, type DrawnFittingKind, type NodeConnection } from '../model/junctions';
import type { FittingType, Project, ValveType } from '../model/types';

/** Schedules for the report: fittings, junctions, pipework and valves. */

export {
  bendName,
  naturalCompare,
  nodeConnections,
  pipeSize,
  STRAIGHT_TOLERANCE_DEG,
  type DrawnFitting,
  type DrawnFittingKind,
  type NodeConnection,
} from '../model/junctions';

export interface FittingScheduleRow {
  kind: DrawnFittingKind;
  name: string;
  size: string;
  quantity: number;
  locations: string[];
}

const KIND_ORDER: DrawnFittingKind[] = ['tee', 'cross', 'manifold', 'takeOff', 'bend', 'reducer', 'endCap'];

/** Drawn fittings grouped by type and size. */
export function fittingSchedule(connections: NodeConnection[]): FittingScheduleRow[] {
  const rows = new Map<string, FittingScheduleRow>();
  for (const c of connections) {
    for (const f of c.fittings) {
      const key = `${f.kind}|${f.name}|${f.size}`;
      const row = rows.get(key) ?? { kind: f.kind, name: f.name, size: f.size, quantity: 0, locations: [] };
      row.quantity += 1;
      row.locations.push(c.node.label);
      rows.set(key, row);
    }
  }
  const bendAngle = (name: string) => parseFloat(name) || 0;
  return [...rows.values()]
    .map((r) => ({ ...r, locations: r.locations.sort(naturalCompare) }))
    .sort(
      (a, b) =>
        KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
        bendAngle(b.name) - bendAngle(a.name) ||
        a.name.localeCompare(b.name) ||
        parseFloat(b.size) - parseFloat(a.size),
    );
}

export interface FittingTotals {
  junctions: number;
  /** Tees where three pipes meet. */
  tees: number;
  /** Tees that branch off the main to a hydrant or hose reel. */
  takeOffTees: number;
  crosses: number;
  bends: number;
  reducers: number;
  endCaps: number;
}

export function fittingTotals(connections: NodeConnection[]): FittingTotals {
  const count = (kind: DrawnFittingKind) =>
    connections.reduce((s, c) => s + c.fittings.filter((f) => f.kind === kind).length, 0);
  return {
    junctions: connections.filter((c) => c.node.kind === 'junction').length,
    tees: count('tee'),
    takeOffTees: count('takeOff'),
    crosses: count('cross') + count('manifold'),
    bends: count('bend'),
    reducers: count('reducer'),
    endCaps: count('endCap'),
  };
}

/** Junction nodes only, in label order. */
export function junctionSchedule(connections: NodeConnection[]): NodeConnection[] {
  return connections.filter((c) => c.node.kind === 'junction').sort((a, b) => naturalCompare(a.node.label, b.node.label));
}

export interface PipeScheduleRow {
  size: number;
  custom: boolean;
  internalDiameters: number[];
  count: number;
  lengthM: number;
}

/** Pipe count and total length by size, largest first. */
export function pipeSchedule(project: Project): PipeScheduleRow[] {
  const rows = new Map<string, PipeScheduleRow>();
  for (const p of project.pipes) {
    const custom = typeof p.nominalMm !== 'number';
    const size = pipeSize(p);
    const key = `${custom ? 'c' : 'n'}${size}`;
    const row = rows.get(key) ?? { size, custom, internalDiameters: [], count: 0, lengthM: 0 };
    row.count += 1;
    row.lengthM += p.lengthM;
    if (!row.internalDiameters.includes(p.internalDiameterMm)) row.internalDiameters.push(p.internalDiameterMm);
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => b.size - a.size);
}

export const VALVE_TYPE_NAMES: Record<ValveType, string> = {
  gate: 'Gate valve',
  butterfly: 'Butterfly valve',
  nonReturn: 'Non-return valve',
};

export interface ValveScheduleRow {
  label: string;
  type: string;
  pipe: string;
  size: number;
  closed: boolean;
}

export function valveSchedule(project: Project): ValveScheduleRow[] {
  return project.pipes
    .flatMap((p) =>
      (p.valves ?? []).map((v) => ({
        label: v.label,
        type: VALVE_TYPE_NAMES[v.type],
        pipe: p.label,
        size: pipeSize(p),
        closed: v.status === 'closed',
      })),
    )
    .sort((a, b) => naturalCompare(a.label, b.label));
}

export interface CalcFittingRow {
  name: string;
  size: number;
  quantity: number;
  pipes: string[];
}

/** Fittings entered by hand on pipes, grouped by type and size. */
export function calculationFittings(project: Project): CalcFittingRow[] {
  const names = new Map<FittingType, string>(project.tables.fittings.map((r) => [r.type, r.name]));
  const rows = new Map<string, CalcFittingRow>();
  for (const p of project.pipes) {
    for (const f of p.fittings) {
      const name =
        f.type === 'custom'
          ? `Other (${f.customMode === 'k' ? `K ${f.customValue}` : `${f.customValue} m equivalent length`})`
          : (names.get(f.type) ?? f.type);
      const size = pipeSize(p);
      const key = `${name}|${size}`;
      const row = rows.get(key) ?? { name, size, quantity: 0, pipes: [] };
      row.quantity += f.quantity;
      if (!row.pipes.includes(p.label)) row.pipes.push(p.label);
      rows.set(key, row);
    }
  }
  return [...rows.values()]
    .map((r) => ({ ...r, pipes: r.pipes.sort(naturalCompare) }))
    .sort((a, b) => a.name.localeCompare(b.name) || b.size - a.size);
}
