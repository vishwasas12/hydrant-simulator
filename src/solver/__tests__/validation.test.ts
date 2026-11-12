import { describe, expect, it } from 'vitest';
import { DEFAULT_HYDRANT, makePump } from '../../model/defaults';
import { seedProject } from '../../model/seed';
import type { Project } from '../../model/types';
import { emitterFlowLpm, hazenWilliamsLoss, nozzleK, pumpHead, fitPumpCurve, solve } from '..';
import { lpmToM3s, m3sToLpm, pipeArea } from '../units';
import { constantPump, fixedHydrant, network, node, pipe } from './helpers';

const ID_150 = 154.3;

function byLabel<T extends { label: string }>(items: T[], label: string): T {
  const found = items.find((i) => i.label === label);
  if (!found) throw new Error(`No item labelled ${label}`);
  return found;
}

describe('1. one-pipe check', () => {
  const q = lpmToM3s(2850);

  it('matches the hand values at C = 120', () => {
    expect(Math.abs(hazenWilliamsLoss(100, q, 120, ID_150 / 1000) - 4.78)).toBeLessThanOrEqual(0.02);
  });

  it('matches the hand value at C = 100', () => {
    expect(Math.abs(hazenWilliamsLoss(100, q, 100, ID_150 / 1000) - 6.7)).toBeLessThanOrEqual(0.02);
  });

  it('solves one pipe to the same loss and velocity', () => {
    const net = network(
      [node('a'), fixedHydrant('b', 2850)],
      [pipe('p', 'P', 'a', 'b', 150, 100)],
      [constantPump('a', 110)],
    );
    const r = solve(net);
    expect(r.ok).toBe(true);
    const p = r.pipes[0];
    expect(Math.abs(p.headLossM - 4.78)).toBeLessThanOrEqual(0.02);
    expect(p.velocityMs).toBeCloseTo(2.54, 2);
    expect(p.flowLpm).toBeCloseTo(2850, 3);
    expect(r.iterations).toBeGreaterThan(0);
    expect(r.headResidualM).toBeLessThan(1e-5);
  });
});

describe('2. two equal parallel pipes', () => {
  it('splits flow equally with the half-flow head loss', () => {
    const net = network(
      [node('a'), fixedHydrant('b', 2850)],
      [pipe('p1', 'P1', 'a', 'b', 150, 100), pipe('p2', 'P2', 'a', 'b', 150, 100)],
      [constantPump('a', 110)],
    );
    const r = solve(net);
    expect(r.ok).toBe(true);
    expect(r.pipes[0].flowLpm).toBeCloseTo(1425, 3);
    expect(r.pipes[1].flowLpm).toBeCloseTo(1425, 3);
    expect(Math.abs(r.pipes[0].headLossM - 1.32)).toBeLessThanOrEqual(0.01);
    expect(r.pipes[0].headLossM).toBeCloseTo(r.pipes[1].headLossM, 6);
  });
});

/** Independent Hardy-Cross solution for one loop: a -> b -> c, with a -> c. */
function hardyCross(rUpper: number, rLower: number, total: number): { upper: number; lower: number } {
  let upper = total / 2;
  for (let i = 0; i < 500; i++) {
    const lower = total - upper;
    const imbalance = rUpper * Math.pow(upper, 1.852) - rLower * Math.pow(lower, 1.852);
    const slope = 1.852 * (rUpper * Math.pow(upper, 0.852) + rLower * Math.pow(lower, 0.852));
    upper -= imbalance / slope;
  }
  return { upper, lower: total - upper };
}

describe('3. simple loop', () => {
  const net = network(
    [node('a'), node('b'), fixedHydrant('c', 2000)],
    [
      pipe('ab', 'AB', 'a', 'b', 150, 200),
      pipe('bc', 'BC', 'b', 'c', 100, 150),
      pipe('ac', 'AC', 'a', 'c', 150, 500),
    ],
    [constantPump('a', 110)],
  );
  const r = solve(net);

  it('closes the loop energy balance within 0.01 m', () => {
    const [ab, bc, ac] = r.pipes;
    const closure = ab.headLossM + bc.headLossM - ac.headLossM;
    expect(Math.abs(closure)).toBeLessThan(0.01);
  });

  it('agrees with a hand Hardy-Cross solution', () => {
    const d150 = ID_150 / 1000;
    const d100 = 103.5 / 1000;
    const R = (l: number, d: number) => (10.67 * l) / (Math.pow(120, 1.852) * Math.pow(d, 4.87));
    const hand = hardyCross(R(200, d150) + R(150, d100), R(500, d150), lpmToM3s(2000));
    expect(r.pipes[0].flowLpm).toBeCloseTo(m3sToLpm(hand.upper), 1);
    expect(r.pipes[2].flowLpm).toBeCloseTo(m3sToLpm(hand.lower), 1);
  });
});

