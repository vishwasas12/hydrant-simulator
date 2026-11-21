import { describe, expect, it } from 'vitest';
import { emptyProject } from '../../model/defaults';
import { addNode, addPipe, addValve, setPumpNode } from '../../model/edit';
import type { NetworkNode, NodeKind, Project } from '../../model/types';
import {
  bendName,
  calculationFittings,
  fittingSchedule,
  fittingTotals,
  junctionSchedule,
  nodeConnections,
  pipeSchedule,
  valveSchedule,
} from '../inventory';

/**
 *   J0 (pump) ──150── JB
 *                      │ 100
 *   JL ──150── JT ──150── H1 ──150── JS ──100── JR
 *                                                 ╲ 100
 *                                                  HX
 */
function build(): { p: Project; n: Record<string, NetworkNode> } {
  const p = emptyProject();
  const n: Record<string, NetworkNode> = {};
  const node = (label: string, x: number, y: number, kind: NodeKind = 'junction') => {
    n[label] = addNode(p, x, y, kind);
    n[label].label = label;
  };
  node('J0', 0, 0);
  node('JB', 100, 0);
  node('JT', 100, 100);
  node('JL', 0, 100);
  node('H1', 200, 100, 'hydrant');
  node('JS', 300, 100);
  node('JR', 400, 100);
  node('HX', 450, 150, 'hydrant');
  setPumpNode(p, n.J0.id);
  const pipe = (a: string, b: string, size: number) => addPipe(p, n[a].id, n[b].id, size);
  pipe('J0', 'JB', 150);
  pipe('JB', 'JT', 100);
  pipe('JL', 'JT', 150);
  pipe('JT', 'H1', 150);
  pipe('H1', 'JS', 150);
  pipe('JS', 'JR', 100);
  pipe('JR', 'HX', 100);
  return { p, n };
}

const describeNode = (p: Project, label: string) => nodeConnections(p).find((c) => c.node.label === label);
const pipeBetween = (p: Project, n: Record<string, NetworkNode>, a: string, b: string) =>
  p.pipes.find((x) => (x.from === n[a].id && x.to === n[b].id) || (x.from === n[b].id && x.to === n[a].id))?.id;

