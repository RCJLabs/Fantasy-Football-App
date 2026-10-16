import { describe, expect, it } from 'vitest';
import type { StatLine } from '../app/src/domain/types';
import { BASELINE_V0 } from './baseline';
import type { SleeperRow } from './baseline';
import { type BacktestRow, blend, bootstrapByPlayer, comparable, earlyExitCheck, fitBlendWeight, gateTable, mae, walkForward, type WeekData } from './baseline-backtest';
import { SLEEPER_PPR } from './lib';

const params = { ...BASELINE_V0, shrinkGames: 0, priorSeasonWeight: 1, halfLife: Infinity };
const proj = (id: string, position: string, stats: Record<string, number>, team = 'KC'): SleeperRow => ({ player_id: id, position, team, stats });
const actual = (id: string, position: string, stats: Record<string, number>, team = 'KC'): SleeperRow => ({ player_id: id, position, team, stats: { gp: 1, ...stats } });

describe('baseline backtest', () => {
  const weeks: WeekData[] = [
    { season: 2025, week: 1, proj: [], stats: [actual('wr', 'WR', { rec: 5, rec_yd: 50 }), actual('qb', 'QB', { pass_yd: 250 })] },
    { season: 2026, week: 1, proj: [proj('wr', 'WR', { rec: 6, rec_yd: 60, pts_ppr: 99 }), proj('rookie', 'WR', { rec: 3 })], stats: [actual('wr', 'WR', { rec: 8, rec_yd: 100 }), actual('rookie', 'WR', { rec: 1 })] },
    // QB projection rows carry Sleeper's inflated pts_ppr; the backtest rescores from stats.
    {
      season: 2026,
      week: 2,
      proj: [proj('wr', 'WR', { rec: 6 }), proj('qb', 'QB', { pass_yd: 250, pass_int: 1, pts_ppr: 12 }), proj('idle', 'WR', { rec: 2 })],
      stats: [actual('wr', 'WR', { rec: 2 }), actual('qb', 'QB', { pass_yd: 200, pass_int: 1 }), actual('idle', 'WR', { gp: 0 })],
    },
  ];
  const gsisBySleeper = new Map([['wr', 'G-WR'], ['qb', 'G-QB'], ['rookie', 'G-RK']]);
  const expected = new Map<string, StatLine>([
    ['G-WR|2025|1', { rec: 4, rec_yd: 40 }],
    ['G-WR|2026|1', { rec: 7, rec_yd: 90 }],
    ['G-QB|2025|1', { pass_yd: 240, pass_int: 0.5 }],
  ]);
  const implied = new Map([['2025|1|KC', 20], ['2026|1|KC', 25], ['2026|2|KC', 25]]);
  const rows = walkForward({ weeks, seasons: [2026], gsisBySleeper, expected, implied, scoring: SLEEPER_PPR, params });
  const row = (id: string, week: number) => rows.find((r) => r.id === id && r.week === week)!;

  it('projects each week from earlier games only', () => {
    // Week 1 sees only 2025's expected 4 rec / 40 yd, scaled by 25/20.
    expect(row('wr', 1).baseline).toBeCloseTo((4 + 4) * 1.25);
    // Week 2 averages 2025 w1 (implied 20) and 2026 w1 (implied 25): (4+7)/2 rec, (40+90)/2 yd, × 25/22.5.
    expect(row('wr', 2).baseline).toBeCloseTo((5.5 + 6.5) * (25 / 22.5));
  });

  it('rescores RotoWire and actual stat lines with one scoring', () => {
    expect(row('wr', 1).rotowire).toBeCloseTo(12);
    expect(row('wr', 1).actual).toBeCloseTo(18);
    expect(row('qb', 2).rotowire).toBeCloseTo(9); // 250 × 0.04 − 1, not Sleeper's 12
  });

  it('leaves rookies without a baseline and skips players who did not play', () => {
    expect(row('rookie', 1).baseline).toBeUndefined();
    expect(rows.some((r) => r.id === 'idle')).toBe(false);
  });

  const r = (id: string, pos: string, rotowire: number, baseline: number | undefined, act: number): BacktestRow => ({ season: 2026, week: 1, id, pos, rotowire, actual: act, ...(baseline !== undefined ? { baseline } : {}) });

  it('compares on rows both project, where either calls the player relevant', () => {
    const set = [r('a', 'WR', 10, 8, 12), r('b', 'WR', 4, 6, 3), r('c', 'WR', 3, 2, 0), r('d', 'WR', 9, undefined, 9)];
    expect(comparable(set).map((x) => x.id)).toEqual(['a', 'b']);
    const wr = gateTable(set).find((g) => g.pos === 'WR')!;
    expect(wr.n).toBe(2);
    expect(wr.coverage).toBe(0.5); // of a and d (RotoWire ≥ 5), only a has a baseline
    expect(wr.rotowire.mae).toBe(1.5);
    expect(wr.baseline.mae).toBe(3.5);
    expect(wr.ratio).toBeCloseTo(3.5 / 1.5, 3);
  });

  it('fits the blend weight that minimises MAE, falling back to RotoWire without a baseline', () => {
    // Actual sits 30% of the way from RotoWire to the baseline every time.
    const set = Array.from({ length: 20 }, (_, i) => r(`p${i}`, 'TE', 10 + i, 20 + i, 13 + i));
    expect(fitBlendWeight(set)).toBeCloseTo(0.3);
    expect(blend(r('x', 'TE', 10, undefined, 0), 0.5)).toBe(10);
  });

  it('compares early exits with the projections before them', () => {
    const wk = (week: number, exitShare: number, exitProj: number): WeekData => ({
      season: 2026,
      week,
      proj: [proj('hurt', 'RB', { rec: exitProj }), proj('fine', 'RB', { rec: 10 })],
      stats: [actual('hurt', 'RB', { rec: 1, off_snp: exitShare * 60, tm_off_snp: 60 }), actual('fine', 'RB', { rec: 9, off_snp: 54, tm_off_snp: 60 })],
    });
    const check = earlyExitCheck([wk(1, 0.9, 10), wk(2, 0.9, 10), wk(3, 0.9, 10), wk(4, 0.1, 8)], SLEEPER_PPR);
    expect(check.earlyExit).toEqual({ n: 1, ratio: 0.8, projected: 8, actual: 1 });
    expect(check.normal).toMatchObject({ n: 1, ratio: 1 });
  });

  it('bootstraps over players reproducibly', () => {
    const set = Array.from({ length: 40 }, (_, i) => r(`p${i % 10}`, 'RB', 10, 10, 10 + (i % 7)));
    const stat = (s: readonly BacktestRow[]) => mae(s, (x) => x.rotowire);
    const ci = bootstrapByPlayer(set, stat, 500, 7);
    expect(ci).toEqual(bootstrapByPlayer(set, stat, 500, 7));
    expect(ci[0]).toBeLessThanOrEqual(stat(set));
    expect(ci[1]).toBeGreaterThanOrEqual(stat(set));
  });
});
