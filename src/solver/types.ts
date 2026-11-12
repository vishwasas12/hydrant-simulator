import type { Id, NodeKind, PipeStatus } from '../model/types';

export type IssueSeverity = 'error' | 'warning';

export interface Issue {
  severity: IssueSeverity;
  message: string;
  /** Node or pipe ids this issue points at, for highlighting. */
  refs: Id[];
}

export type OutletStatus = 'pass' | 'fail' | 'off';

export interface NodeResult {
  id: Id;
  label: string;
  kind: NodeKind;
  connected: boolean;
  elevationM: number;
  headM: number | null;
  pressureM: number | null;
  pressureBar: number | null;
  /** Base demand plus outlet discharge, LPM. */
  outflowLpm: number;
  /** Outlet discharge only, LPM. */
  outletFlowLpm: number;
  status: OutletStatus | null;
  pressureOk: boolean | null;
  flowOk: boolean | null;
  requiredPressureBar: number | null;
  requiredFlowLpm: number | null;
  /** Smallest normalised margin across pressure and flow. Negative is a fail. */
  margin: number | null;
}

export interface PipeResult {
  id: Id;
  label: string;
  status: PipeStatus;
  connected: boolean;
  /** Positive runs from the pipe's `from` node to its `to` node. */
  flowLpm: number;
  upstreamId: Id;
  downstreamId: Id;
  velocityMs: number;
  velocityExceeded: boolean;
  /** A non-return valve is stopping reverse flow; headLossM is then head held back. */
  heldByCheckValve: boolean;
  headLossM: number;
  lossPer100M: number;
  lengthM: number;
  equivalentLengthM: number;
  diameterMm: number;
}

export interface SystemResult {
  pumpFlowLpm: number;
  pumpHeadM: number;
  pumpPressureBar: number;
  pumpBeyondCurve: boolean;
  totalOutflowLpm: number;
  criticalNodeId: Id | null;
  criticalPressureBar: number | null;
  openOutlets: number;
  passingOutlets: number;
  failingOutlets: number;
}

export interface SolveResults {
  /** False when the network could not be solved at all. */
  ok: boolean;
  converged: boolean;
  iterations: number;
  headResidualM: number;
  flowResidualLpm: number;
  nodes: NodeResult[];
  pipes: PipeResult[];
  system: SystemResult;
  issues: Issue[];
}

export interface CriticalPathSegment {
  pipeId: Id;
  label: string;
  fromLabel: string;
  toLabel: string;
  lengthM: number;
  equivalentLengthM: number;
  flowLpm: number;
  headLossM: number;
  pressureAfterBar: number;
  distanceAfterM: number;
}

export interface CriticalPath {
  targetId: Id;
  nodeIds: Id[];
  pipeIds: Id[];
  startPressureBar: number;
  segments: CriticalPathSegment[];
}
