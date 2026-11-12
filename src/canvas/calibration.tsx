import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { recomputeLengths } from '../model/edit';
import { useStore } from '../state/store';

interface Point {
  x: number;
  y: number;
}

/**
 * Two-point scale calibration. The user clicks two points on the drawing and
 * types the real distance. Non-manual pipe lengths then follow the new scale.
 */
export function useCalibration(): {
  points: Point[];
  addPoint: (p: Point) => void;
  dialog: ReactNode;
} {
  const tool = useStore((s) => s.tool);
  const setTool = useStore((s) => s.setTool);
  const update = useStore((s) => s.update);
  const showToast = useStore((s) => s.showToast);
  const [points, setPoints] = useState<Point[]>([]);
  const [distance, setDistance] = useState('');

  useEffect(() => {
    if (tool !== 'calibrate') setPoints([]);
  }, [tool]);

  const addPoint = useCallback((p: Point) => {
    setPoints((current) => (current.length >= 2 ? [p] : [...current, p]));
  }, []);

  const apply = () => {
    const real = Number(distance);
    if (points.length !== 2 || !(real > 0)) return;
    const drawn = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
    if (drawn === 0) return;
    const scale = real / drawn;
    update((d) => {
      d.metersPerUnit = scale;
      recomputeLengths(d);
    });
    showToast(`Scale set: 1 drawing unit = ${scale.toPrecision(4)} m. Pipe lengths updated.`);
    setDistance('');
    setTool('select');
  };

  let dialog: ReactNode = null;
  if (tool === 'calibrate') {
    dialog = (
      <div className="calibrate-box" data-testid="calibrate-box">
        {points.length < 2 ? (
          <span>
            Scale calibration: click point {points.length + 1} of 2 on the drawing.
          </span>
        ) : (
          <>
            <label>
              Real distance between the points
              <span className="input-unit">
                <input
                  autoFocus
                  type="number"
                  min="0"
                  step="any"
                  value={distance}
                  data-testid="calibrate-distance"
                  onChange={(e) => setDistance(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') apply();
                  }}
                />
                <em>m</em>
              </span>
            </label>
            <button className="btn primary" onClick={apply} disabled={!(Number(distance) > 0)} data-testid="calibrate-apply">
              Set scale
            </button>
          </>
        )}
        <button className="btn" onClick={() => setTool('select')}>
          Cancel
        </button>
      </div>
    );
  }
  return { points, addPoint, dialog };
}
