import { describe, expect, it } from 'vitest';
import { runCapacity } from '../../analysis/capacity';
import { emptyProject } from '../../model/defaults';
import { addNode, addPipe, setPumpNode } from '../../model/edit';
import { seedProject } from '../../model/seed';
import type { Project } from '../../model/types';
import { solve } from '../../solver';
import { buildReportHtml } from '../report';

const at = new Date('2026-11-21T10:00:00');
const report = (project: Project, withCapacity = false) =>
  buildReportHtml({
    project,
    results: solve(project),
    capacity: withCapacity ? runCapacity(project, { chosenK: 2, respectPumpLimit: true }) : null,
    generatedAt: at,
  });

const sectionTitles = (html: string) => [...html.matchAll(/<h2><b>(\d+)<\/b>([^<]+)<\/h2>/g)].map((m) => [Number(m[1]), m[2]] as const);

/** Pump, a 90° bend, a tee, an in-line hydrant, an end-of-line hydrant and a dead end. */
function small(): Project {
  const p = emptyProject('Test site');
  const pump = addNode(p, 0, 0, 'junction');
  const bend = addNode(p, 100, 0, 'junction');
  const tee = addNode(p, 100, 100, 'junction');
  const h1 = addNode(p, 200, 100, 'hydrant');
  const h2 = addNode(p, 0, 100, 'hydrant');
  const end = addNode(p, 300, 100, 'junction');
  setPumpNode(p, pump.id);
  addPipe(p, pump.id, bend.id, 150);
  addPipe(p, bend.id, tee.id, 150);
  addPipe(p, tee.id, h1.id, 150);
  addPipe(p, tee.id, h2.id, 150);
  addPipe(p, h1.id, end.id, 150);
  if (h1.outlet) h1.outlet.on = true;
  return p;
}

describe('client report', () => {
  it('leaves out analyses that were not run, without placeholder text', () => {
    const html = report(small());
    const titles = sectionTitles(html).map(([, t]) => t);
    expect(titles).not.toContain('Simultaneous operation');
    expect(titles).not.toContain('Operating scenarios');
    expect(html).not.toMatch(/Capacity tab|No current capacity|No scenarios saved|No pump defined|Run one/i);
  });

  it('includes the capacity search and scenarios when they exist', () => {
    const p = small();
    p.scenarios.push({ id: 's1', name: 'Both hydrants', hydrantOn: Object.fromEntries(p.nodes.filter((n) => n.outlet).map((n) => [n.id, true])) });
    const titles = sectionTitles(report(p, true)).map(([, t]) => t);
    expect(titles).toContain('Simultaneous operation');
    expect(titles).toContain('Operating scenarios');
  });

  it('numbers the sections without gaps', () => {
    for (const html of [report(small()), report(seedProject())]) {
      const numbers = sectionTitles(html).map(([n]) => n);
      expect(numbers).toEqual(numbers.map((_, i) => i + 1));
    }
  });

  it('drops pump-dependent sections when there is no pump', () => {
    const p = small();
    p.pumps = [];
    const titles = sectionTitles(report(p)).map(([, t]) => t);
    expect(titles).not.toContain('Performance charts');
    expect(titles.some((t) => t.includes('flowing alone'))).toBe(false);
    expect(titles).toContain('Network inventory');
  });

  it('lists every junction with its tees and bends', () => {
    const p = small();
    const html = report(p);
    const inventory = html.slice(html.indexOf('<section id="inventory">'), html.indexOf('</section>', html.indexOf('<section id="inventory">')));
    for (const n of p.nodes.filter((x) => x.kind === 'junction')) expect(inventory).toContain(`<td>${n.label}</td>`);
    expect(inventory).toContain('Equal tee');
    expect(inventory).toContain('90° bend');
    expect(inventory).toContain('End cap');
    expect(inventory).toContain('Tee for hydrant outlet');
    expect(inventory).toMatch(/<span>Tees<\/span><strong>2<\/strong><small>1 at junctions, 1 for outlets<\/small>/);
    expect(inventory).toMatch(/<span>Bends<\/span><strong>1<\/strong>/);
  });

  it('states the actual hydrant data rather than program defaults', () => {
    const p = small();
    for (const n of p.nodes) if (n.outlet) n.outlet.minPressureBar = 4;
    const basis = report(p).split('<section id="basis">')[1];
    expect(basis).toContain('<td>Hydrant requirement</td><td>4 bar residual pressure and 900 LPM per outlet</td>');
    expect(basis).not.toContain('3.5 bar');
  });

  it('keeps the design basis to what the network uses', () => {
    const basis = report(small()).split('<section id="basis">')[1].split('</section>')[0];
    const items = [...basis.matchAll(/<tr><td>([^<]+)<\/td>/g)].map((m) => m[1]);
    // The drawing has a bend, a tee and a hydrant take-off, and no valves or hose reels.
    expect(items).toEqual(expect.arrayContaining(['90° elbow', 'Tee (run)', 'Tee (branch)', 'Tees and bends', 'Hydrant outlet']));
    expect(items).not.toEqual(expect.arrayContaining(['Gate valve']));
    expect(basis).not.toMatch(/Convergence|Gravity|Fitted polynomial|Hose reel|200 NB:/);
    expect(items.length).toBeLessThanOrEqual(16);
  });

  it('lists the fittings found at each junction against the pipes', () => {
    const inputs = report(small()).split('<section id="inputs">')[1].split('</section>')[0];
    expect(inputs).toMatch(/90° elbow at J\d/);
    expect(inputs).toMatch(/Tee \(branch\) at J\d/);
  });

  it('escapes the project name in the page footer', () => {
    const p = small();
    p.name = 'Site "A" </style><script>x</script>';
    const html = report(p);
    expect(html).not.toContain('</style><script>');
  });
});
