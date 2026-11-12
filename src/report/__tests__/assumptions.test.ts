import { describe, expect, it } from 'vitest';
import { seedProject } from '../../model/seed';
import { buildAssumptions } from '../assumptions';

const find = (rows: ReturnType<typeof buildAssumptions>, name: string) => rows.find((r) => r.name === name);

describe('assumptions', () => {
  it('lists unit conversions with their sources', () => {
    const rows = buildAssumptions(seedProject());
    expect(find(rows, '1 bar')?.value).toBe('10.197 m of water');
    expect(find(rows, '1 LPM')?.value).toBe('1/60000 m³/s');
  });

  it('lists the material table', () => {
    const rows = buildAssumptions(seedProject());
    expect(find(rows, '150 NB')?.value).toContain('154.3');
  });

  it('does not mark untouched defaults as overridden', () => {
    const rows = buildAssumptions(seedProject());
    expect(find(rows, 'Velocity limit')?.overridden).toBe(false);
    expect(find(rows, '150 NB')?.overridden).toBe(false);
  });

  it('marks a changed setting as overridden', () => {
    const p = seedProject();
    p.settings.velocityLimitMs = 3;
    expect(find(buildAssumptions(p), 'Velocity limit')?.overridden).toBe(true);
  });

  it('marks a changed table value as overridden', () => {
    const p = seedProject();
    p.tables.material.rows.find((r) => r.nominalMm === 150)!.internalDiameterMm = 150;
    expect(find(buildAssumptions(p), '150 NB')?.overridden).toBe(true);
  });

  it('marks a changed pipe C as overridden', () => {
    const p = seedProject();
    p.pipes[0].c = 100;
    const row = find(buildAssumptions(p), 'C = 100');
    expect(row?.overridden).toBe(true);
    expect(row?.value).toContain(p.pipes[0].label);
  });

  it('reports hydrants changed from the defaults', () => {
    const rows = buildAssumptions(seedProject());
    const row = rows.find((r) => r.name === 'Discharge model (changed)');
    expect(row?.value).toContain('fixed');
    expect(row?.overridden).toBe(true);
  });

  it('includes the fitted pump curve', () => {
    const rows = buildAssumptions(seedProject());
    expect(find(rows, 'Fitted polynomial')).toBeDefined();
  });
});
