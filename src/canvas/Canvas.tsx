import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  addNode,
  addPipe,
  addValve,
  deleteNode,
  deletePipe,
  deleteValve,
  markNode,
  moveNode,
  setPumpNode,
  splitPipe,
} from '../model/edit';
import type { Id, NetworkNode, NodeKind, Pipe, PipeValve } from '../model/types';
import { ValveSymbol } from './ValveSymbol';
import { baselineResultsFor, useResults, useStore } from '../state/store';
import { criticalPath, type NodeResult, type PipeResult } from '../solver';
import { useCalibration } from './calibration';
import { diameterClass, sequentialColor, STATUS } from './colors';
import { FittingIcon } from './FittingIcon';
import { placeNodeLabels, textWidth, type Box, type LabelBlock, type Segment } from './labelPlacement';
import { Legend } from './Legend';

interface Point {
  x: number;
  y: number;
}

const NODE_HIT_PX = 11;
const PIPE_HIT_PX = 7;

function distanceToSegment(p: Point, a: Point, b: Point): { d: number; t: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.min(Math.max(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2, 0), 1);
  return { d: Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy), t };
}

export function Canvas() {
  const project = useStore((s) => s.project);
  const tool = useStore((s) => s.tool);
  const selection = useStore((s) => s.selection);
  const pipeStart = useStore((s) => s.pipeStart);
  const view = useStore((s) => s.view);
  const camera = useStore((s) => s.camera);
  const fitRequest = useStore((s) => s.fitRequest);
  const update = useStore((s) => s.update);
  const select = useStore((s) => s.select);
  const setCamera = useStore((s) => s.setCamera);
  const setPipeStart = useStore((s) => s.setPipeStart);
  const results = useResults();
  const calibration = useCalibration();

  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [cursor, setCursor] = useState<Point | null>(null);
  const dragRef = useRef<
    | { type: 'pan'; sx: number; sy: number; tx: number; ty: number }
    | { type: 'node'; id: Id; session: number; moved: boolean; sx: number; sy: number }
    | null
  >(null);
  const sessionRef = useRef(0);
  const spaceRef = useRef(false);

  const { nodes, pipes } = project;
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const nodeResults = useMemo(() => new Map(results.nodes.map((n) => [n.id, n])), [results]);
  const pipeResults = useMemo(() => new Map(results.pipes.map((p) => [p.id, p])), [results]);
  const baseline = view.showDelta ? baselineResultsFor(project) : null;
  const baselineNodes = useMemo(
    () => (baseline ? new Map(baseline.nodes.map((n) => [n.id, n])) : null),
    [baseline],
  );
  const path = useMemo(
    () => (view.showCriticalPath ? criticalPath(project, results) : null),
    [view.showCriticalPath, project, results],
  );
  const pathPipes = useMemo(() => new Set(path?.pipeIds ?? []), [path]);
  const toScreen = useCallback(
    (p: Point): Point => ({ x: p.x * camera.k + camera.tx, y: p.y * camera.k + camera.ty }),
    [camera],
  );
  const toWorld = useCallback(
    (p: Point): Point => ({ x: (p.x - camera.tx) / camera.k, y: (p.y - camera.ty) / camera.k }),
    [camera],
  );

  const fit = useCallback(() => {
    const { nodes: all, background } = useStore.getState().project;
    const xs = all.map((n) => n.x);
    const ys = all.map((n) => n.y);
    if (background && background.visible) {
      xs.push(background.x, background.x + background.width);
      ys.push(background.y, background.y + background.height);
    }
    if (xs.length === 0) {
      setCamera({ tx: size.w / 2, ty: size.h / 2, k: 1 });
      return;
    }
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const pad = 60;
    // The legend sits in the top-right corner, so keep the network clear of it.
    const legendReserve = 150;
    const usableW = size.w - pad * 2 - legendReserve;
    const k = Math.min(
      usableW / Math.max(maxX - minX, 1),
      (size.h - pad * 2) / Math.max(maxY - minY, 1),
      8,
    );
    setCamera({
      k,
      tx: pad + usableW / 2 - ((minX + maxX) / 2) * k,
      ty: size.h / 2 - ((minY + maxY) / 2) * k,
    });
  }, [size, setCamera]);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const fitted = useRef(false);
  useEffect(() => {
    if (size.w < 50 || size.h < 50) return;
    if (!fitted.current || fitRequest > 0) {
      fit();
      fitted.current = true;
    }
    // Re-fit only for an explicit request, or the first real measurement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitRequest, size.w > 50 && size.h > 50]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement)) spaceRef.current = true;
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceRef.current = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const current = useStore.getState().camera;
      const factor = Math.exp(-e.deltaY * 0.0012);
      const k = Math.min(Math.max(current.k * factor, 0.02), 60);
      const ratio = k / current.k;
      setCamera({ k, tx: sx - (sx - current.tx) * ratio, ty: sy - (sy - current.ty) * ratio });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [setCamera]);

  const hitNode = useCallback(
    (screen: Point): NetworkNode | null => {
      let best: NetworkNode | null = null;
      let bestD = NODE_HIT_PX;
      for (const n of nodes) {
        const s = toScreen(n);
        const d = Math.hypot(s.x - screen.x, s.y - screen.y);
        if (d < bestD) {
          best = n;
          bestD = d;
        }
      }
      return best;
    },
    [nodes, toScreen],
  );

  const hitPipe = useCallback(
    (screen: Point): { pipe: Pipe; t: number } | null => {
      let best: { pipe: Pipe; t: number } | null = null;
      let bestD = PIPE_HIT_PX;
      for (const p of pipes) {
        const a = byId.get(p.from);
        const b = byId.get(p.to);
        if (!a || !b) continue;
        const { d, t } = distanceToSegment(screen, toScreen(a), toScreen(b));
        if (d < bestD) {
          best = { pipe: p, t };
          bestD = d;
        }
      }
      return best;
    },
    [pipes, byId, toScreen],
  );

  /** Every valve with its position on the drawing. */
  const valveSpots = useMemo(() => {
    const out: { pipe: Pipe; valve: PipeValve; x: number; y: number; angle: number }[] = [];
    for (const p of pipes) {
      const a = byId.get(p.from);
      const b = byId.get(p.to);
      if (!a || !b) continue;
      const angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
      for (const v of p.valves ?? []) {
        out.push({ pipe: p, valve: v, x: a.x + (b.x - a.x) * v.position, y: a.y + (b.y - a.y) * v.position, angle });
      }
    }
    return out;
  }, [pipes, byId]);

  const hitValve = useCallback(
    (screen: Point) => {
      let best: (typeof valveSpots)[number] | null = null;
      let bestD = 11;
      for (const spot of valveSpots) {
        const s = toScreen(spot);
        const d = Math.hypot(s.x - screen.x, s.y - screen.y);
        if (d < bestD) {
          best = spot;
          bestD = d;
        }
      }
      return best;
    },
    [valveSpots, toScreen],
  );

  const toggleValve = (valveId: Id) =>
    update((d) => {
      for (const p of d.pipes) {
        const v = p.valves?.find((x) => x.id === valveId);
        if (v) v.status = v.status === 'open' ? 'closed' : 'open';
      }
    });

  /** Applies grid snap, and orthogonal snap relative to an anchor. */
  const snapPoint = useCallback(
    (world: Point, anchor?: NetworkNode | null): Point => {
      let { x, y } = world;
      if (view.snap) {
        x = Math.round(x / view.gridSize) * view.gridSize;
        y = Math.round(y / view.gridSize) * view.gridSize;
      }
      if (view.ortho && anchor) {
        if (Math.abs(x - anchor.x) >= Math.abs(y - anchor.y)) y = anchor.y;
        else x = anchor.x;
      }
      return { x, y };
    },
    [view.snap, view.ortho, view.gridSize],
  );

  const screenOf = (e: React.PointerEvent | React.MouseEvent): Point => {
    const rect = (svgRef.current as SVGSVGElement).getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const placeOutlet = (kind: NodeKind, screen: Point) => {
    const n = hitNode(screen);
    if (n) {
      update((d) => markNode(d, n.id, kind));
      select({ type: 'node', id: n.id });
      return;
    }
    const hit = hitPipe(screen);
    const world = snapPoint(toWorld(screen));
    let createdId: Id | null = null;
    update((d) => {
      const created = hit
        ? splitPipe(d, hit.pipe.id, world.x, world.y, kind)
        : addNode(d, world.x, world.y, kind);
      createdId = created ? created.id : null;
    });
    if (createdId) select({ type: 'node', id: createdId });
  };

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const screen = screenOf(e);
    (e.target as Element).setPointerCapture?.(e.pointerId);

    if (e.button === 1 || spaceRef.current) {
      dragRef.current = { type: 'pan', sx: screen.x, sy: screen.y, tx: camera.tx, ty: camera.ty };
      return;
    }
    if (e.button !== 0) return;

    switch (tool) {
      case 'select': {
        const n = hitNode(screen);
        if (n) {
          const pumpHere = project.pumps.find((p) => p.nodeId === n.id);
          select({ type: pumpHere && n.kind === 'junction' ? 'pump' : 'node', id: pumpHere && n.kind === 'junction' ? pumpHere.id : n.id });
          sessionRef.current += 1;
          dragRef.current = { type: 'node', id: n.id, session: sessionRef.current, moved: false, sx: screen.x, sy: screen.y };
          return;
        }
        const valveHit = hitValve(screen);
        if (valveHit) {
          select({ type: 'valve', id: valveHit.valve.id });
          return;
        }
        const hit = hitPipe(screen);
        if (hit) {
          select({ type: 'pipe', id: hit.pipe.id });
          return;
        }
        select(null);
        dragRef.current = { type: 'pan', sx: screen.x, sy: screen.y, tx: camera.tx, ty: camera.ty };
        return;
      }
      case 'junction': {
        if (hitNode(screen)) return;
        const hit = hitPipe(screen);
        const world = snapPoint(toWorld(screen));
        let createdId: Id | null = null;
        update((d) => {
          const created = hit
            ? splitPipe(d, hit.pipe.id, world.x, world.y, 'junction')
            : addNode(d, world.x, world.y, 'junction');
          createdId = created ? created.id : null;
        });
        if (createdId) select({ type: 'node', id: createdId });
        return;
      }
      case 'pipe': {
        const size = useStore.getState().newPipeSize;
        const existing = hitNode(screen);
        const start = pipeStart ? byId.get(pipeStart) ?? null : null;
        let endId: Id | null = existing ? existing.id : null;
        const world = snapPoint(toWorld(screen), start);
        update((d) => {
          if (!endId) endId = addNode(d, world.x, world.y, 'junction').id;
          if (start && endId !== start.id) addPipe(d, start.id, endId, size);
        });
        setPipeStart(endId);
        return;
      }
      case 'valve': {
        const existing = hitValve(screen);
        if (existing) {
          select({ type: 'valve', id: existing.valve.id });
          return;
        }
        const hit = hitPipe(screen);
        if (!hit) return;
        let createdId: Id | null = null;
        update((d) => {
          createdId = addValve(d, hit.pipe.id, hit.t)?.id ?? null;
        });
        if (createdId) select({ type: 'valve', id: createdId });
        return;
      }
      case 'hydrant':
        placeOutlet('hydrant', screen);
        return;
      case 'hoseReel':
        placeOutlet('hoseReel', screen);
        return;
      case 'pump': {
        const n = hitNode(screen);
        if (n) {
          update((d) => setPumpNode(d, n.id));
          const pump = useStore.getState().project.pumps[0];
          select({ type: 'pump', id: pump.id });
        }
        return;
      }
      case 'toggle': {
        const valveHit = hitValve(screen);
        if (valveHit) {
          toggleValve(valveHit.valve.id);
          return;
        }
        const n = hitNode(screen);
        if (n?.outlet) {
          update((d) => {
            const target = d.nodes.find((x) => x.id === n.id);
            if (target?.outlet) target.outlet.on = !target.outlet.on;
          });
        } else {
          const hit = hitPipe(screen);
          if (hit) {
            update((d) => {
              const target = d.pipes.find((x) => x.id === hit.pipe.id);
              if (target) target.status = target.status === 'open' ? 'closed' : 'open';
            });
          }
        }
        return;
      }
      case 'calibrate':
        calibration.addPoint(toWorld(screen));
        return;
    }
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const screen = screenOf(e);
    setCursor(screen);
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.type === 'pan') {
      setCamera({ k: camera.k, tx: drag.tx + screen.x - drag.sx, ty: drag.ty + screen.y - drag.sy });
      return;
    }
    if (!drag.moved && Math.hypot(screen.x - drag.sx, screen.y - drag.sy) < 3) return;
    drag.moved = true;
    const world = snapPoint(toWorld(screen));
    update((d) => moveNode(d, drag.id, world.x, world.y), `drag-${drag.session}`);
  };

  const onPointerUp = () => {
    dragRef.current = null;
  };

  const onDoubleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (tool !== 'select') return;
    const valveHit = hitValve(screenOf(e));
    if (valveHit) {
      toggleValve(valveHit.valve.id);
      return;
    }
    const n = hitNode(screenOf(e));
    if (n?.outlet) {
      update((d) => {
        const target = d.nodes.find((x) => x.id === n.id);
        if (target?.outlet) target.outlet.on = !target.outlet.on;
      });
    }
  };

  const pressureRange = useMemo(() => {
    const vals = results.nodes.filter((n) => n.pressureBar !== null).map((n) => n.pressureBar as number);
    return vals.length ? { min: Math.min(...vals), max: Math.max(...vals) } : { min: 0, max: 1 };
  }, [results]);
  const velocityMax = useMemo(() => {
    const limit = project.settings.velocityLimitMs;
    return Math.max(limit, ...results.pipes.map((p) => p.velocityMs), 0.1);
  }, [results, project.settings.velocityLimitMs]);

  const pipeStroke = (p: Pipe, r: PipeResult | undefined, a: NodeResult | undefined, b: NodeResult | undefined) => {
    const cls = diameterClass(p);
    if (view.colorBy === 'diameter' || !results.ok) return { color: cls.color, width: cls.width };
    if (!r?.connected) return { color: STATUS.muted, width: cls.width };
    if (view.colorBy === 'velocity') {
      return r.velocityExceeded
        ? { color: STATUS.critical, width: cls.width + 1 }
        : { color: sequentialColor(r.velocityMs / velocityMax), width: cls.width };
    }
    const pa = a?.pressureBar ?? 0;
    const pb = b?.pressureBar ?? 0;
    const span = Math.max(pressureRange.max - pressureRange.min, 1e-6);
    return { color: sequentialColor(((pa + pb) / 2 - pressureRange.min) / span), width: cls.width };
  };

  const gridStep = useMemo(() => {
    let step = view.gridSize;
    while (step * camera.k < 14) step *= 5;
    return step;
  }, [camera.k, view.gridSize]);

  const startNode = pipeStart ? byId.get(pipeStart) : null;
  const preview = startNode && cursor && tool === 'pipe' ? snapPoint(toWorld(cursor), startNode) : null;
  const showJunctionLabels = camera.k >= 2.2;
  const bg = project.background;

  // Name, pressure and baseline change beside each node, placed clear of the
  // pipes. Worked out at the current zoom only, since panning does not change it.
  const nodeLabels = useMemo(() => {
    const k = camera.k;
    const segments: Segment[] = [];
    for (const p of pipes) {
      const a = byId.get(p.from);
      const b = byId.get(p.to);
      if (a && b) segments.push({ a: { x: a.x * k, y: a.y * k }, b: { x: b.x * k, y: b.y * k } });
    }
    const pumpNodes = new Set(project.pumps.map((p) => p.nodeId));
    const taken: Box[] = nodes.map((n) => {
      const r = pumpNodes.has(n.id) ? 12 : n.kind === 'junction' ? 3.5 : 7.5;
      return { x1: n.x * k - r, y1: n.y * k - r, x2: n.x * k + r, y2: n.y * k + r };
    });
    const out = new Map<Id, { block: LabelBlock; lines: { key: string; className: string; text: string }[] }>();
    for (const n of nodes) {
      const r = nodeResults.get(n.id);
      const isPump = pumpNodes.has(n.id);
      const isOutlet = n.kind !== 'junction';
      const lines: { key: string; className: string; text: string }[] = [];
      if (view.showLabels && (isOutlet || isPump || showJunctionLabels)) {
        lines.push({ key: 'name', className: 'node-label', text: isPump ? `${n.label} (pump)` : n.label });
      }
      if (results.ok && isOutlet && n.outlet?.on && r?.pressureBar != null && view.showLabels) {
        lines.push({ key: 'value', className: 'node-value', text: `${r.pressureBar.toFixed(2)} bar` });
      }
      const delta =
        baselineNodes && r?.pressureBar != null && (isOutlet || showJunctionLabels)
          ? r.pressureBar - (baselineNodes.get(n.id)?.pressureBar ?? r.pressureBar)
          : null;
      if (delta !== null && Math.abs(delta) >= 0.005) {
        lines.push({
          key: 'delta',
          className: `node-delta ${delta > 0 ? 'up' : 'down'}`,
          text: `${delta > 0 ? '+' : '−'}${Math.abs(delta).toFixed(2)}`,
        });
      }
      if (lines.length === 0) continue;
      const widths = lines.map((l) => textWidth(l.text, l.key === 'name' ? 11 : 10.5));
      const block = placeNodeLabels({ x: n.x * k, y: n.y * k }, widths, segments, taken, isPump ? 16 : 11);
      taken.push(block.box);
      // Relative to the node, which is how the labels are drawn.
      out.set(n.id, { block, lines });
    }
    return out;
  }, [nodes, pipes, byId, camera.k, project.pumps, nodeResults, results.ok, view.showLabels, showJunctionLabels, baselineNodes]);

  return (
    <div className={`canvas-wrap tool-${tool}`}>
      <svg
        ref={svgRef}
        className="canvas"
        data-testid="canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setCursor(null)}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => e.preventDefault()}
      >
        {view.showGrid && (
          <>
            <defs>
              <pattern
                id="grid"
                width={gridStep * camera.k}
                height={gridStep * camera.k}
                patternUnits="userSpaceOnUse"
                x={camera.tx}
                y={camera.ty}
              >
                <path
                  d={`M ${gridStep * camera.k} 0 L 0 0 0 ${gridStep * camera.k}`}
                  fill="none"
                  stroke="var(--grid)"
                  strokeWidth="1"
                />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid)" pointerEvents="none" />
          </>
        )}

        {bg && bg.visible && (
          <image
            href={bg.dataUrl}
            x={bg.x * camera.k + camera.tx}
            y={bg.y * camera.k + camera.ty}
            width={bg.width * camera.k}
            height={bg.height * camera.k}
            opacity={bg.opacity}
            preserveAspectRatio="none"
            pointerEvents="none"
          />
        )}

        {path &&
          path.pipeIds.map((id) => {
            const p = pipes.find((x) => x.id === id);
            const a = p && byId.get(p.from);
            const b = p && byId.get(p.to);
            if (!a || !b) return null;
            const sa = toScreen(a);
            const sb = toScreen(b);
            return (
              <line
                key={`halo-${id}`}
                x1={sa.x}
                y1={sa.y}
                x2={sb.x}
                y2={sb.y}
                stroke="var(--path-halo)"
                strokeWidth={13}
                strokeLinecap="round"
              />
            );
          })}

        {pipes.map((p) => {
          const a = byId.get(p.from);
          const b = byId.get(p.to);
          if (!a || !b) return null;
          const sa = toScreen(a);
          const sb = toScreen(b);
          const r = pipeResults.get(p.id);
          const { color, width } = pipeStroke(p, r, nodeResults.get(p.from), nodeResults.get(p.to));
          const selected = selection?.type === 'pipe' && selection.id === p.id;
          const len = Math.hypot(sb.x - sa.x, sb.y - sa.y);
          // A closed valve shuts the whole pipe, so draw it shut too.
          const closed = p.status === 'closed' || (p.valves ?? []).some((v) => v.status === 'closed');
          const angle = (Math.atan2(sb.y - sa.y, sb.x - sa.x) * 180) / Math.PI;
          const showArrow =
            view.showFlow && results.ok && r?.connected && Math.abs(r.flowLpm) > 0.5 && len > 26;
          const arrowFlip = r && r.flowLpm < 0 ? 180 : 0;
          return (
            <g key={p.id} data-pipe={p.label}>
              {selected && (
                <line x1={sa.x} y1={sa.y} x2={sb.x} y2={sb.y} stroke="var(--select)" strokeWidth={width + 6} strokeLinecap="round" opacity={0.35} />
              )}
              <line
                x1={sa.x}
                y1={sa.y}
                x2={sb.x}
                y2={sb.y}
                stroke={closed ? STATUS.muted : color}
                strokeWidth={width}
                strokeLinecap="round"
                strokeDasharray={closed ? '7 6' : undefined}
              />
              {p.status === 'closed' && len > 16 && (
                <g transform={`translate(${(sa.x + sb.x) / 2} ${(sa.y + sb.y) / 2}) rotate(${angle})`}>
                  <path d="M -7 -6 L 7 6 M -7 6 L 7 -6" stroke={STATUS.critical} strokeWidth={2.2} />
                </g>
              )}
              {showArrow && (
                <g transform={`translate(${(sa.x + sb.x) / 2} ${(sa.y + sb.y) / 2}) rotate(${angle + arrowFlip})`}>
                  <path d="M -5 -4.5 L 5 0 L -5 4.5 Z" fill="#fcfcfb" stroke={color} strokeWidth={1.4} />
                </g>
              )}
              {view.showFittings &&
                len > 44 &&
                p.fittings.slice(0, 4).map((f, i) => {
                  const t = 0.16 + i * 0.1;
                  return (
                    <g
                      key={f.id}
                      transform={`translate(${sa.x + (sb.x - sa.x) * t} ${sa.y + (sb.y - sa.y) * t}) rotate(${angle})`}
                    >
                      <FittingIcon type={f.type} />
                    </g>
                  );
                })}
            </g>
          );
        })}

        {valveSpots.map(({ valve, x, y, angle }) => {
          const s = toScreen({ x, y });
          const selected = selection?.type === 'valve' && selection.id === valve.id;
          const flat = Math.abs(Math.sin((angle * Math.PI) / 180)) < 0.7;
          return (
            <g key={valve.id} transform={`translate(${s.x} ${s.y})`} data-valve={valve.label}>
              {selected && <circle r={14} fill="var(--select)" opacity={0.25} />}
              <g transform={`rotate(${angle})`}>
                <ValveSymbol type={valve.type} closed={valve.status === 'closed'} forward={valve.forward} />
              </g>
              {view.showLabels && (
                <text className="valve-label" x={flat ? 0 : 12} y={flat ? 19 : 4} textAnchor={flat ? 'middle' : 'start'}>
                  {valve.label}
                </text>
              )}
            </g>
          );
        })}

        {preview && startNode && (
          <line
            x1={toScreen(startNode).x}
            y1={toScreen(startNode).y}
            x2={toScreen(preview).x}
            y2={toScreen(preview).y}
            stroke="var(--select)"
            strokeWidth={2}
            strokeDasharray="6 5"
            pointerEvents="none"
          />
        )}

        {nodes.map((n) => {
          const s = toScreen(n);
          const r = nodeResults.get(n.id);
          const isPump = project.pumps.some((p) => p.nodeId === n.id);
          const selected =
            (selection?.type === 'node' && selection.id === n.id) ||
            (selection?.type === 'pump' && project.pumps.some((p) => p.id === selection.id && p.nodeId === n.id));
          const isOutlet = n.kind !== 'junction';
          const on = n.outlet?.on;
          const status = results.ok ? r?.status : null;
          const fill = !on ? '#fcfcfb' : status === 'pass' ? STATUS.good : status === 'fail' ? STATUS.critical : '#e1e0d9';
          const stroke = !on ? '#52514e' : status === 'pass' ? '#0a7f0a' : status === 'fail' ? '#a22828' : '#52514e';
          const labels = nodeLabels.get(n.id);
          return (
            <g key={n.id} transform={`translate(${s.x} ${s.y})`} data-node={n.label}>
              {selected && <circle r={14} fill="var(--select)" opacity={0.25} />}
              {n.kind === 'junction' && !isPump && <circle r={3.2} fill="#52514e" />}
              {n.kind === 'hydrant' && <circle r={7.5} fill={fill} stroke={stroke} strokeWidth={1.8} />}
              {n.kind === 'hoseReel' && (
                <rect x={-6} y={-6} width={12} height={12} transform="rotate(45)" fill={fill} stroke={stroke} strokeWidth={1.8} />
              )}
              {isOutlet && on && status === 'pass' && (
                <path d="M -3.4 0.2 L -0.9 2.8 L 3.6 -2.6" fill="none" stroke="#fff" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
              )}
              {isOutlet && on && status === 'fail' && (
                <path d="M -2.8 -2.8 L 2.8 2.8 M -2.8 2.8 L 2.8 -2.8" stroke="#fff" strokeWidth={1.8} strokeLinecap="round" />
              )}
              {isPump && (
                <g>
                  <circle r={12} fill="#1c1b19" />
                  <path d="M -5 -6.5 L 7.5 0 L -5 6.5 Z" fill="#fcfcfb" />
                </g>
              )}
              {labels?.lines.map((line, i) => (
                <text key={line.key} className={line.className} x={labels.block.x} y={labels.block.ys[i]} textAnchor={labels.block.anchor}>
                  {line.text}
                </text>
              ))}
            </g>
          );
        })}

        {calibration.points.map((p, i) => {
          const s = toScreen(p);
          return (
            <g key={i} transform={`translate(${s.x} ${s.y})`} pointerEvents="none">
              <path d="M -10 0 L 10 0 M 0 -10 L 0 10" stroke={STATUS.critical} strokeWidth={1.6} />
              <circle r={5} fill="none" stroke={STATUS.critical} strokeWidth={1.6} />
            </g>
          );
        })}
        {calibration.points.length === 2 && (
          <line
            x1={toScreen(calibration.points[0]).x}
            y1={toScreen(calibration.points[0]).y}
            x2={toScreen(calibration.points[1]).x}
            y2={toScreen(calibration.points[1]).y}
            stroke={STATUS.critical}
            strokeWidth={1.6}
            strokeDasharray="4 4"
            pointerEvents="none"
          />
        )}
      </svg>
      <Legend pressureRange={pressureRange} velocityMax={velocityMax} />
      {pathPipes.size > 0 && <div className="canvas-chip">Critical path highlighted</div>}
      {calibration.dialog}
    </div>
  );
}

export function deleteSelection(): void {
  const { selection, update, select, project } = useStore.getState();
  if (!selection) return;
  if (selection.type === 'node') update((d) => deleteNode(d, selection.id));
  else if (selection.type === 'pipe') update((d) => deletePipe(d, selection.id));
  else if (selection.type === 'valve') update((d) => deleteValve(d, selection.id));
  else if (selection.type === 'pump') {
    // Removes the pump marking only. The node and its pipes stay.
    if (project.pumps.some((p) => p.id === selection.id)) {
      update((d) => void (d.pumps = d.pumps.filter((p) => p.id !== selection.id)));
    }
  }
  select(null);
}
