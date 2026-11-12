import { diameterClass, STATUS } from '../canvas/colors';
import type { Project } from '../model/types';
import type { CriticalPath, SolveResults } from '../solver';

const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

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
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="Network drawing">${parts.join('')}</svg>`;
}
