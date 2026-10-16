import { describe, expect, it } from 'vitest';
import type { PlayerUsage } from '../data/contracts';
import type { Player, StatLine } from '../domain/types';
import { parseLeague, parseMatchup, parseRoster, type ProjectionIndex } from '../sleeper/parse';
import { gamesByTeam, type WeekContext } from './analyze';
import { buyLowSellHigh, streak } from './luck';
import { buildOutlook } from './outlook';

// No playoffs; one QB, RB and WR slot, so a player either starts or sits.
const league = parseLeague({
  league_id: 'L',
  name: 'Luck',
  season: '2026',
  status: 'in_season',
  total_rosters: 4,
  roster_positions: ['QB', 'RB', 'WR', 'BN', 'BN', 'BN'],
  scoring_settings: { pass_yd: 0.04, pass_td: 4, rush_yd: 0.1, rush_td: 6, rec: 1, rec_yd: 0.1 },
  settings: { type: 0, num_teams: 4, last_scored_leg: 6 },
});

const SPECS: Array<[id: string, pos: string, stats: StatLine]> = [
  ['q1', 'QB', { pass_yd: 250, pass_td: 2 }], // 18
  ['r1', 'RB', { rush_yd: 80, rush_td: 0.5 }], // 11
  ['w1', 'WR', { rec: 5, rec_yd: 60 }], // 11
  ['wb', 'WR', { rec: 1, rec_yd: 10 }], // 2
  ['rr', 'RB', { rush_yd: 100, rush_td: 1 }], // 16: would start for me
  ['rw', 'WR', { rec: 4, rec_yd: 40 }], // 8: wouldn't
  ['rq', 'QB', { pass_yd: 260, pass_td: 2 }],
  ['rz', 'RB', { rush_yd: 30 }], // 3
];
const players = new Map(SPECS.map(([id, pos]) => [id, { id, name: id, pos, fpos: [pos], team: `T${id}`, injury: null } as Player]));
const index = (week: number): ProjectionIndex => ({
  byPlayer: new Map(SPECS.map(([id, , stats]) => [id, { playerId: id, week, stats, team: `T${id}` }])),
  players: new Map(),
  statKeys: new Set(),
});

function outlook() {
  const rosters = [
    parseRoster({ roster_id: 1, owner_id: 'u1', players: ['q1', 'r1', 'w1', 'wb'], starters: [] }),
    parseRoster({ roster_id: 2, owner_id: 'u2', players: ['rr', 'rw', 'rq'], starters: [] }),
    parseRoster({ roster_id: 3, owner_id: 'u3', players: ['rz'], starters: [] }),
    parseRoster({ roster_id: 4, owner_id: 'u4', players: [], starters: [] }),
  ];
  const ctx: WeekContext = { season: '2026', week: 6, now: Date.UTC(2026, 9, 15, 12), players, projections: index(6), gamesByTeam: gamesByTeam([], 6) };
  const byWeek = new Map(Array.from({ length: 12 }, (_, i) => [7 + i, index(7 + i)]));
  const matchups = [1, 2, 3, 4].map((r) => parseMatchup({ roster_id: r, matchup_id: r <= 2 ? 1 : 2, starters: [], players: [], points: 0 }));
  return buildOutlook({ league, rosters, users: [], matchups, ctx, byWeek, schedule: new Map(), sims: 200 });
}

const usage = (pts: [number, number], td: [number, number] = [0, 0], g = 4): PlayerUsage => ({ snap: [], tgt: [], car: [], tshare: [], cshare: [], luck: { g, pts, td } });

describe('streaks', () => {
  it('needs a gap of 3 PPR points a game', () => {
    expect(streak(usage([14, 11.5]))).toBeUndefined();
    expect(streak({ snap: [], tgt: [], car: [], tshare: [], cshare: [] })).toBeUndefined();
    expect(streak(usage([8, 11.2], [0, 1.8], 3))).toEqual({ games: 3, pts: 8, expected: 11.2, td: 0, expectedTd: 1.8 });
  });

  it("sells your hot players and buys other teams' cold ones who'd start for you", () => {
    const luck = new Map<string, PlayerUsage>([
      ['q1', usage([20, 18.5])], // within the gap
      ['w1', usage([17, 11], [4, 1.5])], // mine, hot: sell high
      ['wb', usage([9, 2], [2, 0.2])], // mine, hot, but worth too little to trade on
      ['r1', usage([6, 11])], // mine, cold: nothing to do
      ['rr', usage([9, 15.5], [0, 2.2])], // theirs, cold, would start for me: buy low
      ['rw', usage([3, 8])], // theirs, cold, wouldn't start for me
      ['rq', usage([25, 18])], // theirs, hot
      ['rz', usage([0, 3.5])], // theirs, cold, worth too little
    ]);
    const { sell, buy } = buyLowSellHigh(outlook(), 1, luck);
    expect(sell.map((p) => p.id)).toEqual(['w1']);
    expect(sell[0]).toMatchObject({ rosterId: 1, streak: { pts: 17, expected: 11, td: 4, expectedTd: 1.5 } });
    expect(buy.map((p) => [p.id, p.rosterId])).toEqual([['rr', 2]]);
    expect(buy[0]!.perWeek).toBeGreaterThan(12);
    expect(buyLowSellHigh(outlook(), 1, luck, 0)).toEqual({ sell: [], buy: [] });
  });
});
