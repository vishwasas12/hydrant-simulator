import { useMemo } from 'react';
import { addValve, uid } from '../model/edit';
import { junctionFittings } from '../model/junctions';
import { VALVE_NAMES } from './ValvePanel';
import { C_PRESETS, internalDiameterFor, NOMINAL_SIZES } from '../model/tables';
import type { Fitting, FittingType, Pipe } from '../model/types';
import { FittingIcon } from '../canvas/FittingIcon';
import { useResults, useStore } from '../state/store';
import { NumberField, Section, SelectField, Segmented, TextField } from './fields';

const FITTING_OPTIONS: { value: FittingType; label: string }[] = [
  { value: 'elbow90', label: '90° elbow' },
  { value: 'elbow45', label: '45° elbow' },
  { value: 'longRadiusBend', label: 'Long-radius bend' },
  { value: 'teeRun', label: 'Tee (run)' },
  { value: 'teeBranch', label: 'Tee (branch)' },
  { value: 'butterflyValve', label: 'Butterfly valve' },
  { value: 'gateValve', label: 'Gate valve' },
  { value: 'nonReturnValve', label: 'Non-return valve' },
  { value: 'reducer', label: 'Reducer' },
  { value: 'custom', label: 'Custom' },
];

export function PipePanel({ pipe }: { pipe: Pipe }) {
  const update = useStore((s) => s.update);
  const select = useStore((s) => s.select);
  const material = useStore((s) => s.project.tables.material);
  const nodes = useStore((s) => s.project.nodes);
  const pipes = useStore((s) => s.project.pipes);
  const pumps = useStore((s) => s.project.pumps);
  const autoFittings = useStore((s) => s.project.settings.autoFittings ?? false);
  const fittingNames = useStore((s) => s.project.tables.fittings);
  const results = useResults();
  const r = results.pipes.find((p) => p.id === pipe.id);
  const drawn = useMemo(
    () => (autoFittings ? (junctionFittings({ nodes, pipes, pumps }).get(pipe.id) ?? []) : []),
    [autoFittings, nodes, pipes, pumps, pipe.id],
  );
  const nodeLabel = (id: string) => nodes.find((n) => n.id === id)?.label ?? '';
  const fittingName = (type: FittingType) => fittingNames.find((f) => f.type === type)?.name ?? type;

  const set = (patch: (p: Pipe) => void, key?: string) =>
    update((d) => {
      const target = d.pipes.find((x) => x.id === pipe.id);
      if (target) patch(target);
    }, key);

  const tableId = typeof pipe.nominalMm === 'number' ? internalDiameterFor(material, pipe.nominalMm) : null;
  const idEdited = tableId !== null && Math.abs(tableId - pipe.internalDiameterMm) > 1e-6;

  const setFitting = (id: string, patch: Partial<Fitting>) =>
    set((p) => {
      const f = p.fittings.find((x) => x.id === id);
      if (f) Object.assign(f, patch);
    }, `fit-${id}`);

  return (
    <>
      <Section title="Pipe">
        <TextField label="ID" value={pipe.label} onChange={(v) => set((p) => void (p.label = v), `lbl-${pipe.id}`)} />
        <SelectField
          label="Nominal size"
          testId="pipe-nominal"
          value={String(pipe.nominalMm)}
          options={[
            ...NOMINAL_SIZES.map((s) => ({ value: String(s), label: `${s} mm` })),
            { value: 'custom', label: 'Custom' },
          ]}
          onChange={(v) =>
            set((p) => {
              if (v === 'custom') {
                p.nominalMm = 'custom';
              } else {
                p.nominalMm = Number(v);
                p.internalDiameterMm = internalDiameterFor(material, Number(v));
              }
            })
          }
        />
        <NumberField
          label="Internal diameter"
          unit="mm"
          min={0}
          value={pipe.internalDiameterMm}
          testId="pipe-id"
          onChange={(v) => set((p) => void (p.internalDiameterMm = v), `id-${pipe.id}`)}
          hint={idEdited ? `Overridden. Table value ${tableId} mm.` : tableId !== null ? `From ${material.name}` : undefined}
        />
        <NumberField
          label="Length"
          unit="m"
          min={0}
          value={pipe.lengthM}
          testId="pipe-length"
          onChange={(v) =>
            set((p) => {
              p.lengthM = v;
              p.lengthManual = true;
            }, `len-${pipe.id}`)
          }
          hint={
            pipe.lengthManual ? (
              <button
                type="button"
                className="link"
                onClick={() =>
                  update((d) => {
                    const target = d.pipes.find((x) => x.id === pipe.id);
                    const a = d.nodes.find((n) => n.id === pipe.from);
                    const b = d.nodes.find((n) => n.id === pipe.to);
                    if (target && a && b) {
                      target.lengthManual = false;
                      target.lengthM = Math.hypot(a.x - b.x, a.y - b.y) * d.metersPerUnit;
                    }
                  })
                }
              >
                Manual. Use the drawn length instead
              </button>
            ) : (
              'From the drawing scale'
            )
          }
        />
        <NumberField
          label="Hazen-Williams C"
          min={1}
          value={pipe.c}
          testId="pipe-c"
          onChange={(v) => set((p) => void (p.c = v), `c-${pipe.id}`)}
        />
        <div className="chips">
          {C_PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              className={`chip${pipe.c === preset.c ? ' active' : ''}`}
              onClick={() => set((p) => void (p.c = preset.c))}
            >
              {preset.label} {preset.c}
            </button>
          ))}
        </div>
        <NumberField
          label="Roughness ε (Darcy only)"
          unit="mm"
          min={0}
          value={pipe.roughnessMm}
          onChange={(v) => set((p) => void (p.roughnessMm = v), `e-${pipe.id}`)}
        />
        <div className="field">
          <span className="field-label">Status</span>
          <Segmented
            ariaLabel="Pipe status"
            value={pipe.status}
            options={[
              { value: 'open', label: 'Open' },
              { value: 'closed', label: 'Closed' },
            ]}
            onChange={(v) => set((p) => void (p.status = v))}
          />
        </div>
      </Section>

      <Section title="Valves">
        {(pipe.valves ?? []).length === 0 && <p className="muted">No valves. Add one here, or use the Valve tool (A) on the drawing.</p>}
        {(pipe.valves ?? []).map((v) => (
          <div className="valve-row" key={v.id}>
            <button type="button" className="link" onClick={() => select({ type: 'valve', id: v.id })}>
              {v.label}
            </button>
            <span>{VALVE_NAMES[v.type]}</span>
            <span className={v.status === 'closed' ? 'bad' : 'good'}>{v.status === 'closed' ? '■ Closed' : '□ Open'}</span>
          </div>
        ))}
        <button
          type="button"
          className="btn"
          data-testid="add-valve"
          onClick={() => {
            let id: string | null = null;
            update((d) => {
              id = addValve(d, pipe.id, 0.5)?.id ?? null;
            });
            if (id) select({ type: 'valve', id });
          }}
        >
          Add valve
        </button>
      </Section>

      <Section title="Fittings">
        {autoFittings && (
          <>
            <p className="fitting-group">From the drawing</p>
            {drawn.length === 0 && <p className="muted">No tee, bend or reducer at either end.</p>}
            {drawn.map((f) => (
              <div className="fitting-row drawn" key={f.id} data-testid="drawn-fitting">
                <svg width="20" height="20" viewBox="-10 -10 20 20" aria-hidden="true">
                  <FittingIcon type={f.type} />
                </svg>
                <span>
                  {f.quantity > 1 ? `${f.quantity} × ` : ''}
                  {fittingName(f.type)}
                </span>
                <span className="muted">at {nodeLabel(f.nodeId)}</span>
              </div>
            ))}
            <p className="fitting-group">Added by hand</p>
          </>
        )}
        {pipe.fittings.length === 0 && (
          <p className="muted">
            {autoFittings ? 'None. Add fittings the drawing does not show, such as bends on a riser.' : 'No fittings on this pipe.'}
          </p>
        )}
        {pipe.fittings.map((f) => (
          <div className="fitting-row" key={f.id}>
            <svg width="20" height="20" viewBox="-10 -10 20 20" aria-hidden="true">
              <FittingIcon type={f.type} />
            </svg>
            <select
              aria-label="Fitting type"
              value={f.type}
              onChange={(e) => {
                const type = e.target.value as FittingType;
                setFitting(f.id, type === 'custom' ? { type, customMode: 'leq', customValue: 0 } : { type });
              }}
            >
              {FITTING_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <input
              aria-label="Quantity"
              className="qty"
              type="number"
              min="0"
              step="1"
              value={f.quantity}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (v >= 0) setFitting(f.id, { quantity: v });
              }}
            />
            <button
              type="button"
              className="icon-btn"
              aria-label="Remove fitting"
              onClick={() => set((p) => void (p.fittings = p.fittings.filter((x) => x.id !== f.id)))}
            >
              ×
            </button>
            {f.type === 'custom' && (
              <div className="fitting-custom">
                <select
                  aria-label="Custom fitting value type"
                  value={f.customMode ?? 'leq'}
                  onChange={(e) => setFitting(f.id, { customMode: e.target.value as 'leq' | 'k' })}
                >
                  <option value="leq">Equivalent length, m</option>
                  <option value="k">K value</option>
                </select>
                <input
                  aria-label="Custom fitting value"
                  type="number"
                  min="0"
                  step="any"
                  value={f.customValue ?? 0}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (v >= 0) setFitting(f.id, { customValue: v });
                  }}
                />
              </div>
            )}
          </div>
        ))}
        <button
          type="button"
          className="btn"
          data-testid="add-fitting"
          onClick={() => set((p) => void p.fittings.push({ id: uid('f'), type: 'elbow90', quantity: 1 }))}
        >
          Add fitting
        </button>
      </Section>

      {results.ok && r?.connected && (
        <Section title="Results">
          <dl className="readout">
            <dt>Flow</dt>
            <dd>{Math.abs(r.flowLpm).toFixed(1)} LPM</dd>
            <dt>Velocity</dt>
            <dd className={r.velocityExceeded ? 'bad' : ''}>
              {r.velocityMs.toFixed(2)} m/s{r.velocityExceeded ? ' ▲ over limit' : ''}
            </dd>
            <dt>Head loss</dt>
            <dd>{r.headLossM.toFixed(3)} m</dd>
            <dt>Loss per 100 m</dt>
            <dd>{r.lossPer100M.toFixed(2)} m</dd>
            <dt>L_eq</dt>
            <dd>{r.equivalentLengthM.toFixed(1)} m</dd>
          </dl>
        </Section>
      )}
    </>
  );
}
