import { DEFAULT_HOSE_REEL, DEFAULT_HYDRANT } from '../model/defaults';
import type { NetworkNode, Outlet } from '../model/types';
import { emitterFlowLpm, emitterPressureBar, m3sToLpm, nozzleK } from '../solver';
import { useResults, useStore } from '../state/store';
import { NumberField, Section, Segmented, TextField, Toggle } from './fields';

export function NodePanel({ node }: { node: NetworkNode }) {
  const update = useStore((s) => s.update);
  const settings = useStore((s) => s.project.settings);
  const pump = useStore((s) => s.project.pumps.find((p) => p.nodeId === node.id));
  const select = useStore((s) => s.select);
  const results = useResults();
  const r = results.nodes.find((n) => n.id === node.id);

  const set = (patch: (n: NetworkNode) => void, key?: string) =>
    update((d) => {
      const target = d.nodes.find((x) => x.id === node.id);
      if (target) patch(target);
    }, key);

  const setOutlet = (patch: Partial<Outlet>, key?: string) =>
    set((n) => {
      if (n.outlet) Object.assign(n.outlet, patch);
    }, key);

  const o = node.outlet;
  const title = node.kind === 'hydrant' ? 'Hydrant' : node.kind === 'hoseReel' ? 'Hose reel' : 'Junction';

  return (
    <>
      <Section title={title}>
        <TextField label="ID" value={node.label} onChange={(v) => set((n) => void (n.label = v), `lbl-${node.id}`)} />
        <NumberField
          label="Elevation"
          unit="m"
          value={node.elevationM}
          testId="node-elevation"
          onChange={(v) => set((n) => void (n.elevationM = v), `el-${node.id}`)}
        />
        <NumberField
          label="Base demand"
          unit="LPM"
          min={0}
          value={node.baseDemandLpm}
          onChange={(v) => set((n) => void (n.baseDemandLpm = v), `bd-${node.id}`)}
        />
        {pump && (
          <button type="button" className="btn" onClick={() => select({ type: 'pump', id: pump.id })}>
            Edit the pump on this node
          </button>
        )}
      </Section>

      {o && (
        <>
          <Section title="Outlet">
            <div className="field row">
              <span className="field-label">State</span>
              <span className="switch-with-label">
                <span>{o.on ? 'ON' : 'OFF'}</span>
                <Toggle checked={o.on} onChange={(on) => setOutlet({ on })} label={`${node.label} on or off`} testId="outlet-on" />
              </span>
            </div>
            <div className="field">
              <span className="field-label">Type</span>
              <Segmented
                ariaLabel="Outlet type"
                value={String(o.outlets) as '1' | '2'}
                options={[
                  { value: '1', label: 'Single outlet' },
                  { value: '2', label: 'Double outlet' },
                ]}
                onChange={(v) => setOutlet({ outlets: Number(v) as 1 | 2 })}
              />
            </div>
            <div className="field">
              <span className="field-label">Discharge model</span>
              <Segmented
                ariaLabel="Discharge model"
                value={o.model}
                options={[
                  { value: 'emitter', label: 'Emitter Q = K√P' },
                  { value: 'fixed', label: 'Fixed demand' },
                ]}
                onChange={(model) => setOutlet({ model })}
              />
            </div>
            {o.model === 'fixed' ? (
              <NumberField
                label="Demand per outlet"
                unit="LPM"
                min={0}
                value={o.fixedFlowLpm}
                testId="outlet-fixed"
                onChange={(v) => setOutlet({ fixedFlowLpm: v }, `ff-${node.id}`)}
              />
            ) : (
              <EmitterFields outlet={o} onChange={(patch, key) => setOutlet(patch, `${key}-${node.id}`)} />
            )}
          </Section>

          <Section title="Requirements">
            <NumberField
              label="Minimum residual pressure"
              unit="bar"
              min={0}
              value={o.minPressureBar}
              onChange={(v) => setOutlet({ minPressureBar: v }, `mp-${node.id}`)}
            />
            <NumberField
              label="Minimum flow per outlet"
              unit="LPM"
              min={0}
              value={o.minFlowLpm}
              onChange={(v) => setOutlet({ minFlowLpm: v }, `mf-${node.id}`)}
            />
            <p className="note">
              Check these defaults against the applicable code: NBC 2016 Part 4, TAC, IS 13039, NFPA 14/24.
            </p>
            <EmitterWarning outlet={o} gravity={settings.gravity} mPerBar={settings.mPerBar} />
            <button
              type="button"
              className="btn"
              data-testid="apply-all"
              onClick={() =>
                update((d) => {
                  for (const n of d.nodes) {
                    if (n.kind === node.kind && n.outlet) n.outlet = { ...o, on: n.outlet.on };
                  }
                })
              }
            >
              Apply these settings to all {node.kind === 'hydrant' ? 'hydrants' : 'hose reels'}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() =>
                setOutlet({ ...(node.kind === 'hydrant' ? DEFAULT_HYDRANT : DEFAULT_HOSE_REEL), on: o.on })
              }
            >
              Reset to defaults
            </button>
          </Section>
        </>
      )}

      {results.ok && r?.connected && (
        <Section title="Results">
          <dl className="readout">
            <dt>Total head</dt>
            <dd>{r.headM?.toFixed(2)} m</dd>
            <dt>Pressure</dt>
            <dd>
              {r.pressureM?.toFixed(2)} m · {r.pressureBar?.toFixed(2)} bar
            </dd>
            <dt>Outflow</dt>
            <dd>{r.outflowLpm.toFixed(1)} LPM</dd>
            {r.status && r.status !== 'off' && (
              <>
                <dt>Check</dt>
                <dd className={r.status === 'pass' ? 'good' : 'bad'}>
                  {r.status === 'pass' ? '✓ Pass' : `✕ Fail${r.pressureOk ? '' : ', pressure'}${r.flowOk ? '' : ', flow'}`}
                </dd>
              </>
            )}
          </dl>
        </Section>
      )}
    </>
  );
}

