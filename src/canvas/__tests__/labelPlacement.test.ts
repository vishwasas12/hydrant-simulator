import { describe, expect, it } from 'vitest';
import { placeNodeLabels, segmentHitsBox, type Segment } from '../labelPlacement';

const node = { x: 100, y: 100 };
const seg = (ax: number, ay: number, bx: number, by: number): Segment => ({ a: { x: ax, y: ay }, b: { x: bx, y: by } });
const crosses = (segments: Segment[], box: { x1: number; y1: number; x2: number; y2: number }) =>
  segments.some((s) => segmentHitsBox(s.a, s.b, box));

describe('label placement', () => {
  it('detects a segment passing through a box, and one passing by', () => {
    const box = { x1: 0, y1: 0, x2: 10, y2: 10 };
    expect(segmentHitsBox({ x: -5, y: 5 }, { x: 15, y: 5 }, box)).toBe(true);
    expect(segmentHitsBox({ x: -5, y: 12 }, { x: 15, y: 12 }, box)).toBe(false);
    expect(segmentHitsBox({ x: 2, y: 2 }, { x: 3, y: 3 }, box)).toBe(true);
  });

  it('keeps the name and pressure of a hydrant on a horizontal main above the line', () => {
    const main = [seg(0, 100, 100, 100), seg(100, 100, 300, 100)];
    const block = placeNodeLabels(node, [30, 50], main, []);
    expect(block.anchor).toBe('start');
    // Both baselines, with room for the text height, sit above the pipe.
    expect(Math.max(...block.ys)).toBeLessThan(-5);
    expect(crosses(main, block.box)).toBe(false);
  });

  it('moves to another corner when a pipe runs through the first', () => {
    // Pipe rising to the upper right, and the main going right.
    const pipes = [seg(100, 100, 160, 40), seg(100, 100, 300, 100)];
    const block = placeNodeLabels(node, [30, 50], pipes, []);
    expect(crosses(pipes, block.box)).toBe(false);
    expect(block.box.y1).toBeGreaterThan(100); // below the main
  });

  it('avoids a label already placed', () => {
    const main = [seg(0, 100, 300, 100)];
    const first = placeNodeLabels(node, [40], main, []);
    const second = placeNodeLabels({ x: 104, y: 100 }, [40], main, [first.box]);
    const overlap =
      Math.max(0, Math.min(first.box.x2, second.box.x2) - Math.max(first.box.x1, second.box.x1)) *
      Math.max(0, Math.min(first.box.y2, second.box.y2) - Math.max(first.box.y1, second.box.y1));
    expect(overlap).toBe(0);
  });
});
