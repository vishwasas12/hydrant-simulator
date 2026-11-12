import { useEffect, useRef } from 'react';
import { Canvas, deleteSelection } from './canvas/Canvas';
import { emptyProject } from './model/defaults';
import { parseProject } from './model/schema';
import { seedProject } from './model/seed';
import { Properties } from './panels/Properties';
import { Toolbar, ViewBar } from './panels/Toolbar';
import { BottomPanel } from './panels/BottomPanel';
import { useCapacity } from './analysis/useCapacity';
import { buildReportHtml } from './report/report';
import { networkKey, resultsFor, useStore, type Tool } from './state/store';

const KEY_TOOLS: Record<string, Tool> = {
  v: 'select',
  j: 'junction',
  p: 'pipe',
  a: 'valve',
  h: 'hydrant',
  r: 'hoseReel',
  u: 'pump',
  t: 'toggle',
};

function downloadText(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function App() {
  const project = useStore((s) => s.project);
  const past = useStore((s) => s.past);
  const future = useStore((s) => s.future);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const loadProject = useStore((s) => s.loadProject);
  const toast = useStore((s) => s.toast);
  const showToast = useStore((s) => s.showToast);
  const autosaveNote = useStore((s) => s.autosaveNote);
  const fileRef = useRef<HTMLInputElement>(null);
  const { results, ms } = resultsFor(project);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      // Sliders and checkboxes keep focus after a click but take no typed text.
      const nonTextInput =
        target instanceof HTMLInputElement && ['range', 'checkbox', 'radio', 'file', 'button'].includes(target.type);
      const typing =
        !nonTextInput && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT');
      const state = useStore.getState();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        if (typing) return;
        e.preventDefault();
        if (e.shiftKey) state.redo();
        else state.undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        if (typing) return;
        e.preventDefault();
        state.redo();
        return;
      }
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelection();
        return;
      }
      if (e.key === 'Escape') {
        if (state.pipeStart) state.setPipeStart(null);
        else if (state.tool !== 'select') state.setTool('select');
        else state.select(null);
        return;
      }
      const tool = KEY_TOOLS[e.key.toLowerCase()];
      if (tool) state.setTool(tool);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => showToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast, showToast]);

  const save = () => {
    const safe = project.name.replace(/[^\w.-]+/g, '_') || 'network';
    downloadText(`${safe}.hydrant.json`, JSON.stringify(project, null, 2), 'application/json');
  };

  const open = async (file: File) => {
    try {
      const parsed = parseProject(JSON.parse(await file.text()));
      if (parsed.ok) {
        loadProject(parsed.project);
        showToast(`Opened ${file.name}.`);
      } else {
        showToast(`Could not open ${file.name}: ${parsed.errors[0]}`);
      }
    } catch {
      showToast(`Could not open ${file.name}: it is not valid JSON.`);
    }
  };

  const report = () => {
    const capacity = useCapacity.getState();
    const key = networkKey(project);
    const current =
      !!capacity.resultKey && capacity.resultKey.length === key.length && capacity.resultKey.every((v, i) => v === key[i]);
    const html = buildReportHtml({
      project,
      results,
      capacity: current ? capacity.result : null,
      generatedAt: new Date(),
    });
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    const opened = window.open(url, '_blank');
    if (!opened) {
      const safe = project.name.replace(/[^\w.-]+/g, '_') || 'network';
      downloadText(`${safe}-report.html`, html, 'text/html');
      showToast('Pop-ups are blocked, so the report was downloaded instead.');
    }
  };

  const errors = results.issues.filter((i) => i.severity === 'error');
  const warnings = results.issues.filter((i) => i.severity === 'warning');

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 2 C7 8 5 11.5 5 15 a7 7 0 0 0 14 0 C19 11.5 17 8 12 2 Z" fill="var(--accent)" />
          </svg>
          <strong>Hydrant Network</strong>
          <span className="project-name" data-testid="project-name">{project.name}</span>
        </div>
        <div className="topbar-actions">
          <button className="btn" onClick={undo} disabled={past.length === 0} title="Undo (Ctrl+Z)" data-testid="undo">
            Undo
          </button>
          <button className="btn" onClick={redo} disabled={future.length === 0} title="Redo (Ctrl+Y)" data-testid="redo">
            Redo
          </button>
          <span className="viewbar-sep" />
          <button
            className="btn"
            onClick={() => {
              if (confirm('Start a new empty project? Unsaved changes to this one will be lost.')) loadProject(emptyProject());
            }}
          >
            New
          </button>
          <button
            className="btn"
            onClick={() => {
              if (confirm('Load the reference project? Unsaved changes to this one will be lost.')) loadProject(seedProject());
            }}
          >
            Reference
          </button>
          <button className="btn" onClick={() => fileRef.current?.click()} data-testid="open">
            Open
          </button>
          <button className="btn" onClick={save} data-testid="save">
            Save
          </button>
          <span className="viewbar-sep" />
          <button className="btn primary" onClick={report} data-testid="report">
            Report
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            hidden
            data-testid="open-input"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void open(f);
              e.target.value = '';
            }}
          />
        </div>
      </header>

      <div className="workspace">
        <Toolbar />
        <main className="center">
          <ViewBar />
          <Canvas />
          <BottomPanel />
        </main>
        <Properties />
      </div>

      <footer className="statusbar" data-testid="statusbar">
        {results.ok ? (
          <span className="good" data-testid="solve-status">
            ✓ Solved in {results.iterations} iterations, residual {results.headResidualM.toExponential(1)} m, {ms.toFixed(1)} ms
          </span>
        ) : (
          <span className="bad" data-testid="solve-status">✕ Not solved</span>
        )}
        {errors.length > 0 && (
          <span className="bad" title={errors.map((i) => i.message).join('\n')} data-testid="status-errors">
            ✕ {errors[0].message}
            {errors.length > 1 ? ` (+${errors.length - 1} more)` : ''}
          </span>
        )}
        {warnings.length > 0 && (
          <span className="warn-text" title={warnings.map((i) => i.message).join('\n')}>
            ▲ {warnings[0].message}
            {warnings.length > 1 ? ` (+${warnings.length - 1} more)` : ''}
          </span>
        )}
        {autosaveNote && <span className="warn-text">▲ {autosaveNote}</span>}
      </footer>

      {toast && (
        <div className="toast" role="status" data-testid="toast">
          {toast}
        </div>
      )}
    </div>
  );
}
