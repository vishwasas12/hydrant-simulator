import { useRef, useState } from 'react';
import { loadBackgroundFile } from '../canvas/background';
import { recomputeLengths } from '../model/edit';
import { useStore } from '../state/store';
import { NumberField, Section } from './fields';

export function BackgroundControls() {
  const background = useStore((s) => s.project.background);
  const metersPerUnit = useStore((s) => s.project.metersPerUnit);
  const update = useStore((s) => s.update);
  const setTool = useStore((s) => s.setTool);
  const requestFit = useStore((s) => s.requestFit);
  const showToast = useStore((s) => s.showToast);
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (target: File, pageNumber: number) => {
    setBusy(true);
    setError(null);
    try {
      const loaded = await loadBackgroundFile(target, pageNumber);
      setFile(target);
      setPages(loaded.pages);
      setPage(pageNumber);
      update((d) => {
        d.background = {
          dataUrl: loaded.dataUrl,
          name: target.name,
          x: d.background?.x ?? 0,
          y: d.background?.y ?? 0,
          width: loaded.width,
          height: loaded.height,
          opacity: d.background?.opacity ?? 0.6,
          visible: true,
        };
      });
      requestFit();
      showToast(`Imported ${target.name}. Calibrate the scale before tracing.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The file could not be imported.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Background drawing">
      <input
        ref={fileRef}
        type="file"
        accept="image/*,.pdf,application/pdf"
        hidden
        data-testid="bg-input"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void load(f, 1);
          e.target.value = '';
        }}
      />
      <button type="button" className="btn" disabled={busy} data-testid="bg-import" onClick={() => fileRef.current?.click()}>
        {busy ? 'Importing…' : background ? 'Replace image or PDF' : 'Import image or PDF'}
      </button>
      {error && <p className="warn" data-testid="bg-error">▲ {error}</p>}

      {background && (
        <>
          <p className="muted" data-testid="bg-name">
            {background.name}. Locked layer.
          </p>
          {pages > 1 && file && (
            <NumberField
              label={`PDF page, of ${pages}`}
              min={1}
              step={1}
              value={page}
              testId="bg-page"
              onChange={(v) => {
                if (Number.isInteger(v) && v >= 1 && v <= pages && v !== page) void load(file, v);
              }}
            />
          )}
          <label className="field">
            <span className="field-label">Opacity {Math.round(background.opacity * 100)} %</span>
            <input
              className="range"
              type="range"
              min="0.05"
              max="1"
              step="0.05"
              value={background.opacity}
              data-testid="bg-opacity"
              onChange={(e) => {
                const v = Number(e.target.value);
                update((d) => {
                  if (d.background) d.background.opacity = v;
                }, 'bg-opacity');
              }}
            />
          </label>
          <div className="field row">
            <span className="field-label">Visible</span>
            <input
              type="checkbox"
              className="plain-check"
              checked={background.visible}
              data-testid="bg-visible"
              onChange={(e) => {
                const v = e.target.checked;
                update((d) => {
                  if (d.background) d.background.visible = v;
                });
              }}
            />
          </div>
          <button
            type="button"
            className="btn"
            data-testid="bg-remove"
            onClick={() => {
              update((d) => void (d.background = null));
              setFile(null);
              setPages(1);
            }}
          >
            Remove background
          </button>
        </>
      )}

      <button type="button" className="btn" data-testid="calibrate" onClick={() => setTool('calibrate')}>
        Calibrate scale
      </button>
      <NumberField
        label="Metres per drawing unit"
        min={0}
        value={metersPerUnit}
        testId="meters-per-unit"
        onChange={(v) => {
          if (v > 0) {
            update((d) => {
              d.metersPerUnit = v;
              recomputeLengths(d);
            }, 'scale');
          }
        }}
        hint="Pipe lengths follow this scale unless typed in by hand."
      />
    </Section>
  );
}
