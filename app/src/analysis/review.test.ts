import { describe, expect, it } from 'vitest';
import type { Matchup, Player, StatLine } from '../domain/types';
import { pointSd } from '../engine/winprob';
import { parseLeague, parseMatchup, parseRoster, type ProjectionIndex } from '../sleeper/parse';
import { bestPossible, reviewSeason } from './review';

const raw = {
  league_id: 'R',
  name: 'Review',
  season: '2026',
  status: 'in_season',
  total_rosters: 4,
  roster_positions: ['QB', 'RB', 'WR', 'FLEX', 'BN', 'BN', 'BN'],
  scoring_settings: { pass_yd: 0.04, pass_td: 4, rush_yd: 0.1, rush_td: 6, rec: 1, rec_yd: 0.1, rec_td: 6 },
  settings: { type: 0, num_teams: 4, playoff_week_start: 15, playoff_teams: 2, last_scored_leg: 3 },
};
const league = parseLeague(raw);

const P = (id: string, pos: string): Player => ({ id, name: id, pos, fpos: [pos], team: 'AAA', injury: null });
const players = new Map([P('q1', 'QB'), P('r1', 'RB'), P('r2', 'RB'), P('w1', 'WR'), P('w2', 'WR'), P('tx', 'WR')].map((p) => [p.id, p]));
// Team 1 has a taxi-squad receiver (tx) who can't start: his points never count toward the best lineup.
const rosters = [
  parseRoster({ roster_id: 1, owner_id: 'u1', players: ['q1', 'r1', 'r2', 'w1', 'w2', 'tx'], starters: [], taxi: ['tx'] }),
  ...[2, 3, 4].map((r) => parseRoster({ roster_id: r, owner_id: `u${r}`, players: [], starters: [] })),
];
const mine = ['q1', 'r1', 'r2', 'w1', 'w2', 'tx'];

/** One week: team 1's starters and every player's points; the other teams' scores; head-to-head pairs. */
function week(starters: string[], pp: Record<string, number>, others: Record<number, number>, pairs: Array<[number, number]>): Matchup[] {
  const pts: Record<number, number> = { 1: starters.reduce((s, id) => s + (pp[id] ?? 0), 0), ...others };
  const mid = (r: number) => pairs.findIndex((p) => p.includes(r)) + 1;
  return [1, 2, 3, 4].map((r) =>
    parseMatchup({ roster_id: r, matchup_id: mid(r), starters: r === 1 ? starters : [], players: r === 1 ? mine : [], points: pts[r]!, players_points: r === 1 ? pp : {} }),
  );
}

// Week 1: 43 (best 53: w2 15 should start, w1 at FLEX); beats team 2 (40). Week 2: 47, the best possible; loses to team 3 (60).
// Week 3: 50 (best 58: w2's 18 on the bench); ties team 4 (50).
const played = new Map([
  [1, week(['q1', 'r1', 'w1', 'r2'], { q1: 20, r1: 5, r2: 8, w1: 10, w2: 15, tx: 30 }, { 2: 40, 3: 50, 4: 30 }, [[1, 2], [3, 4]])],
  [2, week(['q1', 'r1', 'w1', 'w2'], { q1: 15, r1: 12, r2: 3, w1: 10, w2: 10, tx: 0 }, { 2: 45, 3: 60, 4: 20 }, [[1, 3], [2, 4]])],
  [3, week(['q1', 'r1', 'w1', 'r2'], { q1: 20, r1: 10, r2: 10, w1: 10, w2: 18, tx: 2 }, { 2: 55, 3: 40, 4: 50 }, [[1, 4], [2, 3]])],
  // Not played yet: nobody has points.
  [4, week([], {}, { 2: 0, 3: 0, 4: 0 }, [[1, 2], [3, 4]])],
]);

describe('bestPossible', () => {
  it('fills each slot from eligible players, with FLEX taking the best leftover', () => {
    const fpos = (id: string) => players.get(id)!.fpos;
    const slots = ['QB', 'RB', 'WR', 'FLEX'];
    expect(bestPossible(slots, ['q1', 'r1', 'r2', 'w1', 'w2'], { q1: 20, r1: 5, r2: 8, w1: 10, w2: 15 }, fpos)).toBe(53);
    // A negative score is better left out: the slot stays empty.
    expect(bestPossible(['QB'], ['q1'], { q1: -2 }, fpos)).toBe(0);
  });
});

