import type {
  Id,
  Network,
  NetworkNode,
  Outlet,
  Pipe,
  PipeStatus,
  PipeValve,
  ScenarioOverrides,
} from '../model/types';
import { junctionFittings } from '../model/junctions';
import { emitterCoefficients } from './emitter';
import { fittingLoss } from './fittings';
import { hazenWilliamsR } from './friction';
import { fitPumpCurve, type FittedCurve } from './pumpCurve';
import { SparseLDL } from './sparse';
import type { Issue } from './types';
import { lpmToM3s, pipeArea } from './units';

export const LINK_PIPE = 0;
export const LINK_PUMP = 1;
export const LINK_EMITTER = 2;

/** Runtime view of one hydrant or hose-reel outlet. */
export interface OutletRuntime {
  nodeId: Id;
  nodeIndex: number;
  label: string;
  outlet: Outlet;
  /** Index of its emitter link, or -1 for fixed demand. */
  linkIndex: number;
  fixedDemandM3s: number;
  minPressureM: number;
  minFlowLpm: number;
  isHydrant: boolean;
}

export interface PipeRuntime {
  pipe: Pipe;
  linkIndex: number;
  c: number;
  equivalentLengthM: number;
}

export interface Compiled {
  network: Network;
  issues: Issue[];
  fatal: boolean;
  nodeIndex: Map<Id, number>;
  nodes: NetworkNode[];
  elevation: Float64Array;
  baseDemand: Float64Array;
  nLinks: number;
  kind: Uint8Array;
  iFrom: Int32Array;
  iTo: Int32Array;
  hFixed: Float64Array;
  r: Float64Array;
  minorM: Float64Array;
  diameter: Float64Array;
  equivalentLength: Float64Array;
  roughness: Float64Array;
  emitterA: Float64Array;
  emitterB: Float64Array;
  pumpCurves: (FittedCurve | null)[];
  suctionLoss: Float64Array;
  offPos: Int32Array;
  /** Per pipe link: +1 or -1 when a non-return valve allows only that direction. */
  checkDir: Int8Array;
  /** Pipes shut by their status or a valve, under this scenario. */
  closedPipeIds: Set<Id>;
  ldl: SparseLDL | null;
  outlets: OutletRuntime[];
  initialOn: boolean[];
  pipes: PipeRuntime[];
  pumpLinks: number[];
  useDarcy: boolean;
  viscosity: number;
  gravity: number;
  mPerBar: number;
  maxIterations: number;
  tolerance: number;
}

function valveState(valve: PipeValve, s?: ScenarioOverrides): PipeStatus {
  return s?.valveStatus?.[valve.id] ?? valve.status;
}

function openCheckValves(pipe: Pipe, s?: ScenarioOverrides): PipeValve[] {
  return (pipe.valves ?? []).filter((v) => v.type === 'nonReturn' && valveState(v, s) === 'open');
}

/** Non-return valves facing both ways stop flow in both directions. */
function checkValvesConflict(pipe: Pipe, s?: ScenarioOverrides): boolean {
  const nrv = openCheckValves(pipe, s);
  return nrv.some((v) => v.forward) && nrv.some((v) => !v.forward);
}

/** A pipe is shut by its own status or by any closed valve on it. */
function effectiveStatus(pipe: Pipe, s?: ScenarioOverrides): PipeStatus {
  if ((s?.pipeStatus?.[pipe.id] ?? pipe.status) === 'closed') return 'closed';
  if ((pipe.valves ?? []).some((v) => valveState(v, s) === 'closed')) return 'closed';
  return checkValvesConflict(pipe, s) ? 'closed' : 'open';
}

function effectiveC(pipe: Pipe, s?: ScenarioOverrides): number {
  return s?.globalC ?? s?.pipeC?.[pipe.id] ?? pipe.c;
}

