import { describe, expect, it } from 'vitest';
import type { League, Matchup, Player, Roster, StatLine } from '../domain/types';
import type { ProjectionIndex } from '../sleeper/parse';
import { parseLeague, parseMatchup, parseRoster } from '../sleeper/parse';
import type { RawLeague, RawTransaction } from '../sleeper/raw';
import { gamesByTeam, type WeekContext } from './analyze';
import { faabMarket, marketPrice, suggestBid, tierOf } from './faab';
import { buildOutlook, byeGrid, evaluateTrade, freeAgentPool, regularStarters, scheduleOutlook, streamers, waiverBoard } from './outlook';
import {
  addGains,
  changeVariance,
  futurePlay,
  HEALTHY_PLAY,
  KICKER_PLAY,
  playoffByes,
  playoffRounds,
  playoffRoundWeeks,
  projectionPositions,
  QUESTIONABLE_PLAY,
  regularSeasonEnd,
  RETURN_PLAY,
  ROS_DRIFT,
  ROS_OFFSET,
  RosModel,
  seasonEnd,
  teamDrift,
  weekWeights,
} from './ros';
import { bracketOrder, simulateSeason, type SeasonTeam } from './season';

const rawLeague: RawLeague = {
  league_id: 'L',
  name: 'Test',
  season: '2026',
  status: 'in_season',
  total_rosters: 4,
  roster_positions: ['QB', 'RB', 'WR', 'FLEX', 'DEF', 'BN', 'BN'],
  scoring_settings: { pass_yd: 0.04, pass_td: 4, rush_yd: 0.1, rush_td: 6, rec: 1, rec_yd: 0.1, rec_td: 6, sack: 1 },
  settings: { type: 0, num_teams: 4, playoff_week_start: 15, playoff_teams: 2, trade_deadline: 11, waiver_type: 2, waiver_budget: 100, last_scored_leg: 5 },
};
const league: League = parseLeague(rawLeague);

const player = (id: string, pos: string, injury: string | null = null): Player => ({ id, name: id, pos, fpos: [pos], team: id.toUpperCase(), injury });
// Projection rows carry the player's team (as Sleeper's do); `player()` below uses the same team codes.
const index = (rows: Record<string, StatLine>, week: number, teamOf = (id: string) => id.toUpperCase()): ProjectionIndex => ({
  byPlayer: new Map(Object.entries(rows).map(([id, stats]) => [id, { playerId: id, week, stats, team: teamOf(id) }])),
  players: new Map(),
  statKeys: new Set(Object.values(rows).flatMap((s) => Object.keys(s))),
});

describe('season calendar', () => {
  it('knows playoff rounds, byes and the last weeks that matter', () => {
    expect([playoffRounds(6), playoffByes(6), playoffRounds(4), playoffByes(4)]).toEqual([3, 2, 2, 0]);
    expect(regularSeasonEnd(league)).toBe(14);
    expect(seasonEnd(league)).toBe(15); // 2-team playoff: one round
    const six = parseLeague({ ...rawLeague, settings: { ...rawLeague.settings, playoff_teams: 6 } });
    expect(seasonEnd(six)).toBe(17);
    const noPlayoffs = parseLeague({ ...rawLeague, settings: { ...rawLeague.settings, playoff_week_start: 0 } });
    expect([regularSeasonEnd(noPlayoffs), seasonEnd(noPlayoffs)]).toEqual([18, 18]);
    expect(weekWeights(league, [13, 14, 15], { pPlayoffs: 0.4, pBye: 0 })).toEqual([1, 1, 0.4]);
    expect(weekWeights(league, [13, 14, 15], undefined, 0.5)).toEqual([1, 1, 0.5]);
    expect(weekWeights(noPlayoffs, [15, 16], { pPlayoffs: 0, pBye: 0 })).toEqual([1, 1]);
    // Every round counts by the playoff odds, but a first-round bye week only by the chance of playing it.
    expect(weekWeights(six, [14, 15, 16, 17], { pPlayoffs: 0.75, pBye: 0.5 })).toEqual([1, 0.25, 0.75, 0.75]);
  });

  it("maps each playoff round to its weeks while the whole bracket is ahead", () => {
    const at = (settings: Record<string, number>) => parseLeague({ ...rawLeague, settings: { ...rawLeague.settings, ...settings } });
    const weeks = [10, 11, 12, 13, 14, 15, 16, 17, 18];
    expect(playoffRoundWeeks(at({ playoff_teams: 6 }), weeks)).toEqual([[5], [6], [7]]);
    expect(playoffRoundWeeks(at({ playoff_teams: 4, playoff_round_type: 2 }), weeks)).toEqual([[5, 6], [7, 8]]);
    expect(playoffRoundWeeks(at({ playoff_teams: 4, playoff_round_type: 1 }), weeks)).toEqual([[5], [6, 7]]);
    const twoWeekFinal = at({ playoff_teams: 6, playoff_round_type: 1 });
    expect(playoffRoundWeeks(twoWeekFinal, weeks)).toEqual([[5], [6], [7, 8]]);
    expect(weekWeights(twoWeekFinal, [15, 16, 17, 18], { pPlayoffs: 0.75, pBye: 0.5 })).toEqual([0.25, 0.75, 0.75, 0.75]);
    expect(playoffRoundWeeks(at({ playoff_teams: 6 }), [16, 17])).toBeUndefined(); // bracket under way
    expect(playoffRoundWeeks(at({ playoff_week_start: 0 }), weeks)).toBeUndefined();
  });
  it('fetches IDP projections only for IDP leagues', () => {
    expect(projectionPositions(league)).not.toContain('LB');
    const idp = parseLeague({ ...rawLeague, roster_positions: ['QB', 'IDP_FLEX', 'BN'] });
    expect(projectionPositions(idp)).toContain('LB');
  });
});