describe('4. emitter', () => {
  it('matches Q = K * sqrt(P) within 0.5 % at a known pressure', () => {
    const head = 60;
    const outlet = {
      ...DEFAULT_HYDRANT,
      on: true,
      model: 'emitter' as const,
      hoseLengthM: 0,
      valveK: 0,
    };
    const net = network(
      [node('a'), node('b', { kind: 'hydrant', outlet })],
      // A very large short pipe, so node pressure is effectively the pump head.
      [{ ...pipe('p', 'P', 'a', 'b', 200, 0.01), internalDiameterMm: 1000 }],
      [constantPump('a', head)],
    );
    const r = solve(net);
    expect(r.ok).toBe(true);
    const b = r.nodes[1];
    const expected = m3sToLpm(nozzleK(outlet.nozzleMm, outlet.cd, 9.81) * Math.sqrt(b.pressureM as number));
    expect(Math.abs(b.outletFlowLpm - expected) / expected).toBeLessThan(0.005);
  });

  it('accounts for hose friction by reducing flow', () => {
    const noHose = emitterFlowLpm({ ...DEFAULT_HYDRANT, hoseLengthM: 0, valveK: 0 }, 5, 9.81, 10.197);
    const withHose = emitterFlowLpm(DEFAULT_HYDRANT, 5, 9.81, 10.197);
    expect(withHose).toBeLessThan(noHose);
  });

  it('doubles flow for a double outlet at the same pressure', () => {
    const one = emitterFlowLpm(DEFAULT_HYDRANT, 5, 9.81, 10.197);
    const two = emitterFlowLpm({ ...DEFAULT_HYDRANT, outlets: 2 }, 5, 9.81, 10.197);
    expect(two / one).toBeCloseTo(2, 3);
  });
});

describe('5. pump curve', () => {
  it('passes through all three entered points', () => {
    const curve = fitPumpCurve({
      kind: 'threePoint',
      shutoffHeadM: 132,
      ratedHeadM: 110,
      ratedFlowLpm: 2850,
      overloadHeadM: 75,
      overloadFlowLpm: 4275,
    });
    expect(pumpHead(curve, 0)).toBeCloseTo(132, 6);
    expect(pumpHead(curve, 2850)).toBeCloseTo(110, 6);
    expect(pumpHead(curve, 4275)).toBeCloseTo(75, 6);
  });

  it('satisfies H_pump(Q) = losses + residual on a single pipe', () => {
    const outlet = { ...DEFAULT_HYDRANT, on: true, model: 'emitter' as const };
    const net = network(
      [node('a'), node('b', { kind: 'hydrant', outlet })],
      [pipe('p', 'P', 'a', 'b', 150, 300)],
      [makePump('pump', 'Pump', 'a')],
    );
    const r = solve(net);
    expect(r.ok).toBe(true);
    const curve = fitPumpCurve(net.pumps[0].curve);
    const head = pumpHead(curve, r.system.pumpFlowLpm);
    const residual = r.nodes[1].pressureM as number;
    expect(head).toBeCloseTo(r.pipes[0].headLossM + residual, 4);
    expect(r.system.pumpHeadM).toBeCloseTo(head, 6);
  });

  it('applies suction loss and water level to the outlet head', () => {
    const net = network(
      [node('a'), fixedHydrant('b', 1000)],
      [pipe('p', 'P', 'a', 'b', 150, 100)],
      [{ ...constantPump('a', 100), suctionLossM: 3, waterLevelM: -2 }],
    );
    const r = solve(net);
    expect(r.nodes[0].headM).toBeCloseTo(95, 4);
  });
});

describe('6. reference project smoke test', () => {
  function farthestOnly(): Project {
    const p = seedProject();
    for (const n of p.nodes) if (n.outlet) n.outlet.on = false;
    const far = byLabel(p.nodes, 'HV 13');
    if (!far.outlet) throw new Error('HV 13 has no outlet');
    far.outlet.on = true;
    far.outlet.model = 'fixed';
    far.outlet.fixedFlowLpm = 2850;
    return p;
  }

  it('has the described shape', () => {
    const p = seedProject();
    expect(p.nodes.filter((n) => n.kind === 'hydrant')).toHaveLength(26);
    expect(p.pumps).toHaveLength(1);
    const ring = p.pipes.filter(
      (x) => x.nominalMm === 150 && !x.fittings.some((f) => f.type === 'teeBranch'),
    );
    const total = ring.reduce((s, x) => s + x.lengthM, 0);
    expect(total).toBeCloseTo(1900, 0);
  });

  it('gives 17-25 m loss and 8-9 bar with 2850 LPM at the farthest hydrant', () => {
    const p = farthestOnly();
    const r = solve(p);
    expect(r.ok).toBe(true);
    const far = byLabel(r.nodes, 'HV 13');
    const loss = r.system.pumpHeadM - (far.pressureM as number);
    expect(r.system.pumpFlowLpm).toBeCloseTo(2850, 2);
    expect(loss).toBeGreaterThan(17);
    expect(loss).toBeLessThan(25);
    expect(far.pressureBar).toBeGreaterThan(8);
    expect(far.pressureBar).toBeLessThan(9);
  });
});

