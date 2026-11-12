import { DEFAULT_HOSE_REEL, DEFAULT_HYDRANT, makePipe, makePump } from './defaults';
import { internalDiameterFor } from './tables';
import type { Id, NetworkNode, NodeKind, Pipe, PipeValve, Project, ValveType } from './types';

/** Pure editing operations. All mutate the project passed in (an immer draft). */

let counter = 0;
export function uid(prefix: string): Id {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

const LABEL_PREFIX: Record<NodeKind, string> = { junction: 'J', hydrant: 'HV ', hoseReel: 'HR ' };

function nextNumber(labels: string[], prefix: string): number {
  const pattern = new RegExp(`^${prefix.trim()}\\s*(\\d+)$`);
  let max = 0;
  for (const label of labels) {
    const m = pattern.exec(label);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

export function nextNodeLabel(project: Project, kind: NodeKind): string {
  const prefix = LABEL_PREFIX[kind];
  return `${prefix}${nextNumber(project.nodes.map((n) => n.label), prefix)}`;
}

export function nextPipeLabel(project: Project): string {
  return `P${nextNumber(project.pipes.map((p) => p.label), 'P')}`;
}

export function drawnLength(project: Project, a: NetworkNode, b: NetworkNode): number {
  return Math.hypot(a.x - b.x, a.y - b.y) * project.metersPerUnit;
}

export function addNode(project: Project, x: number, y: number, kind: NodeKind): NetworkNode {
  const node: NetworkNode = {
    id: uid('n'),
    label: nextNodeLabel(project, kind),
    x,
    y,
    elevationM: 0,
    baseDemandLpm: 0,
    kind,
  };
  if (kind === 'hydrant') node.outlet = { ...DEFAULT_HYDRANT };
  if (kind === 'hoseReel') node.outlet = { ...DEFAULT_HOSE_REEL };
  project.nodes.push(node);
  return node;
}

/** Turns an existing node into a hydrant, a hose reel or back into a junction. */
export function markNode(project: Project, nodeId: Id, kind: NodeKind): void {
  const node = project.nodes.find((n) => n.id === nodeId);
  if (!node || node.kind === kind) return;
  node.label = nextNodeLabel(project, kind);
  node.kind = kind;
  if (kind === 'hydrant') node.outlet = { ...DEFAULT_HYDRANT };
  else if (kind === 'hoseReel') node.outlet = { ...DEFAULT_HOSE_REEL };
  else delete node.outlet;
}

export function addPipe(project: Project, a: Id, b: Id, nominalMm: number): Pipe | null {
  if (a === b) return null;
  const na = project.nodes.find((n) => n.id === a);
  const nb = project.nodes.find((n) => n.id === b);
  if (!na || !nb) return null;
  const pipe = makePipe(uid('p'), nextPipeLabel(project), a, b, nominalMm, drawnLength(project, na, nb));
  pipe.internalDiameterMm = internalDiameterFor(project.tables.material, nominalMm);
  project.pipes.push(pipe);
  return pipe;
}

/** Inserts a node into a pipe at (x, y), splitting length in proportion. */
export function splitPipe(
  project: Project,
  pipeId: Id,
  x: number,
  y: number,
  kind: NodeKind,
): NetworkNode | null {
  const pipe = project.pipes.find((p) => p.id === pipeId);
  if (!pipe) return null;
  const a = project.nodes.find((n) => n.id === pipe.from);
  const b = project.nodes.find((n) => n.id === pipe.to);
  if (!a || !b) return null;
  const total = Math.hypot(a.x - b.x, a.y - b.y) || 1;
  const t = Math.min(Math.max(Math.hypot(x - a.x, y - a.y) / total, 0), 1);
  const node = addNode(project, x, y, kind);
  // Each valve stays on whichever half it sits on, at the same place on the drawing.
  const valves = pipe.valves ?? [];
  const firstValves = valves
    .filter((v) => v.position <= t)
    .map((v) => ({ ...v, position: t > 0 ? v.position / t : 0.5 }));
  const secondValves = valves
    .filter((v) => v.position > t)
    .map((v) => ({ ...v, position: t < 1 ? (v.position - t) / (1 - t) : 0.5 }));
  const second: Pipe = {
    ...pipe,
    id: uid('p'),
    label: nextPipeLabel(project),
    from: node.id,
    to: pipe.to,
    lengthM: pipe.lengthM * (1 - t),
    fittings: [],
    valves: secondValves,
  };
  pipe.valves = firstValves;
  pipe.to = node.id;
  pipe.lengthM = pipe.lengthM * t;
  project.pipes.push(second);
  return node;
}

export function moveNode(project: Project, nodeId: Id, x: number, y: number): void {
  const node = project.nodes.find((n) => n.id === nodeId);
  if (!node) return;
  node.x = x;
  node.y = y;
  for (const pipe of project.pipes) {
    if (pipe.lengthManual || (pipe.from !== nodeId && pipe.to !== nodeId)) continue;
    const a = project.nodes.find((n) => n.id === pipe.from);
    const b = project.nodes.find((n) => n.id === pipe.to);
    if (a && b) pipe.lengthM = drawnLength(project, a, b);
  }
}

/** Re-derives every non-manual pipe length, after the drawing scale changes. */
export function recomputeLengths(project: Project): void {
  const byId = new Map(project.nodes.map((n) => [n.id, n]));
  for (const pipe of project.pipes) {
    if (pipe.lengthManual) continue;
    const a = byId.get(pipe.from);
    const b = byId.get(pipe.to);
    if (a && b) pipe.lengthM = drawnLength(project, a, b);
  }
}

export function deleteNode(project: Project, nodeId: Id): void {
  project.nodes = project.nodes.filter((n) => n.id !== nodeId);
  project.pipes = project.pipes.filter((p) => p.from !== nodeId && p.to !== nodeId);
  project.pumps = project.pumps.filter((p) => p.nodeId !== nodeId);
}

export function deletePipe(project: Project, pipeId: Id): void {
  project.pipes = project.pipes.filter((p) => p.id !== pipeId);
}

/** One pump in v1: marking a node moves the existing pump there. */
export function setPumpNode(project: Project, nodeId: Id): void {
  if (project.pumps.length > 0) project.pumps[0].nodeId = nodeId;
  else project.pumps.push(makePump(uid('pump'), 'Fire pump', nodeId));
}

export function nextValveLabel(project: Project): string {
  const labels = project.pipes.flatMap((p) => (p.valves ?? []).map((v) => v.label));
  return `V${nextNumber(labels, 'V')}`;
}

/** Places a valve on a pipe. Position 0 is the pipe's `from` end. */
export function addValve(
  project: Project,
  pipeId: Id,
  position: number,
  type: ValveType = 'gate',
): PipeValve | null {
  const pipe = project.pipes.find((p) => p.id === pipeId);
  if (!pipe) return null;
  const valve: PipeValve = {
    id: uid('v'),
    label: nextValveLabel(project),
    type,
    position: Math.min(Math.max(position, 0.05), 0.95),
    status: 'open',
    forward: true,
  };
  pipe.valves = [...(pipe.valves ?? []), valve];
  return valve;
}

export function findValve(project: Project, valveId: Id): { pipe: Pipe; valve: PipeValve } | null {
  for (const pipe of project.pipes) {
    const valve = pipe.valves?.find((v) => v.id === valveId);
    if (valve) return { pipe, valve };
  }
  return null;
}

export function deleteValve(project: Project, valveId: Id): void {
  for (const pipe of project.pipes) {
    if (pipe.valves?.some((v) => v.id === valveId)) {
      pipe.valves = pipe.valves.filter((v) => v.id !== valveId);
    }
  }
}

/** Snapshot of the current on/off and valve state, for scenarios and baselines. */
export function captureState(project: Project): {
  hydrantOn: Record<Id, boolean>;
  pipeStatus: Record<Id, Pipe['status']>;
  valveStatus: Record<Id, Pipe['status']>;
  pipeC: Record<Id, number>;
} {
  const hydrantOn: Record<Id, boolean> = {};
  for (const n of project.nodes) if (n.outlet) hydrantOn[n.id] = n.outlet.on;
  const pipeStatus: Record<Id, Pipe['status']> = {};
  const valveStatus: Record<Id, Pipe['status']> = {};
  const pipeC: Record<Id, number> = {};
  for (const p of project.pipes) {
    pipeStatus[p.id] = p.status;
    pipeC[p.id] = p.c;
    for (const v of p.valves ?? []) valveStatus[v.id] = v.status;
  }
  return { hydrantOn, pipeStatus, valveStatus, pipeC };
}
