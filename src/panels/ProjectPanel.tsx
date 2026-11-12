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
