import { describe, expect, it } from 'vitest';
import type { Player, StatLine } from '../domain/types';
import { parseLeague, parseMatchup, parseRoster, type ProjectionIndex } from '../sleeper/parse';
import { gamesByTeam, type WeekContext } from './analyze';
import { buildOutlook, evaluateTrade, freeAgentPool } from './outlook';
import { findPackages, LOPSIDED } from './tradeFinder';

// No playoffs; five starters and three bench spots, so every roster below is full.
const league = parseLeague({
  league_id: 'P',
  name: 'Packages',
  season: '2026',
  status: 'in_season',
  total_rosters: 4,
  roster_positions: ['QB', 'RB', 'RB', 'WR', 'WR', 'BN', 'BN', 'BN'],
  scoring_settings: { pass_yd: 0.04, pass_td: 4, rush_yd: 0.1, rush_td: 6, rec: 1, rec_yd: 0.1 },
  settings: { type: 0, num_teams: 4, last_scored_leg: 6 },
});

const rb = (pts: number): StatLine => ({ rush_yd: pts * 10 });
const wr = (pts: number): StatLine => ({ rec: pts / 2, rec_yd: pts * 5 });
const SPECS: Array<[id: string, pos: string, stats: StatLine]> = [
  // Mine: deep at WR.
  ['q1', 'QB', { pass_yd: 250, pass_td: 2 }],
  ['r1', 'RB', rb(10)],
  ['r2', 'RB', rb(9)],
  ['r3', 'RB', rb(4)],
  ['w1', 'WR', wr(15)],
  ['w2', 'WR', wr(14)],
  ['w3', 'WR', wr(13)],
  ['w4', 'WR', wr(12)],
  // Theirs: a star RB, thin at WR.
  ['tq', 'QB', { pass_yd: 240, pass_td: 2 }],
  ['t1', 'RB', rb(20)],
  ['t2', 'RB', rb(8)],
  ['t3', 'RB', rb(3)],
  ['tw1', 'WR', wr(6)],
  ['tw2', 'WR', wr(5)],
  ['tw3', 'WR', wr(2)],
  ['tb', 'RB', rb(1)],
];
type Spec = (typeof SPECS)[number];
const index = (specs: readonly Spec[], week: number): ProjectionIndex => ({
  byPlayer: new Map(specs.map(([id, , stats]) => [id, { playerId: id, week, stats, team: `T${id}` }])),
  players: new Map(),
  statKeys: new Set(),
});

/** The league in week 6, with `free` as unrostered players. */
function outlook(free: Spec[] = []) {
  const specs = [...SPECS, ...free];
  const players = new Map(specs.map(([id, pos]) => [id, { id, name: id, pos, fpos: [pos], team: `T${id}`, injury: null } as Player]));
  const rosters = [
    parseRoster({ roster_id: 1, owner_id: 'u1', players: ['q1', 'r1', 'r2', 'r3', 'w1', 'w2', 'w3', 'w4'], starters: [] }),
    parseRoster({ roster_id: 2, owner_id: 'u2', players: ['tq', 't1', 't2', 't3', 'tw1', 'tw2', 'tw3', 'tb'], starters: [] }),
    parseRoster({ roster_id: 3, owner_id: 'u3', players: [], starters: [] }),
    parseRoster({ roster_id: 4, owner_id: 'u4', players: [], starters: [] }),
  ];
  const ctx: WeekContext = { season: '2026', week: 6, now: Date.UTC(2026, 9, 15, 12), players, projections: index(specs, 6), gamesByTeam: gamesByTeam([], 6) };
  const byWeek = new Map(Array.from({ length: 12 }, (_, i) => [7 + i, index(specs, 7 + i)]));
  const matchups = [1, 2, 3, 4].map((r) => parseMatchup({ roster_id: r, matchup_id: r <= 2 ? 1 : 2, starters: [], players: [], points: 0 }));
  const o = buildOutlook({ league, rosters, users: [], matchups, ctx, byWeek, schedule: new Map(), sims: 200 });
  return { o, ctx, fa: freeAgentPool(o, ctx) };
}

