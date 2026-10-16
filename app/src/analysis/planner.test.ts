import { describe, expect, it } from 'vitest';
import type { Matchup, Player, StatLine } from '../domain/types';
import { parseLeague, parseMatchup, parseRoster, type ProjectionIndex } from '../sleeper/parse';
import { gamesByTeam, type WeekContext } from './analyze';
import { buildOutlook } from './outlook';
import { planWeeks } from './planner';

// Four teams, weeks 7–11 regular season, a one-round playoff in week 12. It's week 6.
const league = parseLeague({
  league_id: 'P',
  name: 'Plan',
  season: '2026',
  status: 'in_season',
  total_rosters: 4,
  roster_positions: ['QB', 'RB', 'WR', 'TE', 'BN', 'BN'],
  scoring_settings: { pass_yd: 0.04, pass_td: 4, rush_yd: 0.1, rush_td: 6, rec: 1, rec_yd: 0.1, rec_td: 6 },
  settings: { type: 0, num_teams: 4, playoff_week_start: 12, playoff_teams: 2, last_scored_leg: 6 },
});

type Spec = [id: string, pos: string, team: string, stats: StatLine, injury?: Player['injury']];
const SPECS: Spec[] = [
  ['q1', 'QB', 'AAA', { pass_yd: 260, pass_td: 2 }],
  ['r1', 'RB', 'BBB', { rush_yd: 60, rush_td: 0.4 }],
  // Out now, Sleeper projects him again from week 10; better than r1 when healthy.
  ['r2', 'RB', 'EEE', { rush_yd: 95, rush_td: 0.8 }, 'Out'],
  ['w1', 'WR', 'CCC', { rec: 6, rec_yd: 80 }],
  ['w2', 'WR', 'FFF', { rec: 3, rec_yd: 35 }],
  // His team (DDD) is off in week 9, and nobody else on the roster plays TE.
  ['t1', 'TE', 'DDD', { rec: 5, rec_yd: 55 }],
  ['fte', 'TE', 'GGG', { rec: 4, rec_yd: 40 }],
  ['frb', 'RB', 'HHH', { rush_yd: 30 }],
  // r2's team plays while he's out: a team with no projected player at all would look like a bye.
  ['fe', 'WR', 'EEE', { rec: 1, rec_yd: 10 }],
  ['o1', 'QB', 'III', { pass_yd: 230, pass_td: 1.5 }],
  ['o2', 'RB', 'JJJ', { rush_yd: 70, rush_td: 0.5 }],
];
const players = new Map(SPECS.map(([id, pos, team, , injury]) => [id, { id, name: id, pos, fpos: [pos], team, injury: injury ?? null } as Player]));

function index(week: number): ProjectionIndex {
  const rows = SPECS.filter(([id, , team]) => !(week === 9 && team === 'DDD') && !(id === 'r2' && week < 10));
  return {
    byPlayer: new Map(rows.map(([id, , team, stats]) => [id, { playerId: id, week, stats, team }])),
    players: new Map(),
    statKeys: new Set(),
  };
}

const rosters = [
  parseRoster({ roster_id: 1, owner_id: 'u1', players: ['q1', 'r1', 'r2', 'w1', 'w2', 't1'], starters: [] }),
  parseRoster({ roster_id: 2, owner_id: 'u2', players: ['o1', 'o2'], starters: [] }),
  parseRoster({ roster_id: 3, owner_id: 'u3', players: [], starters: [] }),
  parseRoster({ roster_id: 4, owner_id: 'u4', players: [], starters: [] }),
];
const pair = (...ps: Array<[number, number]>): Matchup[] =>
  ps.flatMap(([a, b], m) => [a, b].map((r) => parseMatchup({ roster_id: r, matchup_id: m + 1, starters: [], players: [], points: 0 })));
const now = Date.UTC(2026, 9, 15, 12);
const ctx: WeekContext = { season: '2026', week: 6, now, players, projections: index(6), gamesByTeam: gamesByTeam([], 6) };

function plan(weeks: number[]) {
  const byWeek = new Map(weeks.map((w) => [w, index(w)]));
  const schedule = new Map([7, 8, 9, 10, 11].map((w) => [w, w % 2 ? pair([1, 2], [3, 4]) : pair([1, 3], [2, 4])]));
  const o = buildOutlook({ league, rosters, users: [], matchups: pair([1, 4], [2, 3]), ctx, byWeek, schedule, sims: 500 });
  return planWeeks(o, 1);
}

describe('planWeeks', () => {
  const weeks = plan([7, 8, 9, 10, 11, 12]);
  const at = (w: number) => weeks.find((x) => x.week === w)!;

  it('covers every week to the end of the season, with the playoff week labelled', () => {
    expect(weeks.map((w) => w.week)).toEqual([7, 8, 9, 10, 11, 12]);
    expect(at(7).opponent).toBe(2);
    expect(at(7).winProb).toBeGreaterThan(0.5);
    expect(at(12).playoff).toMatchObject({ round: 1, rounds: 1 });
    expect(at(12).opponent).toBeNull();
    expect(at(12).rank).toBe(1);
  });

  it('flags a regular starter on bye, the slot it opens, and the free agent who fills it', () => {
    expect(at(9).byes).toEqual(['t1']);
    expect(at(9).open).toBe(1);
    expect(at(9).pickup?.id).toBe('fte');
    // The free-agent TE's expected points that week: 4 + 4 = 8 if he plays, times his chance to play three weeks out.
    expect(at(9).pickup!.gain).toBeGreaterThan(6);
    expect(at(8).byes).toEqual([]);
  });

  it("names a regular starter Sleeper doesn't project, and the week he's back", () => {
    for (const w of [7, 8, 9]) expect(at(w).unprojected).toEqual(['r2']);
    expect(at(10).unprojected).toEqual([]);
    expect(at(10).back).toEqual(['r2']);
    expect(weeks.filter((w) => w.back.length).map((w) => w.week)).toEqual([10]);
    // A hole, but no free agent beats r1 at RB or t1 at TE by a point: no pickup to name.
    expect(at(7).pickup).toBeUndefined();
  });

  it("judges nothing in a week whose projections didn't load", () => {
    const missing = plan([7, 8, 10, 11, 12]);
    const w9 = missing.find((w) => w.week === 9)!;
    expect(w9.byes).toEqual([]);
    expect(w9.unprojected).toEqual([]);
    expect(w9.open).toBe(0);
    expect(w9.pickup).toBeUndefined();
  });
});
