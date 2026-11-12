import { useMemo, useState } from 'react';
import { DEFAULT_PUMP_CURVE } from '../model/defaults';
import type { CurvePoint, Pump, PumpCurveSpec } from '../model/types';
import { fitPumpCurve, pumpHead } from '../solver';
import { useResults, useStore } from '../state/store';
import { PumpMiniChart } from './charts';
import { NumberField, Section, Segmented, TextField } from './fields';

function parseTable(text: string): CurvePoint[] {
  const points: CurvePoint[] = [];
  for (const line of text.split(/\r?\n/)) {
    const parts = line.trim().split(/[\s,;\t]+/).map(Number);
    if (parts.length >= 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1])) {
      points.push({ flowLpm: parts[0], headM: parts[1] });
    }
  }
  return points;
}

export function PumpPanel({ pump }: { pump: Pump }) {
  const update = useStore((s) => s.update);
  const nodes = useStore((s) => s.project.nodes);
  const results = useResults();
  const node = nodes.find((n) => n.id === pump.nodeId);

  const set = (patch: (p: Pump) => void, key?: string) =>
    update((d) => {
      const target = d.pumps.find((x) => x.id === pump.id);
      if (target) patch(target);
    }, key);

  const curve = pump.curve;
  const [tableText, setTableText] = useState(
    curve.kind === 'table' ? curve.points.map((p) => `${p.flowLpm}\t${p.headM}`).join('\n') : '',
  );

  const setKind = (kind: PumpCurveSpec['kind']) => {
    if (kind === curve.kind) return;
    if (kind === 'threePoint') set((p) => void (p.curve = { ...DEFAULT_PUMP_CURVE }));
    else if (kind === 'constant') set((p) => void (p.curve = { kind: 'constant', headM: 110 }));
    else {
      const points = [
        { flowLpm: 0, headM: 132 },
        { flowLpm: 1425, headM: 125 },
        { flowLpm: 2850, headM: 110 },
        { flowLpm: 3560, headM: 95 },
        { flowLpm: 4275, headM: 75 },
      ];
      setTableText(points.map((p) => `${p.flowLpm}\t${p.headM}`).join('\n'));
      set((p) => void (p.curve = { kind: 'table', points, degree: 3 }));
    }
  };

  const fit = useMemo(() => {
    try {
      return fitPumpCurve(curve);
    } catch {
      return null;
    }
  }, [curve]);

  const setThree = (patch: Partial<Extract<PumpCurveSpec, { kind: 'threePoint' }>>, key: string) =>
    set((p) => {
      if (p.curve.kind === 'threePoint') Object.assign(p.curve, patch);
    }, `${key}-${pump.id}`);

  return (
    <>
      <Section title="Pump">
        <TextField label="ID" value={pump.label} onChange={(v) => set((p) => void (p.label = v), `pl-${pump.id}`)} />
        <div className="field">
          <span className="field-label">Outlet node</span>
          <span className="static-value">{node?.label ?? 'Missing'}</span>
        </div>
        {node && (
          <NumberField
            label="Outlet node elevation (pump datum)"
            unit="m"
            value={node.elevationM}
            testId="pump-elevation"
            onChange={(v) =>
              update((d) => {
                const target = d.nodes.find((n) => n.id === node.id);
                if (target) target.elevationM = v;
              }, `pe-${node.id}`)
            }
          />
        )}
        <NumberField
          label="Suction / pump-room loss"
          unit="m"
          min={0}
          value={pump.suctionLossM}
          testId="pump-suction"
          onChange={(v) => set((p) => void (p.suctionLossM = v), `ps-${pump.id}`)}
        />
        <NumberField
          label="Water level vs pump datum"
          unit="m"
          value={pump.waterLevelM}
          onChange={(v) => set((p) => void (p.waterLevelM = v), `pw-${pump.id}`)}
          hint="Datum is the outlet node elevation. Negative means suction lift."
        />
      </Section>

      <Section title="Curve">
        <Segmented
          ariaLabel="Curve entry"
          value={curve.kind}
          options={[
            { value: 'threePoint', label: '3 points' },
            { value: 'table', label: 'Table' },
            { value: 'constant', label: 'Constant' },
          ]}
          onChange={setKind}
        />
        {curve.kind === 'threePoint' && (
          <div className="field-grid">
            <NumberField label="Shutoff head" unit="m" value={curve.shutoffHeadM} onChange={(v) => setThree({ shutoffHeadM: v }, 'sh')} />
            <div />
            <NumberField label="Rated head" unit="m" value={curve.ratedHeadM} testId="pump-rated-head" onChange={(v) => setThree({ ratedHeadM: v }, 'rh')} />
            <NumberField label="Rated flow" unit="LPM" min={0} value={curve.ratedFlowLpm} onChange={(v) => setThree({ ratedFlowLpm: v }, 'rf')} />
            <NumberField label="150 % head" unit="m" value={curve.overloadHeadM} onChange={(v) => setThree({ overloadHeadM: v }, 'oh')} />
            <NumberField label="150 % flow" unit="LPM" min={0} value={curve.overloadFlowLpm} onChange={(v) => setThree({ overloadFlowLpm: v }, 'of')} />
          </div>
        )}
        {curve.kind === 'constant' && (
          <NumberField label="Head" unit="m" value={curve.headM} onChange={(v) => set((p) => void (p.curve = { kind: 'constant', headM: v }), `pc-${pump.id}`)} />
        )}
        {curve.kind === 'table' && (
          <>
            <label className="field">
              <span className="field-label">Paste flow (LPM) and head (m), one pair per line</span>
              <textarea
                rows={6}
                value={tableText}
                data-testid="pump-table"
                onChange={(e) => {
                  setTableText(e.target.value);
                  const points = parseTable(e.target.value);
                  if (points.length >= 2) {
                    set((p) => {
                      if (p.curve.kind === 'table') p.curve.points = points;
                    }, `pt-${pump.id}`);
                  }
                }}
              />
            </label>
            <div className="field">
              <span className="field-label">Fit</span>
              <Segmented
                ariaLabel="Polynomial degree"
                value={String(curve.degree) as '2' | '3'}
                options={[
                  { value: '2', label: 'Quadratic' },
                  { value: '3', label: 'Cubic' },
                ]}
                onChange={(v) =>
                  set((p) => {
                    if (p.curve.kind === 'table') p.curve.degree = Number(v) as 2 | 3;
                  })
                }
              />
            </div>
          </>
        )}
        {fit ? (
          <PumpMiniChart
            fit={fit}
            operating={results.ok ? { flowLpm: results.system.pumpFlowLpm, headM: results.system.pumpHeadM } : null}
          />
        ) : (
          <p className="warn">▲ These points do not define a curve.</p>
        )}
        {fit && curve.kind !== 'constant' && (
          <p className="muted">Fitted head at the last point: {pumpHead(fit, fit.maxFlowLpm).toFixed(1)} m</p>
        )}
      </Section>

      {results.ok && (
        <Section title="Operating point">
          <dl className="readout">
            <dt>Flow</dt>
            <dd>{results.system.pumpFlowLpm.toFixed(0)} LPM</dd>
            <dt>Head</dt>
            <dd>{results.system.pumpHeadM.toFixed(1)} m</dd>
            <dt>Pressure</dt>
            <dd>{results.system.pumpPressureBar.toFixed(2)} bar</dd>
          </dl>
        </Section>
      )}
    </>
  );
}
