import type { Pipe, PipeValve, ValveType } from '../model/types';
import { lookupBySize, VALVE_FITTING } from '../solver';
import { useResults, useStore } from '../state/store';
import { Section, Segmented, TextField } from './fields';

export const VALVE_NAMES: Record<ValveType, string> = {
  gate: 'Gate valve',
  butterfly: 'Butterfly valve',
  nonReturn: 'Non-return valve',
};

export function ValvePanel({ pipe, valve }: { pipe: Pipe; valve: PipeValve }) {
  const update = useStore((s) => s.update);
  const select = useStore((s) => s.select);
  const nodes = useStore((s) => s.project.nodes);
  const tables = useStore((s) => s.project.tables);
  const results = useResults();
  const r = results.pipes.find((p) => p.id === pipe.id);
  const from = nodes.find((n) => n.id === pipe.from)?.label ?? 'start';
  const to = nodes.find((n) => n.id === pipe.to)?.label ?? 'end';

  const set = (patch: (v: PipeValve) => void, key?: string) =>
    update((d) => {
      const v = d.pipes.find((p) => p.id === pipe.id)?.valves?.find((x) => x.id === valve.id);
      if (v) patch(v);
    }, key);

  const size = typeof pipe.nominalMm === 'number' ? pipe.nominalMm : pipe.internalDiameterMm;
  const row = tables.fittings.find((f) => f.type === VALVE_FITTING[valve.type]);
  const leq = row ? lookupBySize(row.leqM, size) : null;
  const otherClosed = pipe.status === 'closed' || (pipe.valves ?? []).some((v) => v.id !== valve.id && v.status === 'closed');

  return (
    <>
      <Section title="Valve">
        <TextField label="ID" value={valve.label} testId="valve-label" onChange={(v) => set((x) => void (x.label = v), `vl-${valve.id}`)} />
        <div className="field">
          <span className="field-label">Type</span>
          <Segmented
            ariaLabel="Valve type"
            value={valve.type}
            options={[
              { value: 'gate', label: 'Gate' },
              { value: 'butterfly', label: 'Butterfly' },
              { value: 'nonReturn', label: 'Non-return' },
            ]}
            onChange={(type) => set((x) => void (x.type = type))}
          />
        </div>
        <div className="field">
          <span className="field-label">Status</span>
          <Segmented
            ariaLabel="Valve status"
            value={valve.status}
            options={[
              { value: 'open', label: 'Open' },
              { value: 'closed', label: 'Closed' },
            ]}
            onChange={(status) => set((x) => void (x.status = status))}
          />
        </div>
        {valve.type === 'nonReturn' && (
          <div className="field">
            <span className="field-label">Lets water flow</span>
            <Segmented
              ariaLabel="Non-return direction"
              value={valve.forward ? 'forward' : 'reverse'}
              options={[
                { value: 'forward', label: `${from} → ${to}` },
                { value: 'reverse', label: `${to} → ${from}` },
              ]}
              onChange={(v) => set((x) => void (x.forward = v === 'forward'))}
            />
          </div>
        )}
        <label className="field">
          <span className="field-label">Position along {pipe.label}: {Math.round(valve.position * 100)} %</span>
          <input
            className="range"
            type="range"
            min="0.05"
            max="0.95"
            step="0.01"
            value={valve.position}
            onChange={(e) => {
              const v = Number(e.target.value);
              set((x) => void (x.position = v), `vp-${valve.id}`);
            }}
          />
          <span className="field-hint">Drawing only. A valve anywhere on the pipe acts the same.</span>
        </label>
        <button type="button" className="btn" onClick={() => select({ type: 'pipe', id: pipe.id })}>
          Select pipe {pipe.label}
        </button>
      </Section>

      <Section title="Hydraulics">
        <p className="muted">
          Closed, it shuts pipe {pipe.label}. Open, it adds the {row?.name.toLowerCase() ?? 'valve'} loss from the fitting
          table{leq !== null ? `: L_eq ${leq.toFixed(1)} m at ${size} mm` : ''}.
          {valve.type === 'nonReturn' ? ' It also stops any flow in the reverse direction.' : ''}
        </p>
        {otherClosed && valve.status === 'open' && <p className="warn">▲ The pipe is already shut by its status or another valve.</p>}
        {results.ok && r && (
          <dl className="readout">
            <dt>Flow through</dt>
            <dd data-testid="valve-flow">{r.connected ? `${Math.abs(r.flowLpm).toFixed(1)} LPM` : 'None, pipe shut'}</dd>
            {r.connected && r.heldByCheckValve && (
              <>
                <dt>Head held back</dt>
                <dd data-testid="valve-held">{r.headLossM.toFixed(2)} m</dd>
              </>
            )}
            {r.connected && !r.heldByCheckValve && (
              <>
                <dt>Pipe head loss</dt>
                <dd>{r.headLossM.toFixed(3)} m</dd>
              </>
            )}
          </dl>
        )}
      </Section>
    </>
  );
}
