import { describe, expect, it } from 'vitest';
import { niceAxis } from '../charts';

describe('chart axes', () => {
  it('rounds the maximum up to an even step from zero', () => {
    expect(niceAxis(4809)).toEqual({ max: 5000, ticks: [0, 1000, 2000, 3000, 4000, 5000] });
    expect(niceAxis(180)).toEqual({ max: 200, ticks: [0, 50, 100, 150, 200] });
    expect(niceAxis(805.1)).toEqual({ max: 1000, ticks: [0, 200, 400, 600, 800, 1000] });
  });

  it('handles fractional ranges without floating-point noise', () => {
    expect(niceAxis(10.8).ticks).toEqual([0, 2.5, 5, 7.5, 10, 12.5]);
    expect(niceAxis(0.37).ticks).toEqual([0, 0.1, 0.2, 0.3, 0.4]);
  });

  it('falls back to a unit axis when there is nothing to show', () => {
    expect(niceAxis(0)).toEqual({ max: 1, ticks: [0, 1] });
    expect(niceAxis(Number.NaN)).toEqual({ max: 1, ticks: [0, 1] });
  });
});