/** Input checks that make a solve impossible. Each returns a specific message. */
function validateInputs(network: Network, s: ScenarioOverrides | undefined): Issue[] {
  const issues: Issue[] = [];
  const ids = new Set(network.nodes.map((n) => n.id));
  if (network.pumps.length === 0) {
    issues.push({
      severity: 'error',
      message: 'No pump defined. Use the Pump tool (U) to mark a node as the pump outlet.',
      refs: [],
    });
  }
  for (const pump of network.pumps) {
    if (!ids.has(pump.nodeId)) {
      issues.push({
        severity: 'error',
        message: `${pump.label} points at a node that no longer exists.`,
        refs: [pump.id],
      });
    }
    try {
      fitPumpCurve(pump.curve);
    } catch (e) {
      issues.push({
        severity: 'error',
        message: `${pump.label}: ${e instanceof Error ? e.message : 'invalid curve'}.`,
        refs: [pump.id],
      });
    }
  }
  for (const pipe of network.pipes) {
    if (!ids.has(pipe.from) || !ids.has(pipe.to)) {
      issues.push({
        severity: 'error',
        message: `Pipe ${pipe.label} is attached to a node that no longer exists.`,
        refs: [pipe.id],
      });
    }
    if (!(pipe.internalDiameterMm > 0)) {
      issues.push({
        severity: 'error',
        message: `Pipe ${pipe.label} needs an internal diameter above 0 mm.`,
        refs: [pipe.id],
      });
    }
    if (!(effectiveC(pipe, s) > 0)) {
      issues.push({
        severity: 'error',
        message: `Pipe ${pipe.label} needs a Hazen-Williams C above 0.`,
        refs: [pipe.id],
      });
    }
    if (!(pipe.lengthM >= 0)) {
      issues.push({
        severity: 'error',
        message: `Pipe ${pipe.label} has an invalid length.`,
        refs: [pipe.id],
      });
    }
  }
  for (const node of network.nodes) {
    if (node.kind === 'junction' || !node.outlet) continue;
    const o = node.outlet;
    if (o.model === 'emitter' && !(o.nozzleMm > 0 && o.cd > 0 && o.valveDiameterMm > 0)) {
      issues.push({
        severity: 'error',
        message: `${node.label} needs a nozzle size, Cd and valve size above 0.`,
        refs: [node.id],
      });
    }
    if (o.model === 'emitter' && o.hoseLengthM > 0 && !(o.hoseDiameterMm > 0 && o.hoseC > 0)) {
      issues.push({
        severity: 'error',
        message: `${node.label} needs a hose diameter and C above 0.`,
        refs: [node.id],
      });
    }
  }
  return issues;
}

/** Minimum equivalent length, so a zero-length pipe keeps a finite gradient. */
const MIN_LENGTH_M = 0.01;

/**
 * Turns a network and scenario into flat arrays for the iteration. Closed pipes
 * are removed, and only nodes with an open path to a pump are solved.
 */
