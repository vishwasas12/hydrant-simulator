import type { Id, Network, NetworkNode, ScenarioOverrides } from '../model/types';
import {
  emitterCoefficients,
  emitterFlowForHead,
  emitterHeadForFlow,
  fitPumpCurve,
  lpmToM3s,
  m3sToLpm,
  pumpHead,
  solve,
} from '../solver';

export interface RequirementRow {
  id: Id;
  label: string;
  kind: NetworkNode['kind'];
  connected: boolean;
  /** Result with this outlet alone open, on the real pump curve. */
  residualBar: number | null;
  flowLpm: number;
  minPressureBar: number;
  minFlowLpm: number;
  /** Pressure the outlet needs at the node to meet both minimums. */
  requiredPressureBar: number;
  /** Flow at that required pressure. */
  requiredFlowLpm: number;
  frictionM: number | null;
  /** Pump head needed at the required flow. */
  pumpHeadNeededM: number | null;
  /** Pump head actually available at that flow. */
  pumpHeadAvailableM: number | null;
  marginM: number | null;
  pass: boolean;
  beyondCurve: boolean;
}

function aloneScenario(network: Network, id: Id): ScenarioOverrides {
  const hydrantOn: Record<Id, boolean> = {};
  for (const n of network.nodes) if (n.outlet) hydrantOn[n.id] = n.id === id;
  return { hydrantOn };
}

/**
 * For each outlet alone: what it gets from the real pump, then the pump head
 * that would just meet its minimum pressure and flow.
 */
export function requirementCheck(network: Network): RequirementRow[] {
  const { gravity, mPerBar } = network.settings;
  const pump = network.pumps[0];
  if (!pump) return [];
  const curve = fitPumpCurve(pump.curve);
  const pumpNode = network.nodes.find((n) => n.id === pump.nodeId);
  const baseDemand = network.nodes.reduce((s, n) => s + n.baseDemandLpm, 0);

  return network.nodes
    .filter((n) => n.kind !== 'junction' && n.outlet)
    .map((node) => {
      const outlet = node.outlet as NonNullable<NetworkNode['outlet']>;
      const scenario = aloneScenario(network, node.id);
      const alone = solve(network, scenario);
      const result = alone.nodes.find((r) => r.id === node.id);
      const minFlowTotal = outlet.minFlowLpm * outlet.outlets;
      const minHead = outlet.minPressureBar * mPerBar;

      let requiredHead = minHead;
      let requiredFlow = Math.max(outlet.fixedFlowLpm * outlet.outlets, minFlowTotal);
      if (outlet.model === 'emitter') {
        const coeff = emitterCoefficients(outlet, gravity);
        requiredHead = Math.max(minHead, emitterHeadForFlow(coeff, lpmToM3s(minFlowTotal)));
        requiredFlow = m3sToLpm(emitterFlowForHead(coeff, requiredHead));
      }

      // Friction at the required flow, with this outlet as a fixed draw.
      const probe: Network = {
        ...network,
        pumps: network.pumps.map((p) => ({ ...p, curve: { kind: 'constant', headM: 1000 } })),
        nodes: network.nodes.map((n) =>
          n.id === node.id
            ? {
                ...n,
                outlet: {
                  ...outlet,
                  on: true,
                  model: 'fixed' as const,
                  fixedFlowLpm: requiredFlow / outlet.outlets,
                },
              }
            : n,
        ),
      };
      const probed = solve(probe, scenario);
      const headOut = probed.nodes.find((r) => r.id === pump.nodeId)?.headM;
      const headAt = probed.nodes.find((r) => r.id === node.id)?.headM;
      const connected = !!result?.connected;
      const frictionM = connected && headOut != null && headAt != null ? headOut - headAt : null;

      let needed: number | null = null;
      let available: number | null = null;
      let beyondCurve = false;
      if (frictionM !== null && pumpNode) {
        const sourceHead = pumpNode.elevationM + pump.waterLevelM;
        needed = node.elevationM + requiredHead + frictionM - sourceHead + pump.suctionLossM;
        const pumpFlow = requiredFlow + baseDemand;
        available = pumpHead(curve, pumpFlow);
        beyondCurve = pumpFlow > curve.maxFlowLpm;
      }

      return {
        id: node.id,
        label: node.label,
        kind: node.kind,
        connected,
        residualBar: result?.pressureBar ?? null,
        flowLpm: result?.outletFlowLpm ?? 0,
        minPressureBar: outlet.minPressureBar,
        minFlowLpm: minFlowTotal,
        requiredPressureBar: requiredHead / mPerBar,
        requiredFlowLpm: requiredFlow,
        frictionM,
        pumpHeadNeededM: needed,
        pumpHeadAvailableM: available,
        marginM: needed !== null && available !== null ? available - needed : null,
        pass: result?.status === 'pass',
        beyondCurve,
      };
    });
}
