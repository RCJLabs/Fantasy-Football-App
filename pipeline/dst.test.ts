import { describe, expect, it } from 'vitest';
import type { SleeperRow } from './baseline';
import { type DefGame, defGames, DST_V0, dstStats, dstWeek, leagueRates, teamRate } from './dst';

const game = (season: number, week: number, team: string, opp: string, stats: Record<string, number>, home?: boolean, oppImplied?: number): DefGame => ({
  season,
  week,
  team,
  opp,
  stats,
  ...(home !== undefined ? { home } : {}),
  ...(oppImplied !== undefined ? { oppImplied } : {}),
});

describe('team defense v0', () => {
  const history = [
    game(2026, 1, 'AAA', 'BBB', { sack: 4, int: 2, fum_rec: 0, pts_allow: 17, def_td: 1, safe: 0 }, true, 20),
    game(2026, 1, 'BBB', 'AAA', { sack: 2, int: 0, fum_rec: 0, pts_allow: 24, safe: 1 }, false, 23),
    game(2026, 2, 'AAA', 'CCC', { sack: 2, int: 0, fum_rec: 1, pts_allow: 21 }, false, 22),
    game(2026, 2, 'CCC', 'AAA', { sack: 0, int: 1, fum_rec: 1, pts_allow: 27 }, true, 26),
  ];

  it('measures league rates: the points-allowed gap, home factors and TDs per takeaway', () => {
    const l = leagueRates(history);
    expect(l.mean.sack).toBe(2);
    expect(l.ptsGap).toBeCloseTo(((17 - 20) + (24 - 23) + (21 - 22) + (27 - 26)) / 4, 9);
    // Home defenses averaged 2 sacks, away 2: no factor.
    expect(l.home.sack).toBe(1);
    // Interceptions: home 1.5 a game, away 0 → home ×2, away ×0.
    expect(l.home.int).toBe(2);
    expect(l.tdPerTakeaway).toBeCloseTo(0.25 / (0.75 + 0.5), 9);
  });

  it('shrinks a team rate toward the league by shrinkGames pseudo-games', () => {
    const r = teamRate([{ season: 2026, week: 1, stats: { sack: 6 } }], 2026, { sack: 2 }, { ...DST_V0, shrinkGames: 1, halfLife: Infinity });
    expect(r.sack).toBe(4);
  });

  it('combines the defense with what the opponent has allowed, and takes points allowed from the line', () => {
    const p = { ...DST_V0, shrinkGames: 0, halfLife: Infinity };
    const l = { ...leagueRates(history), home: { sack: 1, int: 1, fum_rec: 1, ff: 1 } };
    const s = dstStats('AAA', 'BBB', true, 24, 2026, history, l, p);
    // AAA sacks 3 a game; BBB's offense allowed 4 (to AAA); league 2 → 3 × 4 / 2.
    expect(s.sack).toBeCloseTo(6, 9);
    expect(s.pts_allow).toBeCloseTo(24 + l.ptsGap, 9);
    expect(s.def_td).toBeCloseTo(((s.int ?? 0) + (s.fum_rec ?? 0)) * l.tdPerTakeaway, 9);
    expect(s.safe).toBe(l.mean.safe);
    // Without a line, points allowed fall back to the league average.
    expect(dstStats('AAA', 'BBB', undefined, undefined, 2026, history, l, p).pts_allow).toBe(l.mean.pts_allow);
  });

  it('turns Sleeper DEF rows into games and projects only from earlier weeks of this season and last', () => {
    const rows: SleeperRow[] = [
      { player_id: 'AAA', position: 'DEF', team: 'AAA', opponent: 'BBB', stats: { sack: 3, pts_allow: 10 } },
      { player_id: 'BBB', position: 'DEF', team: 'BBB', opponent: null, stats: { sack: 1, pts_allow: 3 } }, // no opponent
      { player_id: 'w1', position: 'WR', team: 'AAA', opponent: 'BBB', stats: { rec: 3 } },
    ];
    const context = new Map([['2026|3|AAA', { home: true, oppImplied: 19 }]]);
    expect(defGames(2026, 3, rows, context)).toEqual([{ season: 2026, week: 3, team: 'AAA', opp: 'BBB', home: true, oppImplied: 19, stats: { sack: 3, pts_allow: 10 } }]);

    const old = game(2024, 18, 'AAA', 'BBB', { sack: 50, pts_allow: 0 });
    const lines = dstWeek(2026, 2, [old, ...history], new Map([['AAA', 'CCC']]), new Map());
    expect(Object.keys(lines)).toEqual(['AAA']);
    // Week 2's own games and 2024's are left out: week 1 alone sets the league's 3 sacks a game.
    const wk1 = history.filter((g) => g.week === 1);
    expect(lines.AAA!.pts_allow).toBeCloseTo(wk1.reduce((a, g) => a + g.stats.pts_allow!, 0) / 2, 9);
    expect(dstWeek(2026, 1, history, new Map([['AAA', 'BBB']]), new Map())).toEqual({});
  });
});
