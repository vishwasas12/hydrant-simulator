import { LINK_PIPE, LINK_PUMP, type Compiled } from './compile';
import { darcyLoss } from './friction';
import { pumpHead, pumpSlope } from './pumpCurve';
import { HW_FLOW_EXPONENT, LPM_PER_M3S, pipeArea } from './units';

/** Below this flow the head-loss law is replaced by a straight line through zero. */
const Q_SMALL = 1e-6;
/** Resistance applied against reverse flow through a pump or an outlet. */
const BACKFLOW_R = 1e7;
/** Resistance a non-return valve puts against reverse flow. Leakage stays below 0.1 LPM. */
const CHECK_VALVE_R = 1e8;
/** Smallest gradient used for a pump, where its slope is flat or rising. */
const MIN_PUMP_GRADIENT = 1e-3;
const HW_MINUS_ONE = HW_FLOW_EXPONENT - 1;

export interface HydraulicState {
  heads: Float64Array;
  flows: Float64Array;
  converged: boolean;
  iterations: number;
  headResidualM: number;
  flowResidualM3s: number;
}

let outH = 0;
let outG = 0;

/** Writes the head loss from `from` to `to`, and its gradient, into outH and outG. */
function evaluateLink(c: Compiled, l: number, q: number): void {
  const kind = c.kind[l];
  if (kind === LINK_PIPE) {
    const dir = c.checkDir[l];
    if (dir !== 0 && q * dir < 0) {
      outH = CHECK_VALVE_R * q;
      outG = CHECK_VALVE_R;
      return;
    }
    const aq = Math.abs(q);
    const m = c.minorM[l];
    if (c.useDarcy) {
      const d = c.diameter[l];
      const leq = c.equivalentLength[l];
      const e = c.roughness[l];
      if (aq < Q_SMALL) {
        const hs = darcyLoss(leq, Q_SMALL, d, e, c.viscosity, c.gravity) + m * Q_SMALL * Q_SMALL;
        outG = hs / Q_SMALL;
        outH = outG * q;
        return;
      }
      const h1 = darcyLoss(leq, aq, d, e, c.viscosity, c.gravity);
      const h2 = darcyLoss(leq, aq * 1.0001, d, e, c.viscosity, c.gravity);
      outH = (h1 + m * aq * aq) * Math.sign(q);
      outG = (h2 - h1) / (aq * 0.0001) + 2 * m * aq;
      return;
    }
    const r = c.r[l];
    if (aq < Q_SMALL) {
      outG = r * Math.pow(Q_SMALL, HW_MINUS_ONE) + m * Q_SMALL;
      outH = outG * q;
      return;
    }
    const t = r * Math.pow(aq, HW_MINUS_ONE);
    const u = m * aq;
    outH = (t + u) * q;
    outG = HW_FLOW_EXPONENT * t + 2 * u;
    return;
  }
  if (kind === LINK_PUMP) {
    const curve = c.pumpCurves[l];
    if (!curve) throw new Error('Pump link without a curve');
    if (q < 0) {
      outH = -(curve.shutoffHeadM - c.suctionLoss[l]) + BACKFLOW_R * q;
      outG = BACKFLOW_R;
      return;
    }
    const lpm = q * LPM_PER_M3S;
    outH = -(pumpHead(curve, lpm) - c.suctionLoss[l]);
    outG = Math.max(-pumpSlope(curve, lpm) * LPM_PER_M3S, MIN_PUMP_GRADIENT);
    return;
  }
  // Emitter: one-way, discharging to atmosphere at the node elevation.
  if (q < 0) {
    outH = BACKFLOW_R * q;
    outG = BACKFLOW_R;
    return;
  }
  const a = c.emitterA[l];
  const b = c.emitterB[l];
  if (q < Q_SMALL) {
    outG = a * Q_SMALL + b * Math.pow(Q_SMALL, HW_MINUS_ONE);
    outH = outG * q;
    return;
  }
  const t = a * q;
  const u = b * Math.pow(q, HW_MINUS_ONE);
  outH = (t + u) * q;
  outG = 2 * t + HW_FLOW_EXPONENT * u;
}

/** Evaluates the head loss on one link at one flow. Used when reporting results. */
export function linkHeadLoss(c: Compiled, l: number, q: number): number {
  evaluateLink(c, l, q);
  return outH;
}

function initialFlows(c: Compiled, on: readonly boolean[], active: Uint8Array): Float64Array {
  const q = new Float64Array(c.nLinks);
  let total = 0;
  for (let i = 0; i < c.baseDemand.length; i++) total += c.baseDemand[i];
  c.outlets.forEach((o, i) => {
    if (!on[i]) return;
    if (o.linkIndex >= 0) {
      const estimate = Math.sqrt(50 / c.emitterA[o.linkIndex]);
      q[o.linkIndex] = estimate;
      total += estimate;
    } else {
      total += o.fixedDemandM3s;
    }
  });
  for (const rt of c.pipes) {
    // Start at 1 m/s, in the direction any non-return valve allows.
    q[rt.linkIndex] = pipeArea(c.diameter[rt.linkIndex]) * (c.checkDir[rt.linkIndex] < 0 ? -1 : 1);
  }
  const perPump = c.pumpLinks.length > 0 ? total / c.pumpLinks.length : 0;
  for (const l of c.pumpLinks) q[l] = Math.max(perPump, 1e-4);
  for (let l = 0; l < c.nLinks; l++) if (!active[l]) q[l] = 0;
  return q;
}

