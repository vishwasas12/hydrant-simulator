import type { Id, Network } from '../model/types';
import type { Compiled, OutletRuntime } from './compile';
import { linkHeadLoss, type HydraulicState } from './gga';
import { pumpHead } from './pumpCurve';
import type {
  CriticalPath,
  CriticalPathSegment,
  Issue,
  NodeResult,
  OutletStatus,
  PipeResult,
  SolveResults,
  SystemResult,
} from './types';
import { LPM_PER_M3S, m3sToLpm, pipeArea } from './units';

/** Flow tolerance when comparing against a requirement, LPM. */
const FLOW_EPS = 1e-6;

export interface OutletCheck {
  pressureM: number;
  flowLpm: number;
  pressureOk: boolean;
  flowOk: boolean;
  margin: number;
}

/** Compares one open outlet with its minimum pressure and flow. */
export function checkOutlet(
  c: Compiled,
  o: OutletRuntime,
  state: Pick<HydraulicState, 'heads' | 'flows'>,
): OutletCheck {
  const pressureM = state.heads[o.nodeIndex] - c.elevation[o.nodeIndex];
  const flowLpm =
    o.linkIndex >= 0
      ? Math.max(m3sToLpm(state.flows[o.linkIndex]), 0)
      : pressureM > 0
        ? m3sToLpm(o.fixedDemandM3s)
        : 0;
  const pressureOk = pressureM >= o.minPressureM - FLOW_EPS;
  const flowOk = flowLpm >= o.minFlowLpm - FLOW_EPS;
  const pressureMargin = o.minPressureM > 0 ? (pressureM - o.minPressureM) / o.minPressureM : Infinity;
  const flowMargin = o.minFlowLpm > 0 ? (flowLpm - o.minFlowLpm) / o.minFlowLpm : Infinity;
  // A fixed demand that meets the minimum is an input, not a hydraulic outcome,
  // so only pressure can erode its margin.
  const flowCounts = o.linkIndex >= 0 || !flowOk;
  const margin = flowCounts ? Math.min(pressureMargin, flowMargin) : pressureMargin;
  return { pressureM, flowLpm, pressureOk, flowOk, margin: Number.isFinite(margin) ? margin : 0 };
}

export function emptySystem(): SystemResult {
  return {
    pumpFlowLpm: 0,
    pumpHeadM: 0,
    pumpPressureBar: 0,
    pumpBeyondCurve: false,
    totalOutflowLpm: 0,
    criticalNodeId: null,
    criticalPressureBar: null,
    openOutlets: 0,
    passingOutlets: 0,
    failingOutlets: 0,
  };
}

/** Result shell for a network that could not be solved. */
export function failedResults(network: Network, issues: Issue[]): SolveResults {
  return {
    ok: false,
    converged: false,
    iterations: 0,
    headResidualM: 0,
    flowResidualLpm: 0,
    nodes: network.nodes.map((n) => ({
      id: n.id,
      label: n.label,
      kind: n.kind,
      connected: false,
      elevationM: n.elevationM,
      headM: null,
      pressureM: null,
      pressureBar: null,
      outflowLpm: 0,
      outletFlowLpm: 0,
      status: null,
      pressureOk: null,
      flowOk: null,
      requiredPressureBar: n.outlet?.minPressureBar ?? null,
      requiredFlowLpm: n.outlet ? n.outlet.minFlowLpm * n.outlet.outlets : null,
      margin: null,
    })),
    pipes: network.pipes.map((p) => ({
      id: p.id,
      label: p.label,
      status: p.status,
      connected: false,
      flowLpm: 0,
      upstreamId: p.from,
      downstreamId: p.to,
      velocityMs: 0,
      velocityExceeded: false,
      heldByCheckValve: false,
      headLossM: 0,
      lossPer100M: 0,
      lengthM: p.lengthM,
      equivalentLengthM: p.lengthM,
      diameterMm: p.internalDiameterMm,
    })),
    system: emptySystem(),
    issues,
  };
}