describe('future availability', () => {
  it('falls with the weeks ahead and holds its last value beyond the fit', () => {
    expect(futurePlay('WR', null, 1)).toBe(HEALTHY_PLAY[0]);
    expect(futurePlay('RB', null, 8)).toBe(HEALTHY_PLAY[7]);
    expect(futurePlay('QB', null, 40)).toBe(HEALTHY_PLAY.at(-1));
    expect(futurePlay('LB', null, 2)).toBe(HEALTHY_PLAY[1]); // IDP: the QB/RB/WR/TE curve
    expect(futurePlay('K', null, 3)).toBe(KICKER_PLAY[2]);
    expect(futurePlay('DEF', 'IR', 10)).toBe(1);
    for (const curve of [HEALTHY_PLAY, KICKER_PLAY]) curve.forEach((p, i) => expect(p).toBeLessThanOrEqual(curve[i - 1] ?? 1));
  });

  it('never rates a Questionable or sidelined player above a healthy one', () => {
    expect(futurePlay('WR', 'Questionable', 1)).toBe(QUESTIONABLE_PLAY);
    expect(futurePlay('WR', 'Questionable', 15)).toBe(HEALTHY_PLAY[14]);
    expect(futurePlay('RB', 'IR', 2)).toBe(RETURN_PLAY);
    expect(futurePlay('RB', 'Out', 15)).toBe(HEALTHY_PLAY[14]);
  });
});

