/**
 * Project data model. Everything here is plain JSON so a project can be saved,
 * loaded and diffed. User-facing units: m, mm, LPM, bar.
 */

export type Id = string;

export type NodeKind = 'junction' | 'hydrant' | 'hoseReel';
export type DischargeModel = 'emitter' | 'fixed';

/** Outlet configuration carried by hydrant and hose-reel nodes. */
export interface Outlet {
  /** Number of identical outlets on this node (single = 1, double = 2). */
  outlets: 1 | 2;
  on: boolean;
  model: DischargeModel;
  /** Fixed-demand model: flow per outlet, LPM. */
  fixedFlowLpm: number;
  /** Emitter model: nozzle bore, mm. */
  nozzleMm: number;
  /** Emitter model: nozzle discharge coefficient. */
  cd: number;
  hoseLengthM: number;
  hoseDiameterMm: number;
  /** Hazen-Williams C of the hose lining. */
  hoseC: number;
  valveDiameterMm: number;
  /** Landing-valve loss coefficient, applied to the velocity in the valve bore. */
  valveK: number;
  /** Required minimum residual pressure at the node, bar. */
  minPressureBar: number;
  /** Required minimum flow per outlet, LPM. */
  minFlowLpm: number;
}

export interface NetworkNode {
  id: Id;
  label: string;
  x: number;
  y: number;
  elevationM: number;
  baseDemandLpm: number;
  kind: NodeKind;
  outlet?: Outlet;
}

export type FittingType =
  | 'elbow90'
  | 'elbow45'
  | 'longRadiusBend'
  | 'teeRun'
  | 'teeBranch'
  | 'butterflyValve'
  | 'gateValve'
  | 'nonReturnValve'
  | 'reducer'
  | 'custom';

export interface Fitting {
  id: Id;
  type: FittingType;
  quantity: number;
  /** Only for type = custom. */
  customMode?: 'leq' | 'k';
  /** Equivalent length in m, or a K value, per customMode. */
  customValue?: number;
}

export type PipeStatus = 'open' | 'closed';

export type ValveType = 'gate' | 'butterfly' | 'nonReturn';

/** A valve placed along a pipe. A closed valve shuts the whole pipe. */
export interface PipeValve {
  id: Id;
  label: string;
  type: ValveType;
  /** Where it sits along the pipe, 0 at `from`, 1 at `to`. Drawing only. */
  position: number;
  status: PipeStatus;
  /** Non-return only: true lets water flow from `from` to `to`. */
  forward: boolean;
}

export interface Pipe {
  id: Id;
  label: string;
  from: Id;
  to: Id;
  /** Nominal bore in mm, or 'custom' for a size outside the standard list. */
  nominalMm: number | 'custom';
  internalDiameterMm: number;
  lengthM: number;
  /** True when the length was typed in; false follows the drawing scale. */
  lengthManual: boolean;
  c: number;
  /** Absolute roughness for Darcy-Weisbach, mm. */
  roughnessMm: number;
  fittings: Fitting[];
  /** Optional, so files saved before valves existed still load. */
  valves?: PipeValve[];
  status: PipeStatus;
}

export type PumpCurveSpec =
  | {
      kind: 'threePoint';
      shutoffHeadM: number;
      ratedHeadM: number;
      ratedFlowLpm: number;
      overloadHeadM: number;
      overloadFlowLpm: number;
    }
  | { kind: 'table'; points: CurvePoint[]; degree: 2 | 3 }
  | { kind: 'constant'; headM: number };

export interface CurvePoint {
  flowLpm: number;
  headM: number;
}

export interface Pump {
  id: Id;
  label: string;
  nodeId: Id;
  curve: PumpCurveSpec;
  /** Extra head deduction for suction and pump-room losses, m. */
  suctionLossM: number;
  /** Water level relative to the pump datum (the outlet node elevation), m. */
  waterLevelM: number;
}

export type FrictionModel = 'hazenWilliams' | 'darcyWeisbach';
export type FittingMethod = 'equivalentLength' | 'kValue';

export interface Settings {
  frictionModel: FrictionModel;
  fittingMethod: FittingMethod;
  /** Scale NFPA equivalent lengths for C other than 120. */
  applyCFactorToFittings: boolean;
  /**
   * Add the tees, bends and reducers found in the drawing to the pipe losses.
   * Optional so files saved before it existed load, and they keep their results.
   */
  autoFittings?: boolean;
  velocityLimitMs: number;
  kinematicViscosityM2s: number;
  gravity: number;
  mPerBar: number;
  maxIterations: number;
  headToleranceM: number;
}

export interface MaterialRow {
  nominalMm: number;
  outerDiameterMm: number;
  wallMm: number;
  internalDiameterMm: number;
}

export interface MaterialTable {
  name: string;
  source: string;
  rows: MaterialRow[];
}

/** One fitting row. Values are keyed by nominal size in mm. */
export interface FittingTableRow {
  type: Exclude<FittingType, 'custom'>;
  name: string;
  source: string;
  leqM: Record<string, number>;
  k: Record<string, number>;
}

export interface CFactorRow {
  c: number;
  multiplier: number;
}

export interface Tables {
  material: MaterialTable;
  fittings: FittingTableRow[];
  cFactors: CFactorRow[];
}

/** Everything the solver needs. */
export interface Network {
  nodes: NetworkNode[];
  pipes: Pipe[];
  pumps: Pump[];
  settings: Settings;
  tables: Tables;
}

/** Overrides applied on top of a network, for one analysis run. */
export interface ScenarioOverrides {
  hydrantOn?: Record<Id, boolean>;
  pipeStatus?: Record<Id, PipeStatus>;
  valveStatus?: Record<Id, PipeStatus>;
  pipeC?: Record<Id, number>;
  /** Replaces C on every pipe, after pipeC. */
  globalC?: number;
}

export interface Scenario extends ScenarioOverrides {
  id: Id;
  name: string;
  notes?: string;
}

export interface BackgroundLayer {
  dataUrl: string;
  /** Original file name, for display. */
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
  visible: boolean;
}

/** Document details and choices for the client report. */
export interface ReportDetails {
  client: string;
  site: string;
  documentNo: string;
  revision: string;
  preparedBy: string;
  checkedBy: string;
  approvedBy: string;
  /** Include the saved operating scenarios. */
  includeScenarios: boolean;
}

export interface Project extends Network {
  schemaVersion: 1;
  name: string;
  /** Optional so files saved before it existed load. */
  report?: Partial<ReportDetails>;
  /** Metres per drawing unit. Set by scale calibration. */
  metersPerUnit: number;
  background: BackgroundLayer | null;
  scenarios: Scenario[];
  /** Pinned configuration that the delta overlay compares against. */
  baseline: Scenario | null;
}
