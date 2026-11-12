import { useEffect, useRef, useState, type ReactNode } from 'react';

/** Numeric input that keeps its own text while typing and commits valid numbers. */
export function NumberField({
  label,
  value,
  unit,
  onChange,
  min,
  step = 'any',
  disabled,
  testId,
  hint,
}: {
  label: string;
  value: number;
  unit?: string;
  onChange: (value: number) => void;
  min?: number;
  step?: number | 'any';
  disabled?: boolean;
  testId?: string;
  hint?: ReactNode;
}) {
  const [text, setText] = useState(format(value));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(format(value));
  }, [value]);

  const invalid = text.trim() === '' || !Number.isFinite(Number(text)) || (min !== undefined && Number(text) < min);

  return (
    <label className={`field${invalid ? ' invalid' : ''}`}>
      <span className="field-label">{label}</span>
      <span className="input-unit">
        <input
          type="number"
          value={text}
          step={step}
          min={min}
          disabled={disabled}
          data-testid={testId}
          onFocus={() => {
            focused.current = true;
          }}
          onBlur={() => {
            focused.current = false;
            setText(format(value));
          }}
          onChange={(e) => {
            setText(e.target.value);
            const v = Number(e.target.value);
            if (e.target.value.trim() !== '' && Number.isFinite(v) && (min === undefined || v >= min)) onChange(v);
          }}
        />
        {unit && <em>{unit}</em>}
      </span>
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

function format(v: number): string {
  if (!Number.isFinite(v)) return '';
  return String(Math.round(v * 1e4) / 1e4);
}

export function TextField({
  label,
  value,
  onChange,
  testId,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  testId?: string;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)} data-testid={testId} />
    </label>
  );
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
  testId,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  testId?: string;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as T)} data-testid={testId}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={value === o.value ? 'active' : ''}
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  testId,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  testId?: string;
}) {
  return (
    <button
      type="button"
      className={`switch${checked ? ' on' : ''}`}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      data-testid={testId}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="panel-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}
