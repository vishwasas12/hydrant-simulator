import { diameterClass, STATUS } from '../canvas/colors';
import type { Project } from '../model/types';
import type { CriticalPath, SolveResults } from '../solver';

const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

interface Box {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Rough width of sans-serif text, enough to keep labels apart. */
const textWidth = (text: string, fontSize: number): number => text.length * fontSize * 0.6;

const overlapArea = (box: Box, taken: Box[]): number =>
  taken.reduce(
    (sum, t) => sum + Math.max(0, Math.min(box.x2, t.x2) - Math.max(box.x1, t.x1)) * Math.max(0, Math.min(box.y2, t.y2) - Math.max(box.y1, t.y1)),
    0,
  );

const isClear = (box: Box, taken: Box[]): boolean => overlapArea(box, taken) === 0;

/** Static SVG of the network for the report, coloured by pipe size. */
export function networkSnapshot(
  project: Project,
  results: SolveResults,
  path: CriticalPath | null,
  width = 1000,
): string {
  const { nodes, pipes, background } = project;
  if (nodes.length === 0) return '<p>The drawing is empty.</p>';
  const xs = nodes.map((n) => n.x);
  const ys = nodes.map((n) => n.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const pad = 70;
  const k = (width - pad * 2) / Math.max(maxX - minX, 1);
  const height = Math.max(Math.round((maxY - minY) * k + pad * 2), 240);
  const sx = (x: number) => (x - minX) * k + pad;
  const sy = (y: number) => (y - minY) * k + pad;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const nodeResults = new Map(results.nodes.map((n) => [n.id, n]));
  const pathPipes = new Set(path?.pipeIds ?? []);
  const parts: string[] = [];

  if (background && background.visible) {
    parts.push(
      `<image href="${background.dataUrl}" x="${sx(background.x)}" y="${sy(background.y)}" width="${background.width * k}" height="${background.height * k}" opacity="${background.opacity}" preserveAspectRatio="none"/>`,
    );
  }
  for (const p of pipes) {
    if (!pathPipes.has(p.id)) continue;
    const a = byId.get(p.from);
    const b = byId.get(p.to);
    if (a && b) {
      parts.push(`<line x1="${sx(a.x)}" y1="${sy(a.y)}" x2="${sx(b.x)}" y2="${sy(b.y)}" stroke="#f7c948" stroke-width="12" stroke-linecap="round"/>`);
    }
  }
  for (const p of pipes) {
    const a = byId.get(p.from);
    const b = byId.get(p.to);
    if (!a || !b) continue;
    const cls = diameterClass(p);
    const closed = p.status === 'closed' || (p.valves ?? []).some((v) => v.status === 'closed');
    parts.push(
      `<line x1="${sx(a.x)}" y1="${sy(a.y)}" x2="${sx(b.x)}" y2="${sy(b.y)}" stroke="${closed ? STATUS.muted : cls.color}" stroke-width="${cls.width}" stroke-linecap="round"${closed ? ' stroke-dasharray="7 6"' : ''}/>`,
    );
  }
  // Label placement. Junction and pipe labels let the drawing be read against
  // the schedules, so each takes the first spot clear of labels already placed.
  const taken: Box[] = [];
  const isPumpNode = (id: string) => project.pumps.some((p) => p.nodeId === id);
  for (const n of nodes) {
    const x = sx(n.x);
    const y = sy(n.y);
    const r = isPumpNode(n.id) ? 11 : n.kind === 'junction' ? 3.5 : 7;
    taken.push({ x1: x - r, y1: y - r, x2: x + r, y2: y + r });
    if (n.kind !== 'junction' || isPumpNode(n.id)) {
      const text = isPumpNode(n.id) ? `${n.label} (pump)` : n.label;
      taken.push({ x1: x + 10, y1: y - 17, x2: x + 10 + textWidth(text, 11), y2: y - 6 });
      const r = nodeResults.get(n.id);
      if (n.outlet?.on && r?.pressureBar != null) taken.push({ x1: x + 10, y1: y - 3, x2: x + 10 + 9 * 6, y2: y + 7 });
    }
  }
  for (const p of pipes) {
    const a = byId.get(p.from);
    const b = byId.get(p.to);
    if (!a || !b) continue;
    for (const v of p.valves ?? []) {
      const x = sx(a.x + (b.x - a.x) * v.position);
      const y = sy(a.y + (b.y - a.y) * v.position);
      const w = textWidth(v.label, 9);
      taken.push({ x1: x - 8, y1: y - 8, x2: x + 8, y2: y + 8 }, { x1: x - w / 2, y1: y - 18, x2: x + w / 2, y2: y - 9 });
    }
  }
  const junctionLabels: string[] = [];
  for (const n of nodes) {
    if (n.kind !== 'junction' || isPumpNode(n.id)) continue;
    const x = sx(n.x);
    const y = sy(n.y);
    const w = textWidth(n.label, 9.5);
    const spots = [
      [x + 6, y - 6],
      [x + 6, y + 14],
      [x - 6 - w, y - 6],
      [x - 6 - w, y + 14],
    ];
    const boxOf = ([tx, ty]: number[]): Box => ({ x1: tx, y1: ty - 9, x2: tx + w, y2: ty + 1 });
    // First clear spot, otherwise the one that covers the least.
    const spot =
      spots.find((s) => isClear(boxOf(s), taken)) ??
      spots.reduce((best, s) => (overlapArea(boxOf(s), taken) < overlapArea(boxOf(best), taken) ? s : best));
    taken.push(boxOf(spot));
    junctionLabels.push(
      `<text x="${spot[0].toFixed(1)}" y="${spot[1].toFixed(1)}" font-size="9.5" font-family="sans-serif" font-weight="600" fill="#3d3c39">${esc(n.label)}</text>`,
    );
  }
  for (const p of pipes) {
    const a = byId.get(p.from);
    const b = byId.get(p.to);
    if (!a || !b) continue;
    const dx = sx(b.x) - sx(a.x);
    const dy = sy(b.y) - sy(a.y);
    const w = textWidth(p.label, 8.5);
    if (Math.hypot(dx, dy) < w + 20) continue;
    let angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    if (angle > 90) angle -= 180;
    if (angle <= -90) angle += 180;
    const rad = (angle * Math.PI) / 180;
    const [nx, ny] = [Math.sin(rad), -Math.cos(rad)];
    // Half extents of the rotated text, 8 px tall.
    const hx = (Math.abs(Math.cos(rad)) * w) / 2 + Math.abs(Math.sin(rad)) * 4;
    const hy = (Math.abs(Math.sin(rad)) * w) / 2 + Math.abs(Math.cos(rad)) * 4;
    let placed: { x: number; y: number; box: Box } | null = null;
    for (const t of [0.5, 0.35, 0.65, 0.25, 0.75]) {
      // Baseline 7 px off the line on the upper side, or 13 px on the lower side.
      for (const d of [7, -13]) {
        const x = sx(a.x) + dx * t + nx * d;
        const y = sy(a.y) + dy * t + ny * d;
        const cx = x + nx * 3;
        const cy = y + ny * 3;
        const box = { x1: cx - hx, y1: cy - hy, x2: cx + hx, y2: cy + hy };
        if (isClear(box, taken)) {
          placed = { x, y, box };
          break;
        }
      }
      if (placed) break;
    }
    if (!placed) continue;
    taken.push(placed.box);
    const { x, y } = placed;
    parts.push(
      `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="8.5" font-family="sans-serif" text-anchor="middle" fill="#76746e" transform="rotate(${angle.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)})">${esc(p.label)}</text>`,
    );
  }
  for (const p of pipes) {
    const a = byId.get(p.from);
    const b = byId.get(p.to);
    if (!a || !b) continue;
    const angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
    for (const v of p.valves ?? []) {
      const x = sx(a.x + (b.x - a.x) * v.position);
      const y = sy(a.y + (b.y - a.y) * v.position);
      const fill = v.status === 'closed' ? '#1c1b19' : '#ffffff';
      const shape =
        v.type === 'nonReturn'
          ? `<path d="M -7 -5.5 L 5 0 L -7 5.5 Z" fill="${fill}" stroke="#1c1b19" stroke-width="1.4"/><path d="M 6.5 -6 L 6.5 6" stroke="#1c1b19" stroke-width="2"/>`
          : `<path d="M -7 -5.5 L 7 5.5 L 7 -5.5 L -7 5.5 Z" fill="${fill}" stroke="#1c1b19" stroke-width="1.4"/>`;
      const turn = v.type === 'nonReturn' && !v.forward ? 180 : 0;
      parts.push(`<g transform="translate(${x} ${y}) rotate(${angle + turn})">${shape}</g>`);
      parts.push(`<text x="${x}" y="${y - 10}" font-size="9" font-family="sans-serif" text-anchor="middle" fill="#1c1b19">${esc(v.label)}</text>`);
    }
  }
  for (const n of nodes) {
    const x = sx(n.x);
    const y = sy(n.y);
    const r = nodeResults.get(n.id);
    const isPump = project.pumps.some((p) => p.nodeId === n.id);
    const on = n.outlet?.on;
    const fill = !on ? '#ffffff' : r?.status === 'pass' ? STATUS.good : r?.status === 'fail' ? STATUS.critical : '#e1e0d9';
    if (isPump) {
      parts.push(`<circle cx="${x}" cy="${y}" r="11" fill="#1c1b19"/><path d="M ${x - 4.5} ${y - 6} L ${x + 7} ${y} L ${x - 4.5} ${y + 6} Z" fill="#fff"/>`);
    } else if (n.kind === 'junction') {
      parts.push(`<circle cx="${x}" cy="${y}" r="2.6" fill="#52514e"/>`);
    } else if (n.kind === 'hydrant') {
      parts.push(`<circle cx="${x}" cy="${y}" r="7" fill="${fill}" stroke="#52514e" stroke-width="1.5"/>`);
    } else {
      parts.push(`<rect x="${x - 5.5}" y="${y - 5.5}" width="11" height="11" transform="rotate(45 ${x} ${y})" fill="${fill}" stroke="#52514e" stroke-width="1.5"/>`);
    }
    if (n.kind !== 'junction' || isPump) {
      const text = isPump ? `${n.label} (pump)` : n.label;
      parts.push(`<text x="${x + 10}" y="${y - 8}" font-size="11" font-family="sans-serif" fill="#1c1b19">${esc(text)}</text>`);
      if (on && r?.pressureBar != null) {
        parts.push(`<text x="${x + 10}" y="${y + 5}" font-size="10" font-family="monospace" fill="#52514e">${r.pressureBar.toFixed(2)} bar</text>`);
      }
    }
  }
  parts.push(...junctionLabels);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="Network drawing">${parts.join('')}</svg>`;
}
