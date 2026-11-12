import type { CFactorRow, Fitting, FittingTableRow, FittingType, Pipe, Settings, Tables, ValveType } from '../model/types';

/** The fitting-table row that gives each valve type its head loss. */
export const VALVE_FITTING: Record<ValveType, Exclude<FittingType, 'custom'>> = {
  gate: 'gateValve',
  butterfly: 'butterflyValve',
  nonReturn: 'nonReturnValve',
};

/** Linear interpolation in a size-keyed table, clamped at both ends. */
export function lookupBySize(values: Record<string, number>, sizeMm: number): number {
  const keys = Object.keys(values)
    .map(Number)
    .sort((a, b) => a - b);
  if (keys.length === 0) return 0;
  if (sizeMm <= keys[0]) return values[String(keys[0])];
  const last = keys[keys.length - 1];
  if (sizeMm >= last) return values[String(last)];
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (sizeMm >= a && sizeMm <= b) {
      const t = (sizeMm - a) / (b - a);
      return values[String(a)] * (1 - t) + values[String(b)] * t;
    }
  }
  return values[String(last)];
}

/** NFPA multiplier for a given C, interpolated and clamped to the table. */
export function cFactor(rows: CFactorRow[], c: number): number {
  const sorted = [...rows].sort((a, b) => a.c - b.c);
  if (sorted.length === 0) return 1;
  if (c <= sorted[0].c) return sorted[0].multiplier;
  const last = sorted[sorted.length - 1];
  if (c >= last.c) return last.multiplier;
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (c >= a.c && c <= b.c) {
      const t = (c - a.c) / (b.c - a.c);
      return a.multiplier * (1 - t) + b.multiplier * t;
    }
  }
  return 1;
}

function findRow(table: FittingTableRow[], fitting: Fitting): FittingTableRow | undefined {
  return table.find((r) => r.type === fitting.type);
}

function sizeOf(pipe: Pipe): number {
  return typeof pipe.nominalMm === 'number' ? pipe.nominalMm : pipe.internalDiameterMm;
}

export interface FittingLoss {
  /** Total equivalent length added to the pipe, m. */
  equivalentLengthM: number;
  /** Total K applied as h = K V^2 / 2g. */
  k: number;
}

/**
 * Resolves a pipe's fittings into an added equivalent length and a K sum, under
 * the selected method. A custom fitting keeps the form the user entered, so a
 * custom K still applies as K under the equivalent-length method and vice versa.
 */
export function fittingLoss(
  pipe: Pipe,
  c: number,
  settings: Settings,
  tables: Tables,
): FittingLoss {
  const size = sizeOf(pipe);
  const useK = settings.fittingMethod === 'kValue';
  const applyC = settings.applyCFactorToFittings && settings.frictionModel === 'hazenWilliams';
  const multiplier = applyC ? cFactor(tables.cFactors, c) : 1;
  let equivalentLengthM = 0;
  let k = 0;
  const valveFittings: Fitting[] = (pipe.valves ?? []).map((v) => ({
    id: v.id,
    type: VALVE_FITTING[v.type],
    quantity: 1,
  }));
  for (const fitting of [...pipe.fittings, ...valveFittings]) {
    const qty = fitting.quantity;
    if (fitting.type === 'custom') {
      const v = fitting.customValue ?? 0;
      if (fitting.customMode === 'k') k += qty * v;
      else equivalentLengthM += qty * v;
      continue;
    }
    const row = findRow(tables.fittings, fitting);
    if (!row) continue;
    if (useK) k += qty * lookupBySize(row.k, size);
    else equivalentLengthM += qty * lookupBySize(row.leqM, size) * multiplier;
  }
  return { equivalentLengthM, k };
}
