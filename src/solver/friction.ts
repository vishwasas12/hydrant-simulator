import { HW_CONSTANT, HW_DIAMETER_EXPONENT, HW_FLOW_EXPONENT, pipeArea } from './units';

/** Hazen-Williams resistance r, where hf = r * Q^1.852 (Q in m3/s). */
export function hazenWilliamsR(lengthM: number, c: number, diameterM: number): number {
  return (
    (HW_CONSTANT * lengthM) /
    (Math.pow(c, HW_FLOW_EXPONENT) * Math.pow(diameterM, HW_DIAMETER_EXPONENT))
  );
}

/** Hazen-Williams head loss in m for a positive flow in m3/s. */
export function hazenWilliamsLoss(
  lengthM: number,
  flowM3s: number,
  c: number,
  diameterM: number,
): number {
  return hazenWilliamsR(lengthM, c, diameterM) * Math.pow(Math.abs(flowM3s), HW_FLOW_EXPONENT);
}

const RE_LAMINAR = 2000;
const RE_TURBULENT = 4000;

export function swameeJain(relativeRoughness: number, reynolds: number): number {
  const l = Math.log10(relativeRoughness / 3.7 + 5.74 / Math.pow(reynolds, 0.9));
  return 0.25 / (l * l);
}

/** Darcy friction factor: laminar, linear transition, then Swamee-Jain. */
export function darcyFrictionFactor(relativeRoughness: number, reynolds: number): number {
  if (reynolds <= 1) return 64;
  if (reynolds < RE_LAMINAR) return 64 / reynolds;
  if (reynolds < RE_TURBULENT) {
    const t = (reynolds - RE_LAMINAR) / (RE_TURBULENT - RE_LAMINAR);
    return (64 / RE_LAMINAR) * (1 - t) + swameeJain(relativeRoughness, RE_TURBULENT) * t;
  }
  return swameeJain(relativeRoughness, reynolds);
}

/** Darcy-Weisbach head loss in m for a positive flow in m3/s. */
export function darcyLoss(
  lengthM: number,
  flowM3s: number,
  diameterM: number,
  roughnessM: number,
  viscosity: number,
  gravity: number,
): number {
  const q = Math.abs(flowM3s);
  if (q === 0) return 0;
  const area = pipeArea(diameterM);
  const v = q / area;
  const re = (v * diameterM) / viscosity;
  const f = darcyFrictionFactor(roughnessM / diameterM, re);
  return (f * lengthM * v * v) / (diameterM * 2 * gravity);
}
