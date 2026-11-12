import type { Pipe } from '../model/types';

/**
 * Diameter classes. Colour follows the size, and width is a second encoding so
 * identity never depends on hue alone. 32 and 40 mm share a class to stay within
 * the eight validated categorical slots.
 */
export interface DiameterClass {
  label: string;
  sizes: number[];
  color: string;
  width: number;
}

export const DIAMETER_CLASSES: DiameterClass[] = [
  { label: '200', sizes: [200], color: '#6250d6', width: 5.5 },
  { label: '150', sizes: [150], color: '#2a78d6', width: 4.5 },
  { label: '100', sizes: [100], color: '#eda100', width: 3.5 },
  { label: '80', sizes: [80], color: '#eb6834', width: 3 },
  { label: '65', sizes: [65], color: '#e87ba4', width: 2.5 },
  { label: '50', sizes: [50], color: '#008300', width: 2.2 },
  { label: '32–40', sizes: [32, 40], color: '#e34948', width: 1.8 },
  { label: '25', sizes: [25], color: '#1baf7a', width: 1.5 },
];

export const CUSTOM_CLASS: DiameterClass = { label: 'Custom', sizes: [], color: '#898781', width: 2.5 };

export function diameterClass(pipe: Pipe): DiameterClass {
  if (typeof pipe.nominalMm !== 'number') return CUSTOM_CLASS;
  return DIAMETER_CLASSES.find((c) => c.sizes.includes(pipe.nominalMm as number)) ?? CUSTOM_CLASS;
}

/** Sequential blue ramp, stopped at a step that stays visible on the light canvas. */
const SEQUENTIAL = ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#104281', '#0d366b'];

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  const channel = (x: number, y: number) => Math.round(x + (y - x) * t);
  return `rgb(${channel(ar, br)}, ${channel(ag, bg)}, ${channel(ab, bb)})`;
}

export function sequentialColor(t: number): string {
  const clamped = Math.min(Math.max(t, 0), 1);
  const pos = clamped * (SEQUENTIAL.length - 1);
  const i = Math.min(Math.floor(pos), SEQUENTIAL.length - 2);
  return mix(SEQUENTIAL[i], SEQUENTIAL[i + 1], pos - i);
}

export const SEQUENTIAL_GRADIENT = `linear-gradient(90deg, ${SEQUENTIAL.join(', ')})`;

export const STATUS = {
  good: '#0ca30c',
  critical: '#d03b3b',
  muted: '#898781',
};