describe('solver robustness', () => {
  it('converges with every hydrant off, at shutoff head', () => {
    const p = seedProject();
    for (const n of p.nodes) if (n.outlet) n.outlet.on = false;
    const r = solve(p);
    expect(r.ok).toBe(true);
    expect(r.system.pumpFlowLpm).toBeLessThan(0.1);
    expect(r.nodes[0].headM).toBeCloseTo(132, 1);
  });

  it('converges with all 26 emitter hydrants open', () => {
    const p = seedProject();
    for (const n of p.nodes) {
      if (n.kind === 'hydrant' && n.outlet) {
        n.outlet.on = true;
        n.outlet.model = 'emitter';
      }
    }
    const r = solve(p);
    expect(r.ok).toBe(true);
    expect(r.flowResidualLpm).toBeLessThan(1e-3);
  });

  it('keeps solving around a closed ring pipe', () => {
    const p = seedProject();
    p.pipes[0].status = 'closed';
    const r = solve(p);
    expect(r.ok).toBe(true);
    expect(r.pipes[0].flowLpm).toBe(0);
  });

  it('reports a hydrant with no path to the pump', () => {
    const net = network(
      [node('a'), node('b'), fixedHydrant('c', 500)],
      [pipe('ab', 'AB', 'a', 'b', 150, 50)],
      [constantPump('a', 100)],
    );
    const r = solve(net);
    const errors = r.issues.filter((i) => i.severity === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('no open path');
    expect(r.nodes[2].status).toBe('fail');
  });

  it('reports a clear error when there is no pump', () => {
    const r = solve(network([node('a')], [], []));
    expect(r.ok).toBe(false);
    expect(r.issues[0].message).toContain('No pump');
  });

  it('solves with Darcy-Weisbach close to Hazen-Williams on steel', () => {
    const base = network(
      [node('a'), fixedHydrant('b', 2850)],
      [pipe('p', 'P', 'a', 'b', 150, 100)],
      [constantPump('a', 110)],
    );
    const hw = solve(base).pipes[0].headLossM;
    const dw = solve({
      ...base,
      settings: { ...base.settings, frictionModel: 'darcyWeisbach' },
    }).pipes[0].headLossM;
    expect(dw).toBeGreaterThan(hw * 0.6);
    expect(dw).toBeLessThan(hw * 1.4);
  });

  it('adds fitting equivalent lengths to L_eq', () => {
    const p = pipe('p', 'P', 'a', 'b', 150, 100);
    p.fittings = [
      { id: 'f1', type: 'elbow90', quantity: 2 },
      { id: 'f2', type: 'custom', quantity: 1, customMode: 'leq', customValue: 5 },
    ];
    const r = solve(network([node('a'), fixedHydrant('b', 1000)], [p], [constantPump('a', 110)]));
    expect(r.pipes[0].equivalentLengthM).toBeCloseTo(100 + 2 * 4.3 + 5, 6);
  });

  it('applies K-value fittings as K V^2 / 2g', () => {
    const p = pipe('p', 'P', 'a', 'b', 150, 100);
    p.fittings = [{ id: 'f1', type: 'custom', quantity: 1, customMode: 'k', customValue: 2 }];
    const base = network([node('a'), fixedHydrant('b', 2850)], [p], [constantPump('a', 110)]);
    const r = solve(base);
    const v = lpmToM3s(2850) / pipeArea(ID_150 / 1000);
    const friction = hazenWilliamsLoss(100, lpmToM3s(2850), 120, ID_150 / 1000);
    expect(r.pipes[0].headLossM).toBeCloseTo(friction + (2 * v * v) / (2 * 9.81), 4);
  });

  it('accounts for elevation in node pressure', () => {
    const net = network(
      [node('a'), fixedHydrant('b', 500, { minPressureBar: 0 })],
      [pipe('p', 'P', 'a', 'b', 150, 10)],
      [constantPump('a', 100)],
    );
    net.nodes[1].elevationM = 20;
    const r = solve(net);
    const b = r.nodes[1];
    expect(b.pressureM).toBeCloseTo((b.headM as number) - 20, 6);
  });
});
