import { describe, expect, it } from 'vitest';
import { DEFAULT_HYDRANT, emptyProject, makePipe, makePump } from '../../model/defaults';
import { seedProject } from '../../model/seed';
import type { NetworkNode, Project } from '../../model/types';
import { binomial, runCapacity } from '../capacity';
import { requirementCheck } from '../requirement';

/** A straight main with hydrants at increasing distance from the pump. */
function line(count: number, flowLpm = 950): Project {
  const p = emptyProject('line');
  const nodes: NetworkNode[] = [
    { id: 'pump', label: 'J0', x: 0, y: 0, elevationM: 0, baseDemandLpm: 0, kind: 'junction' },
  ];
  for (let i = 1; i <= count; i++) {
    nodes.push({
      id: `h${i}`,
      label: `HV ${i}`,
      x: i * 100,
      y: 0,
      elevationM: 0,
      baseDemandLpm: 0,
      kind: 'hydrant',
      outlet: { ...DEFAULT_HYDRANT, model: 'fixed', fixedFlowLpm: flowLpm, on: false },
    });
    p.pipes.push(makePipe(`p${i}`, `P${i}`, i === 1 ? 'pump' : `h${i - 1}`, `h${i}`, 150, 100));
  }
  p.nodes = nodes;
  p.pumps = [makePump('pump1', 'Pump', 'pump')];
  return p;
}

describe('binomial', () => {
  it('matches known values', () => {
    expect(binomial(26, 3)).toBe(2600);
    expect(binomial(26, 5)).toBe(65780);
    expect(binomial(5, 0)).toBe(1);
    expect(binomial(5, 6)).toBe(0);
  });
});

describe('exhaustive search', () => {
  const r = runCapacity(line(6), { chosenK: 2, respectPumpLimit: true });

  it('solves every combination', () => {
    expect(r.method).toBe('exhaustive');
    expect(r.evaluated).toBe(63);
    expect(r.combos).toHaveLength(63);
  });

  it('sorts worst margin first', () => {
    for (let i = 1; i < r.combos.length; i++) {
      expect(r.combos[i].margin).toBeGreaterThanOrEqual(r.combos[i - 1].margin);
    }
  });

  it('limits a 2850 LPM pump to what its curve can carry', () => {
    // 950 LPM each: 4 draw 3800 LPM (inside the curve), 5 draw 4750 (past it).
    expect(r.maxSimultaneous).toBe(4);
    expect(r.guaranteedK).toBeLessThanOrEqual(r.maxSimultaneous);
  });

  it('finds the two farthest as the worst pair', () => {
    expect(r.worstForK?.members.map((m) => r.hydrants[m].label).sort()).toEqual(['HV 5', 'HV 6']);
    expect(r.worstForKExact).toBe(true);
  });

  it('ranks the last hydrant as most remote', () => {
    expect(r.hydrants[r.remoteness[0]].label).toBe('HV 6');
    expect(r.kFarthest?.count).toBe(2);
  });

  it('agrees with a direct single solve', () => {
    const p = line(6);
    p.nodes[6].outlet = { ...(p.nodes[6].outlet as NonNullable<NetworkNode['outlet']>), on: true };
    const combo = r.combos.find((c) => c.count === 1 && r.hydrants[c.members[0]].label === 'HV 6');
    expect(combo?.pass).toBe(true);
    expect(combo?.pumpFlowLpm).toBeCloseTo(950, 2);
  });
});

describe('pump limit option', () => {
  it('allows more hydrants when off the limit, if pressure holds', () => {
    const limited = runCapacity(line(6, 500), { chosenK: 2, respectPumpLimit: true });
    const free = runCapacity(line(6, 500), { chosenK: 2, respectPumpLimit: false });
    expect(free.maxSimultaneous).toBeGreaterThanOrEqual(limited.maxSimultaneous);
  });
});

describe('search on larger networks', () => {
  it('agrees with exhaustive results when forced to the greedy path', () => {
    const exact = runCapacity(line(8), { chosenK: 3, respectPumpLimit: true });
    const greedy = runCapacity(line(8), { chosenK: 3, respectPumpLimit: true, exhaustiveLimit: 2 });
    expect(greedy.method).toBe('greedy');
    expect(greedy.maxSimultaneous).toBe(exact.maxSimultaneous);
    expect(greedy.guaranteedK).toBe(exact.guaranteedK);
    expect(greedy.worstForK?.margin).toBeCloseTo(exact.worstForK?.margin as number, 6);
  });

  it('stays sensible when enumeration is cut short', () => {
    const r = runCapacity(line(10), { chosenK: 4, respectPumpLimit: true, exhaustiveLimit: 2, exactKLimit: 50 });
    expect(r.method).toBe('greedy');
    expect(r.worstForKExact).toBe(false);
    expect(r.worstForK?.count).toBe(4);
    expect(r.maxSimultaneous).toBeGreaterThan(0);
  });

  it('handles the 26-hydrant reference project', () => {
    const r = runCapacity(seedProject(), { chosenK: 3, respectPumpLimit: true, exactKLimit: 3000 });
    expect(r.method).toBe('greedy');
    expect(r.hydrants).toHaveLength(26);
    expect(r.maxSimultaneous).toBeGreaterThanOrEqual(3);
    expect(r.worstForK?.pass).toBe(true);
    expect(r.worstForKExact).toBe(true);
  });

  it('reports a network it cannot solve', () => {
    const p = emptyProject();
    expect(() => runCapacity(p, { chosenK: 1, respectPumpLimit: true })).toThrow(/No pump/);
  });
});

describe('requirement check', () => {
  it('returns one row per outlet', () => {
    expect(requirementCheck(seedProject())).toHaveLength(29);
  });

  it('needs pump head equal to minimum pressure plus friction', () => {
    const p = line(1);
    const [row] = requirementCheck(p);
    const expected = 3.5 * 10.197 + (row.frictionM as number);
    expect(row.pumpHeadNeededM).toBeCloseTo(expected, 4);
    expect(row.requiredFlowLpm).toBeCloseTo(950, 4);
  });

  it('asks an emitter for the pressure that yields its minimum flow', () => {
    const p = line(1);
    const hv = p.nodes[1];
    hv.outlet = { ...(hv.outlet as NonNullable<NetworkNode['outlet']>), model: 'emitter' };
    const [row] = requirementCheck(p);
    expect(row.requiredPressureBar).toBeCloseTo(12.89, 1);
    expect(row.requiredFlowLpm).toBeCloseTo(900, 1);
    expect(row.pass).toBe(false);
  });

  it('accounts for elevation and suction loss', () => {
    const flat = line(1);
    const [base] = requirementCheck(flat);
    const raised = line(1);
    raised.nodes[1].elevationM = 10;
    raised.pumps[0].suctionLossM = 2;
    const [high] = requirementCheck(raised);
    expect((high.pumpHeadNeededM as number) - (base.pumpHeadNeededM as number)).toBeCloseTo(12, 4);
  });
});
