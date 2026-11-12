import type { ReactNode } from 'react';
import { deleteSelection } from '../canvas/Canvas';
import { NOMINAL_SIZES } from '../model/tables';
import { useStore, type Tool } from '../state/store';

const TOOLS: { tool: Tool; key: string; label: string; icon: ReactNode }[] = [
  { tool: 'select', key: 'V', label: 'Select / move', icon: <path d="M6 3 L6 18 L10 14 L13 20 L15.5 19 L12.5 13 L18 13 Z" fill="currentColor" /> },
  { tool: 'junction', key: 'J', label: 'Junction', icon: <circle cx="12" cy="12" r="4" fill="currentColor" /> },
  {
    tool: 'pipe',
    key: 'P',
    label: 'Pipe',
    icon: (
      <g fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="5.5" cy="18.5" r="2.5" />
        <circle cx="18.5" cy="5.5" r="2.5" />
        <path d="M7.5 16.5 L16.5 7.5" />
      </g>
    ),
  },
  {
    tool: 'valve',
    key: 'A',
    label: 'Valve',
    icon: (
      <g>
        <path d="M2 12 H5 M19 12 H22" stroke="currentColor" strokeWidth="2" />
        <path d="M5 7 L19 17 L19 7 L5 17 Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      </g>
    ),
  },
  { tool: 'hydrant', key: 'H', label: 'Hydrant', icon: <circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" strokeWidth="2.4" /> },
  { tool: 'hoseReel', key: 'R', label: 'Hose reel', icon: <rect x="7" y="7" width="10" height="10" transform="rotate(45 12 12)" fill="none" stroke="currentColor" strokeWidth="2.4" /> },
  {
    tool: 'pump',
    key: 'U',
    label: 'Pump',
    icon: (
      <g>
        <circle cx="12" cy="12" r="9" fill="currentColor" />
        <path d="M9 7.5 L17 12 L9 16.5 Z" fill="var(--panel)" />
      </g>
    ),
  },
  {
    tool: 'toggle',
    key: 'T',
    label: 'Toggle hydrant, valve or pipe',
    icon: (
      <g>
        <rect x="3" y="8" width="18" height="8" rx="4" fill="none" stroke="currentColor" strokeWidth="2" />
        <circle cx="16" cy="12" r="2.4" fill="currentColor" />
      </g>
    ),
  },
];

export function Toolbar() {
  const tool = useStore((s) => s.tool);
  const setTool = useStore((s) => s.setTool);
  const selection = useStore((s) => s.selection);

  return (
    <nav className="toolbar" aria-label="Drawing tools">
      {TOOLS.map((t) => (
        <button
          key={t.tool}
          type="button"
          className={tool === t.tool ? 'active' : ''}
          title={`${t.label} (${t.key})`}
          aria-label={`${t.label} (${t.key})`}
          aria-pressed={tool === t.tool}
          data-testid={`tool-${t.tool}`}
          onClick={() => setTool(t.tool)}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
            {t.icon}
          </svg>
          <kbd>{t.key}</kbd>
        </button>
      ))}
      <div className="toolbar-gap" />
      <button
        type="button"
        title="Delete selected (Del)"
        aria-label="Delete selected (Del)"
        disabled={!selection}
        data-testid="tool-delete"
        onClick={deleteSelection}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 7 H18 M9 7 V4.5 H15 V7 M8 7 L9 20 H15 L16 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        </svg>
        <kbd>Del</kbd>
      </button>
    </nav>
  );
}

export function ViewBar() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const tool = useStore((s) => s.tool);
  const newPipeSize = useStore((s) => s.newPipeSize);
  const setNewPipeSize = useStore((s) => s.setNewPipeSize);
  const requestFit = useStore((s) => s.requestFit);

  const check = (key: 'showGrid' | 'showLabels' | 'showFittings' | 'showFlow' | 'ortho' | 'snap', label: string) => (
    <label className="check">
      <input type="checkbox" checked={view[key]} onChange={(e) => setView({ [key]: e.target.checked })} data-testid={`view-${key}`} />
      {label}
    </label>
  );

  return (
    <div className="viewbar">
      <div className="segmented" role="group" aria-label="Colour pipes by">
        {(['diameter', 'pressure', 'velocity'] as const).map((c) => (
          <button
            key={c}
            type="button"
            className={view.colorBy === c ? 'active' : ''}
            aria-pressed={view.colorBy === c}
            data-testid={`color-${c}`}
            onClick={() => setView({ colorBy: c })}
          >
            {c[0].toUpperCase() + c.slice(1)}
          </button>
        ))}
      </div>
      <span className="viewbar-sep" />
      {check('showGrid', 'Grid')}
      {check('showLabels', 'Labels')}
      {check('showFittings', 'Fittings')}
      {check('showFlow', 'Flow')}
      <span className="viewbar-sep" />
      {check('snap', 'Snap')}
      {check('ortho', 'Orthogonal')}
      {tool === 'pipe' && (
        <label className="check">
          New pipe
          <select value={newPipeSize} onChange={(e) => setNewPipeSize(Number(e.target.value))} data-testid="new-pipe-size">
            {NOMINAL_SIZES.map((s) => (
              <option key={s} value={s}>
                {s} mm
              </option>
            ))}
          </select>
        </label>
      )}
      <span className="viewbar-fill" />
      <button type="button" className="btn" onClick={requestFit} data-testid="fit">
        Fit
      </button>
    </div>
  );
}
