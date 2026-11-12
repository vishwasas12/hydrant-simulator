import type { Network, ScenarioOverrides } from '../model/types';
import { solve } from './solve';
import type { SolveResults } from './types';

export interface SystemPoint {
  flowLpm: number;
  headM: number;
}

function withConstantPump(network: Network, headM: number, demandScale: number): Network {
  return {
    ...network,
    pumps: network.pumps.map((p) => ({ ...p, curve: { kind: 'constant', headM } })),
    nodes: network.nodes.map((n) => ({
      ...n,
      baseDemandLpm: n.baseDemandLpm * demandScale,
      outlet: n.outlet
        ? { ...n.outlet, fixedFlowLpm: n.outlet.fixedFlowLpm * demandScale }
        : undefined,
    })),
  };
}

/**
 * Head the pump must supply as flow varies, for the open outlets in `results`.
 * Emitters set their own flow from pressure, so the pump head is swept. With
 * only fixed demands the demands are scaled, and the residual pressure at the
 * critical outlet is held at its operating value.
 */
export function systemCurve(
  network: Network,
  scenario: ScenarioOverrides | undefined,
  results: SolveResults,
  count = 26,
): SystemPoint[] {
  if (!results.ok || network.pumps.length !== 1 || results.system.pumpFlowLpm < 1) return [];
  const pump = network.pumps[0];
  const operatingHead = results.system.pumpHeadM - pump.suctionLossM;
  const openNodes = network.nodes.filter(
    (n) => n.outlet && (scenario?.hydrantOn?.[n.id] ?? n.outlet.on),
  );
  const hasEmitter = openNodes.some((n) => n.outlet?.model === 'emitter');
  const points: SystemPoint[] = [];

  if (hasEmitter) {
    for (let i = 1; i <= count; i++) {
      const fraction = (1.7 * i) / count;
      const head = operatingHead * fraction;
      const r = solve(withConstantPump(network, head, Math.sqrt(fraction)), scenario);
      if (r.ok) points.push({ flowLpm: r.system.pumpFlowLpm, headM: head + pump.suctionLossM });
    }
    return points.sort((a, b) => a.flowLpm - b.flowLpm);
  }

  const criticalId = results.system.criticalNodeId;
  if (!criticalId) return [];
  const friction = (r: SolveResults): number | null => {
    const out = r.nodes.find((n) => n.id === pump.nodeId)?.headM;
    const critical = r.nodes.find((n) => n.id === criticalId)?.headM;
    return out == null || critical == null ? null : out - critical;
  };
  const atOperating = friction(solve(withConstantPump(network, operatingHead, 1), scenario));
  if (atOperating === null) return [];
  for (let i = 0; i <= count; i++) {
    const scale = (1.5 * i) / count;
    const r = solve(withConstantPump(network, operatingHead, scale), scenario);
    const f = friction(r);
    if (r.ok && f !== null) {
      points.push({
        flowLpm: r.system.pumpFlowLpm,
        headM: operatingHead + pump.suctionLossM - (atOperating - f),
      });
    }
  }
  return points;
}