function EmitterFields({
  outlet,
  onChange,
}: {
  outlet: Outlet;
  onChange: (patch: Partial<Outlet>, key: string) => void;
}) {
  const settings = useStore((s) => s.project.settings);
  const k = m3sToLpm(nozzleK(outlet.nozzleMm, outlet.cd, settings.gravity)) * Math.sqrt(settings.mPerBar);
  return (
    <>
      <div className="field-grid">
        <NumberField label="Nozzle" unit="mm" min={0} value={outlet.nozzleMm} testId="outlet-nozzle" onChange={(v) => onChange({ nozzleMm: v }, 'nz')} />
        <NumberField label="Cd" min={0} value={outlet.cd} onChange={(v) => onChange({ cd: v }, 'cd')} />
        <NumberField label="Hose length" unit="m" min={0} value={outlet.hoseLengthM} onChange={(v) => onChange({ hoseLengthM: v }, 'hl')} />
        <NumberField label="Hose bore" unit="mm" min={0} value={outlet.hoseDiameterMm} onChange={(v) => onChange({ hoseDiameterMm: v }, 'hd')} />
        <NumberField label="Hose C" min={0} value={outlet.hoseC} onChange={(v) => onChange({ hoseC: v }, 'hc')} />
        <NumberField label="Valve bore" unit="mm" min={0} value={outlet.valveDiameterMm} onChange={(v) => onChange({ valveDiameterMm: v }, 'vd')} />
        <NumberField label="Valve K" min={0} value={outlet.valveK} onChange={(v) => onChange({ valveK: v }, 'vk')} />
      </div>
      <p className="muted">
        Nozzle K = {Number.isFinite(k) ? k.toFixed(1) : '–'} LPM/√bar per outlet, before hose and valve losses.
      </p>
    </>
  );
}

/** Tells the user when the nozzle cannot deliver the required flow at the required pressure. */
function EmitterWarning({ outlet, gravity, mPerBar }: { outlet: Outlet; gravity: number; mPerBar: number }) {
  if (outlet.model !== 'emitter' || !(outlet.nozzleMm > 0) || !(outlet.cd > 0)) return null;
  const required = outlet.minFlowLpm * outlet.outlets;
  const atMinimum = emitterFlowLpm(outlet, outlet.minPressureBar, gravity, mPerBar);
  if (atMinimum >= required) return null;
  const neededBar = emitterPressureBar(outlet, required, gravity, mPerBar);
  return (
    <p className="warn" data-testid="emitter-warning">
      ▲ This nozzle delivers {atMinimum.toFixed(0)} LPM at {outlet.minPressureBar} bar. Reaching {required.toFixed(0)} LPM needs{' '}
      {neededBar.toFixed(1)} bar at the hydrant. Use a larger nozzle, lower the required flow, or use fixed demand.
    </p>
  );
}
