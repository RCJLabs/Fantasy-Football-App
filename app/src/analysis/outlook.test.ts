import { describe, expect, it } from 'vitest';
import type { League, Matchup, Player, Roster, StatLine } from '../domain/types';
import type { ProjectionIndex } from '../sleeper/parse';
import { parseLeague, parseMatchup, parseRoster } from '../sleeper/parse';
import type { RawLeague, RawTransaction } from '../sleeper/raw';
import { gamesByTeam, type WeekContext } from './analyze';
import { faabMarket, marketPrice, suggestBid, tierOf } from './faab';
import { buildOutlook, byeGrid, evaluateTrade, freeAgentPool, regularStarters, scheduleOutlook, streamers, waiverBoard } from './outlook';
import { addGains, playoffByes, playoffRounds, projectionPositions, regularSeasonEnd, RosModel, seasonEnd, weekWeights } from './ros';
import { simulateSeason } from './season';

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
    expect(weekWeights(league, [13, 14, 15], 0.4)).toEqual([1, 1, 0.4]);
    expect(weekWeights(noPlayoffs, [15, 16], 0)).toEqual([1, 1]);
  });
  it('fetches IDP projections only for IDP leagues', () => {
    expect(projectionPositions(league)).not.toContain('LB');
    const idp = parseLeague({ ...rawLeague, roster_positions: ['QB', 'IDP_FLEX', 'BN'] });
    expect(projectionPositions(idp)).toContain('LB');
  });
});

describe('RosModel', () => {
  const players = new Map(['qb', 'rb1', 'rb2', 'wr1', 'def'].map((id) => [id, player(id, id.startsWith('rb') ? 'RB' : id === 'qb' ? 'QB' : id === 'def' ? 'DEF' : 'WR')]));
  const byWeek = new Map([
    [7, index({ qb: { pass_yd: 250, pass_td: 2 }, rb1: { rush_yd: 100 }, rb2: { rush_yd: 60 }, wr1: { rec: 5, rec_yd: 50 }, def: { sack: 3 } }, 7)],
    [8, index({ qb: { pass_yd: 250, pass_td: 2 }, rb2: { rush_yd: 60 }, wr1: { rec: 5, rec_yd: 50 }, def: { sack: 3 } }, 8)], // rb1 on bye
  ]);
  const model = new RosModel({ league, weeks: [7, 8], byWeek, players });

  it('scores future weeks with availability and lets depth cover byes', () => {
    expect(model.ev('rb1')[0]).toBeCloseTo(0.91 * 10, 9);
    expect(model.ev('rb1')[1]).toBe(0);
    expect(model.ev('def')[0]).toBeCloseTo(3, 9); // DEFs don't get hurt
    const team = ['qb', 'rb1', 'rb2', 'wr1', 'def'];
    const w7 = model.bestWeek(team, 0);
    // QB 18×.95 + RB 10×.91 + WR 10×.93 + FLEX rb2 6×.91 + DEF 3; no bench left to insure anyone.
    expect(w7.mean).toBeCloseTo(18 * 0.95 + 9.1 + 9.3 + 6 * 0.91 + 3, 9);
    // Week 8: rb2 starts at RB; FLEX empty.
    expect(model.bestWeek(team, 1).mean).toBeCloseTo(18 * 0.95 + 6 * 0.91 + 9.3 + 3, 9);
  });

  it('values a bench player as insurance for starters who might miss', () => {
    const withBench = model.bestWeek(['qb', 'rb1', 'wr1', 'def', 'rb2'], 0);
    const flexless = new RosModel({ league: parseLeague({ ...rawLeague, roster_positions: ['QB', 'RB', 'WR', 'DEF', 'BN'] }), weeks: [7], byWeek, players });
    const insured = flexless.bestWeek(['qb', 'rb1', 'wr1', 'def', 'rb2'], 0).mean;
    const bare = flexless.bestWeek(['qb', 'rb1', 'wr1', 'def'], 0).mean;
    expect(insured - bare).toBeCloseTo((1 - 0.91) * 0.91 * 6, 9); // rb1 out → rb2 plays
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
  });

  it('adds median wins and keeps odds summing to the playoff spots', () => {
    const teams = [1, 2, 3, 4].map((id) => ({ rosterId: id, wins: 3, losses: 2, ties: 0, pointsFor: 500, weeks: [{ mean: 100, variance: 400 }, { mean: 100, variance: 400 }] }));
    const odds = simulateSeason({ teams, weeks: [7, 8], pairings, medianGame: true, playoffTeams: 2, sims: 2000 });
    const total = [...odds.values()].reduce((a, o) => a + o.pPlayoffs, 0);
    expect(total).toBeCloseTo(2, 9);
    for (const o of odds.values()) expect(o.expWins + o.expLosses).toBeCloseTo(5 + 4, 9); // 2 weeks × (H2H + median)
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
    // Playoff-week weight follows playoff odds.
    const me = o.teams.get(1)!;
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
    expect(t.deadlinePassed).toBe(false);
    // 2-for-1: my open spot absorbs the extra player; they may refill only the one spot the trade frees.
    const two = evaluateTrade(o, ctx, 1, 2, ['wa'], ['rd', 're'], fa);
    expect(two.me.drops).toHaveLength(0);
    expect(two.them.adds).toEqual(['fa_rb']);
    // 3-for-1 overflows my roster by one: the cheapest player goes.
    const three = evaluateTrade(o, ctx, 1, 2, ['wa'], ['rd', 're', 'wb'], fa);
    expect(three.me.drops).toHaveLength(1);
  });

  it('lists DEF streamers: mine first, then free agents', () => {
    const s = streamers(o, rosters[0]!, ctx, 'DEF');
    expect(s[0]!.mine).toBe(true);
    expect(s.some((r) => r.player.id === 'fa_def')).toBe(true);
    expect(streamers(o, rosters[0]!, ctx, 'K')).toEqual([]);
  });
});
