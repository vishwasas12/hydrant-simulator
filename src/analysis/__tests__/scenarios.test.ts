import { describe, expect, it } from 'vitest';
import { captureState } from '../../model/edit';
import { seedProject } from '../../model/seed';
import { solve } from '../../solver';
import { applyScenario, compareScenarios } from '../scenarios';

describe('scenarios', () => {
  it('produces one column per scenario', () => {
    const p = seedProject();
    const c = compareScenarios(p, p.scenarios);
    expect(c.columns).toHaveLength(3);
    for (const col of c.columns) expect(col.results.ok).toBe(true);
    expect(c.rows.find((r) => r.key === 'q')?.values).toHaveLength(3);
  });

  it('lowers pressure with aged pipe', () => {
    const p = seedProject();
    const [design, , aged] = compareScenarios(p, p.scenarios).columns;
    expect(aged.results.system.criticalPressureBar as number).toBeLessThan(
      design.results.system.criticalPressureBar as number,
    );
  });

  it('lowers pressure with a ring valve shut', () => {
    const p = seedProject();
    const [design, shut] = compareScenarios(p, p.scenarios).columns;
    expect(shut.results.system.criticalPressureBar as number).toBeLessThan(
      design.results.system.criticalPressureBar as number,
    );
  });

  it('applies overrides to the model and matches a scenario solve', () => {
    const p = seedProject();
    const scenario = p.scenarios[1];
    const expected = solve(p, scenario);
    applyScenario(p, scenario);
    const actual = solve(p);
    expect(actual.system.criticalPressureBar).toBeCloseTo(expected.system.criticalPressureBar as number, 6);
  });

  it('does not mutate the network when solving a scenario', () => {
    const p = seedProject();
    const before = JSON.stringify(p);
    solve(p, p.scenarios[2]);
    expect(JSON.stringify(p)).toBe(before);
  });

  it('captures a state that reproduces the current solve', () => {
    const p = seedProject();
    const snap = captureState(p);
    for (const n of p.nodes) if (n.outlet) n.outlet.on = false;
    const r = solve(p, snap);
    expect(r.system.pumpFlowLpm).toBeCloseTo(2850, 1);
  });
});
