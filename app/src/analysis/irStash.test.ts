import { describe, expect, it } from 'vitest';
import type { Player, StatLine } from '../domain/types';
import { parseLeague, parseMatchup, parseRoster, type ProjectionIndex } from '../sleeper/parse';
import { gamesByTeam, type WeekContext } from './analyze';
import { irStash } from './irStash';
import { buildOutlook } from './outlook';

const settings = { type: 0, num_teams: 4, last_scored_leg: 6, reserve_slots: 1, reserve_allow_out: 1, reserve_allow_doubtful: 0 };
const raw = {
  league_id: 'I',
  name: 'IR',
  season: '2026',
  status: 'in_season',
  total_rosters: 4,
  roster_positions: ['QB', 'RB', 'RB', 'BN', 'BN'],
  scoring_settings: { pass_yd: 0.04, pass_td: 4, rush_yd: 0.1, rush_td: 6 },
  settings,
};

type Spec = [id: string, pos: string, stats: StatLine, injury: Player['injury'], from: number];
const SPECS: Spec[] = [
  ['q1', 'QB', { pass_yd: 250, pass_td: 2 }, null, 7],
  ['r1', 'RB', { rush_yd: 70, rush_td: 0.5 }, null, 7],
  ['r2', 'RB', { rush_yd: 40 }, null, 7], // 4 a game: the stash beats him once back
  ['x1', 'RB', { rush_yd: 90, rush_td: 0.6 }, 'IR', 10], // on IR, back in week 10
  ['x2', 'RB', { rush_yd: 60, rush_td: 0.3 }, 'Out', 8], // Out, which this league allows on IR
  ['x3', 'RB', { rush_yd: 100, rush_td: 1 }, 'Doubtful', 7], // Doubtful isn't allowed here
  ['x4', 'RB', { rush_yd: 100, rush_td: 1 }, 'Questionable', 7], // never IR-eligible
  ['x5', 'RB', { rush_yd: 30 }, 'IR', 99], // on IR for the season: never projected again
];
const players = new Map(SPECS.map(([id, pos, , injury]) => [id, { id, name: id, pos, fpos: [pos], team: `T${id}`, injury } as Player]));
const index = (week: number): ProjectionIndex => ({
  byPlayer: new Map(SPECS.filter(([, , , , from]) => week >= from).map(([id, , stats]) => [id, { playerId: id, week, stats, team: `T${id}` }])),
  players: new Map(),
  statKeys: new Set(),
});

function outlook(reserve: string[], extraSettings: Record<string, number> = {}) {
  const league = parseLeague({ ...raw, settings: { ...settings, ...extraSettings } });
  const rosters = [
    parseRoster({ roster_id: 1, owner_id: 'u1', players: ['q1', 'r1', 'r2', ...reserve], reserve, starters: [] }),
    ...[2, 3, 4].map((r) => parseRoster({ roster_id: r, owner_id: `u${r}`, players: [], starters: [] })),
  ];
  const ctx: WeekContext = { season: '2026', week: 6, now: Date.UTC(2026, 9, 15, 12), players, projections: index(6), gamesByTeam: gamesByTeam([], 6) };
  const byWeek = new Map(Array.from({ length: 12 }, (_, i) => [7 + i, index(7 + i)]));
  const matchups = [1, 2, 3, 4].map((r) => parseMatchup({ roster_id: r, matchup_id: r <= 2 ? 1 : 2, starters: [], players: [], points: 0 }));
  return buildOutlook({ league, rosters, users: [], matchups, ctx, byWeek, schedule: new Map(), sims: 200 });
}

describe('irStash', () => {
  it('lists IR-eligible free agents who come back, by what they add', () => {
    const stash = irStash(outlook([]), 1, players);
    expect(stash.openSlots).toBe(1);
    expect(stash.rows.map((r) => r.id)).toEqual(['x1', 'x2']);
    const [x1, x2] = stash.rows;
    expect(x1).toMatchObject({ back: 10 });
    expect(x2).toMatchObject({ back: 8 });
    // Points if active: 9 + 3.6 for x1, 6 + 1.8 for x2.
    expect(x1!.perWeek).toBeCloseTo(12.6, 9);
    expect(x2!.perWeek).toBeCloseTo(7.8, 9);
    expect(x1!.gain).toBeGreaterThan(x2!.gain);
    // No playoffs in this league: nothing to split out.
    expect(x1!.playoffGain).toBe(0);
  });

  it('adds his gain week by week from his return, with no drop', () => {
    const o = outlook([]);
    const x1 = irStash(o, 1, players).rows.find((r) => r.id === 'x1')!;
    const ids = ['q1', 'r1', 'r2'];
    let expected = 0;
    for (let i = 3; i < o.weeks.length; i++) expected += o.model.lineupWeek([...ids, 'x1'], i).mean - o.model.lineupWeek(ids, i).mean;
    expect(x1.gain).toBeCloseTo(expected, 9);
  });

  it('splits out the playoff weeks', () => {
    const x1 = irStash(outlook([], { playoff_week_start: 15, playoff_teams: 2 }), 1, players).rows.find((r) => r.id === 'x1')!;
    expect(x1.playoffGain).toBeGreaterThan(0);
    expect(x1.playoffGain).toBeLessThan(x1.gain);
  });

  it('stays empty without an open IR slot', () => {
    const full = irStash(outlook(['x5']), 1, players);
    expect(full).toEqual({ openSlots: 0, rows: [] });
  });
});
