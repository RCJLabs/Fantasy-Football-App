import { describe, expect, it } from 'vitest';
import type { Game, Matchup, Player, StatLine } from '../domain/types';
import { parseLeague, parseMatchup, parseRoster, type ProjectionIndex } from '../sleeper/parse';
import { gamesByTeam, type WeekContext } from './analyze';
import { gradeOf, leagueGrades, zScores } from './grades';
import { buildOutlook } from './outlook';

describe('grade bands', () => {
  it('maps z-scores within the league to S–F', () => {
    const cases: Array<[number, string]> = [
      [2.1, 'S'],
      [1.5, 'S'],
      [1.49, 'A'],
      [0.75, 'A'],
      [0.74, 'B'],
      [0.25, 'B'],
      [0.24, 'C'],
      [-0.24, 'C'],
      [-0.25, 'D'],
      [-0.74, 'D'],
      [-0.75, 'F'],
      [-2, 'F'],
    ];
    for (const [z, g] of cases) expect(gradeOf(z)).toBe(g);
  });

  it('keeps teams that are nearly level near average', () => {
    expect(zScores([5, 5, 5], 1)).toEqual([0, 0, 0]);
    const spread = zScores([1, 2, 3], 0);
    expect(spread[0]).toBeCloseTo(-1.2247, 4);
    expect(spread[2]).toBeCloseTo(1.2247, 4);
    // 0.1 apart with a floor of 1: still C, not S and F.
    expect(zScores([10, 10.1], 1).map(gradeOf)).toEqual(['C', 'C']);
  });
});

// Six teams; each player's projection scales with a strength factor, every week alike.
const league = parseLeague({
  league_id: 'G',
  name: 'Grades',
  season: '2026',
  status: 'in_season',
  total_rosters: 6,
  roster_positions: ['QB', 'RB', 'WR', 'FLEX', 'BN', 'BN', 'BN'],
  scoring_settings: { pass_yd: 0.04, pass_td: 4, rush_yd: 0.1, rush_td: 6, rec: 1, rec_yd: 0.1, rec_td: 6 },
  settings: { type: 0, num_teams: 6, playoff_week_start: 15, playoff_teams: 4, last_scored_leg: 5 },
});
const stat = (pos: string, k: number): StatLine =>
  pos === 'QB' ? { pass_yd: 250 * k, pass_td: 1.8 * k } : pos === 'RB' ? { rush_yd: 70 * k, rush_td: 0.5 * k } : { rec: 5 * k, rec_yd: 65 * k };
type Spec = Array<[string, number]>;

function setup(specs: Record<number, Spec>, records: Record<number, [number, number]>) {
  const players = new Map<string, Player>();
  const rows: Record<string, StatLine> = {};
  const rosters = Object.entries(specs).map(([rid, spec]) => {
    const ids = spec.map(([pos, k], j) => {
      const id = `t${rid}_${pos.toLowerCase()}${j}`;
      players.set(id, { id, name: id, pos, fpos: [pos], team: `T${id}`, injury: null });
      rows[id] = stat(pos, k);
      return id;
    });
    const [wins, losses] = records[Number(rid)]!;
    return parseRoster({ roster_id: Number(rid), owner_id: `u${rid}`, players: ids, starters: ids.slice(0, 4), settings: { wins, losses } });
  });
  const index = (week: number): ProjectionIndex => ({
    byPlayer: new Map(Object.entries(rows).map(([id, stats]) => [id, { playerId: id, week, stats, team: `T${id}` }])),
    players: new Map(),
    statKeys: new Set(Object.values(rows).flatMap((s) => Object.keys(s))),
  });
  const now = Date.UTC(2026, 9, 15, 12);
  const games: Game[] = [...players.values()].map((p) => ({ id: p.id, week: 6, away: p.team!, home: `X${p.team}`, kickoff: new Date(now + 3 * 86_400_000).toISOString() }));
  const pair = (...ps: Array<[number, number]>): Matchup[] =>
    ps.flatMap(([a, b], m) => [a, b].map((r) => parseMatchup({ roster_id: r, matchup_id: m + 1, starters: [], players: [], points: 0 })));
  const matchups = pair([1, 2], [3, 4], [5, 6]);
  const ctx: WeekContext = { season: '2026', week: 6, now, players, projections: index(6), gamesByTeam: gamesByTeam(games, 6) };
  const byWeek = new Map(Array.from({ length: 12 }, (_, i) => [7 + i, index(7 + i)]));
  const schedule = new Map(Array.from({ length: 8 }, (_, i) => [7 + i, i % 2 ? pair([1, 3], [2, 5], [4, 6]) : pair([1, 4], [2, 6], [3, 5])]));
  const o = buildOutlook({ league, rosters, users: [], matchups, ctx, byWeek, schedule, sims: 2000 });
  return { o, grades: leagueGrades(o, matchups, ctx)! };
}

