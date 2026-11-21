import { DEFAULT_HOSE_REEL, DEFAULT_HYDRANT, emptyProject, makePipe, makePump } from './defaults';
import type { Fitting, FittingType, NetworkNode, Pipe, Project } from './types';

/**
 * Reference project: a 600 m x 350 m ring of 150 mm pipe (1.9 km), three cross
 * headers, 26 hydrants on short 80 mm branches and the pump at one corner.
 *
 * Hydrants use fixed demand of 950 LPM. Three open hydrants then draw the pump's
 * rated 2850 LPM. See the README for why the emitter default is not used here.
 */
const WIDTH = 600;
const HEIGHT = 350;
const PERIMETER = 2 * (WIDTH + HEIGHT);
const HEADER_X = [150, 300, 450];
const HYDRANT_COUNT = 26;
const BRANCH_DRAWN = 14;
const BRANCH_LENGTH_M = 3;
const SNAP_M = 15;

/** Point on the ring at arc length s. Starts at the bottom-left pump corner. */
function pointAt(s: number): { x: number; y: number; nx: number; ny: number } {
  if (s <= WIDTH) return { x: s, y: HEIGHT, nx: 0, ny: 1 };
  if (s <= WIDTH + HEIGHT) return { x: WIDTH, y: HEIGHT - (s - WIDTH), nx: 1, ny: 0 };
  if (s <= 2 * WIDTH + HEIGHT) {
    return { x: WIDTH - (s - WIDTH - HEIGHT), y: 0, nx: 0, ny: -1 };
  }
  return { x: 0, y: s - 2 * WIDTH - HEIGHT, nx: -1, ny: 0 };
}

const fitting = (id: string, type: FittingType, quantity: number): Fitting => ({ id, type, quantity });