export function buildResults(
  c: Compiled,
  on: readonly boolean[],
  state: HydraulicState,
): SolveResults {
  const { network, mPerBar } = c;
  const issues: Issue[] = [...c.issues];

  const outletByNode = new Map<Id, { runtime: OutletRuntime; index: number }>();
  c.outlets.forEach((runtime, index) => outletByNode.set(runtime.nodeId, { runtime, index }));

  const nodes: NodeResult[] = network.nodes.map((n) => {
    const idx = c.nodeIndex.get(n.id);
    const required = n.outlet
      ? {
          requiredPressureBar: n.outlet.minPressureBar,
          requiredFlowLpm: n.outlet.minFlowLpm * n.outlet.outlets,
        }
      : { requiredPressureBar: null, requiredFlowLpm: null };

    if (idx === undefined) {
      // Not reachable. An open outlet here is a failure, not a blank.
      const wanted = issues.some((i) => i.severity === 'error' && i.refs.includes(n.id));
      const hasOutlet = n.kind !== 'junction' && !!n.outlet;
      return {
        id: n.id,
        label: n.label,
        kind: n.kind,
        connected: false,
        elevationM: n.elevationM,
        headM: null,
        pressureM: null,
        pressureBar: null,
        outflowLpm: 0,
        outletFlowLpm: 0,
        status: hasOutlet ? (wanted ? 'fail' : 'off') : null,
        pressureOk: wanted ? false : null,
        flowOk: wanted ? false : null,
        margin: wanted ? -1 : null,
        ...required,
      };
    }

    const head = state.heads[idx];
    const pressureM = head - n.elevationM;
    const entry = outletByNode.get(n.id);
    let outletFlowLpm = 0;
    let status: OutletStatus | null = null;
    let pressureOk: boolean | null = null;
    let flowOk: boolean | null = null;
    let margin: number | null = null;
    if (entry) {
      if (on[entry.index]) {
        const check = checkOutlet(c, entry.runtime, state);
        outletFlowLpm = check.flowLpm;
        pressureOk = check.pressureOk;
        flowOk = check.flowOk;
        margin = check.margin;
        status = check.pressureOk && check.flowOk ? 'pass' : 'fail';
      } else {
        status = 'off';
      }
    }
    return {
      id: n.id,
      label: n.label,
      kind: n.kind,
      connected: true,
      elevationM: n.elevationM,
      headM: head,
      pressureM,
      pressureBar: pressureM / mPerBar,
      outflowLpm: outletFlowLpm + n.baseDemandLpm,
      outletFlowLpm,
      status,
      pressureOk,
      flowOk,
      margin,
      ...required,
    };
  });

  const solved = new Map(c.pipes.map((rt) => [rt.pipe.id, rt]));
  let velocityFlags = 0;
  const pipes: PipeResult[] = network.pipes.map((p) => {
    const rt = solved.get(p.id);
    if (!rt) {
      return {
        id: p.id,
        label: p.label,
        // An open pipe can still be cut off from the pump by other closures.
        status: c.closedPipeIds.has(p.id) ? 'closed' : 'open',
        connected: false,
        flowLpm: 0,
        upstreamId: p.from,
        downstreamId: p.to,
        velocityMs: 0,
        velocityExceeded: false,
        heldByCheckValve: false,
        headLossM: 0,
        lossPer100M: 0,
        lengthM: p.lengthM,
        equivalentLengthM: p.lengthM,
        diameterMm: p.internalDiameterMm,
      };
    }
    const q = state.flows[rt.linkIndex];
    const area = pipeArea(c.diameter[rt.linkIndex]);
    const velocity = Math.abs(q) / area;
    const headLoss = Math.abs(linkHeadLoss(c, rt.linkIndex, q));
    const exceeded = velocity > network.settings.velocityLimitMs;
    if (exceeded) velocityFlags++;
    const held = c.checkDir[rt.linkIndex] !== 0 && q * c.checkDir[rt.linkIndex] < 0;
    return {
      id: p.id,
      label: p.label,
      status: 'open',
      connected: true,
      flowLpm: m3sToLpm(q),
      upstreamId: q >= 0 ? p.from : p.to,
      downstreamId: q >= 0 ? p.to : p.from,
      velocityMs: velocity,
      velocityExceeded: exceeded,
      heldByCheckValve: held,
      headLossM: headLoss,
      lossPer100M: held || p.lengthM <= 0 ? 0 : (headLoss / p.lengthM) * 100,
      lengthM: p.lengthM,
      equivalentLengthM: rt.equivalentLengthM,
      diameterMm: p.internalDiameterMm,
    };
  });

  const firstPump = c.pumpLinks[0];
  const pumpQ = firstPump === undefined ? 0 : Math.max(state.flows[firstPump], 0);
  const curve = firstPump === undefined ? null : c.pumpCurves[firstPump];
  const pumpFlowLpm = c.pumpLinks.reduce(
    (sum, l) => sum + Math.max(state.flows[l], 0) * LPM_PER_M3S,
    0,
  );
  const pumpHeadM = curve ? pumpHead(curve, pumpQ * LPM_PER_M3S) : 0;
  const pumpBeyondCurve = c.pumpLinks.some((l) => {
    const pc = c.pumpCurves[l];
    return !!pc && state.flows[l] * LPM_PER_M3S > pc.maxFlowLpm + 1e-6;
  });
  if (pumpBeyondCurve) {
    issues.push({
      severity: 'warning',
      message: 'The pump is running beyond the last point on its curve, so its head is extrapolated.',
      refs: network.pumps.map((p) => p.id),
    });
  }

  let critical: NodeResult | null = null;
  const openNodes = nodes.filter((n) => n.status === 'pass' || n.status === 'fail');
  const openHydrants = openNodes.filter((n) => n.kind === 'hydrant' && n.pressureBar !== null);
  const pool = openHydrants.length > 0 ? openHydrants : openNodes.filter((n) => n.pressureBar !== null);
  for (const n of pool) {
    if (critical === null || (n.pressureBar as number) < (critical.pressureBar as number)) critical = n;
  }

  const negative = nodes.filter((n) => n.pressureM !== null && n.pressureM < -1e-6);
  if (negative.length > 0) {
    const names = negative
      .slice(0, 8)
      .map((n) => n.label)
      .join(', ');
    issues.push({
      severity: 'warning',
      message: `Negative pressure at ${negative.length} node${negative.length > 1 ? 's' : ''} (${names}${negative.length > 8 ? ', ...' : ''}). Fixed demands there cannot physically be met.`,
      refs: negative.map((n) => n.id),
    });
  }
  if (velocityFlags > 0) {
    issues.push({
      severity: 'warning',
      message: `${velocityFlags} pipe${velocityFlags > 1 ? 's exceed' : ' exceeds'} the ${network.settings.velocityLimitMs} m/s velocity limit.`,
      refs: pipes.filter((p) => p.velocityExceeded).map((p) => p.id),
    });
  }
  if (!state.converged) {
    issues.push({
      severity: 'error',
      message: `The solver did not converge after ${state.iterations} iterations (head residual ${state.headResidualM.toExponential(2)} m). Check for extreme pipe sizes or demands.`,
      refs: [],
    });
  }

  const totalOutflowLpm = nodes.reduce((s, n) => s + n.outflowLpm, 0);
  const system: SystemResult = {
    pumpFlowLpm,
    pumpHeadM,
    pumpPressureBar: pumpHeadM / mPerBar,
    pumpBeyondCurve,
    totalOutflowLpm,
    criticalNodeId: critical ? critical.id : null,
    criticalPressureBar: critical ? critical.pressureBar : null,
    openOutlets: openNodes.length,
    passingOutlets: openNodes.filter((n) => n.status === 'pass').length,
    failingOutlets: openNodes.filter((n) => n.status === 'fail').length,
  };

  return {
    ok: state.converged,
    converged: state.converged,
    iterations: state.iterations,
    headResidualM: state.headResidualM,
    flowResidualLpm: m3sToLpm(state.flowResidualM3s),
    nodes,
    pipes,
    system,
    issues,
  };
}

