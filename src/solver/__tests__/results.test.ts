import { describe, expect, it } from 'vitest';
import { makePump } from '../../model/defaults';
import { DEFAULT_HYDRANT } from '../../model/defaults';
import { seedProject } from '../../model/seed';
import { criticalPath, fitPumpCurve, pumpHead, solve, systemCurve } from '..';
import { fixedHydrant, network, node, pipe } from './helpers';

describe('critical path', () => {
  it('runs from the pump to the critical hydrant', () => {
    const p = seedProject();
    const r = solve(p);
    const path = criticalPath(p, r);
    if (!path) throw new Error('no critical path');
    expect(path.nodeIds[0]).toBe(p.pumps[0].nodeId);
    expect(path.nodeIds[path.nodeIds.length - 1]).toBe(r.system.criticalNodeId);
  });

  it('loses pressure consistently with the segments along the way', () => {
    const p = seedProject();
    const r = solve(p);
    const path = criticalPath(p, r);
    if (!path) throw new Error('no critical path');
    const loss = path.segments.reduce((s, x) => s + x.headLossM, 0);
    const target = r.nodes.find((n) => n.id === path.targetId);
    const start = r.nodes.find((n) => n.id === path.nodeIds[0]);
    expect((start?.headM as number) - (target?.headM as number)).toBeCloseTo(loss, 3);
  });

  it('is null with nothing open', () => {
    const p = seedProject();
    for (const n of p.nodes) if (n.outlet) n.outlet.on = false;
    expect(criticalPath(p, solve(p))).toBeNull();
  });
});

describe('system curve', () => {
  const interpolateAt = (pts: { flowLpm: number; headM: number }[], q: number): number => {
    for (let i = 0; i < pts.length - 1; i++) {
      if (q >= pts[i].flowLpm && q <= pts[i + 1].flowLpm) {
        const t = (q - pts[i].flowLpm) / (pts[i + 1].flowLpm - pts[i].flowLpm);
        return pts[i].headM + (pts[i + 1].headM - pts[i].headM) * t;
      }
    }
    throw new Error('flow outside curve');
  };

  it('passes through the operating point with fixed demands', () => {
    const p = seedProject();
    const r = solve(p);
    const pts = systemCurve(p, undefined, r);
    expect(pts.length).toBeGreaterThan(5);
    expect(interpolateAt(pts, r.system.pumpFlowLpm)).toBeCloseTo(r.system.pumpHeadM, 0);
  });

  it('passes through the operating point with an emitter', () => {
    const outlet = { ...DEFAULT_HYDRANT, on: true, model: 'emitter' as const };
    const net = network(
      [node('a'), node('b', { kind: 'hydrant', outlet })],
      [pipe('p', 'P', 'a', 'b', 150, 300)],
      [makePump('pump', 'Pump', 'a')],
    );
    const r = solve(net);
    const pts = systemCurve(net, undefined, r);
    expect(interpolateAt(pts, r.system.pumpFlowLpm)).toBeCloseTo(r.system.pumpHeadM, 0);
  });

  it('rises with flow', () => {
    const net = network(
      [node('a'), fixedHydrant('b', 2000)],
      [pipe('p', 'P', 'a', 'b', 150, 500)],
      [makePump('pump', 'Pump', 'a')],
    );
    const pts = systemCurve(net, undefined, solve(net));
    expect(pts[pts.length - 1].headM).toBeGreaterThan(pts[0].headM);
  });
});

describe('pump extrapolation', () => {
  const curve = fitPumpCurve({
    kind: 'threePoint',
    shutoffHeadM: 132,
    ratedHeadM: 110,
    ratedFlowLpm: 2850,
    overloadHeadM: 75,
    overloadFlowLpm: 4275,
  });

  it('continues downward past the last point', () => {
    expect(pumpHead(curve, 5000)).toBeLessThan(75);
  });

  it('flags running beyond the curve', () => {
    const net = network(
      [node('a'), fixedHydrant('b', 5000)],
      [pipe('p', 'P', 'a', 'b', 200, 20)],
      [makePump('pump', 'Pump', 'a')],
    );
    const r = solve(net);
    expect(r.system.pumpBeyondCurve).toBe(true);
    expect(r.issues.some((i) => i.message.includes('beyond the last point'))).toBe(true);
  });
});
