import type { Fitting, FittingType, Network, NetworkNode, Pipe } from './types';

/**
 * Fittings implied by the drawing. Each node is judged by how many pipes meet
 * there and the angle between them, and each fitting found puts its head loss
 * on one of the pipes it joins.
 */

/** Below this deflection two pipes are treated as one straight run. */
export const STRAIGHT_TOLERANCE_DEG = 5;

/** Standard bend angles, with the upper edge of the deflection range each covers. */
const BEND_BANDS: { angle: number; upTo: number }[] = [
  { angle: 11.25, upTo: 16.875 },
  { angle: 22.5, upTo: 33.75 },
  { angle: 45, upTo: 67.5 },
  { angle: 90, upTo: 112.5 },
];

export type DrawnFittingKind = 'tee' | 'takeOff' | 'cross' | 'manifold' | 'bend' | 'reducer' | 'endCap';

/** One fitting-table entry placed on a pipe for the head-loss calculation. */
export interface FittingLossItem {
  pipeId: string;
  type: Exclude<FittingType, 'custom'>;
  quantity: number;
}

export interface DrawnFitting {
  kind: DrawnFittingKind;
  /** Name for the schedule, e.g. "Equal tee" or "90° bend". */
  name: string;
  /** Pipe size(s) in mm NB, e.g. "150" or "150 × 100". */
  size: string;
  /** Where its head loss goes. Empty for an end cap. */
  losses: FittingLossItem[];
}

export interface NodeConnection {
  node: NetworkNode;
  pipes: Pipe[];
  /** Pump label when this node is a pump outlet. */
  pump: string | null;
  /** Angle the flow turns through between two pipes, degrees. Two-pipe nodes only. */
  deflectionDeg: number | null;
  fittings: DrawnFitting[];
  /** What the node is physically, e.g. "Equal tee" or "Dead end". */
  description: string;
}

/** What the fitting search needs from a network or project. */
export type Layout = Pick<Network, 'nodes' | 'pipes' | 'pumps'>;

export const naturalCompare = (a: string, b: string): number =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

/** Nominal size in mm, or the internal diameter for a custom pipe. */
export function pipeSize(p: Pipe): number {
  return typeof p.nominalMm === 'number' ? p.nominalMm : p.internalDiameterMm;
}

function sizeText(sizes: number[]): string {
  const unique = [...new Set(sizes)];
  return unique.length === 1 ? String(unique[0]) : sizes.join(' × ');
}

/** 0° means the two pipes continue in a straight line, 90° a right-angle turn. */
function deflection(node: NetworkNode, a: NetworkNode, b: NetworkNode): number {
  const ux = a.x - node.x;
  const uy = a.y - node.y;
  const vx = b.x - node.x;
  const vy = b.y - node.y;
  const lu = Math.hypot(ux, uy);
  const lv = Math.hypot(vx, vy);
  if (lu === 0 || lv === 0) return 0;
  const cos = Math.min(1, Math.max(-1, (ux * vx + uy * vy) / (lu * lv)));
  return 180 - (Math.acos(cos) * 180) / Math.PI;
}

/** "90° bend" for a standard angle, otherwise the measured angle. */
export function bendName(deflectionDeg: number): string {
  const band = BEND_BANDS.find((b) => deflectionDeg < b.upTo);
  return band ? `${band.angle}° bend` : `${Math.round(deflectionDeg)}° bend`;
}

/** Elbows that make up a bend in the head-loss calculation. */
function bendElbows(deflectionDeg: number): [Exclude<FittingType, 'custom'>, number][] {
  if (deflectionDeg < 67.5) return [['elbow45', 1]];
  if (deflectionDeg <= 112.5) return [['elbow90', 1]];
  if (deflectionDeg <= 157.5) return [['elbow90', 1], ['elbow45', 1]];
  return [['elbow90', 2]];
}

/** The pipe that carries a fitting's loss: the smallest, so the loss is taken at the higher velocity. */
function lossPipe(pipes: Pipe[]): Pipe {
  return [...pipes].sort((a, b) => pipeSize(a) - pipeSize(b) || naturalCompare(a.label, b.label))[0];
}

/** Indices of the two most nearly opposite pipes, which form the run of a tee or cross. */
function runPair(node: NetworkNode, pipes: Pipe[], other: (p: Pipe) => NetworkNode | undefined): [number, number] {
  let best: [number, number] = [0, 1];
  let bestTurn = Infinity;
  for (let i = 0; i < pipes.length; i++) {
    for (let j = i + 1; j < pipes.length; j++) {
      const a = other(pipes[i]);
      const b = other(pipes[j]);
      const turn = a && b ? deflection(node, a, b) : 90;
      if (turn < bestTurn) {
        bestTurn = turn;
        best = [i, j];
      }
    }
  }
  return best;
}

