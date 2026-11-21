import { useEffect, useRef } from 'react';
import { reportDetails } from '../model/defaults';
import type { ReportDetails } from '../model/types';
import { COMPANY } from '../report/company';
import { useStore } from '../state/store';

type TextKey = Exclude<keyof ReportDetails, 'includeScenarios'>;

const FIELDS: { key: TextKey; label: string; placeholder?: string; wide?: boolean }[] = [
  { key: 'client', label: 'Client', wide: true },
  { key: 'site', label: 'Site / location', wide: true },
  { key: 'documentNo', label: 'Document no.', placeholder: 'e.g. TRX-FH-001' },
  { key: 'revision', label: 'Revision' },
  { key: 'preparedBy', label: 'Prepared by' },
  { key: 'checkedBy', label: 'Checked by' },
  { key: 'approvedBy', label: 'Approved by' },
];

/** Document details and section choices, asked for before the report opens. */
export function ReportDialog({ onClose, onCreate }: { onClose: () => void; onCreate: () => void }) {
  const name = useStore((s) => s.project.name);
  const stored = useStore((s) => s.project.report);
  const scenarioCount = useStore((s) => s.project.scenarios.length);
  const update = useStore((s) => s.update);
  const details = reportDetails({ report: stored });
  const firstField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstField.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const set = <K extends keyof ReportDetails>(key: K, value: ReportDetails[K]) =>
    update((d) => void (d.report = { ...d.report, [key]: value }), `report-${key}`);

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="report-dialog-title" data-testid="report-dialog">
        <h2 id="report-dialog-title">Client report</h2>
        <p className="muted">Issued under the {COMPANY} letterhead. These details are saved with the project.</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onCreate();
          }}
        >
          <div className="dialog-grid">
            <label className="field wide">
              <span className="field-label">Project name</span>
              <input
                ref={firstField}
                type="text"
                value={name}
                data-testid="report-project-name"
                onChange={(e) => update((d) => void (d.name = e.target.value), 'project-name')}
              />
            </label>
            {FIELDS.map((f) => (
              <label className={`field${f.wide ? ' wide' : ''}`} key={f.key}>
                <span className="field-label">{f.label}</span>
                <input
                  type="text"
                  value={details[f.key]}
                  placeholder={f.placeholder}
                  data-testid={`report-${f.key}`}
                  onChange={(e) => set(f.key, e.target.value)}
                />
              </label>
            ))}
          </div>

          <p className="fitting-group">Sections</p>
          <label className="check">
            <input
              type="checkbox"
              checked={scenarioCount > 0 && details.includeScenarios}
              disabled={scenarioCount === 0}
              data-testid="report-include-scenarios"
              onChange={(e) => set('includeScenarios', e.target.checked)}
            />
            Operating scenarios {scenarioCount > 0 ? `(${scenarioCount} saved)` : '(none saved)'}
          </label>
          <p className="muted">Simultaneous operation is included when a capacity search has been run on the current network.</p>

          <div className="dialog-actions">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn primary" data-testid="report-create">
              Open report
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