export function compile(network: Network, scenario?: ScenarioOverrides): Compiled {
  const issues = validateInputs(network, scenario);
  const { settings, tables } = network;

  const base: Compiled = {
    network,
    issues,
    fatal: issues.some((i) => i.severity === 'error'),
    nodeIndex: new Map(),
    nodes: [],
    elevation: new Float64Array(0),
    baseDemand: new Float64Array(0),
    nLinks: 0,
    kind: new Uint8Array(0),
    iFrom: new Int32Array(0),
    iTo: new Int32Array(0),
    hFixed: new Float64Array(0),
    r: new Float64Array(0),
    minorM: new Float64Array(0),
    diameter: new Float64Array(0),
    equivalentLength: new Float64Array(0),
    roughness: new Float64Array(0),
    emitterA: new Float64Array(0),
    emitterB: new Float64Array(0),
    pumpCurves: [],
    suctionLoss: new Float64Array(0),
    offPos: new Int32Array(0),
    checkDir: new Int8Array(0),
    closedPipeIds: new Set(),
    ldl: null,
    outlets: [],
    initialOn: [],
    pipes: [],
    pumpLinks: [],
    useDarcy: settings.frictionModel === 'darcyWeisbach',
    viscosity: settings.kinematicViscosityM2s,
    gravity: settings.gravity,
    mPerBar: settings.mPerBar,
    maxIterations: settings.maxIterations,
    tolerance: settings.headToleranceM,
  };
  if (base.fatal) return base;

  const byId = new Map(network.nodes.map((n) => [n.id, n]));
  const openPipes = network.pipes.filter(
    (p) => effectiveStatus(p, scenario) === 'open' && p.from !== p.to,
  );
  const closedPipeIds = new Set(
    network.pipes.filter((p) => effectiveStatus(p, scenario) === 'closed').map((p) => p.id),
  );
  for (const p of network.pipes) {
    if (checkValvesConflict(p, scenario)) {
      issues.push({
        severity: 'warning',
        message: `Pipe ${p.label} has non-return valves facing opposite ways, so no water can pass. It is treated as closed.`,
        refs: [p.id],
      });
    }
  }

  // Connectivity from every pump outlet through open pipes.
  const adjacency = new Map<Id, Id[]>();
  for (const n of network.nodes) adjacency.set(n.id, []);
  for (const p of openPipes) {
    adjacency.get(p.from)?.push(p.to);
    adjacency.get(p.to)?.push(p.from);
  }
  const reachable = new Set<Id>();
  const queue: Id[] = network.pumps.map((p) => p.nodeId);
  queue.forEach((id) => reachable.add(id));
  for (let head = 0; head < queue.length; head++) {
    for (const next of adjacency.get(queue[head]) ?? []) {
      if (!reachable.has(next)) {
        reachable.add(next);
        queue.push(next);
      }
    }
  }

  const isOn = (node: NetworkNode): boolean =>
    !!node.outlet && (scenario?.hydrantOn?.[node.id] ?? node.outlet.on);

  const isolated = network.nodes.filter((n) => !reachable.has(n.id));
  const isolatedActive = isolated.filter(
    (n) => (n.kind !== 'junction' && isOn(n)) || n.baseDemandLpm > 0,
  );
  for (const n of isolatedActive) {
    issues.push({
      severity: 'error',
      message: `${n.label} has no open path to the pump, so it cannot be supplied. Check for a closed valve or a missing pipe.`,
      refs: [n.id],
    });
  }
  const idleCount = isolated.length - isolatedActive.length;
  if (idleCount > 0) {
    const idle = isolated.filter((n) => !isolatedActive.includes(n));
    const names = idle
      .slice(0, 8)
      .map((n) => n.label)
      .join(', ');
    issues.push({
      severity: 'warning',
      message: `${idleCount} node${idleCount > 1 ? 's are' : ' is'} not connected to the pump and left out of the solve: ${names}${idleCount > 8 ? ', ...' : ''}.`,
      refs: idle.map((n) => n.id),
    });
  }

  const nodes = network.nodes.filter((n) => reachable.has(n.id));
  const nodeIndex = new Map(nodes.map((n, i) => [n.id, i]));
  const nUnknown = nodes.length;
  const solvedPipes = openPipes.filter((p) => reachable.has(p.from) && reachable.has(p.to));
  const outletNodes = nodes.filter((n) => n.kind !== 'junction' && n.outlet);
  const emitterNodes = outletNodes.filter((n) => n.outlet?.model === 'emitter');
  const nLinks = solvedPipes.length + network.pumps.length + emitterNodes.length;

  const c: Compiled = {
    ...base,
    nodeIndex,
    nodes,
    elevation: new Float64Array(nUnknown),
    baseDemand: new Float64Array(nUnknown),
    nLinks,
    kind: new Uint8Array(nLinks),
    iFrom: new Int32Array(nLinks).fill(-1),
    iTo: new Int32Array(nLinks).fill(-1),
    hFixed: new Float64Array(nLinks),
    r: new Float64Array(nLinks),
    minorM: new Float64Array(nLinks),
    diameter: new Float64Array(nLinks),
    equivalentLength: new Float64Array(nLinks),
    roughness: new Float64Array(nLinks),
    emitterA: new Float64Array(nLinks),
    emitterB: new Float64Array(nLinks),
    pumpCurves: new Array<FittedCurve | null>(nLinks).fill(null),
    suctionLoss: new Float64Array(nLinks),
    offPos: new Int32Array(nLinks).fill(-1),
    checkDir: new Int8Array(nLinks),
    closedPipeIds,
  };

  nodes.forEach((n, i) => {
    c.elevation[i] = n.elevationM;
    c.baseDemand[i] = lpmToM3s(n.baseDemandLpm);
  });

  // Fittings are physical, so they come from every pipe in the drawing, open or closed.
  const drawn = settings.autoFittings ? junctionFittings(network) : null;
  const edges: [number, number][] = [];
  let link = 0;
  for (const pipe of solvedPipes) {
    const from = nodeIndex.get(pipe.from) as number;
    const to = nodeIndex.get(pipe.to) as number;
    const cValue = effectiveC(pipe, scenario);
    const d = pipe.internalDiameterMm / 1000;
    const loss = fittingLoss(pipe, cValue, settings, tables, drawn?.get(pipe.id));
    const leq = Math.max(pipe.lengthM + loss.equivalentLengthM, MIN_LENGTH_M);
    const area = pipeArea(d);
    c.kind[link] = LINK_PIPE;
    c.iFrom[link] = from;
    c.iTo[link] = to;
    c.r[link] = hazenWilliamsR(leq, cValue, d);
    c.minorM[link] = loss.k / (2 * settings.gravity * area * area);
    c.diameter[link] = d;
    c.equivalentLength[link] = leq;
    c.roughness[link] = pipe.roughnessMm / 1000;
    const nrv = openCheckValves(pipe, scenario);
    c.checkDir[link] = nrv.length === 0 ? 0 : nrv[0].forward ? 1 : -1;
    c.pipes.push({ pipe, linkIndex: link, c: cValue, equivalentLengthM: leq });
    edges.push([from, to]);
    link++;
  }

  for (const pump of network.pumps) {
    const j = nodeIndex.get(pump.nodeId) as number;
    const node = byId.get(pump.nodeId) as NetworkNode;
    c.kind[link] = LINK_PUMP;
    c.iFrom[link] = -1;
    c.iTo[link] = j;
    c.hFixed[link] = node.elevationM + pump.waterLevelM;
    c.pumpCurves[link] = fitPumpCurve(pump.curve);
    c.suctionLoss[link] = pump.suctionLossM;
    c.pumpLinks.push(link);
    link++;
  }

  for (const node of outletNodes) {
    const outlet = node.outlet as Outlet;
    const nodeIdx = nodeIndex.get(node.id) as number;
    const runtime: OutletRuntime = {
      nodeId: node.id,
      nodeIndex: nodeIdx,
      label: node.label,
      outlet,
      linkIndex: -1,
      fixedDemandM3s: lpmToM3s(outlet.fixedFlowLpm * outlet.outlets),
      minPressureM: outlet.minPressureBar * settings.mPerBar,
      minFlowLpm: outlet.minFlowLpm * outlet.outlets,
      isHydrant: node.kind === 'hydrant',
    };
    if (outlet.model === 'emitter') {
      const coeff = emitterCoefficients(outlet, settings.gravity);
      c.kind[link] = LINK_EMITTER;
      c.iFrom[link] = nodeIdx;
      c.iTo[link] = -1;
      c.hFixed[link] = node.elevationM;
      c.emitterA[link] = coeff.a;
      c.emitterB[link] = coeff.b;
      runtime.linkIndex = link;
      link++;
    }
    c.outlets.push(runtime);
    c.initialOn.push(isOn(node));
  }

  if (nUnknown > 0) {
    c.ldl = new SparseLDL(nUnknown, edges);
    for (const rt of c.pipes) {
      c.offPos[rt.linkIndex] = c.ldl.offDiagonalPosition(
        c.iFrom[rt.linkIndex],
        c.iTo[rt.linkIndex],
      );
    }
  }
  return c;
}
