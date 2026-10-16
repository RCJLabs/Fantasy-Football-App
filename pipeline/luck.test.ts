import { describe, expect, it } from 'vitest';
import { correlation, luckRows, type PlayerWeek, slope } from './luck';

const week = (w: number, actual: number, xfp: number | undefined, proj: number | undefined, played = true): PlayerWeek => ({
  season: 2024,
  week: w,
  player: 'p',
  pos: 'WR',
  played,
  actual,
  ...(xfp !== undefined ? { xfp } : {}),
  ...(proj !== undefined ? { proj } : {}),
});

describe('luck rows', () => {
  const rows = luckRows([
    week(1, 20, 12, 10),
    week(2, 18, 12, 11),
    week(3, 0, undefined, 11, false), // out
    week(4, 22, 14, 12),
    week(5, 9, 13, 13),
    week(6, 10, undefined, 12), // played; no usage data yet
    week(7, 12, 12, 4), // projected under 5
  ]);

  it('starts once three games with usage data are behind a projected week', () => {
    expect(rows.map((r) => r.week)).toEqual([5, 6]);
  });

  it('measures luck as points a game above what the usage was worth', () => {
    expect(rows[0]).toMatchObject({ games: 3, recent: 20, actual: 9, proj: 13 });
    expect(rows[0]!.usage).toBeCloseTo(38 / 3);
    expect(rows[0]!.luck).toBeCloseTo(20 - 38 / 3);
    // The window keeps the last four games.
    expect(rows[1]).toMatchObject({ games: 4, recent: 17.25, usage: 12.75 });
  });

  it('averages this week and the next three he played with a projection of 5+', () => {
    expect(rows[0]!.ahead).toEqual({ n: 2, proj: 12.5, actual: 9.5 });
    expect(rows[1]!.ahead).toEqual({ n: 1, proj: 12, actual: 10 });
  });
});

describe('fit helpers', () => {
  it('fits a line and a correlation', () => {
    expect(slope([1, 2, 3], [2, 4, 6])).toEqual({ b: 2, a: 0 });
    expect(slope([], [])).toEqual({ b: 0, a: 0 });
    expect(correlation([1, 2, 3], [3, 2, 1])).toBeCloseTo(-1);
    expect(correlation([1, 1, 1], [3, 2, 1])).toBe(0);
  });
});