describe('what it would take', () => {
  it('finds packages both lineups gain from, cheapest for me first', async () => {
    const { o, ctx } = outlook();
    const search = (await findPackages(o, ctx, 1, 't1'))!;
    expect(search.partner).toBe(2);
    expect(search.packages.length).toBeGreaterThan(0);
    expect(search.closest).toEqual([]);
    for (const p of search.packages) {
      expect(p.get).toEqual(['t1']);
      expect(p.mine).toBeGreaterThanOrEqual(1);
      expect(p.theirs).toBeGreaterThanOrEqual(0);
      // Reported numbers are the trade tab's own evaluation.
      expect(p.mine).toBeCloseTo(evaluateTrade(o, ctx, 1, 2, p.give, ['t1'], []).me.delta, 6);
      // No one player of mine is enough for a 20-point back: their lineup would lose.
      expect(p.give.length).toBe(2);
    }
    expect(search.packages.map((p) => p.mine)).toEqual([...search.packages.map((p) => p.mine)].sort((a, b) => b - a));
    // My best receiver is in every package, but in at most two of them.
    expect(search.packages.every((p) => p.give.includes('w1'))).toBe(true);
    expect(search.packages.length).toBe(2);
  });

  it("puts packages they'd see as lopsided on market value last", async () => {
    const { o, ctx } = outlook();
    const market = new Map(Object.entries({ t1: 9000, w1: 3000, r1: 2000, w3: 4000 }).map(([id, value]) => [id, { value }]));
    const search = (await findPackages(o, ctx, 1, 't1', { market }))!;
    // w1 + r1 is better for my lineup, but 5,000 of market value for 9,000 is lopsided; w1 + w3 (7,000) isn't.
    expect(search.packages.map((p) => p.give)).toEqual([
      ['w1', 'w3'],
      ['w1', 'r1'],
    ]);
    expect(search.packages[1]!.market).toEqual({ give: 5000, get: 9000, unvalued: 0 });
    expect(search.packages[1]!.market!.get).toBeGreaterThan(search.packages[1]!.market!.give * LOPSIDED);
    expect(search.packages[1]!.mine).toBeGreaterThan(search.packages[0]!.mine);
  });

  it('shows the closest packages when none helps both lineups', async () => {
    const { o, ctx } = outlook();
    // Their only QB: any package they'd take costs my lineup points.
    const search = (await findPackages(o, ctx, 1, 'tq'))!;
    expect(search.packages).toEqual([]);
    expect(search.closest.length).toBeGreaterThan(0);
    expect(search.closest[0]!.give).toEqual(['q1']);
    for (const p of search.closest) {
      expect(p.mine).toBeLessThan(1);
      expect(p.theirs).toBeGreaterThanOrEqual(0);
    }
    expect(search.closest.map((p) => p.mine)).toEqual([...search.closest.map((p) => p.mine)].sort((a, b) => b - a));
  });

  it("leaves out the free agent a two-for-one's open spot could take: that pickup is open anyway", async () => {
    const { o, ctx, fa } = outlook([['fa', 'RB', rb(12)]]);
    expect(fa).toEqual(['fa']);
    const search = (await findPackages(o, ctx, 1, 't1'))!;
    expect(search.packages.length).toBeGreaterThan(0);
    for (const p of search.packages) expect(p.result.me.adds).toEqual([]);
    // The trade tab would count him: the same trade looks better there.
    const first = search.packages[0]!;
    expect(evaluateTrade(o, ctx, 1, 2, first.give, ['t1'], fa).me.delta).toBeGreaterThan(first.mine);
  });

  it('says whether he would start for me', async () => {
    const { o, ctx } = outlook();
    expect(await findPackages(o, ctx, 1, 't1')).toMatchObject({ starts: 12, weeks: 12 });
    // Their QB would sit behind mine.
    expect(await findPackages(o, ctx, 1, 'tq')).toMatchObject({ starts: 0, weeks: 12 });
  });

  it("needs a player on another team's roster", async () => {
    const { o, ctx } = outlook();
    expect(await findPackages(o, ctx, 1, 'w1')).toBeNull();
    expect(await findPackages(o, ctx, 1, 'nobody')).toBeNull();
  });
});