describe('RosModel', () => {
  const players = new Map(['qb', 'rb1', 'rb2', 'wr1', 'def'].map((id) => [id, player(id, id.startsWith('rb') ? 'RB' : id === 'qb' ? 'QB' : id === 'def' ? 'DEF' : 'WR')]));
  const byWeek = new Map([
    [7, index({ qb: { pass_yd: 250, pass_td: 2 }, rb1: { rush_yd: 100 }, rb2: { rush_yd: 60 }, wr1: { rec: 5, rec_yd: 50 }, def: { sack: 3 } }, 7)],
    [8, index({ qb: { pass_yd: 250, pass_td: 2 }, rb2: { rush_yd: 60 }, wr1: { rec: 5, rec_yd: 50 }, def: { sack: 3 } }, 8)], // rb1 on bye
  ]);
  const model = new RosModel({ league, weeks: [7, 8], byWeek, players });

  // Seen from week 6: week 7 is one week ahead, week 8 two.
  const [p1, p2] = [HEALTHY_PLAY[0]!, HEALTHY_PLAY[1]!];

  it('scores future weeks with availability falling by weeks ahead, and lets depth cover byes', () => {
    expect(model.ev('rb1')[0]).toBeCloseTo(p1 * 10, 9);
    expect(model.ev('rb1')[1]).toBe(0);
    expect(model.ev('def')[0]).toBeCloseTo(3, 9); // DEFs don't get hurt
    const team = ['qb', 'rb1', 'rb2', 'wr1', 'def'];
    const w7 = model.bestWeek(team, 0);
    // QB 18 + RB 10 + WR 10 + FLEX rb2 6, each × P(active) a week out, + DEF 3; no bench left to insure anyone.
    expect(w7.mean).toBeCloseTo((18 + 10 + 10 + 6) * p1 + 3, 9);
    // Week 8: rb2 starts at RB; FLEX empty.
    expect(model.bestWeek(team, 1).mean).toBeCloseTo((18 + 6 + 10) * p2 + 3, 9);
    // From week 5 the same weeks are two and three weeks ahead.
    const earlier = new RosModel({ league, weeks: [7, 8], currentWeek: 5, byWeek, players });
    expect(earlier.ev('rb1')[0]).toBeCloseTo(p2 * 10, 9);
    expect(earlier.ev('qb')[1]).toBeCloseTo(HEALTHY_PLAY[2]! * 18, 9);
  });

  it("sizes a roster change's spread from the weeks each moving player would start", () => {
    const team = ['qb', 'rb1', 'rb2', 'wr1', 'def'];
    const [e, v] = [model.ev('rb2'), model.variance('rb2')];
    // rb2 starts both weeks (FLEX in week 7, RB in week 8): weekly variance plus a season-long miss of ROS_OFFSET.
    expect(changeVariance(model, [{ id: 'rb2', roster: team }], [1, 1])).toBeCloseTo(v[0]! + v[1]! + (ROS_OFFSET * (e[0]! + e[1]!)) ** 2, 9);
    expect(changeVariance(model, [{ id: 'rb2', roster: team }], [1, 0.5])).toBeCloseTo(v[0]! + 0.25 * v[1]! + (ROS_OFFSET * (e[0]! + 0.5 * e[1]!)) ** 2, 9);
    // Only the weeks he'd start count: on a roster he isn't in, he never starts.
    expect(changeVariance(model, [{ id: 'rb2', roster: ['qb', 'rb1', 'wr1', 'def'] }], [1, 1])).toBe(0);
    expect(changeVariance(model, [], [1, 1])).toBe(0);
  });

  it("sizes a team's drift from its QB/RB/WR/TE starters' expected points", () => {
    const team = ['qb', 'rb1', 'rb2', 'wr1', 'def'];
    const squares = [
      (18 * 18 + 10 * 10 + 10 * 10 + 6 * 6) * p1 * p1, // week 7: QB, RB, WR, FLEX rb2; the DEF doesn't drift
      (18 * 18 + 6 * 6 + 10 * 10) * p2 * p2, // week 8: rb1 on bye
    ];
    expect(teamDrift(model, team)).toBeCloseTo(ROS_DRIFT * Math.sqrt((squares[0]! + squares[1]!) / 2), 9);
    expect(teamDrift(model, team, 1)).toBeCloseTo(ROS_DRIFT * Math.sqrt(squares[0]!), 9);
  });

  it('values a bench player as insurance for starters who might miss', () => {
    const withBench = model.bestWeek(['qb', 'rb1', 'wr1', 'def', 'rb2'], 0);
    const flexless = new RosModel({ league: parseLeague({ ...rawLeague, roster_positions: ['QB', 'RB', 'WR', 'DEF', 'BN'] }), weeks: [7], byWeek, players });
    const insured = flexless.bestWeek(['qb', 'rb1', 'wr1', 'def', 'rb2'], 0).mean;
    const bare = flexless.bestWeek(['qb', 'rb1', 'wr1', 'def'], 0).mean;
    expect(insured - bare).toBeCloseTo((1 - p1) * p1 * 6, 9); // rb1 out → rb2 plays
    expect(withBench.mean).toBeGreaterThan(bare);
  });

  it('knows byes from the teams playing each week, and counts slots nobody can fill', () => {
    // Week 8: RB1's team has no rows at all, so it's on bye.
    expect(model.onBye('rb1', 1)).toBe(true);
    expect(model.onBye('rb1', 0)).toBe(false);
    expect(model.onBye('rb2', 1)).toBe(false);
    const w8 = model.lineupWeek(['qb', 'rb1', 'wr1', 'def'], 1);
    expect(w8.open).toBe(2); // RB (on bye) and FLEX empty
    expect(w8.starters).toEqual(['qb', 'wr1', 'def']);
  });

  it('builds a bye grid of regular starters and lineup points before and after', () => {
    const before = ['qb', 'rb1', 'rb2', 'wr1', 'def'];
    const after = ['qb', 'rb1', 'wr1', 'def']; // trade rb2 away
    expect([...regularStarters(model, after)].sort()).toEqual(['def', 'qb', 'rb1', 'wr1']);
    const grid = byeGrid(model, before, after);
    expect(grid.map((g) => g.week)).toEqual([7, 8]);
    expect(grid[1]).toMatchObject({ week: 8, byes: ['rb1'], openBefore: 1, openAfter: 2 });
    expect(grid[1]!.after).toBeLessThan(grid[1]!.before);
  });

  it('suggests the cheapest drop when the roster is full', () => {
    const gains = addGains(model, ['qb', 'rb1', 'wr1', 'def', 'rb2'], ['rb2', 'wr1'], 0, ['rb1'], [1, 1]);
    expect(gains[0]!.drop).toBeDefined();
  });
});

