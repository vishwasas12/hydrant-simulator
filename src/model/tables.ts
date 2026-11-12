import type { CFactorRow, FittingTableRow, MaterialTable, Tables } from './types';

export const NOMINAL_SIZES = [25, 32, 40, 50, 65, 80, 100, 150, 200] as const;

/**
 * MS heavy class pipe. Up to 150 NB: IS 1239 Part 1 heavy series.
 * 200 NB is outside IS 1239 and uses IS 3589, 219.1 x 6.3.
 * ID = OD - 2 x wall.
 */
export const MATERIAL_TABLE: MaterialTable = {
  name: 'MS heavy class (IS 1239 / IS 3589)',
  source: 'IS 1239 Pt 1 heavy series (to 150 NB); IS 3589 219.1 x 6.3 (200 NB)',
  rows: [
    { nominalMm: 25, outerDiameterMm: 33.7, wallMm: 4.0, internalDiameterMm: 25.7 },
    { nominalMm: 32, outerDiameterMm: 42.4, wallMm: 4.0, internalDiameterMm: 34.4 },
    { nominalMm: 40, outerDiameterMm: 48.3, wallMm: 4.0, internalDiameterMm: 40.3 },
    { nominalMm: 50, outerDiameterMm: 60.3, wallMm: 4.5, internalDiameterMm: 51.3 },
    { nominalMm: 65, outerDiameterMm: 76.1, wallMm: 4.5, internalDiameterMm: 67.1 },
    { nominalMm: 80, outerDiameterMm: 88.9, wallMm: 4.8, internalDiameterMm: 79.3 },
    { nominalMm: 100, outerDiameterMm: 114.3, wallMm: 5.4, internalDiameterMm: 103.5 },
    { nominalMm: 150, outerDiameterMm: 165.1, wallMm: 5.4, internalDiameterMm: 154.3 },
    { nominalMm: 200, outerDiameterMm: 219.1, wallMm: 6.3, internalDiameterMm: 206.5 },
  ],
};

const SIZES = NOMINAL_SIZES;

function bySize(values: readonly number[]): Record<string, number> {
  const out: Record<string, number> = {};
  SIZES.forEach((s, i) => {
    out[String(s)] = values[i];
  });
  return out;
}

/** Crane TP-410 friction factor at full turbulence, by nominal size. */
const F_T = [0.023, 0.022, 0.021, 0.019, 0.018, 0.018, 0.017, 0.015, 0.014];
const kFrom = (multiple: number) => bySize(F_T.map((f) => +(f * multiple).toFixed(3)));

const NFPA = 'NFPA 13 equivalent pipe length chart (C = 120)';
const NFPA_EST = `${NFPA}; sizes below 50 mm not listed, estimated`;

export const FITTING_TABLE: FittingTableRow[] = [
  {
    type: 'elbow90',
    name: '90° elbow',
    source: NFPA,
    leqM: bySize([0.6, 0.9, 1.2, 1.5, 1.8, 2.1, 3.0, 4.3, 5.5]),
    k: kFrom(30),
  },
  {
    type: 'elbow45',
    name: '45° elbow',
    source: NFPA,
    leqM: bySize([0.3, 0.3, 0.6, 0.6, 0.9, 0.9, 1.2, 2.1, 2.7]),
    k: kFrom(16),
  },
  {
    type: 'longRadiusBend',
    name: 'Long-radius bend',
    source: NFPA,
    leqM: bySize([0.6, 0.6, 0.6, 0.9, 1.2, 1.5, 1.8, 2.7, 4.0]),
    k: kFrom(20),
  },
  {
    type: 'teeRun',
    name: 'Tee (run)',
    source: 'Estimate: one third of tee (branch), the Crane TP-410 run/branch ratio',
    leqM: bySize([0.5, 0.6, 0.8, 1.0, 1.2, 1.5, 2.0, 3.0, 3.6]),
    k: kFrom(20),
  },
  {
    type: 'teeBranch',
    name: 'Tee (branch)',
    source: NFPA,
    leqM: bySize([1.5, 1.8, 2.4, 3.0, 3.7, 4.6, 6.1, 9.1, 10.7]),
    k: kFrom(60),
  },
  {
    type: 'butterflyValve',
    name: 'Butterfly valve',
    source: NFPA_EST,
    leqM: bySize([1.8, 1.8, 1.8, 1.8, 2.1, 3.0, 3.7, 3.0, 3.7]),
    k: kFrom(45),
  },
  {
    type: 'gateValve',
    name: 'Gate valve',
    source: NFPA_EST,
    leqM: bySize([0.2, 0.2, 0.3, 0.3, 0.3, 0.3, 0.6, 0.9, 1.2]),
    k: kFrom(8),
  },
  {
    type: 'nonReturnValve',
    name: 'Non-return valve (swing)',
    source: NFPA,
    leqM: bySize([1.5, 2.1, 2.7, 3.4, 4.3, 4.9, 6.7, 9.7, 13.7]),
    k: kFrom(100),
  },
  {
    type: 'reducer',
    name: 'Reducer',
    source: 'Estimate: K about 0.3, so L_eq about 15 x D. Not in NFPA 13',
    leqM: bySize([0.4, 0.5, 0.6, 0.8, 1.0, 1.2, 1.5, 2.3, 3.0]),
    k: bySize([0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3]),
  },
];

/** NFPA 13 multiplier applied to equivalent lengths when C is not 120. */
export const C_FACTORS: CFactorRow[] = [
  { c: 100, multiplier: 0.713 },
  { c: 120, multiplier: 1.0 },
  { c: 130, multiplier: 1.16 },
  { c: 140, multiplier: 1.33 },
  { c: 150, multiplier: 1.51 },
];

export const C_PRESETS: { label: string; c: number }[] = [
  { label: 'New steel', c: 120 },
  { label: 'Aged steel', c: 100 },
  { label: 'HDPE', c: 150 },
  { label: 'Cement-lined', c: 140 },
];

export function defaultTables(): Tables {
  return JSON.parse(
    JSON.stringify({ material: MATERIAL_TABLE, fittings: FITTING_TABLE, cFactors: C_FACTORS }),
  ) as Tables;
}

export function internalDiameterFor(table: MaterialTable, nominalMm: number): number {
  const row = table.rows.find((r) => r.nominalMm === nominalMm);
  return row ? row.internalDiameterMm : nominalMm;
}