/**
 * Global Gradient Algorithm (Todini-Pilati). Each iteration linearises every
 * link, solves the symmetric node-head system, then recovers flows from heads.
 * A backtracking step guards the kinks in the pump and outlet laws.
 */
export function iterate(
  c: Compiled,
  on: readonly boolean[],
  warm?: Pick<HydraulicState, 'heads' | 'flows'>,
): HydraulicState {
  const n = c.nodes.length;
  const ldl = c.ldl;
  if (!ldl) throw new Error('Nothing to solve');

  const active = new Uint8Array(c.nLinks).fill(1);
  const demand = new Float64Array(n);
  demand.set(c.baseDemand);
  c.outlets.forEach((o, i) => {
    if (o.linkIndex >= 0) active[o.linkIndex] = on[i] ? 1 : 0;
    else if (on[i]) demand[o.nodeIndex] += o.fixedDemandM3s;
  });

  let q = initialFlows(c, on, active);
  if (warm) {
    q.set(warm.flows);
    c.outlets.forEach((o, i) => {
      if (o.linkIndex < 0) return;
      if (!on[i]) q[o.linkIndex] = 0;
      else if (q[o.linkIndex] <= 0) q[o.linkIndex] = Math.sqrt(50 / c.emitterA[o.linkIndex]);
    });
  }
  let h = new Float64Array(n);
  if (warm) h.set(warm.heads);

  const p = new Float64Array(c.nLinks);
  const y = new Float64Array(c.nLinks);
  const rhs = new Float64Array(n);
  const hNew = new Float64Array(n);
  const qNew = new Float64Array(c.nLinks);
  const hTrial = new Float64Array(n);
  const qTrial = new Float64Array(c.nLinks);
  const values = ldl.values;

  const energyResidual = (heads: Float64Array, flows: Float64Array): number => {
    let worst = 0;
    for (let l = 0; l < c.nLinks; l++) {
      if (!active[l]) continue;
      const hi = c.iFrom[l] >= 0 ? heads[c.iFrom[l]] : c.hFixed[l];
      const hj = c.iTo[l] >= 0 ? heads[c.iTo[l]] : c.hFixed[l];
      evaluateLink(c, l, flows[l]);
      const e = Math.abs(hi - hj - outH);
      if (e > worst) worst = e;
    }
    return worst;
  };

  let merit = Infinity;
  let iterations = 0;
  let converged = false;

  for (let it = 1; it <= c.maxIterations; it++) {
    iterations = it;
    values.fill(0);
    for (let i = 0; i < n; i++) rhs[i] = -demand[i];

    for (let l = 0; l < c.nLinks; l++) {
      if (!active[l]) continue;
      evaluateLink(c, l, q[l]);
      const pl = 1 / outG;
      const yl = q[l] - pl * outH;
      p[l] = pl;
      y[l] = yl;
      const i = c.iFrom[l];
      const j = c.iTo[l];
      if (i >= 0) {
        values[ldl.diagPos[i]] += pl;
        rhs[i] -= yl;
      } else {
        rhs[j] += pl * c.hFixed[l];
      }
      if (j >= 0) {
        values[ldl.diagPos[j]] += pl;
        rhs[j] += yl;
      } else {
        rhs[i] += pl * c.hFixed[l];
      }
      if (i >= 0 && j >= 0) values[c.offPos[l]] -= pl;
    }

    if (!ldl.factor()) break;
    ldl.solve(rhs, hNew);

    for (let l = 0; l < c.nLinks; l++) {
      if (!active[l]) {
        qNew[l] = 0;
        continue;
      }
      const hi = c.iFrom[l] >= 0 ? hNew[c.iFrom[l]] : c.hFixed[l];
      const hj = c.iTo[l] >= 0 ? hNew[c.iTo[l]] : c.hFixed[l];
      qNew[l] = y[l] + p[l] * (hi - hj);
    }

    let residual = energyResidual(hNew, qNew);
    let useTrial = false;
    if (it > 1 && residual > merit) {
      let best = residual;
      for (let alpha = 0.5; alpha >= 0.06; alpha /= 2) {
        for (let i = 0; i < n; i++) hTrial[i] = h[i] + alpha * (hNew[i] - h[i]);
        for (let l = 0; l < c.nLinks; l++) qTrial[l] = q[l] + alpha * (qNew[l] - q[l]);
        const trial = energyResidual(hTrial, qTrial);
        if (trial < best) {
          best = trial;
          useTrial = true;
          if (trial < merit) break;
        }
      }
      if (useTrial) residual = best;
    }

    if (useTrial) {
      h.set(hTrial);
      q.set(qTrial);
    } else {
      h.set(hNew);
      q.set(qNew);
    }
    merit = residual;
    if (residual < c.tolerance) {
      converged = true;
      break;
    }
  }

  // Mass balance at every node, measured on the final flows.
  const imbalance = new Float64Array(n);
  for (let i = 0; i < n; i++) imbalance[i] = -demand[i];
  for (let l = 0; l < c.nLinks; l++) {
    if (!active[l]) continue;
    if (c.iFrom[l] >= 0) imbalance[c.iFrom[l]] -= q[l];
    if (c.iTo[l] >= 0) imbalance[c.iTo[l]] += q[l];
  }
  let flowResidual = 0;
  for (let i = 0; i < n; i++) flowResidual = Math.max(flowResidual, Math.abs(imbalance[i]));

  return {
    heads: h,
    flows: q,
    converged,
    iterations,
    headResidualM: merit,
    flowResidualM3s: flowResidual,
  };
}
