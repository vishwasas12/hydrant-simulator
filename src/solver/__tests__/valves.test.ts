import { describe, expect, it } from 'vitest';
import { addValve, captureState } from '../../model/edit';
import { seedProject } from '../../model/seed';
import type { PipeValve } from '../../model/types';
import { solve } from '..';
import { constantPump, fixedHydrant, network, node, pipe } from './helpers';

const valve = (patch: Partial<PipeValve> = {}): PipeValve => ({
  id: 'v1',
  label: 'V1',
  type: 'gate',
  position: 0.5,
  status: 'open',
  forward: true,
  ...patch,
});

/** a(pump) -> b -> c(hydrant), plus a direct a -> c. Natural flow in bc is b to c. */
function triangle(v?: PipeValve) {
  const bc = pipe('bc', 'BC', 'b', 'c', 100, 150);
  if (v) bc.valves = [v];
  return network(
    [node('a'), node('b'), fixedHydrant('c', 2000)],
    [pipe('ab', 'AB', 'a', 'b', 150, 200), bc, pipe('ac', 'AC', 'a', 'c', 150, 500)],
    [constantPump('a', 110)],
  );
}

describe('valves', () => {
  it('an open gate valve adds its table equivalent length', () => {
    const p = pipe('p', 'P', 'a', 'b', 150, 100);
    p.valves = [valve()];
    const r = solve(network([node('a'), fixedHydrant('b', 1000)], [p], [constantPump('a', 110)]));
    expect(r.pipes[0].equivalentLengthM).toBeCloseTo(100.9, 6);
  });

  it('a closed valve shuts its pipe, like a closed pipe', () => {
    const r = solve(triangle(valve({ status: 'closed' })));
    expect(r.ok).toBe(true);
    expect(r.pipes[1].flowLpm).toBe(0);
    expect(r.pipes[1].status).toBe('closed');
    expect(r.pipes[2].flowLpm).toBeCloseTo(2000, 3);
  });

  it('a non-return valve facing the flow passes it', () => {
    const plain = solve(triangle());
    const r = solve(triangle(valve({ type: 'nonReturn', forward: true })));
    expect(plain.pipes[1].flowLpm).toBeGreaterThan(100);
    expect(r.pipes[1].flowLpm).toBeGreaterThan(100);
  });

  it('a non-return valve against the flow blocks it', () => {
    const r = solve(triangle(valve({ type: 'nonReturn', forward: false })));
    expect(r.ok).toBe(true);
    expect(Math.abs(r.pipes[1].flowLpm)).toBeLessThan(0.1);
    expect(r.pipes[2].flowLpm).toBeCloseTo(2000, 0);
  });

  it('non-return valves facing both ways shut the pipe with a warning', () => {
    const bc = pipe('bc', 'BC', 'b', 'c', 100, 150);
    const net = triangle();
    net.pipes[1] = { ...bc, valves: [valve({ type: 'nonReturn' }), valve({ id: 'v2', type: 'nonReturn', forward: false })] };
    const r = solve(net);
    expect(r.pipes[1].flowLpm).toBe(0);
    expect(r.issues.some((i) => i.message.includes('opposite ways'))).toBe(true);
  });

  it('a scenario can close a valve without changing the model', () => {
    const net = triangle(valve());
    const r = solve(net, { valveStatus: { v1: 'closed' } });
    expect(r.pipes[1].flowLpm).toBe(0);
    expect(net.pipes[1].valves?.[0].status).toBe('open');
  });

  it('closing V1 at the pump lowers pressure on the reference ring', () => {
    const p = seedProject();
    const open = solve(p).system.criticalPressureBar as number;
    const shut = solve(p, { valveStatus: { v1: 'closed' } }).system.criticalPressureBar as number;
    expect(shut).toBeLessThan(open);
  });

  it('captureState records valve status', () => {
    const p = seedProject();
    p.pipes[0].valves![0].status = 'closed';
    expect(captureState(p).valveStatus.v1).toBe('closed');
  });

  it('addValve labels in sequence and keeps the valve off the pipe ends', () => {
    const p = seedProject();
    const v = addValve(p, p.pipes[5].id, 0);
    expect(v?.label).toBe('V6');
    expect(v?.position).toBe(0.05);
  });

  it('still loads files saved before valves existed', () => {
    const p = seedProject();
    for (const x of p.pipes) delete x.valves;
    expect(solve(p).ok).toBe(true);
  });
});