describe('network inventory', () => {
  it('classifies each junction from the pipes meeting there', () => {
    const { p } = build();
    expect(describeNode(p, 'J0')?.description).toBe('Pump delivery (Fire pump)');
    expect(describeNode(p, 'JB')?.fittings).toMatchObject([{ kind: 'bend', name: '90° bend', size: '150 × 100' }]);
    expect(describeNode(p, 'JT')?.fittings).toMatchObject([{ kind: 'tee', name: 'Reducing tee', size: '150 × 150 × 100' }]);
    expect(describeNode(p, 'JL')?.description).toBe('Dead end, capped');
    expect(describeNode(p, 'JS')?.fittings).toMatchObject([{ kind: 'reducer', name: 'Reducer', size: '150 × 100' }]);
    expect(describeNode(p, 'JR')?.fittings[0].name).toBe('45° bend');
  });

  it('counts an in-line hydrant as a tee and an end-of-line one as none', () => {
    const { p } = build();
    expect(describeNode(p, 'H1')?.fittings).toMatchObject([{ kind: 'takeOff', name: 'Tee for hydrant outlet', size: '150 main' }]);
    expect(describeNode(p, 'HX')?.fittings).toEqual([]);
    expect(describeNode(p, 'HX')?.description).toBe('End-of-line hydrant');
  });

  it('puts each fitting loss on the right pipe', () => {
    const { p, n } = build();
    const losses = (label: string) => describeNode(p, label)?.fittings.flatMap((f) => f.losses);
    // Bend between 150 and 100: the elbow goes on the smaller pipe.
    expect(losses('JB')).toEqual([{ pipeId: pipeBetween(p, n, 'JB', 'JT'), type: 'elbow90', quantity: 1 }]);
    // Tee: branch loss on the branch, run loss on one run pipe.
    expect(losses('JT')).toEqual([
      { pipeId: pipeBetween(p, n, 'JL', 'JT'), type: 'teeRun', quantity: 1 },
      { pipeId: pipeBetween(p, n, 'JB', 'JT'), type: 'teeBranch', quantity: 1 },
    ]);
    expect(losses('H1')).toEqual([{ pipeId: pipeBetween(p, n, 'JT', 'H1'), type: 'teeRun', quantity: 1 }]);
    expect(losses('JS')).toEqual([{ pipeId: pipeBetween(p, n, 'JS', 'JR'), type: 'reducer', quantity: 1 }]);
    expect(losses('JR')).toEqual([{ pipeId: pipeBetween(p, n, 'JS', 'JR'), type: 'elbow45', quantity: 1 }]);
    expect(losses('JL')).toEqual([]);
  });

  it('totals junctions, tees and bends', () => {
    const { p } = build();
    expect(fittingTotals(nodeConnections(p))).toEqual({
      junctions: 6,
      tees: 1,
      takeOffTees: 1,
      crosses: 0,
      bends: 2,
      reducers: 1,
      endCaps: 1,
    });
  });

  it('treats a slight kink in the drawing as a straight run', () => {
    const p = emptyProject();
    const a = addNode(p, 0, 0, 'junction');
    const b = addNode(p, 100, 0, 'junction');
    const c = addNode(p, 200, 5, 'junction');
    addPipe(p, a.id, b.id, 150);
    addPipe(p, b.id, c.id, 150);
    const mid = nodeConnections(p).find((x) => x.node.id === b.id);
    expect(mid?.deflectionDeg).toBeCloseTo(2.86, 1);
    expect(mid?.fittings).toEqual([]);
    expect(mid?.description).toBe('Straight joint');
  });

  it('groups the fitting schedule by type and size, tees first', () => {
    const { p } = build();
    const rows = fittingSchedule(nodeConnections(p));
    expect(rows.map((r) => `${r.name} ${r.size} ×${r.quantity}`)).toEqual([
      'Reducing tee 150 × 150 × 100 ×1',
      'Tee for hydrant outlet 150 main ×1',
      '90° bend 150 × 100 ×1',
      '45° bend 100 ×1',
      'Reducer 150 × 100 ×1',
      'End cap 150 ×1',
    ]);
    expect(rows[0].locations).toEqual(['JT']);
  });

  it('lists junctions only, in natural label order', () => {
    const p = emptyProject();
    for (const label of ['J10', 'J2', 'J1']) addNode(p, Math.random() * 100, 0, 'junction').label = label;
    addNode(p, 50, 50, 'hydrant');
    expect(junctionSchedule(nodeConnections(p)).map((c) => c.node.label)).toEqual(['J1', 'J2', 'J10']);
  });

  it('snaps bends to standard angles', () => {
    expect(bendName(89.5)).toBe('90° bend');
    expect(bendName(44)).toBe('45° bend');
    expect(bendName(30)).toBe('22.5° bend');
    expect(bendName(10)).toBe('11.25° bend');
    expect(bendName(130)).toBe('130° bend');
  });

  it('totals pipe length by size', () => {
    const { p } = build();
    const rows = pipeSchedule(p);
    expect(rows.map((r) => [r.size, r.count])).toEqual([
      [150, 4],
      [100, 3],
    ]);
    expect(rows[0].lengthM).toBeCloseTo(400, 6);
  });

  it('sums fittings entered on pipes for the calculation', () => {
    const { p } = build();
    p.pipes[0].fittings.push({ id: 'f1', type: 'elbow90', quantity: 2 });
    p.pipes[2].fittings.push({ id: 'f2', type: 'elbow90', quantity: 1 });
    const rows = calculationFittings(p);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: '90° elbow', size: 150, quantity: 3 });
    expect(rows[0].pipes).toHaveLength(2);
  });

  it('lists valves with the pipe they sit on', () => {
    const { p } = build();
    const v = addValve(p, p.pipes[1].id, 0.5, 'butterfly');
    if (!v) throw new Error('valve not placed');
    v.status = 'closed';
    expect(valveSchedule(p)).toEqual([{ label: 'V1', type: 'Butterfly valve', pipe: p.pipes[1].label, size: 100, closed: true }]);
  });
});
