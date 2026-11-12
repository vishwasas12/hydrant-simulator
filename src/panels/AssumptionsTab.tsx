import { useMemo, useState } from 'react';
import { C_FACTORS, FITTING_TABLE, MATERIAL_TABLE, NOMINAL_SIZES } from '../model/tables';
import { buildAssumptions, type Assumption } from '../report/assumptions';
import { useStore } from '../state/store';
import { DataTable, type Column } from './DataTable';
import { Segmented } from './fields';

const columns: Column<Assumption>[] = [
  { key: 'group', label: 'Group', value: (r) => r.group },
  { key: 'name', label: 'Item', value: (r) => r.name },
  { key: 'value', label: 'Value used', value: (r) => r.value },
  { key: 'source', label: 'Source', value: (r) => r.source },
  {
    key: 'over',
    label: 'Overridden',
    value: (r) => (r.overridden ? 'Yes' : ''),
    render: (r) => (r.overridden ? <span className="badge override">● Overridden</span> : ''),
  },
];

type View = 'values' | 'fittings' | 'material' | 'cfactors';

function Cell({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  return (
    <input
      className="cell-input"
      type="number"
      min="0"
      step="any"
      aria-label={label}
      value={value}
      onChange={(e) => {
        const v = Number(e.target.value);
        if (e.target.value !== '' && v >= 0) onChange(v);
      }}
    />
  );
}

function FittingsEditor() {
  const tables = useStore((s) => s.project.tables);
  const update = useStore((s) => s.update);
  const [field, setField] = useState<'leqM' | 'k'>('leqM');
  return (
    <div className="table-wrap">
      <div className="table-tools">
        <Segmented
          ariaLabel="Fitting table values"
          value={field}
          options={[
            { value: 'leqM', label: 'Equivalent length, m' },
            { value: 'k', label: 'K value' },
          ]}
          onChange={setField}
        />
        <span className="muted">Based on NFPA 13, valid at C = 120. Edits apply to every pipe.</span>
        <span className="viewbar-fill" />
        <button
          type="button"
          className="btn"
          onClick={() => update((d) => void (d.tables.fittings = JSON.parse(JSON.stringify(FITTING_TABLE))))}
        >
          Reset
        </button>
      </div>
      <div className="table-scroll">
        <table data-testid="fittings-editor">
          <thead>
            <tr>
              <th><button type="button" tabIndex={-1}>Fitting</button></th>
              {NOMINAL_SIZES.map((s) => (
                <th key={s} className="num"><button type="button" tabIndex={-1}>{s}</button></th>
              ))}
              <th><button type="button" tabIndex={-1}>Source</button></th>
            </tr>
          </thead>
          <tbody>
            {tables.fittings.map((row, i) => (
              <tr key={row.type}>
                <td>{row.name}</td>
                {NOMINAL_SIZES.map((s) => (
                  <td key={s} className="num">
                    <Cell
                      label={`${row.name} at ${s} mm`}
                      value={row[field][String(s)]}
                      onChange={(v) => update((d) => void (d.tables.fittings[i][field][String(s)] = v), `ft-${row.type}-${s}-${field}`)}
                    />
                  </td>
                ))}
                <td className="source-cell">{row.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MaterialEditor() {
  const material = useStore((s) => s.project.tables.material);
  const update = useStore((s) => s.update);
  return (
    <div className="table-wrap">
      <div className="table-tools">
        <span className="muted">{material.source}. Pipes that still match the old value follow an edit.</span>
        <span className="viewbar-fill" />
        <button
          type="button"
          className="btn"
          onClick={() => update((d) => void (d.tables.material = JSON.parse(JSON.stringify(MATERIAL_TABLE))))}
        >
          Reset
        </button>
      </div>
      <div className="table-scroll">
        <table data-testid="material-editor">
          <thead>
            <tr>
              {['Nominal, mm', 'OD, mm', 'Wall, mm', 'ID, mm'].map((h) => (
                <th key={h} className="num"><button type="button" tabIndex={-1}>{h}</button></th>
              ))}
            </tr>
          </thead>
          <tbody>
            {material.rows.map((row, i) => (
              <tr key={row.nominalMm}>
                <td className="num">{row.nominalMm}</td>
                <td className="num">
                  <Cell label={`OD at ${row.nominalMm}`} value={row.outerDiameterMm} onChange={(v) => update((d) => void (d.tables.material.rows[i].outerDiameterMm = v), `m-od-${i}`)} />
                </td>
                <td className="num">
                  <Cell label={`Wall at ${row.nominalMm}`} value={row.wallMm} onChange={(v) => update((d) => void (d.tables.material.rows[i].wallMm = v), `m-w-${i}`)} />
                </td>
                <td className="num">
                  <Cell
                    label={`ID at ${row.nominalMm}`}
                    value={row.internalDiameterMm}
                    onChange={(v) =>
                      update((d) => {
                        const r = d.tables.material.rows[i];
                        for (const p of d.pipes) {
                          if (p.nominalMm === r.nominalMm && p.internalDiameterMm === r.internalDiameterMm) p.internalDiameterMm = v;
                        }
                        r.internalDiameterMm = v;
                      }, `m-id-${i}`)
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CFactorEditor() {
  const rows = useStore((s) => s.project.tables.cFactors);
  const update = useStore((s) => s.update);
  return (
    <div className="table-wrap">
      <div className="table-tools">
        <span className="muted">NFPA 13 multipliers applied to equivalent lengths when C is not 120.</span>
        <span className="viewbar-fill" />
        <button type="button" className="btn" onClick={() => update((d) => void (d.tables.cFactors = JSON.parse(JSON.stringify(C_FACTORS))))}>
          Reset
        </button>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th className="num"><button type="button" tabIndex={-1}>C</button></th>
              <th className="num"><button type="button" tabIndex={-1}>Multiplier</button></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={row.c}>
                <td className="num">{row.c}</td>
                <td className="num">
                  <Cell label={`Multiplier at C ${row.c}`} value={row.multiplier} onChange={(v) => update((d) => void (d.tables.cFactors[i].multiplier = v), `cf-${i}`)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function AssumptionsTab() {
  const project = useStore((s) => s.project);
  const [view, setView] = useState<View>('values');
  const rows = useMemo(() => buildAssumptions(project), [project]);
  return (
    <div className="assumptions" data-testid="assumptions">
      <div className="assumptions-nav">
        <Segmented
          ariaLabel="Assumptions view"
          value={view}
          options={[
            { value: 'values', label: 'Values used' },
            { value: 'fittings', label: 'Fitting table' },
            { value: 'material', label: 'Pipe ID table' },
            { value: 'cfactors', label: 'C factors' },
          ]}
          onChange={setView}
        />
      </div>
      <div className="assumptions-body">
        {view === 'values' && (
          <DataTable
            testId="assumptions-table"
            rows={rows}
            columns={columns}
            rowKey={(r) => `${r.group}|${r.name}|${r.value}`}
            csvName="assumptions.csv"
          />
        )}
        {view === 'fittings' && <FittingsEditor />}
        {view === 'material' && <MaterialEditor />}
        {view === 'cfactors' && <CFactorEditor />}
      </div>
    </div>
  );
}
