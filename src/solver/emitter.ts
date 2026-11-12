import type { Outlet } from '../model/types';
import { hazenWilliamsR } from './friction';
import { HW_FLOW_EXPONENT, lpmToM3s, m3sToLpm, pipeArea } from './units';

/** Nozzle K in (m3/s)/sqrt(m), so that Q = K * sqrt(P) with P in m of water. */
export function nozzleK(nozzleMm: number, cd: number, gravity: number): number {
  return cd * pipeArea(nozzleMm / 1000) * Math.sqrt(2 * gravity);
}

export interface EmitterCoefficients {
  /** Quadratic term: h = a * Q^2 + b * Q^1.852, with Q in m3/s for the whole node. */
  a: number;
  b: number;
}

/**
 * Head needed at the node to push a flow through the landing valve, the hose and
 * the nozzle. Outlets act in parallel, so each carries Q / outlets.
 */
export function emitterCoefficients(outlet: Outlet, gravity: number): EmitterCoefficients {
  const k = nozzleK(outlet.nozzleMm, outlet.cd, gravity);
  const valveArea = pipeArea(outlet.valveDiameterMm / 1000);
  const valveTerm = outlet.valveK / (2 * gravity * valveArea * valveArea);
  const n = outlet.outlets;
  const a = (1 / (k * k) + valveTerm) / (n * n);
  const hoseR =
    outlet.hoseLengthM > 0
      ? hazenWilliamsR(outlet.hoseLengthM, outlet.hoseC, outlet.hoseDiameterMm / 1000)
      : 0;
  const b = hoseR / Math.pow(n, HW_FLOW_EXPONENT);
  return { a, b };
}

export function emitterHeadForFlow(c: EmitterCoefficients, flowM3s: number): number {
  return c.a * flowM3s * flowM3s + c.b * Math.pow(flowM3s, HW_FLOW_EXPONENT);
}

/** Flow in m3/s at a given head. Inverts the monotonic head law by bisection. */
export function emitterFlowForHead(c: EmitterCoefficients, headM: number): number {
  if (headM <= 0) return 0;
  let lo = 0;
  let hi = Math.sqrt(headM / c.a);
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (emitterHeadForFlow(c, mid) > headM) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

/** Whole-node flow in LPM at a pressure in bar, for display and checks. */
export function emitterFlowLpm(
  outlet: Outlet,
  pressureBar: number,
  gravity: number,
  mPerBar: number,
): number {
  return m3sToLpm(
    emitterFlowForHead(emitterCoefficients(outlet, gravity), pressureBar * mPerBar),
  );
}

/** Pressure in bar needed for the whole-node flow in LPM. */
export function emitterPressureBar(
  outlet: Outlet,
  flowLpm: number,
  gravity: number,
  mPerBar: number,
): number {
  return emitterHeadForFlow(emitterCoefficients(outlet, gravity), lpmToM3s(flowLpm)) / mPerBar;
}
