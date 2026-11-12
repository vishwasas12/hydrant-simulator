import type { ValveType } from '../model/types';

const INK = '#1c1b19';
const PAPER = '#fcfcfb';

/**
 * Valve symbol in the pipe's rotated frame. Open is hollow, closed is filled,
 * so state never depends on colour. A non-return valve points the way it lets
 * water through.
 */
export function ValveSymbol({ type, closed, forward }: { type: ValveType; closed: boolean; forward: boolean }) {
  const fill = closed ? INK : PAPER;
  if (type === 'nonReturn') {
    return (
      <g transform={forward ? undefined : 'rotate(180)'}>
        <path d="M -8 -6.5 L 6 0 L -8 6.5 Z" fill={fill} stroke={INK} strokeWidth={1.6} strokeLinejoin="round" />
        <path d="M 7.5 -7 L 7.5 7" stroke={INK} strokeWidth={2.2} />
      </g>
    );
  }
  return (
    <g>
      <path d="M -8 -6.5 L 8 6.5 L 8 -6.5 L -8 6.5 Z" fill={fill} stroke={INK} strokeWidth={1.6} strokeLinejoin="round" />
      {type === 'butterfly' && <circle r={2.4} fill={closed ? PAPER : INK} />}
    </g>
  );
}
