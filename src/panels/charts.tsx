import { useMemo } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { Project } from '../model/types';
import {
  criticalPath,
  fitPumpCurve,
  pumpHead,
  systemCurve,
  type CriticalPath,
  type FittedCurve,
  type SolveResults,
  type SystemPoint,
} from '../solver';
import { useResults, useStore } from '../state/store';

export const CHART = {
  grid: '#e1e0d9',
  axis: '#c3c2b7',
  muted: '#6f6d68',
  ink: '#0b0b0b',
  series1: '#2a78d6',
  series2: '#eb6834',
  critical: '#d03b3b',
  surface: '#fcfcfb',
};

const TICK = { fontSize: 11, fill: CHART.muted };
const TOOLTIP_STYLE = { fontSize: 12, border: `1px solid ${CHART.axis}`, borderRadius: 3 };

export function curveSamples(fit: FittedCurve, extendToLpm = 0, count = 41): { flow: number; head: number }[] {
  const finite = Number.isFinite(fit.maxFlowLpm) ? fit.maxFlowLpm : Math.max(extendToLpm, 4000);
  const top = Math.max(finite, extendToLpm);
  return Array.from({ length: count }, (_, i) => {
    const flow = (top * i) / (count - 1);
    return { flow: Math.round(flow), head: +pumpHead(fit, flow).toFixed(2) };
  });
}