/** How every node in the drawing is made up, with the fittings it needs. */
export function nodeConnections(layout: Layout): NodeConnection[] {
  const byId = new Map(layout.nodes.map((n) => [n.id, n]));
  const attached = new Map<string, Pipe[]>(layout.nodes.map((n) => [n.id, []]));
  for (const p of layout.pipes) {
    if (p.from === p.to) continue;
    attached.get(p.from)?.push(p);
    attached.get(p.to)?.push(p);
  }
  const pumpAt = new Map(layout.pumps.map((p) => [p.nodeId, p.label]));

  return layout.nodes.map((node) => {
    const pipes = attached.get(node.id) ?? [];
    const other = (p: Pipe) => byId.get(p.from === node.id ? p.to : p.from);
    const sizes = pipes.map(pipeSize).sort((a, b) => b - a);
    const pump = pumpAt.get(node.id) ?? null;
    const fittings: DrawnFitting[] = [];
    let deflectionDeg: number | null = null;
    let description: string;

    if (pipes.length === 2) {
      const a = other(pipes[0]);
      const b = other(pipes[1]);
      deflectionDeg = a && b ? deflection(node, a, b) : 0;
    }
    const run = pipes.length >= 3 ? runPair(node, pipes, other) : null;
    const runPipes = run ? [pipes[run[0]], pipes[run[1]]] : pipes;
    const branchPipes = run ? pipes.filter((_, i) => i !== run[0] && i !== run[1]) : [];

    const bendOrReducer = () => {
      if (deflectionDeg === null) return;
      if (deflectionDeg >= STRAIGHT_TOLERANCE_DEG) {
        const on = lossPipe(pipes).id;
        fittings.push({
          kind: 'bend',
          name: bendName(deflectionDeg),
          size: sizeText(sizes),
          losses: bendElbows(deflectionDeg).map(([type, quantity]) => ({ pipeId: on, type, quantity })),
        });
      } else if (sizes[0] !== sizes[1]) {
        fittings.push({
          kind: 'reducer',
          name: 'Reducer',
          size: sizes.join(' × '),
          losses: [{ pipeId: lossPipe(pipes).id, type: 'reducer', quantity: 1 }],
        });
      }
    };
    const junctionFitting = () => {
      if (!run) return;
      const losses: FittingLossItem[] = [
        { pipeId: lossPipe(runPipes).id, type: 'teeRun', quantity: 1 },
        ...branchPipes.map((p) => ({ pipeId: p.id, type: 'teeBranch' as const, quantity: 1 })),
      ];
      if (pipes.length === 3) {
        const runSizes = runPipes.map(pipeSize).sort((a, b) => b - a);
        const equal = new Set(sizes).size === 1;
        fittings.push({
          kind: 'tee',
          name: equal ? 'Equal tee' : 'Reducing tee',
          size: equal ? String(sizes[0]) : [...runSizes, pipeSize(branchPipes[0])].join(' × '),
          losses,
        });
      } else if (pipes.length === 4) {
        fittings.push({ kind: 'cross', name: new Set(sizes).size === 1 ? 'Equal cross' : 'Reducing cross', size: sizeText(sizes), losses });
      } else {
        fittings.push({ kind: 'manifold', name: `${pipes.length}-way header`, size: sizeText(sizes), losses });
      }
    };

    if (pipes.length === 0) {
      description = 'Not connected';
    } else if (node.outlet) {
      // The hydrant or hose reel is a branch off the main, so an in-line one sits on a tee.
      const what = node.kind === 'hoseReel' ? 'hose reel' : 'hydrant';
      if (pipes.length === 1) {
        description = `End-of-line ${what}`;
      } else {
        // The branch size is not drawn, so give the main it sits on. Where three
        // or more pipes meet, the junction tee already carries the run loss.
        fittings.push({
          kind: 'takeOff',
          name: `Tee for ${what} outlet`,
          size: `${sizes[0]} main`,
          losses: run ? [] : [{ pipeId: lossPipe(runPipes).id, type: 'teeRun', quantity: 1 }],
        });
        bendOrReducer();
        junctionFitting();
        description = fittings.map((f) => f.name).join(' + ');
      }
    } else if (pump && pipes.length === 1) {
      description = `Pump delivery (${pump})`;
    } else if (pipes.length === 1) {
      fittings.push({ kind: 'endCap', name: 'End cap', size: String(sizes[0]), losses: [] });
      description = 'Dead end, capped';
    } else {
      bendOrReducer();
      junctionFitting();
      description = fittings.length > 0 ? fittings.map((f) => f.name).join(' + ') : 'Straight joint';
      if (pump) description = `Pump delivery (${pump}), ${description.toLowerCase()}`;
    }
    return { node, pipes, pump, deflectionDeg, fittings, description };
  });
}

/** A fitting placed on a pipe by the drawing, with the node it sits at. */
export interface AutoFitting extends Fitting {
  nodeId: string;
}

/** Head-loss fittings implied by the drawing, by pipe id. */
export function junctionFittings(layout: Layout): Map<string, AutoFitting[]> {
  const out = new Map<string, AutoFitting[]>();
  for (const c of nodeConnections(layout)) {
    let n = 0;
    for (const f of c.fittings) {
      for (const loss of f.losses) {
        const list = out.get(loss.pipeId) ?? [];
        list.push({ id: `auto-${c.node.id}-${n++}`, type: loss.type, quantity: loss.quantity, nodeId: c.node.id });
        out.set(loss.pipeId, list);
      }
    }
  }
  return out;
}

/** Every fitting counted on each pipe: those entered by hand, then those from the drawing when enabled. */
export function countedFittings(network: Layout & Pick<Network, 'settings'>): Map<string, (Fitting | AutoFitting)[]> {
  const drawn = network.settings.autoFittings ? junctionFittings(network) : new Map<string, AutoFitting[]>();
  return new Map(network.pipes.map((p) => [p.id, [...p.fittings, ...(drawn.get(p.id) ?? [])]]));
}

/** Hand-entered fitting types that the drawing now supplies at junctions. */
export const JUNCTION_FITTING_TYPES: FittingType[] = ['elbow90', 'elbow45', 'longRadiusBend', 'teeRun', 'teeBranch', 'reducer'];