describe('simulateSeason', () => {
  const certain = (mean: number) => ({ mean, variance: 0 });
  const pairings = new Map([
    [7, new Map<number, number | null>([[1, 1], [2, 1], [3, 2], [4, 2]])],
    [8, new Map<number, number | null>([[1, 1], [3, 1], [2, 2], [4, 2]])],
  ]);
  const team = (rosterId: number, wins: number, mean: number) => ({ rosterId, wins, losses: 5 - wins, ties: 0, pointsFor: 500, weeks: [certain(mean), certain(mean)] });

  it('plays out a deterministic schedule', () => {
    const odds = simulateSeason({ teams: [team(1, 2, 120), team(2, 3, 100), team(3, 3, 90), team(4, 2, 80)], weeks: [7, 8], pairings, medianGame: false, playoffTeams: 2, sims: 50 });
    // Week 7: 1 beats 2, 3 beats 4. Week 8: 1 beats 3, 2 beats 4. Teams 1–3 finish 4-3; points for breaks the tie.
    expect(odds.get(1)!.expWins).toBe(4);
    expect(odds.get(3)!.expWins).toBe(4);
    expect(odds.get(4)!.expWins).toBe(2);
    expect(odds.get(1)!.pPlayoffs + odds.get(2)!.pPlayoffs).toBe(2);
    expect(odds.get(3)!.pPlayoffs).toBe(0);
    expect(odds.get(4)!.rankProbs).toEqual([0, 0, 0, 1]);
    expect(odds.get(3)!.rankProbs).toEqual([0, 0, 1, 0]);
  });

  it('gives each team a distribution over final places', () => {
    const teams = [1, 2, 3, 4].map((id) => ({ rosterId: id, wins: 3, losses: 2, ties: 0, pointsFor: 500, weeks: [{ mean: 100, variance: 400 }, { mean: 100, variance: 400 }] }));
    const odds = [...simulateSeason({ teams, weeks: [7, 8], pairings, medianGame: false, playoffTeams: 2, sims: 1000 }).values()];
    for (const o of odds) expect(o.rankProbs.reduce((a, p) => a + p, 0)).toBeCloseTo(1, 9);
    for (let place = 0; place < 4; place++) expect(odds.reduce((a, o) => a + o.rankProbs[place]!, 0)).toBeCloseTo(1, 9);
  });

  it('adds median wins and keeps odds summing to the playoff spots', () => {
    const teams = [1, 2, 3, 4].map((id) => ({ rosterId: id, wins: 3, losses: 2, ties: 0, pointsFor: 500, weeks: [{ mean: 100, variance: 400 }, { mean: 100, variance: 400 }] }));
    const odds = simulateSeason({ teams, weeks: [7, 8], pairings, medianGame: true, playoffTeams: 2, sims: 2000 });
    const total = [...odds.values()].reduce((a, o) => a + o.pPlayoffs, 0);
    expect(total).toBeCloseTo(2, 9);
    for (const o of odds.values()) expect(o.expWins + o.expLosses).toBeCloseTo(5 + 4, 9); // 2 weeks × (H2H + median)
  });
});