/** Small pump curve in the properties panel. */
export function PumpMiniChart({
  fit,
  operating,
}: {
  fit: FittedCurve;
  operating: { flowLpm: number; headM: number } | null;
}) {
  const data = useMemo(() => curveSamples(fit, operating?.flowLpm ?? 0), [fit, operating?.flowLpm]);
  return (
    <div className="mini-chart" data-testid="pump-mini-chart">
      <ResponsiveContainer width="100%" height={150}>
        <LineChart data={data} margin={{ top: 8, right: 10, bottom: 14, left: 0 }}>
          <CartesianGrid stroke={CHART.grid} vertical={false} />
          <XAxis
            dataKey="flow"
            type="number"
            domain={[0, 'dataMax']}
            tick={{ fontSize: 10, fill: CHART.muted }}
            stroke={CHART.axis}
            label={{ value: 'Flow, LPM', position: 'insideBottom', offset: -6, fontSize: 10, fill: CHART.muted }}
          />
          <YAxis width={36} tick={{ fontSize: 10, fill: CHART.muted }} stroke={CHART.axis} domain={[0, 'auto']} />
          <Tooltip
            formatter={(v: number) => [`${v} m`, 'Head']}
            labelFormatter={(l) => `${l} LPM`}
            contentStyle={{ fontSize: 11 }}
          />
          <Line dataKey="head" stroke={CHART.series1} strokeWidth={2} dot={false} isAnimationActive={false} />
          {operating && operating.flowLpm > 0 && (
            <ReferenceDot x={operating.flowLpm} y={operating.headM} r={5} fill={CHART.series2} stroke={CHART.surface} strokeWidth={2} />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function interpolate(points: SystemPoint[], flow: number): number | null {
  if (points.length < 2 || flow < points[0].flowLpm || flow > points[points.length - 1].flowLpm) return null;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (flow >= a.flowLpm && flow <= b.flowLpm) {
      const span = b.flowLpm - a.flowLpm;
      return span === 0 ? a.headM : a.headM + ((b.headM - a.headM) * (flow - a.flowLpm)) / span;
    }
  }
  return null;
}

export interface PumpSystemData {
  rows: { flow: number; pump: number; system: number | null }[];
  operating: { flowLpm: number; headM: number } | null;
}

export function pumpSystemData(project: Project, results: SolveResults): PumpSystemData | null {
  const pump = project.pumps[0];
  if (!pump || !results.ok) return null;
  let fit: FittedCurve;
  try {
    fit = fitPumpCurve(pump.curve);
  } catch {
    return null;
  }
  const system = systemCurve(project, undefined, results);
  const operating = results.system.pumpFlowLpm > 0
    ? { flowLpm: results.system.pumpFlowLpm, headM: results.system.pumpHeadM }
    : null;
  const finite = Number.isFinite(fit.maxFlowLpm) ? fit.maxFlowLpm : 0;
  const top = Math.max(finite, (operating?.flowLpm ?? 0) * 1.25, 1000);
  const count = 60;
  const flows = Array.from({ length: count + 1 }, (_, i) => (top * i) / count);
  if (operating) flows.push(operating.flowLpm);
  flows.sort((a, b) => a - b);
  const rows = flows.map((flow) => {
    const s = interpolate(system, flow);
    return {
      flow: Math.round(flow),
      pump: +pumpHead(fit, flow).toFixed(2),
      system: s === null ? null : +s.toFixed(2),
    };
  });
  return { rows, operating };
}

/** Pump and system curves on one head axis. Fixed size when width is given. */
export function PumpSystemChart({
  data,
  width,
  height = 240,
}: {
  data: PumpSystemData;
  width?: number;
  height?: number;
}) {
  const chart = (
    <LineChart width={width} height={height} data={data.rows} margin={{ top: 10, right: 18, bottom: 18, left: 4 }}>
      <CartesianGrid stroke={CHART.grid} vertical={false} />
      <XAxis
        dataKey="flow"
        type="number"
        domain={[0, 'dataMax']}
        tick={TICK}
        stroke={CHART.axis}
        label={{ value: 'Flow, LPM', position: 'insideBottom', offset: -8, fontSize: 11, fill: CHART.muted }}
      />
      <YAxis
        tick={TICK}
        stroke={CHART.axis}
        width={44}
        domain={[0, 'auto']}
        label={{ value: 'Head, m', angle: -90, position: 'insideLeft', offset: 10, fontSize: 11, fill: CHART.muted }}
      />
      {width === undefined && (
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          formatter={(v: number, name: string) => [`${v} m`, name]}
          labelFormatter={(l) => `${l} LPM`}
        />
      )}
      <Legend verticalAlign="top" height={22} iconType="plainline" wrapperStyle={{ fontSize: 12 }} />
      <Line name="Pump curve" dataKey="pump" stroke={CHART.series1} strokeWidth={2} dot={false} isAnimationActive={false} />
      <Line name="System curve" dataKey="system" stroke={CHART.series2} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
      {data.operating && (
        <ReferenceDot
          x={Math.round(data.operating.flowLpm)}
          y={data.operating.headM}
          r={6}
          fill={CHART.ink}
          stroke={CHART.surface}
          strokeWidth={2}
          label={{
            value: `${data.operating.flowLpm.toFixed(0)} LPM, ${data.operating.headM.toFixed(1)} m`,
            position: 'top',
            fontSize: 11,
            fill: CHART.ink,
          }}
        />
      )}
    </LineChart>
  );
  if (width !== undefined) return chart;
  return (
    <ResponsiveContainer width="100%" height={height}>
      {chart}
    </ResponsiveContainer>
  );
}

export interface ProfileData {
  rows: { distance: number; pressure: number; label: string }[];
  requiredBar: number | null;
}

export function profileData(path: CriticalPath, results: SolveResults, pumpLabel: string): ProfileData {
  const rows = [
    { distance: 0, pressure: +path.startPressureBar.toFixed(3), label: pumpLabel },
    ...path.segments.map((s) => ({
      distance: +s.distanceAfterM.toFixed(1),
      pressure: +s.pressureAfterBar.toFixed(3),
      label: s.toLabel,
    })),
  ];
  const target = results.nodes.find((n) => n.id === path.targetId);
  return { rows, requiredBar: target?.requiredPressureBar ?? null };
}

export function PressureProfileChart({
  data,
  width,
  height = 240,
}: {
  data: ProfileData;
  width?: number;
  height?: number;
}) {
  const chart = (
    <LineChart width={width} height={height} data={data.rows} margin={{ top: 10, right: 18, bottom: 18, left: 4 }}>
      <CartesianGrid stroke={CHART.grid} vertical={false} />
      <XAxis
        dataKey="distance"
        type="number"
        domain={[0, 'dataMax']}
        tick={TICK}
        stroke={CHART.axis}
        label={{ value: 'Distance along path, m', position: 'insideBottom', offset: -8, fontSize: 11, fill: CHART.muted }}
      />
      <YAxis
        tick={TICK}
        stroke={CHART.axis}
        width={44}
        domain={[0, 'auto']}
        label={{ value: 'Pressure, bar', angle: -90, position: 'insideLeft', offset: 10, fontSize: 11, fill: CHART.muted }}
      />
      {width === undefined && (
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          formatter={(v: number) => [`${v} bar`, 'Pressure']}
          labelFormatter={(_, payload) => {
            const row = payload?.[0]?.payload as ProfileData['rows'][number] | undefined;
            return row ? `${row.label} · ${row.distance} m` : '';
          }}
        />
      )}
      {data.requiredBar !== null && (
        <ReferenceLine
          y={data.requiredBar}
          stroke={CHART.critical}
          strokeDasharray="5 4"
          label={{ value: `Minimum ${data.requiredBar} bar`, position: 'insideBottomRight', fontSize: 11, fill: CHART.critical }}
        />
      )}
      <Line dataKey="pressure" stroke={CHART.series1} strokeWidth={2} dot={{ r: 2.5, fill: CHART.series1 }} isAnimationActive={false} />
    </LineChart>
  );
  if (width !== undefined) return chart;
  return (
    <ResponsiveContainer width="100%" height={height}>
      {chart}
    </ResponsiveContainer>
  );
}

export function ChartsTab() {
  const project = useStore((s) => s.project);
  const results = useResults();
  const pumpData = useMemo(() => pumpSystemData(project, results), [project, results]);
  const path = useMemo(() => criticalPath(project, results), [project, results]);
  const profile = useMemo(
    () => (path ? profileData(path, results, project.pumps[0]?.label ?? 'Pump') : null),
    [path, results, project.pumps],
  );
  if (!pumpData) return <p className="empty">Add a pump and solve the network to see the charts.</p>;
  return (
    <div className="charts" data-testid="charts">
      <figure>
        <figcaption>Pump and system curves</figcaption>
        <PumpSystemChart data={pumpData} height={222} />
      </figure>
      <figure>
        <figcaption>Pressure along the critical path</figcaption>
        {profile ? (
          <PressureProfileChart data={profile} height={222} />
        ) : (
          <p className="empty">Open a hydrant to see the pressure profile.</p>
        )}
      </figure>
    </div>
  );
}
