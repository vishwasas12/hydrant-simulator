import type { CurvePoint, PumpCurveSpec } from '../model/types';

/** A fitted pump curve. Polynomial coefficients are in ascending powers of LPM. */
export interface FittedCurve {
  coefficients: number[];
  /** Highest flow the curve was fitted to. Beyond this it is extrapolated. */
  maxFlowLpm: number;
  shutoffHeadM: number;
  points: CurvePoint[];
}

/** Solves a small dense system by Gaussian elimination with partial pivoting. */
function solveDense(a: number[][], b: number[]): number[] {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    }
    [m[col], m[pivot]] = [m[pivot], m[col]];
    if (Math.abs(m[col][col]) < 1e-14) throw new Error('Pump curve points are degenerate');
    for (let r = col + 1; r < n; r++) {
      const f = m[r][col] / m[col][col];
      for (let c = col; c <= n; c++) m[r][c] -= f * m[col][c];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = m[r][n];
    for (let c = r + 1; c < n; c++) s -= m[r][c] * x[c];
    x[r] = s / m[r][r];
  }
  return x;
}

/** Least-squares polynomial fit. Flow is normalised first for conditioning. */
export function fitPolynomial(points: CurvePoint[], degree: number): number[] {
  const scale = Math.max(...points.map((p) => p.flowLpm), 1);
  const d = Math.min(degree, points.length - 1);
  const size = d + 1;
  const ata = Array.from({ length: size }, () => new Array<number>(size).fill(0));
  const atb = new Array<number>(size).fill(0);
  for (const p of points) {
    const t = p.flowLpm / scale;
    const powers = Array.from({ length: size }, (_, i) => Math.pow(t, i));
    for (let i = 0; i < size; i++) {
      atb[i] += powers[i] * p.headM;
      for (let j = 0; j < size; j++) ata[i][j] += powers[i] * powers[j];
    }
  }
  const scaled = solveDense(ata, atb);
  return scaled.map((c, i) => c / Math.pow(scale, i));
}

export function curvePoints(spec: PumpCurveSpec): CurvePoint[] {
  if (spec.kind === 'threePoint') {
    return [
      { flowLpm: 0, headM: spec.shutoffHeadM },
      { flowLpm: spec.ratedFlowLpm, headM: spec.ratedHeadM },
      { flowLpm: spec.overloadFlowLpm, headM: spec.overloadHeadM },
    ];
  }
  if (spec.kind === 'table') return [...spec.points].sort((a, b) => a.flowLpm - b.flowLpm);
  return [{ flowLpm: 0, headM: spec.headM }];
}

export function fitPumpCurve(spec: PumpCurveSpec): FittedCurve {
  const points = curvePoints(spec);
  if (spec.kind === 'constant') {
    return {
      coefficients: [spec.headM],
      maxFlowLpm: Infinity,
      shutoffHeadM: spec.headM,
      points,
    };
  }
  if (points.length < 2) throw new Error('A pump curve needs at least two points');
  const degree = spec.kind === 'threePoint' ? 2 : spec.degree;
  const coefficients = fitPolynomial(points, degree);
  return {
    coefficients,
    maxFlowLpm: points[points.length - 1].flowLpm,
    shutoffHeadM: coefficients[0],
    points,
  };
}

function polyValue(c: number[], x: number): number {
  let v = 0;
  for (let i = c.length - 1; i >= 0; i--) v = v * x + c[i];
  return v;
}

function polySlope(c: number[], x: number): number {
  let v = 0;
  for (let i = c.length - 1; i >= 1; i--) v = v * x + i * c[i];
  return v;
}

/**
 * Head at a flow in LPM. Above the last fitted point the curve continues as a
 * straight line, because a polynomial can turn back up outside its data.
 */
export function pumpHead(curve: FittedCurve, flowLpm: number): number {
  const q = Math.max(flowLpm, 0);
  if (q <= curve.maxFlowLpm) return polyValue(curve.coefficients, q);
  const end = polyValue(curve.coefficients, curve.maxFlowLpm);
  const slope = Math.min(polySlope(curve.coefficients, curve.maxFlowLpm), -1e-6);
  return end + slope * (q - curve.maxFlowLpm);
}

/** Slope dH/dQ in m per LPM, matching pumpHead. */
export function pumpSlope(curve: FittedCurve, flowLpm: number): number {
  const q = Math.max(flowLpm, 0);
  if (q <= curve.maxFlowLpm) return polySlope(curve.coefficients, q);
  return Math.min(polySlope(curve.coefficients, curve.maxFlowLpm), -1e-6);
}