describe('persistent drift', () => {
  const weeks = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
  const pairings = new Map(
    weeks.map((w, i) => [w, new Map<number, number | null>(i % 2 ? [[1, 1], [2, 1], [3, 2], [4, 2]] : [[1, 1], [3, 1], [2, 2], [4, 2]])]),
  );
  const team = (rosterId: number, mean: number, drift?: number): SeasonTeam => ({
    rosterId,
    wins: 2,
    losses: 2,
    ties: 0,
    pointsFor: 400,
    weeks: weeks.map(() => ({ mean, variance: 400 })),
    ...(drift !== undefined ? { drift } : {}),
  });
  const run = (teams: SeasonTeam[], w = weeks) => simulateSeason({ teams, weeks: w, pairings, medianGame: false, playoffTeams: 2, sims: 3000, freshWeeks: 1 });

  it('changes nothing at zero', () => {
    const plain = run([team(1, 115), team(2, 100), team(3, 100), team(4, 90)]);
    const zero = run([team(1, 115, 0), team(2, 100, 0), team(3, 100, 0), team(4, 90, 0)]);
    expect([...zero.values()]).toEqual([...plain.values()]);
  });

  it("makes the season's odds less sure: a stronger team can fade, a weaker one can surge", () => {
    const plain = run([team(1, 115), team(2, 100), team(3, 100), team(4, 90)]);
    const drifting = run([team(1, 115, 8), team(2, 100, 8), team(3, 100, 8), team(4, 90, 8)]);
    expect(drifting.get(1)!.pPlayoffs).toBeLessThan(plain.get(1)!.pPlayoffs - 0.03);
    expect(drifting.get(1)!.pPlayoffs).toBeGreaterThan(0.5);
    expect(drifting.get(4)!.pPlayoffs).toBeGreaterThan(plain.get(4)!.pPlayoffs + 0.03);
    expect([...drifting.values()].reduce((a, o) => a + o.pPlayoffs, 0)).toBeCloseTo(2, 9);
  });

  it("doesn't drift this week's fresh projections", () => {
    const one = [5];
    const plain = run([team(1, 115), team(2, 100), team(3, 100), team(4, 90)], one);
    const drifting = run([team(1, 115, 8), team(2, 100, 8), team(3, 100, 8), team(4, 90, 8)], one);
    expect([...drifting.values()]).toEqual([...plain.values()]);
  });
});

