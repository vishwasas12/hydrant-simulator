import { DEFAULT_HYDRANT, emptyProject, makePipe, makePump } from '../../model/defaults';
import type { NetworkNode, Outlet, Project, Pump } from '../../model/types';

export function node(id: string, extra: Partial<NetworkNode> = {}): NetworkNode {
  return { id, label: id, x: 0, y: 0, elevationM: 0, baseDemandLpm: 0, kind: 'junction', ...extra };
}

export function fixedHydrant(id: string, flowLpm: number, extra: Partial<Outlet> = {}): NetworkNode {
  return node(id, {
    kind: 'hydrant',
    outlet: { ...DEFAULT_HYDRANT, model: 'fixed', fixedFlowLpm: flowLpm, on: true, ...extra },
  });
}

export function constantPump(nodeId: string, headM: number): Pump {
  return { ...makePump('pump', 'Pump', nodeId), curve: { kind: 'constant', headM } };
}

export function network(nodes: NetworkNode[], pipes: Project['pipes'], pumps: Pump[]): Project {
  return { ...emptyProject('test'), nodes, pipes, pumps };
}

export const pipe = makePipe;