describe('reviewSeason', () => {
  const rev = reviewSeason({ league, rosters, rosterId: 1, played, players })!;

  it('scores each week played: result, best lineup in hindsight, rank and all-play', () => {
    expect(rev.weeks.map((w) => w.week)).toEqual([1, 2, 3]);
    expect(rev.weeks.map((w) => [w.points, w.result, w.oppPoints])).toEqual([
      [43, 'W', 40],
      [47, 'L', 60],
      [50, 'T', 50],
    ]);
    expect(rev.weeks.map((w) => w.best)).toEqual([53, 47, 58]);
    expect(rev.weeks.map((w) => w.rank)).toEqual([2, 2, 2]);
    expect(rev.weeks[2]!.allPlay).toEqual({ w: 1, l: 1, t: 1 });
    expect(rev.record).toEqual({ w: 1, l: 1, t: 1 });
    expect(rev.allPlay).toEqual({ w: 5, l: 3, t: 1 });
  });

  it('measures schedule luck against all-play wins', () => {
    // Expected: 2/3 + 2/3 + 1.5/3 = 1.83 wins; actual 1.5 (the tie counts half).
    expect(rev.expectedWins).toBeCloseTo(11 / 6, 9);
    expect(rev.luck).toBeCloseTo(1.5 - 11 / 6, 9);
    // 40 + 60 + 50 against: the most in the league (team 4 next with 145).
    expect(rev.pointsAgainst).toBe(150);
    expect(rev.pointsAgainstRank).toBe(1);
  });

  it('compares lineup efficiency with the league', () => {
    expect(rev.points).toBe(140);
    expect(rev.best).toBe(158);
    expect(rev.efficiency).toBeCloseTo(140 / 158, 9);
    // The other teams list no players, so their best is what they scored.
    expect(rev.leagueEfficiency).toBeCloseTo((140 / 158 + 3) / 4, 9);
    expect(rev.efficiencyRank).toBe(4);
    expect(rev.efficiencyTeams).toBe(4);
    expect(rev.median).toBeUndefined();
  });

  it('counts the league-median game separately', () => {
    const median = reviewSeason({ league: parseLeague({ ...raw, settings: { ...raw.settings, league_average_match: 1 } }), rosters, rosterId: 1, played, players })!;
    // Medians 41.5, 46 and 50: above, above, level.
    expect(median.weeks.map((w) => w.median)).toEqual(['W', 'W', 'T']);
    expect(median.median).toEqual({ w: 2, l: 0, t: 1 });
    expect(median.record).toEqual({ w: 1, l: 1, t: 1 });
  });

  it("scores the app's saved pick from that week's points", () => {
    const withAdvice = reviewSeason({ league, rosters, rosterId: 1, played, players, advice: new Map([[1, ['q1', 'r2', 'w2', 'w1']]]) })!;
    expect(withAdvice.weeks.map((w) => w.app)).toEqual([53, undefined, undefined]);
  });

  it('compares current players with their projections, taxi squad aside', () => {
    const qb: StatLine = { pass_yd: 250, pass_td: 2 }; // 18
    const wr: StatLine = { rec: 5, rec_yd: 60 }; // 11
    const index = (week: number): ProjectionIndex => {
      const rows: Record<string, StatLine> = { q1: qb, w2: wr, w1: wr, tx: wr, r1: week === 2 ? {} : { rush_yd: 70 } };
      return { byPlayer: new Map(Object.entries(rows).map(([id, stats]) => [id, { playerId: id, week, stats }])), players: new Map(), statKeys: new Set() };
    };
    const projections = new Map([1, 2, 3].map((w) => [w, index(w)]));
    const r = reviewSeason({ league, rosters, rosterId: 1, played, players, projections })!;
    const byId = new Map(r.players.map((p) => [p.id, p]));
    expect([...byId.keys()].sort()).toEqual(['q1', 'r1', 'w1', 'w2']);
    // w2: 15, 10, 18 against 11 a game.
    const w2 = byId.get('w2')!;
    expect(w2.games).toBe(3);
    expect(w2.projected).toBeCloseTo(11, 9);
    expect(w2.actual).toBeCloseTo(43 / 3, 9);
    expect(w2.z).toBeCloseTo((43 - 33) / Math.sqrt(3 * pointSd('WR', 11) ** 2), 9);
    // r1 wasn't projected in week 2: two games count.
    expect(byId.get('r1')!.games).toBe(2);
    expect(byId.get('r1')!.actual).toBeCloseTo(7.5, 9);
    // Biggest gain first.
    expect(r.players[0]!.id).toBe('w2');
    expect(r.players.at(-1)!.id).toBe('w1');
  });

  it('has nothing to say before a week is played', () => {
    expect(reviewSeason({ league, rosters, rosterId: 1, played: new Map([[4, played.get(4)!]]), players })).toBeUndefined();
  });
});
