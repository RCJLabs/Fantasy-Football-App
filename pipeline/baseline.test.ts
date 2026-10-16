import { describe, expect, it } from 'vitest';
import type { StatLine } from '../app/src/domain/types';
import { averageLine, BASELINE_V0, type BaselineGame, baselineStats, buildBaselineFile, ffoppStats, impliedFactor, type SleeperRow, trailingMean } from './baseline';

const p = { ...BASELINE_V0, halfLife: 1, maxGames: 3, priorSeasonWeight: 0.5, shrinkGames: 1, elasticity: 1 };
const game = (season: number, week: number, rec: number, implied?: number): BaselineGame => ({ season, week, stats: rec ? { rec } : {}, ...(implied !== undefined ? { implied } : {}) });

describe('baseline v0', () => {
  it('maps ffopportunity columns to Sleeper keys, expected values where they exist', () => {
    const line = ffoppStats({ receptions: '9', receptions_exp: '6.5', rec_attempt: '10', rec_yards_gained_exp: '71.2', pass_attempt: '0', rush_touchdown_exp: 'NA', rec_fumble_lost: '1', rush_fumble_lost: '0' });
    expect(line).toEqual({ rec: 6.5, rec_tgt: 10, rec_yd: 71.2, fum_lost: 1 });
  });

  it('weights recent games more and last season less, skipping beyond maxGames', () => {
    const t = trailingMean([game(2025, 17, 8, 20), game(2026, 2, 4, 24), game(2026, 1, 0), game(2025, 18, 6, 22)], 2026, p)!;
    // Most recent first: w2 (weight 1), w1 (0.5), 2025 w18 (0.25 × 0.5); 2025 w17 is the fourth game, dropped.
    const w = 1 + 0.5 + 0.125;
    expect(t.weight).toBeCloseTo(w);
    expect(t.stats.rec).toBeCloseTo((4 + 0 + 6 * 0.125) / w);
    // Implied totals average only over games that had lines.
    expect(t.implied).toBeCloseTo((24 + 22 * 0.125) / 1.125);
    expect(trailingMean([], 2026, p)).toBeUndefined();
  });

  it('scales by this week’s implied total over the games averaged, bounded, and only with both', () => {
    expect(impliedFactor(20, 25, p)).toBeCloseTo(1.25);
    expect(impliedFactor(20, 25, { ...p, elasticity: 0.5 })).toBeCloseTo(Math.sqrt(1.25));
    expect(impliedFactor(10, 30, p)).toBe(p.maxFactor);
    expect(impliedFactor(30, 10, p)).toBe(p.minFactor);
    expect(impliedFactor(undefined, 25, p)).toBe(1);
    expect(impliedFactor(20, undefined, p)).toBe(1);
  });

  it('shrinks toward the position average by shrinkGames pseudo-games', () => {
    const t = { stats: { rec: 8, rush_yd: 10 }, weight: 3, implied: 20 };
    const prior = { rec: 4, rec_td: 0.2 };
    const out = baselineStats(t, prior, 22, p);
    const f = 22 / 20;
    expect(out.rec).toBeCloseTo(((8 * 3 + 4) / 4) * f);
    expect(out.rush_yd).toBeCloseTo(((10 * 3) / 4) * f);
    expect(out.rec_td).toBeCloseTo((0.2 / 4) * f);
  });

  it('averages lines with missing keys as zeros', () => {
    expect(averageLine([{ rec: 4 }, { rec: 2, rec_td: 1 }])).toEqual({ rec: 3, rec_td: 0.5 });
    expect(averageLine([])).toEqual({});
  });
});

describe('baseline.json', () => {
  const src = {
    gsisBySleeper: new Map([['wr', 'G-WR'], ['rb', 'G-RB'], ['fa', 'G-FA']]),
    expected: new Map<string, StatLine>([
      ['G-WR|2025|18', { rec: 4, rec_yd: 40 }],
      ['G-WR|2026|1', { rec: 6, rec_yd: 70 }],
      ['G-RB|2026|1', { rush_att: 10, rush_yd: 40 }],
      ['G-FA|2026|1', { rec: 1 }],
      // 2026 week 2 isn't in ffopportunity yet.
    ]),
    implied: new Map([['2025|18|KC', 20], ['2026|1|KC', 25], ['2026|1|LV', 20], ['2026|3|KC', 25]]),
  };
  const row = (id: string, position: string, team: string): SleeperRow => ({ player_id: id, position, team, stats: { gp: 1 } });
  const weeks = [
    { season: 2025, week: 18, stats: [row('wr', 'WR', 'KC')] },
    { season: 2026, week: 1, stats: [row('wr', 'WR', 'KC'), row('rb', 'RB', 'LV'), row('fa', 'WR', 'LV')] },
    { season: 2026, week: 2, stats: [row('wr', 'WR', 'KC')] }, // not processed by ffopportunity: left out, not counted as a zero
    { season: 2026, week: 3, stats: [row('wr', 'WR', 'KC')] }, // this week: never in its own average
  ];
  // fa was released: no team now, but he is in the position average, as in the backtest.
  const players = [{ id: 'wr', pos: 'WR', team: 'KC' }, { id: 'rb', pos: 'RB', team: 'LV' }, { id: 'fa', pos: 'WR', team: null }];
  const params = { ...BASELINE_V0, halfLife: Infinity, priorSeasonWeight: 1 };
  const r2 = (x: number) => Math.round(x * 100) / 100;

  it('averages only earlier weeks that ffopportunity covers, and publishes teams that play', () => {
    const file = buildBaselineFile({ season: 2026, week: 3, now: 'T', weeks, players, playing: new Set(['KC']), ...src, params: { ...params, shrinkGames: 0 } })!;
    expect(file).toMatchObject({ schemaVersion: 1, season: '2026', week: 3, throughWeek: 1 });
    expect(Object.keys(file.players)).toEqual(['wr']); // LV is on bye; fa has no team
    // 2025 w18 (implied 20) and 2026 w1 (implied 25): means 5 rec and 55 yards, × 25 / 22.5.
    expect(file.players.wr).toEqual({ rec: r2(5 * (25 / 22.5)), rec_yd: r2(55 * (25 / 22.5)) });
  });

  it('shrinks toward the average of everyone at the position', () => {
    const file = buildBaselineFile({ season: 2026, week: 3, now: 'T', weeks, players, playing: new Set(['KC']), ...src, params: { ...params, shrinkGames: 1 } })!;
    // WR average of wr (5 rec, 55 yd) and fa (1 rec): 3 rec and 27.5 yd, as one pseudo-game next to wr's two.
    const f = 25 / 22.5;
    expect(file.players.wr).toEqual({ rec: r2(((5 * 2 + 3) / 3) * f), rec_yd: r2(((55 * 2 + 27.5) / 3) * f) });
  });

  it('is null when no team plays or nobody has a game to average', () => {
    expect(buildBaselineFile({ season: 2026, week: 3, now: 'T', weeks, players, playing: new Set(), ...src })).toBeNull();
    expect(buildBaselineFile({ season: 2026, week: 3, now: 'T', weeks: [], players, playing: new Set(['KC']), ...src })).toBeNull();
  });
});
