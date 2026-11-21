import { describe, expect, it } from 'vitest';
import { emptyProject } from '../../model/defaults';
import { addNode, addPipe, setPumpNode } from '../../model/edit';
import { parseProject } from '../../model/schema';
import type { Project } from '../../model/types';
import { solve } from '../solve';

/** Pump → 90° bend → tee with two fixed-demand hydrants: one on the run, one on the branch. */
function lShape(autoFittings: boolean | undefined): Project {
  const p = emptyProject('L');
  p.settings.autoFittings = autoFittings;
  const pump = addNode(p, 0, 0, 'junction');
  const bend = addNode(p, 100, 0, 'junction');
  const tee = addNode(p, 100, 100, 'junction');
  const run = addNode(p, 100, 200, 'hydrant');
  const branch = addNode(p, 200, 100, 'hydrant');
  setPumpNode(p, pump.id);
  p.pumps[0].curve = { kind: 'constant', headM: 80 };
  addPipe(p, pump.id, bend.id, 150);
  addPipe(p, bend.id, tee.id, 150);
  addPipe(p, tee.id, run.id, 150);
  addPipe(p, tee.id, branch.id, 150);
  for (const n of [run, branch]) {
    if (n.outlet) Object.assign(n.outlet, { on: true, model: 'fixed', fixedFlowLpm: 900 });
  }
  return p;
}

const leqByPipe = (p: Project) => {
  const r = solve(p);
  expect(r.ok).toBe(true);
  return Object.fromEntries(r.pipes.map((x) => [x.label, x.equivalentLengthM - x.lengthM]));
};

describe('fittings found from the drawing', () => {
  it('adds the bend and tee losses to the adjoining pipes', () => {
    // 150 NB at C = 120: 90° elbow 4.3 m, tee run 3.0 m, tee branch 9.1 m.
    const extra = leqByPipe(lShape(true));
    expect(extra.P1).toBeCloseTo(4.3, 6); // bend, on the first pipe by label
    expect(extra.P2).toBeCloseTo(3.0, 6); // tee run, on one run pipe
    expect(extra.P3).toBeCloseTo(0, 6);
    expect(extra.P4).toBeCloseTo(9.1, 6); // tee branch
  });

  it('lowers the pressure at the outlets compared with no fittings', () => {
    const on = solve(lShape(true));
    const off = solve(lShape(false));
    const hydrantPressures = (r: typeof on) => r.nodes.filter((n) => n.kind === 'hydrant').map((n) => n.pressureM ?? NaN);
    const [runOn, branchOn] = hydrantPressures(on);
    const [runOff, branchOff] = hydrantPressures(off);
    expect(runOn).toBeLessThan(runOff - 0.1);
    expect(branchOn).toBeLessThan(branchOff - 0.1);
  });

  it('adds nothing when switched off', () => {
    const extra = leqByPipe(lShape(false));
    expect(Object.values(extra).every((v) => Math.abs(v) < 1e-9)).toBe(true);
  });

  it('keeps an older file, saved without the setting, on its own fittings', () => {
    const saved = JSON.parse(JSON.stringify(lShape(true)));
    delete saved.settings.autoFittings;
    const parsed = parseProject(saved);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.project.settings.autoFittings).toBeUndefined();
    const extra = leqByPipe(parsed.project);
    expect(Object.values(extra).every((v) => Math.abs(v) < 1e-9)).toBe(true);
  });

  it('is on for a new project', () => {
    expect(emptyProject().settings.autoFittings).toBe(true);
  });
});
