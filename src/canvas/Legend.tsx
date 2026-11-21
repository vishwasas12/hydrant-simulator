import { useMemo } from 'react';
import { useStore } from '../state/store';
import { ValveSymbol } from './ValveSymbol';
import { CUSTOM_CLASS, DIAMETER_CLASSES, diameterClass, SEQUENTIAL_GRADIENT, STATUS } from './colors';

export function Legend({
  pressureRange,
  velocityMax,
}: {
  pressureRange: { min: number; max: number };
  velocityMax: number;
}) {
  const colorBy = useStore((s) => s.view.colorBy);
  const limit = useStore((s) => s.project.settings.velocityLimitMs);
  const pipes = useStore((s) => s.project.pipes);

  const used = useMemo(() => {
    const labels = new Set(pipes.map((p) => diameterClass(p).label));
    return [...DIAMETER_CLASSES, CUSTOM_CLASS].filter((c) => labels.has(c.label));
  }, [pipes]);

  return (
    <div className="legend" data-testid="legend">
      {colorBy === 'diameter' && (
        <>
          <div className="legend-title">Pipe size, mm</div>
          {used.map((c) => (
            <div className="legend-row" key={c.label}>
              <svg width="26" height="10" aria-hidden="true">
                <line x1="1" y1="5" x2="25" y2="5" stroke={c.color} strokeWidth={c.width} strokeLinecap="round" />
              </svg>
              <span>{c.label}</span>
            </div>
          ))}
        </>
      )}
      {colorBy === 'pressure' && (
        <>
          <div className="legend-title">Pressure, bar</div>
          <div className="legend-gradient" style={{ background: SEQUENTIAL_GRADIENT }} />
          <div className="legend-scale">
            <span>{pressureRange.min.toFixed(2)}</span>
            <span>{pressureRange.max.toFixed(2)}</span>
          </div>
        </>
      )}
      {colorBy === 'velocity' && (
        <>
          <div className="legend-title">Velocity, m/s</div>
          <div className="legend-gradient" style={{ background: SEQUENTIAL_GRADIENT }} />
          <div className="legend-scale">
            <span>0</span>
            <span>{velocityMax.toFixed(1)}</span>
          </div>
          <div className="legend-row">
            <svg width="26" height="10" aria-hidden="true">
              <line x1="1" y1="5" x2="25" y2="5" stroke={STATUS.critical} strokeWidth={5} strokeLinecap="round" />
            </svg>
            <span>Above {limit} m/s</span>
          </div>
        </>
      )}
      <div className="legend-divider" />
      <div className="legend-row">
        <svg width="18" height="18" viewBox="-9 -9 18 18" aria-hidden="true">
          <circle r="6.5" fill={STATUS.good} stroke="#0a7f0a" strokeWidth="1.5" />
          <path d="M -3 0.2 L -0.8 2.5 L 3.2 -2.3" fill="none" stroke="#fff" strokeWidth="1.6" />
        </svg>
        <span>Flowing, meets requirement</span>
      </div>
      <div className="legend-row">
        <svg width="18" height="18" viewBox="-9 -9 18 18" aria-hidden="true">
          <circle r="6.5" fill={STATUS.critical} stroke="#a22828" strokeWidth="1.5" />
          <path d="M -2.5 -2.5 L 2.5 2.5 M -2.5 2.5 L 2.5 -2.5" stroke="#fff" strokeWidth="1.6" />
        </svg>
        <span>Flowing, below requirement</span>
      </div>
      <div className="legend-row">
        <svg width="18" height="18" viewBox="-9 -9 18 18" aria-hidden="true">
          <circle r="6.5" fill="#fcfcfb" stroke="#52514e" strokeWidth="1.5" />
        </svg>
        <span>Closed</span>
      </div>
      <div className="legend-row">
        <svg width="18" height="18" viewBox="-9 -9 18 18" aria-hidden="true">
          <ValveSymbol type="gate" closed={false} forward />
        </svg>
        <span>Valve open</span>
      </div>
      <div className="legend-row">
        <svg width="18" height="18" viewBox="-9 -9 18 18" aria-hidden="true">
          <ValveSymbol type="gate" closed forward />
        </svg>
        <span>Valve closed</span>
      </div>
    </div>
  );
}