describe('leagueGrades', () => {
  const { grades } = setup(
    {
      // Best starters, no bench.
      1: [['QB', 1.4], ['RB', 1.4], ['WR', 1.4], ['RB', 1.3]],
      // Nearly as good, and a deep bench.
      2: [['QB', 1.35], ['RB', 1.35], ['WR', 1.35], ['RB', 1.25], ['RB', 1.0], ['WR', 1.0], ['QB', 0.9]],
      3: [['QB', 1.0], ['RB', 1.0], ['WR', 1.0], ['WR', 1.0], ['RB', 0.7]],
      4: [['QB', 0.95], ['RB', 0.95], ['WR', 0.95], ['RB', 0.9], ['WR', 0.6]],
      5: [['QB', 0.8], ['RB', 0.8], ['WR', 0.8], ['WR', 0.75], ['RB', 0.6]],
      // Weakest, no bench.
      6: [['QB', 0.7], ['RB', 0.7], ['WR', 0.7], ['RB', 0.65]],
    },
    { 1: [4, 1], 2: [3, 2], 3: [3, 2], 4: [2, 3], 5: [2, 3], 6: [1, 4] },
  );
  const team = (id: number) => grades.teams.find((t) => t.rosterId === id)!;

  it('grades this week, the rest of the season, the bench and playoff odds', () => {
    expect(grades.parts).toEqual(['week', 'ros', 'depth', 'odds']);
    expect(grades.odds).toBe('playoffs');
    for (const part of grades.parts) expect(grades.teams.map((t) => t.parts[part]!.rank).sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('ranks the strong teams on top and the weakest last', () => {
    expect(grades.teams.map((t) => t.rank)).toEqual([1, 2, 3, 4, 5, 6]);
    expect([grades.teams[0]!.rosterId, grades.teams[1]!.rosterId].sort()).toEqual([1, 2]);
    expect(grades.teams.at(-1)!.rosterId).toBe(6);
    expect(['A', 'S']).toContain(team(1).grade);
    expect(['D', 'F']).toContain(team(6).grade);
    // The best starters win this week; over the season the deep bench covers absences and edges ahead.
    expect(team(1).parts.week!.rank).toBe(1);
    expect(team(2).parts.ros!.rank).toBe(1);
    expect(team(1).parts.ros!.rank).toBe(2);
  });

  it('credits the bench for covering absences, not the starters', () => {
    expect(team(2).parts.depth!.rank).toBe(1);
    expect(team(2).parts.depth!.value).toBeGreaterThan(1);
    // No bench: nothing added.
    expect(team(1).parts.depth!.value).toBeCloseTo(0, 6);
    expect(team(6).parts.depth!.value).toBeCloseTo(0, 6);
  });

  it('gives a league of equals C across the board', () => {
    const same: Spec = [['QB', 1], ['RB', 1], ['WR', 1], ['RB', 1], ['WR', 0.8]];
    const level = setup({ 1: same, 2: same, 3: same, 4: same, 5: same, 6: same }, { 1: [3, 2], 2: [3, 2], 3: [3, 2], 4: [3, 2], 5: [3, 2], 6: [3, 2] }).grades;
    expect(level.teams.map((t) => t.grade)).toEqual(['C', 'C', 'C', 'C', 'C', 'C']);
    for (const part of ['week', 'ros', 'depth'] as const) expect(level.teams.every((t) => t.parts[part]!.grade === 'C')).toBe(true);
  });
});
