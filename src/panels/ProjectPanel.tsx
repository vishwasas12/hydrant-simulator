import { JUNCTION_FITTING_TYPES } from '../model/junctions';
import { useResults, useStore } from '../state/store';
import { NumberField, Section, Segmented, TextField, Toggle } from './fields';
import { BackgroundControls } from './BackgroundControls';

export function ProjectPanel() {
  const project = useStore((s) => s.project);
  const update = useStore((s) => s.update);
  const results = useResults();
  const settings = project.settings;
  const hydrants = project.nodes.filter((n) => n.kind === 'hydrant').length;
  const reels = project.nodes.filter((n) => n.kind === 'hoseReel').length;
  const totalLength = project.pipes.reduce((s, p) => s + p.lengthM, 0);

  const setAutoFittings = (on: boolean) => {
    const handEntered = on
      ? project.pipes.filter((p) => p.fittings.some((f) => JUNCTION_FITTING_TYPES.includes(f.type))).map((p) => p.label)
      : [];
    const remove =
      handEntered.length > 0 &&
      confirm(
        `Tees, bends and reducers will now be found from the drawing.\n\n` +
          `${handEntered.length} pipe${handEntered.length > 1 ? 's have' : ' has'} tees, elbows or reducers entered by hand ` +
          `(${handEntered.slice(0, 8).join(', ')}${handEntered.length > 8 ? ', ...' : ''}). ` +
          `Remove them so they are not counted twice?\n\nOK removes them. Cancel keeps them as extra fittings.`,
      );
    update((d) => {
      d.settings.autoFittings = on;
      if (remove) {
        for (const p of d.pipes) p.fittings = p.fittings.filter((f) => !JUNCTION_FITTING_TYPES.includes(f.type));
      }
    });
  };

  return (
    <>
      <Section title="Project">
        <TextField label="Name" value={project.name} onChange={(v) => update((d) => void (d.name = v), 'project-name')} />
        <dl className="readout">
          <dt>Nodes</dt>
          <dd>{project.nodes.length}</dd>
          <dt>Pipes</dt>
          <dd>
            {project.pipes.length} · {(totalLength / 1000).toFixed(2)} km
          </dd>
          <dt>Hydrants</dt>
          <dd>{hydrants}</dd>
          <dt>Hose reels</dt>
          <dd>{reels}</dd>
        </dl>
        <p className="muted">Select a node, pipe or the pump to edit it.</p>
      </Section>

      {results.ok && (
        <Section title="System">
          <dl className="readout">
            <dt>Pump flow</dt>
            <dd>{results.system.pumpFlowLpm.toFixed(0)} LPM</dd>
            <dt>Pump head</dt>
            <dd>
              {results.system.pumpHeadM.toFixed(1)} m · {results.system.pumpPressureBar.toFixed(2)} bar
            </dd>
            <dt>Total outflow</dt>
            <dd>{results.system.totalOutflowLpm.toFixed(0)} LPM</dd>
            <dt>Critical outlet</dt>
            <dd>
              {results.system.criticalNodeId
                ? `${results.nodes.find((n) => n.id === results.system.criticalNodeId)?.label} · ${results.system.criticalPressureBar?.toFixed(2)} bar`
                : 'None open'}
            </dd>
            <dt>Open outlets</dt>
            <dd>
              {results.system.passingOutlets} pass, {results.system.failingOutlets} fail
            </dd>
          </dl>
        </Section>
      )}

      <Section title="Solver">
        <div className="field">
          <span className="field-label">Friction</span>
          <Segmented
            ariaLabel="Friction model"
            value={settings.frictionModel}
            options={[
              { value: 'hazenWilliams', label: 'Hazen-Williams' },
              { value: 'darcyWeisbach', label: 'Darcy-Weisbach' },
            ]}
            onChange={(v) => update((d) => void (d.settings.frictionModel = v))}
          />
        </div>
        <div className="field">
          <span className="field-label">Fittings</span>
          <Segmented
            ariaLabel="Fitting method"
            value={settings.fittingMethod}
            options={[
              { value: 'equivalentLength', label: 'Equivalent length' },
              { value: 'kValue', label: 'K value' },
            ]}
            onChange={(v) => update((d) => void (d.settings.fittingMethod = v))}
          />
        </div>
        <div className="field row">
          <span className="field-label">Tees and bends from the drawing</span>
          <Toggle
            label="Find tees, bends and reducers from the drawing"
            testId="auto-fittings"
            checked={settings.autoFittings ?? false}
            onChange={setAutoFittings}
          />
        </div>
        <p className="muted">
          {settings.autoFittings
            ? 'Losses for tees, bends and reducers at junctions are added automatically. Add other fittings on the pipe.'
            : 'Off: only the fittings entered on each pipe are counted.'}
        </p>
        <div className="field row">
          <span className="field-label">Scale L_eq for C ≠ 120 (NFPA 13)</span>
          <Toggle
            label="Scale equivalent lengths for C other than 120"
            checked={settings.applyCFactorToFittings}
            onChange={(v) => update((d) => void (d.settings.applyCFactorToFittings = v))}
          />
        </div>
        <NumberField
          label="Velocity limit"
          unit="m/s"
          min={0}
          value={settings.velocityLimitMs}
          testId="velocity-limit"
          onChange={(v) => update((d) => void (d.settings.velocityLimitMs = v), 'vel-limit')}
        />
      </Section>

      <BackgroundControls />
    </>
  );
}
