import { describe, expect, it } from 'vitest';
import { emptyProject } from '../defaults';
import {
  addNode,
  addPipe,
  addValve,
  deleteNode,
  deleteValve,
  markNode,
  moveNode,
  recomputeLengths,
  setPumpNode,
  splitPipe,
} from '../edit';
import { parseProject } from '../schema';
import { seedProject } from '../seed';

describe('editing operations', () => {
  it('derives pipe length from the drawing scale', () => {
    const p = emptyProject();
    p.metersPerUnit = 2;
    const a = addNode(p, 0, 0, 'junction');
    const b = addNode(p, 30, 40, 'junction');
    const pipe = addPipe(p, a.id, b.id, 150);
    expect(pipe?.lengthM).toBeCloseTo(100, 6);
    expect(pipe?.internalDiameterMm).toBe(154.3);
  });

  it('updates length when a node moves, unless the length is manual', () => {
    const p = emptyProject();
    const a = addNode(p, 0, 0, 'junction');
    const b = addNode(p, 10, 0, 'junction');
    const c = addNode(p, 0, 10, 'junction');
    const follow = addPipe(p, a.id, b.id, 80);
    const manual = addPipe(p, a.id, c.id, 80);
    if (!follow || !manual) throw new Error('pipes not created');
    manual.lengthManual = true;
    manual.lengthM = 99;
    moveNode(p, a.id, -10, 0);
    expect(follow.lengthM).toBeCloseTo(20, 6);
    expect(manual.lengthM).toBe(99);
  });

  it('rescales only non-manual lengths after calibration', () => {
    const p = emptyProject();
    const a = addNode(p, 0, 0, 'junction');
    const b = addNode(p, 10, 0, 'junction');
    const pipe = addPipe(p, a.id, b.id, 80);
    if (!pipe) throw new Error('pipe not created');
    p.metersPerUnit = 5;
    recomputeLengths(p);
    expect(pipe.lengthM).toBeCloseTo(50, 6);
  });

  it('splits a pipe in proportion', () => {
    const p = emptyProject();
    const a = addNode(p, 0, 0, 'junction');
    const b = addNode(p, 100, 0, 'junction');
    const pipe = addPipe(p, a.id, b.id, 150);
    if (!pipe) throw new Error('pipe not created');
    const mid = splitPipe(p, pipe.id, 25, 0, 'hydrant');
    expect(mid?.kind).toBe('hydrant');
    expect(p.pipes).toHaveLength(2);
    expect(p.pipes[0].lengthM).toBeCloseTo(25, 6);
    expect(p.pipes[1].lengthM).toBeCloseTo(75, 6);
    expect(p.pipes[1].to).toBe(b.id);
  });

  it('keeps each valve on its own half when a pipe is split', () => {
    const p = emptyProject();
    const a = addNode(p, 0, 0, 'junction');
    const b = addNode(p, 100, 0, 'junction');
    const pipe = addPipe(p, a.id, b.id, 150);
    if (!pipe) throw new Error('pipe not created');
    addValve(p, pipe.id, 0.2);
    addValve(p, pipe.id, 0.8);
    splitPipe(p, pipe.id, 50, 0, 'junction');
    expect(p.pipes[0].valves?.map((v) => [v.label, v.position])).toEqual([['V1', 0.4]]);
    expect(p.pipes[1].valves?.map((v) => v.label)).toEqual(['V2']);
    expect(p.pipes[1].valves?.[0].position).toBeCloseTo(0.6, 6);
  });

  it('deletes a valve and leaves the pipe', () => {
    const p = emptyProject();
    const a = addNode(p, 0, 0, 'junction');
    const b = addNode(p, 100, 0, 'junction');
    const pipe = addPipe(p, a.id, b.id, 150);
    const v = addValve(p, pipe!.id, 0.5);
    deleteValve(p, v!.id);
    expect(p.pipes).toHaveLength(1);
    expect(p.pipes[0].valves).toHaveLength(0);
  });

  it('marks a node with the right defaults and label', () => {
    const p = emptyProject();
    const a = addNode(p, 0, 0, 'junction');
    markNode(p, a.id, 'hydrant');
    expect(a.label).toBe('HV 1');
    expect(a.outlet?.minFlowLpm).toBe(900);
    markNode(p, a.id, 'hoseReel');
    expect(a.label).toBe('HR 1');
    expect(a.outlet?.fixedFlowLpm).toBe(30);
    expect(a.outlet?.minPressureBar).toBe(1.5);
  });

  it('removes attached pipes and pump with a deleted node', () => {
    const p = emptyProject();
    const a = addNode(p, 0, 0, 'junction');
    const b = addNode(p, 10, 0, 'junction');
    addPipe(p, a.id, b.id, 150);
    setPumpNode(p, a.id);
    deleteNode(p, a.id);
    expect(p.pipes).toHaveLength(0);
    expect(p.pumps).toHaveLength(0);
  });

  it('keeps a single pump when marking a second node', () => {
    const p = emptyProject();
    const a = addNode(p, 0, 0, 'junction');
    const b = addNode(p, 10, 0, 'junction');
    setPumpNode(p, a.id);
    setPumpNode(p, b.id);
    expect(p.pumps).toHaveLength(1);
    expect(p.pumps[0].nodeId).toBe(b.id);
  });
});

describe('project file', () => {
  it('round-trips the seed project through JSON and the schema', () => {
    const seed = seedProject();
    const parsed = parseProject(JSON.parse(JSON.stringify(seed)));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.project.nodes).toHaveLength(seed.nodes.length);
  });

  it('rejects a file with a dangling pipe reference', () => {
    const seed = seedProject();
    seed.pipes[0].from = 'missing';
    const parsed = parseProject(JSON.parse(JSON.stringify(seed)));
    expect(parsed.ok).toBe(false);
  });

  it('rejects a file that is not a project', () => {
    expect(parseProject({ hello: 'world' }).ok).toBe(false);
  });
});