export function seedProject(): Project {
  const project = emptyProject('Reference yard ring');
  // Its fittings are placed by hand below, so the drawing does not add more.
  project.settings.autoFittings = false;
  const nodes: NetworkNode[] = [];
  let nodeSeq = 0;
  let junctionSeq = 0;
  let pipeSeq = 0;
  let fittingSeq = 0;

  const addJunction = (x: number, y: number): NetworkNode => {
    junctionSeq += 1;
    nodeSeq += 1;
    const node: NetworkNode = {
      id: `n${nodeSeq}`,
      label: `J${junctionSeq}`,
      x,
      y,
      elevationM: 0,
      baseDemandLpm: 0,
      kind: 'junction',
    };
    nodes.push(node);
    return node;
  };

  const addPipe = (a: string, b: string, size: number, length: number, manual = false, fit: [FittingType, number][] = []) => {
    pipeSeq += 1;
    const pipe = makePipe(`p${pipeSeq}`, `P${pipeSeq}`, a, b, size, length);
    pipe.lengthManual = manual;
    pipe.fittings = fit.map(([type, qty]) => {
      fittingSeq += 1;
      return fitting(`f${fittingSeq}`, type, qty);
    });
    project.pipes.push(pipe);
    return pipe;
  };

  // Key points along the ring: corners, header tees and hydrant taps.
  const headerBottom = HEADER_X.map((x) => x);
  const headerTop = HEADER_X.map((x) => 2 * WIDTH + HEIGHT - x);
  const corners = [0, WIDTH, WIDTH + HEIGHT, 2 * WIDTH + HEIGHT];
  const anchors = [...corners, ...headerBottom, ...headerTop];

  const spacing = PERIMETER / HYDRANT_COUNT;
  const taps: number[] = [];
  for (let k = 1; k < HYDRANT_COUNT; k++) taps.push(k * spacing);
  taps.push(PERIMETER - 24);
  const snappedTaps = taps.map((s) => {
    const near = anchors.find((a) => a !== 0 && Math.abs(a - s) <= SNAP_M);
    return near ?? Math.round(s);
  });

  const stations = [...new Set([...anchors, ...snappedTaps])].sort((a, b) => a - b);
  const ringNode = new Map<number, NetworkNode>();
  for (const s of stations) {
    const p = pointAt(s);
    ringNode.set(s, addJunction(p.x, p.y));
  }

  const cornerSet = new Set(corners);
  stations.forEach((s, i) => {
    const next = i + 1 < stations.length ? stations[i + 1] : PERIMETER;
    const a = ringNode.get(s) as NetworkNode;
    const b = ringNode.get(i + 1 < stations.length ? stations[i + 1] : 0) as NetworkNode;
    const fit: [FittingType, number][] = cornerSet.has(s) ? [['elbow90', 1]] : [['teeRun', 1]];
    addPipe(a.id, b.id, 150, next - s, false, fit);
  });

  // Cross headers, each with a mid-point tee feeding a hose reel.
  const reels: { node: NetworkNode; label: string }[] = [];
  HEADER_X.forEach((x, i) => {
    const bottom = ringNode.get(headerBottom[i]) as NetworkNode;
    const top = ringNode.get(headerTop[i]) as NetworkNode;
    const mid = addJunction(x, HEIGHT / 2);
    addPipe(bottom.id, mid.id, 150, HEIGHT / 2, false, [['teeBranch', 1]]);
    addPipe(mid.id, top.id, 150, HEIGHT / 2, false, [['teeBranch', 1]]);
    reels.push({ node: mid, label: `HR ${i + 1}` });
  });

  // Hydrants on short 80 mm branches. Drawn offset is schematic, length is typed in.
  snappedTaps.forEach((s, i) => {
    const tap = ringNode.get(s) as NetworkNode;
    const p = pointAt(s);
    const isFarCorner = s === WIDTH + HEIGHT;
    nodeSeq += 1;
    const hydrant: NetworkNode = {
      id: `n${nodeSeq}`,
      label: `HV ${i + 1}`,
      x: p.x + (isFarCorner ? BRANCH_DRAWN * 0.7 : p.nx * BRANCH_DRAWN),
      y: p.y + (isFarCorner ? -BRANCH_DRAWN * 0.7 : p.ny * BRANCH_DRAWN),
      elevationM: 0,
      baseDemandLpm: 0,
      kind: 'hydrant',
      outlet: { ...DEFAULT_HYDRANT, model: 'fixed', on: i >= 11 && i <= 13 },
    };
    nodes.push(hydrant);
    addPipe(tap.id, hydrant.id, 80, BRANCH_LENGTH_M, true, [
      ['teeBranch', 1],
      ['gateValve', 1],
    ]);
  });

  for (const { node, label } of reels) {
    nodeSeq += 1;
    const reel: NetworkNode = {
      id: `n${nodeSeq}`,
      label,
      x: node.x + BRANCH_DRAWN,
      y: node.y,
      elevationM: 0,
      baseDemandLpm: 0,
      kind: 'hoseReel',
      outlet: { ...DEFAULT_HOSE_REEL },
    };
    nodes.push(reel);
    addPipe(node.id, reel.id, 25, BRANCH_LENGTH_M, true, [['teeBranch', 1]]);
  }

  // Sectional isolation valves: one on each ring leg near the pump, and at two header feet.
  const ringPipes = project.pipes.filter((p) => p.nominalMm === 150 && !p.fittings.some((f) => f.type === 'teeBranch'));
  const headerFeet = project.pipes.filter((p) => p.nominalMm === 150 && p.fittings.some((f) => f.type === 'teeBranch') && p.from !== p.to);
  const valveOn: [Pipe, number][] = [
    [ringPipes[0], 0.35],
    [ringPipes[ringPipes.length - 2], 0.5],
    ...headerFeet.filter((_, i) => i % 2 === 0).map((p): [Pipe, number] => [p, 0.12]),
  ];
  valveOn.forEach(([pipe, position], i) => {
    pipe.valves = [
      { id: `v${i + 1}`, label: `V${i + 1}`, type: 'gate', position, status: 'open', forward: true },
    ];
  });

  project.nodes = nodes;
  const pumpNode = ringNode.get(0) as NetworkNode;
  project.pumps = [makePump('pump1', 'Fire pump', pumpNode.id)];

  const design: Record<string, boolean> = {};
  for (const n of nodes) if (n.outlet) design[n.id] = !!n.outlet.on;
  project.scenarios = [
    { id: 's1', name: 'Design: 3 remotest open', hydrantOn: design },
    {
      id: 's2',
      name: 'Valve V1 shut at pump',
      hydrantOn: design,
      valveStatus: { v1: 'closed' },
    },
    { id: 's3', name: 'Aged pipe, C = 100', hydrantOn: design, globalC: 100 },
  ];
  return project;
}
