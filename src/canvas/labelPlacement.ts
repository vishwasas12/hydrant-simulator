/**
 * Places the text beside a node so it stays off the pipes and off other labels.
 * Shared by the drawing on screen and the drawing in the report.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Box {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface Segment {
  a: Point;
  b: Point;
}

export interface LabelBlock {
  /** Text x relative to the node. */
  x: number;
  anchor: 'start' | 'end';
  /** Baseline of each line relative to the node, top line first. */
  ys: number[];
  /** Space the block takes, in the same coordinates as the node. */
  box: Box;
}

/** Spacing between stacked lines, px. */
export const LINE_HEIGHT = 12.5;

/** Rough width of a line of text, enough to keep labels apart. */
export const textWidth = (text: string, fontSize: number): number => text.length * fontSize * 0.6;

export const overlapArea = (box: Box, taken: Box[]): number =>
  taken.reduce(
    (sum, t) => sum + Math.max(0, Math.min(box.x2, t.x2) - Math.max(box.x1, t.x1)) * Math.max(0, Math.min(box.y2, t.y2) - Math.max(box.y1, t.y1)),
    0,
  );

/** Whether a line segment passes through a box (Liang-Barsky clipping). */
export function segmentHitsBox(a: Point, b: Point, box: Box): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const p = [-dx, dx, -dy, dy];
  const q = [a.x - box.x1, box.x2 - a.x, a.y - box.y1, box.y2 - a.y];
  let t0 = 0;
  let t1 = 1;
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return false;
      continue;
    }
    const r = q[i] / p[i];
    if (p[i] < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
  }
  return true;
}

/** Half the widest pipe stroke, so text clears the drawn line and not just its centre. */
const PIPE_CLEARANCE = 3;

const CORNERS = [
  { right: true, up: true },
  { right: true, up: false },
  { right: false, up: true },
  { right: false, up: false },
];

/**
 * Stacks a node's labels above right, below right, above left or below left of
 * it, taking the first corner that crosses no pipe and no label already placed,
 * or the least crowded one when none is clear.
 *
 * @param widths width of each line, top line first
 * @param gap horizontal distance from the node centre to the text
 */
export function placeNodeLabels(node: Point, widths: number[], segments: Segment[], taken: Box[], gap = 11): LabelBlock {
  const height = widths.length * LINE_HEIGHT;
  const width = Math.max(0, ...widths);
  let best: LabelBlock | null = null;
  let bestScore = Infinity;
  for (const corner of CORNERS) {
    // Up blocks end 6 px above the node, down blocks start 6 px below it.
    const top = corner.up ? -6 - height : 6;
    const ys = widths.map((_, i) => top + 9.5 + LINE_HEIGHT * i);
    const box: Box = {
      x1: node.x + (corner.right ? gap - 1 : -gap - width - 1),
      x2: node.x + (corner.right ? gap + width + 1 : -gap + 1),
      y1: node.y + top,
      y2: node.y + top + height,
    };
    const padded = { x1: box.x1 - PIPE_CLEARANCE, y1: box.y1 - PIPE_CLEARANCE, x2: box.x2 + PIPE_CLEARANCE, y2: box.y2 + PIPE_CLEARANCE };
    const crossings = segments.filter((s) => segmentHitsBox(s.a, s.b, padded)).length;
    const score = crossings * 1e6 + overlapArea(box, taken);
    const block: LabelBlock = { x: corner.right ? gap : -gap, anchor: corner.right ? 'start' : 'end', ys, box };
    if (score === 0) return block;
    if (score < bestScore) {
      bestScore = score;
      best = block;
    }
  }
  return best as LabelBlock;
}
