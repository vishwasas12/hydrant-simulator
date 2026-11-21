import { defaultTables, internalDiameterFor, MATERIAL_TABLE } from './tables';
import type { Outlet, Pipe, Project, Pump, PumpCurveSpec, Settings } from './types';

export const DEFAULT_SETTINGS: Settings = {
  frictionModel: 'hazenWilliams',
  fittingMethod: 'equivalentLength',
  applyCFactorToFittings: true,
  autoFittings: true,
  velocityLimitMs: 5,
  kinematicViscosityM2s: 1.0e-6,
  gravity: 9.81,
  mPerBar: 10.197,
  maxIterations: 200,
  headToleranceM: 1e-6,
};

export const DEFAULT_C = 120;
export const DEFAULT_ROUGHNESS_MM = 0.045;

export const DEFAULT_HYDRANT: Outlet = {
  outlets: 1,
  on: false,
  model: 'emitter',
  fixedFlowLpm: 950,
  nozzleMm: 20,
  cd: 0.97,
  hoseLengthM: 15,
  hoseDiameterMm: 63,
  hoseC: 140,
  valveDiameterMm: 63,
  valveK: 2.5,
  minPressureBar: 3.5,
  minFlowLpm: 900,
};

export const DEFAULT_HOSE_REEL: Outlet = {
  outlets: 1,
  on: false,
  model: 'fixed',
  fixedFlowLpm: 30,
  nozzleMm: 6.5,
  cd: 0.97,
  hoseLengthM: 30,
  hoseDiameterMm: 19,
  hoseC: 140,
  valveDiameterMm: 25,
  valveK: 2.5,
  minPressureBar: 1.5,
  minFlowLpm: 30,
};

export const DEFAULT_PUMP_CURVE: PumpCurveSpec = {
  kind: 'threePoint',
  shutoffHeadM: 132,
  ratedHeadM: 110,
  ratedFlowLpm: 2850,
  overloadHeadM: 75,
  overloadFlowLpm: 4275,
};

export function makePump(id: string, label: string, nodeId: string): Pump {
  return {
    id,
    label,
    nodeId,
    curve: { ...DEFAULT_PUMP_CURVE },
    suctionLossM: 0,
    waterLevelM: 0,
  };
}

export function makePipe(
  id: string,
  label: string,
  from: string,
  to: string,
  nominalMm: number,
  lengthM: number,
): Pipe {
  return {
    id,
    label,
    from,
    to,
    nominalMm,
    internalDiameterMm: internalDiameterFor(MATERIAL_TABLE, nominalMm),
    lengthM,
    lengthManual: false,
    c: DEFAULT_C,
    roughnessMm: DEFAULT_ROUGHNESS_MM,
    fittings: [],
    status: 'open',
  };
}

export function emptyProject(name = 'Untitled network'): Project {
  return {
    schemaVersion: 1,
    name,
    nodes: [],
    pipes: [],
    pumps: [],
    settings: { ...DEFAULT_SETTINGS },
    tables: defaultTables(),
    metersPerUnit: 1,
    background: null,
    scenarios: [],
    baseline: null,
  };
}
