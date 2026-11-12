import type { FittingType } from '../model/types';

const STROKE = '#1c1b19';

/** Small symbols drawn on a pipe, in the pipe's own rotated frame. */
export function FittingIcon({ type }: { type: FittingType }) {
  const common = { fill: '#fcfcfb', stroke: STROKE, strokeWidth: 1.1 };
  switch (type) {
    case 'elbow90':
      return <path d="M -4 4 L -4 -4 L 4 -4" fill="none" stroke={STROKE} strokeWidth={1.8} />;
    case 'elbow45':
      return <path d="M -4 3 L 0 -3 L 5 -3" fill="none" stroke={STROKE} strokeWidth={1.8} />;
    case 'longRadiusBend':
      return <path d="M -4 4 Q -4 -4 4 -4" fill="none" stroke={STROKE} strokeWidth={1.8} />;
    case 'teeRun':
      return <path d="M -5 -3 L 5 -3 M 0 -3 L 0 4" fill="none" stroke={STROKE} strokeWidth={1.6} />;
    case 'teeBranch':
      return <path d="M -4 -4 L 4 -4 M 0 -4 L 0 4 M -2.5 2 L 0 4.5 L 2.5 2" fill="none" stroke={STROKE} strokeWidth={1.4} />;
    case 'gateValve':
      return <path d="M -5 -4 L 5 4 L 5 -4 L -5 4 Z" {...common} />;
    case 'butterflyValve':
      return (
        <g>
          <path d="M -5 -4 L 5 4 L 5 -4 L -5 4 Z" {...common} />
          <circle r={1.8} fill={STROKE} />
        </g>
      );
    case 'nonReturnValve':
      return (
        <g>
          <path d="M -5 -4 L 5 0 L -5 4 Z" {...common} />
          <path d="M 5 -4 L 5 4" stroke={STROKE} strokeWidth={1.4} />
        </g>
      );
    case 'reducer':
      return <path d="M -5 -4.5 L 5 -2 L 5 2 L -5 4.5 Z" {...common} />;
    case 'custom':
      return <rect x={-3.5} y={-3.5} width={7} height={7} {...common} />;
  }
}