describe('playoff bracket', () => {
  it("orders seeds the way Sleeper's bracket pairs them", () => {
    expect(bracketOrder(2)).toEqual([1, 2]);
    expect(bracketOrder(4)).toEqual([1, 4, 2, 3]);
    expect(bracketOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
  });

  // Six teams seeded 1–6 by record (no regular-season weeks left), each scoring the same certain total every round.
  const seeded = (scores: number[]): SeasonTeam[] =>
    scores.map((mean, i) => ({ rosterId: i + 1, wins: 10 - i, losses: 3 + i, ties: 0, pointsFor: 1500, weeks: [], playoff: [0, 1, 2].map(() => ({ mean, variance: 0 })) }));
  const run = (teams: SeasonTeam[], reseed = false) =>
    simulateSeason({ teams, weeks: [], pairings: new Map(), medianGame: false, playoffTeams: 6, playoffRounds: 3, reseed, sims: 10 });

  it('gives the top seeds byes and plays the fixed bracket', () => {
    // Round 1: 6 beats 3, 4 beats 5. Fixed bracket: 1 meets 4, 2 meets 6, so 6 reaches the final; 1 wins it.
    const odds = run(seeded([100, 90, 70, 85, 60, 95]));
    expect([1, 2, 3, 4, 5, 6].map((id) => odds.get(id)!.pRound)).toEqual([
      [0, 1, 1],
      [0, 1, 0],
      [1, 0, 0],
      [1, 1, 0],
      [1, 0, 0],
      [1, 1, 1],
    ]);
    expect([1, 2, 3, 4, 5, 6].map((id) => odds.get(id)!.pTitle)).toEqual([1, 0, 0, 0, 0, 0]);
  });

  it('re-seeds each round when the league does: the best seed left meets the worst', () => {
    // Round 2 re-seeded: 1 meets 6 and 2 meets 4, so 2 reaches the final instead of 6.
    const odds = run(seeded([100, 90, 70, 85, 60, 95]), true);
    expect(odds.get(2)!.pRound).toEqual([0, 1, 1]);
    expect(odds.get(6)!.pRound).toEqual([1, 1, 0]);
    expect(odds.get(1)!.pTitle).toBe(1);
  });

  it('breaks a tied round in favour of the better seed', () => {
    const odds = run(seeded([80, 80, 80, 80, 80, 80]));
    expect(odds.get(1)!.pTitle).toBe(1);
    expect(odds.get(4)!.pRound).toEqual([1, 1, 0]); // beats seed 5 on the tie, then loses to seed 1 on one
    expect(odds.get(5)!.pRound).toEqual([1, 0, 0]);
  });

  it('spreads the title over an even field, with byes worth a round', () => {
    const teams = seeded([100, 100, 100, 100, 100, 100]).map((t) => ({ ...t, playoff: t.playoff!.map((d) => ({ ...d, variance: 400 })) }));
    const odds = simulateSeason({ teams, weeks: [], pairings: new Map(), medianGame: false, playoffTeams: 6, playoffRounds: 3, sims: 4000 });
    const title = [1, 2, 3, 4, 5, 6].map((id) => odds.get(id)!.pTitle!);
    expect(title.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    // Byes: two wins to the title (1/4) instead of three (1/8).
    for (const [i, expected] of [0.25, 0.25, 0.125, 0.125, 0.125, 0.125].entries()) expect(title[i]).toBeCloseTo(expected, 1);
    expect(odds.get(1)!.pRound![0]).toBe(0);
    expect(odds.get(1)!.pRound![1]).toBe(1);
  });
});

describe('FAAB', () => {
  const claim = (leg: number, id: string, bid: number, status = 'complete'): RawTransaction => ({ type: 'waiver', status, leg, adds: { [id]: 1 }, settings: { waiver_bid: bid } });
  const pos: Record<string, string> = { r1: 'RB', r2: 'RB', r3: 'RB', r4: 'RB', d1: 'DEF', d2: 'DEF', d3: 'DEF', d4: 'DEF', w1: 'WR' };
  const claims = [claim(3, 'r1', 40), claim(3, 'r2', 20), claim(4, 'r3', 10), claim(4, 'r4', 4), claim(4, 'd1', 1), claim(5, 'd2', 0), claim(5, 'd3', 2), claim(5, 'd4', 1), claim(5, 'w1', 30), claim(5, 'w1', 50, 'failed')];
  const market = faabMarket(claims, 100, (id) => pos[id])!;

  it('prices by position and tier from winning claims only', () => {
    expect(market.claims).toBe(9);
    expect(marketPrice(market, 'RB', 0)).toBeGreaterThan(marketPrice(market, 'RB', 2));
    expect(marketPrice(market, 'DEF', 0)).toBeLessThanOrEqual(2);
    // WR has a single claim: falls back to all claims.
    expect(marketPrice(market, 'WR', 1)).toBe(Math.round(100 * quantileOf([0, 1, 1, 2, 4, 10, 20, 30, 40].map((x) => x / 100), 0.55)));
    expect(tierOf(0)).toBe(0);
    expect(tierOf(2)).toBe(1);
    expect(tierOf(5)).toBe(2);
  });

  it('bids the minimum for players who barely help, and scales with budget otherwise', () => {
    expect(suggestBid(market, 'RB', 0, 1, 50, 50).bid).toBe(0);
    const rich = suggestBid(market, 'RB', 0, 10, 80, 40).bid;
    const poor = suggestBid(market, 'RB', 0, 10, 20, 40).bid;
    expect(rich).toBeGreaterThan(poor);
    expect(suggestBid(market, 'RB', 0, 10, 3, 40).bid).toBeLessThanOrEqual(3);
  });
});

function quantileOf(sorted: number[], q: number): number {
  const x = q * (sorted.length - 1);
  const lo = Math.floor(x);
  return sorted[lo]! + (sorted[Math.min(sorted.length - 1, lo + 1)]! - sorted[lo]!) * (x - lo);
}

describe('league outlook', () => {
  const ids = { me: ['qa', 'ra', 'rb', 'wa', 'da', 'rc'], opp: ['qb', 'rd', 're', 'wb', 'db'], c: ['qc', 'rf', 'wc', 'dc'], d: ['qd', 'rg', 'wd', 'dd'] };
  const posOf = (id: string) => {
    const k = id.replace(/^fa_/, '');
    return k[0] === 'q' ? 'QB' : k[0] === 'r' ? 'RB' : k[0] === 'w' ? 'WR' : 'DEF';
  };
  const all = [...Object.values(ids).flat(), 'fa_rb', 'fa_wr', 'fa_def'];
  const players = new Map(all.map((id) => [id, { ...player(id, posOf(id)), team: `T${id}` }]));
  const statFor = (id: string): StatLine =>
    posOf(id) === 'QB' ? { pass_yd: 240, pass_td: 1.7 } : posOf(id) === 'RB' ? { rush_yd: id === 'fa_rb' ? 95 : 55, rush_td: 0.4 } : posOf(id) === 'WR' ? { rec: 5, rec_yd: 60 } : { sack: 2.5 };
  const weekRows = Object.fromEntries(all.map((id) => [id, statFor(id)]));
  const byWeek = new Map(Array.from({ length: 9 }, (_, i) => [7 + i, index(weekRows, 7 + i, (id) => `T${id}`)]));
  const rosters: Roster[] = [
    { roster_id: 1, owner_id: 'u1', players: ids.me, starters: ['qa', 'ra', 'wa', 'rb', 'da'], settings: { wins: 3, losses: 2, waiver_budget_used: 40 } },
    { roster_id: 2, owner_id: 'u2', players: ids.opp, starters: ['qb', 'rd', 'wb', 're', 'db'], settings: { wins: 4, losses: 1, waiver_budget_used: 10 } },
    { roster_id: 3, owner_id: 'u3', players: ids.c, starters: ['qc', 'rf', 'wc', '0', 'dc'], settings: { wins: 2, losses: 3 } },
    { roster_id: 4, owner_id: 'u4', players: ids.d, starters: ['qd', 'rg', 'wd', '0', 'dd'], settings: { wins: 1, losses: 4 } },
  ].map(parseRoster);
  const pair = (a: number[], b: number[]): Matchup[] =>
    [...a.map((r) => ({ r, m: 1 })), ...b.map((r) => ({ r, m: 2 }))].map(({ r, m }) => parseMatchup({ roster_id: r, matchup_id: m, starters: [], players: [], points: 0 }));
  const schedule = new Map(Array.from({ length: 8 }, (_, i) => [7 + i, i % 2 ? pair([1, 3], [2, 4]) : pair([1, 4], [2, 3])]));
  const now = Date.UTC(2026, 9, 15, 12);
  const ctx: WeekContext = { season: '2026', week: 6, now, players, projections: index(weekRows, 6, (id) => `T${id}`), gamesByTeam: gamesByTeam([], 6) };
  const o = buildOutlook({ league, rosters, users: [], matchups: pair([1, 2], [3, 4]), ctx, byWeek, schedule, sims: 1500 });

  it('simulates the rest of the regular season, this week included', () => {
    expect(o.weeks).toEqual([7, 8, 9, 10, 11, 12, 13, 14, 15]);
    expect(o.regularWeeks[0]).toBe(6);
    const odds = [...o.odds!.values()];
    expect(odds.reduce((a, x) => a + x.pPlayoffs, 0)).toBeCloseTo(2, 9);
    expect(o.odds!.get(4)!.pPlayoffs).toBeLessThan(o.odds!.get(2)!.pPlayoffs);
    // Two-team playoff: the final is week 15, played by both playoff teams; it counts by the playoff odds.
    expect(o.playoffRounds).toEqual([[8]]);
    expect(odds.reduce((a, x) => a + x.pTitle!, 0)).toBeCloseTo(1, 9);
    const me = o.teams.get(1)!;
    expect(o.odds!.get(1)!.pRound).toEqual([o.odds!.get(1)!.pPlayoffs]);
    expect(me.weights.at(-1)).toBeCloseTo(o.odds!.get(1)!.pPlayoffs, 9);
    expect(scheduleOutlook(o, 1)[0]).toMatchObject({ week: 7, opponent: 4 });
    expect(scheduleOutlook(o, 1)[1]).toMatchObject({ week: 8, opponent: 3 });
  });

  it('ranks the free-agent RB first with a drop and a bid', () => {
    const claims: RawTransaction[] = Array.from({ length: 6 }, (_, i) => ({ type: 'waiver', status: 'complete', leg: 2 + (i % 3), adds: { [`x${i}`]: 2 }, settings: { waiver_bid: 5 + i * 3 } }));
    const board = waiverBoard(o, rosters[0]!, ctx, new Map(), claims);
    expect(board.rows[0]!.player.id).toBe('fa_rb');
    expect(board.rows[0]!.rosGain).toBeGreaterThan(5);
    expect(board.openSpots).toBe(1);
    expect(board.remaining).toBe(60);
    expect(board.rows[0]!.bid!.bid).toBeGreaterThan(0);
  });

  it('evaluates a trade for both sides', () => {
    const fa = freeAgentPool(o, ctx);
    expect(fa[0]).toBe('fa_rb');
    // Give my WR for their RB: I have RB depth already, they have none at WR.
    const t = evaluateTrade(o, ctx, 1, 2, ['wa'], ['rd'], fa);
    expect(t.me.delta + t.them.delta).not.toBe(0);
    expect(t.me.weekly).toHaveLength(o.weeks.length);
    expect(t.me.pBefore).toBeCloseTo(o.odds!.get(1)!.pPlayoffs, 9);
    expect(t.me.titleBefore).toBeCloseTo(o.odds!.get(1)!.pTitle!, 9);
    // A range around the change, and the chance it helps, on the same side of even as the change itself.
    for (const side of [t.me, t.them]) {
      expect(side.range![0]).toBeLessThan(side.delta);
      expect(side.range![1]).toBeGreaterThan(side.delta);
      expect(side.pBetter! > 0.5).toBe(side.delta > 0);
    }
    expect(t.them.titleAfter).toBeGreaterThanOrEqual(0);
    expect(t.deadlinePassed).toBe(false);
    // 2-for-1: my open spot absorbs the extra player; they may refill only the one spot the trade frees.
    const two = evaluateTrade(o, ctx, 1, 2, ['wa'], ['rd', 're'], fa);
    expect(two.me.drops).toHaveLength(0);
    expect(two.them.adds).toEqual(['fa_rb']);
    // 3-for-1 overflows my roster by one: the cheapest player goes.
    const three = evaluateTrade(o, ctx, 1, 2, ['wa'], ['rd', 're', 'wb'], fa);
    expect(three.me.drops).toHaveLength(1);
  });

  it('plays out a bracket of two-week rounds with a bye, which only discounts the bye weeks', () => {
    const three = parseLeague({ ...rawLeague, settings: { ...rawLeague.settings, playoff_teams: 3, playoff_round_type: 2 } });
    const toWeek18 = new Map(Array.from({ length: 12 }, (_, i) => [7 + i, index(weekRows, 7 + i, (id) => `T${id}`)]));
    const b = buildOutlook({ league: three, rosters, users: [], matchups: pair([1, 2], [3, 4]), ctx, byWeek: toWeek18, schedule, sims: 1500 });
    expect(b.weeks.at(-1)).toBe(18);
    expect(b.playoffRounds).toEqual([[8, 9], [10, 11]]);
    const odds = [...b.odds!.values()];
    expect(odds.reduce((a, x) => a + x.pTitle!, 0)).toBeCloseTo(1, 9);
    expect(odds.reduce((a, x) => a + x.pRound![0]!, 0)).toBeCloseTo(2, 9); // seeds 2 and 3; seed 1 has the bye
    expect(odds.reduce((a, x) => a + x.pRound![1]!, 0)).toBeCloseTo(2, 9); // two finalists
    for (const x of odds) {
      const firstRound = Math.max(0, x.pPlayoffs - x.pBye);
      expect(b.teams.get(x.rosterId)!.weights.slice(8)).toEqual([firstRound, firstRound, x.pPlayoffs, x.pPlayoffs]);
    }
  });

  it('lists DEF streamers: mine first, then free agents', () => {
    const s = streamers(o, rosters[0]!, ctx, 'DEF');
    expect(s[0]!.mine).toBe(true);
    expect(s.some((r) => r.player.id === 'fa_def')).toBe(true);
    expect(streamers(o, rosters[0]!, ctx, 'K')).toEqual([]);
  });
});