/**
 * Walks upstream from the critical outlet to the pump, always taking the inflow
 * pipe that carries the most water. Head falls along any flow path, so the walk
 * cannot cycle.
 */
export function criticalPath(network: Network, results: SolveResults): CriticalPath | null {
  const target = results.system.criticalNodeId;
  if (!target || !results.ok) return null;
  const pumpNodes = new Set(network.pumps.map((p) => p.nodeId));
  const nodeById = new Map(results.nodes.map((n) => [n.id, n]));
  const inflow = new Map<Id, PipeResult[]>();
  for (const p of results.pipes) {
    if (!p.connected || Math.abs(p.flowLpm) < 1e-3) continue;
    const list = inflow.get(p.downstreamId);
    if (list) list.push(p);
    else inflow.set(p.downstreamId, [p]);
  }

  const reversed: PipeResult[] = [];
  const visited = new Set<Id>([target]);
  let current = target;
  while (!pumpNodes.has(current)) {
    const candidates = (inflow.get(current) ?? []).filter((p) => !visited.has(p.upstreamId));
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => Math.abs(b.flowLpm) - Math.abs(a.flowLpm));
    const pick = candidates[0];
    reversed.push(pick);
    current = pick.upstreamId;
    visited.add(current);
  }

  const ordered = reversed.reverse();
  const startNode = nodeById.get(current);
  const nodeIds: Id[] = [current];
  const segments: CriticalPathSegment[] = [];
  let distance = 0;
  for (const p of ordered) {
    const up = nodeById.get(p.upstreamId);
    const down = nodeById.get(p.downstreamId);
    distance += p.lengthM;
    nodeIds.push(p.downstreamId);
    segments.push({
      pipeId: p.id,
      label: p.label,
      fromLabel: up?.label ?? '',
      toLabel: down?.label ?? '',
      lengthM: p.lengthM,
      equivalentLengthM: p.equivalentLengthM,
      flowLpm: Math.abs(p.flowLpm),
      headLossM: p.headLossM,
      pressureAfterBar: down?.pressureBar ?? 0,
      distanceAfterM: distance,
    });
  }
  return {
    targetId: target,
    nodeIds,
    pipeIds: ordered.map((p) => p.id),
    startPressureBar: startNode?.pressureBar ?? 0,
    segments,
  };
}
