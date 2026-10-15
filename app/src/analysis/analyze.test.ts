import { describe, expect, it } from 'vitest';
import type { Game, League, Roster } from '../domain/types';
import { indexProjections, parseLeague, parseMatchup, parseRoster } from '../sleeper/parse';
import type { RawLeague, RawMatchup, RawProjection } from '../sleeper/raw';
import { analyzeLineup, analyzeWaivers, gamesByTeam, playerRow, type WeekContext } from './analyze';

const H = 3_600_000;
const now = Date.UTC(2026, 9, 18, 12, 0); // Sun Oct 18, 08:00 ET
const iso = (hoursFromNow: number) => new Date(now + hoursFromNow * H).toISOString();

const rawLeague: RawLeague = {
  league_id: 'L1',
  name: 'Test League',
  season: '2026',
  status: 'in_season',
  total_rosters: 4,
  roster_positions: ['QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DEF', 'BN', 'BN', 'BN'],
  scoring_settings: { pass_yd: 0.04, pass_td: 4, pass_int: -1, rush_yd: 0.1, rush_td: 6, rec: 0.5, rec_yd: 0.1, rec_td: 6, bonus_rec_te: 0.5, fgm: 3, xpm: 1, sack: 1, int: 2, pts_allow_14_20: 1, pts_allow_28_34: -1 },
  settings: { type: 0, num_teams: 4, league_average_match: 1, playoff_week_start: 15, trade_deadline: 11, reserve_slots: 1, reserve_allow_out: 1, waiver_budget: 100 },
};

const games: Game[] = [
  { id: 'g1', week: 6, away: 'AAA', home: 'BBB', kickoff: iso(5), spread: 3, total: 45, homeImplied: 24, awayImplied: 21 }, // 1 pm ET
  { id: 'g2', week: 6, away: 'CCC', home: 'DDD', kickoff: iso(8.4) }, // 4:25 pm ET
  { id: 'g3', week: 6, away: 'EEE', home: 'FFF', kickoff: iso(-36) }, // already played (TNF)
];

const proj = (id: string, pos: string, team: string, stats: Record<string, number>, injury: string | null = null, fpos?: string[]): RawProjection => ({
  player_id: id,
  stats,
  team,
  company: 'rotowire',
  player: { first_name: id, last_name: pos, position: pos, fantasy_positions: fpos ?? [pos], team, injury_status: injury },
});

const rows: RawProjection[] = [
  proj('qb1', 'QB', 'AAA', { pass_yd: 250, pass_td: 1.8, pass_int: 0.7, rush_yd: 15 }),
  proj('rb1', 'RB', 'BBB', { rush_yd: 80, rush_td: 0.6, rec: 3, rec_yd: 20 }, 'Out'),
  proj('rb2', 'RB', 'CCC', { rush_yd: 60, rush_td: 0.4, rec: 2, rec_yd: 15 }),
  proj('wr1', 'WR', 'EEE', { rec: 6, rec_yd: 80, rec_td: 0.5 }),
  proj('wr2', 'WR', 'DDD', { rec: 4, rec_yd: 50, rec_td: 0.3 }),
  proj('wr3', 'WR', 'AAA', { rec: 5, rec_yd: 70, rec_td: 0.5 }, 'Questionable'),
  proj('te1', 'TE', 'BBB', { rec: 4, rec_yd: 45, rec_td: 0.35, bonus_rec_te: 4 }),
  proj('k1', 'K', 'DDD', { fgm: 1.8, xpm: 2.4 }),
  proj('def1', 'DEF', 'CCC', { sack: 2.5, int: 0.8, pts_allow: 20 }),
  // free agents
  proj('fa_rb', 'RB', 'AAA', { rush_yd: 85, rush_td: 0.7, rec: 3, rec_yd: 25 }),
  proj('fa_wr', 'WR', 'BBB', { rec: 2, rec_yd: 20, rec_td: 0.1 }),
  // opponent
  proj('o_qb', 'QB', 'BBB', { pass_yd: 240, pass_td: 1.6, pass_int: 0.8 }),
  proj('o_rb', 'RB', 'DDD', { rush_yd: 70, rush_td: 0.5, rec: 2, rec_yd: 10 }),
];

function context(): WeekContext {
  const projections = indexProjections(rows, 6);
  return { season: '2026', week: 6, now, players: new Map(projections.players), projections, gamesByTeam: gamesByTeam(games, 6) };
}

const league: League = parseLeague(rawLeague);
const myRaw = { roster_id: 1, owner_id: 'me', players: ['qb1', 'rb1', 'rb2', 'wr1', 'wr2', 'wr3', 'te1', 'k1', 'def1', 'ir1'], starters: ['qb1', 'rb1', 'wr2', 'te1', 'wr3', 'k1', 'def1'], reserve: ['ir1'] };
const oppRaw = { roster_id: 2, owner_id: 'opp', players: ['o_qb', 'o_rb'], starters: ['o_qb', 'o_rb', '0', '0', '0', '0', '0'] };
const rosters: Roster[] = [myRaw, oppRaw, { roster_id: 3, owner_id: 'c', players: [], starters: [] }, { roster_id: 4, owner_id: 'd', players: [], starters: [] }].map(parseRoster);
const rawMatchups: RawMatchup[] = [
  { roster_id: 1, matchup_id: 1, starters: myRaw.starters, players: myRaw.players, points: 14.2, players_points: { wr1: 14.2 } },
  { roster_id: 2, matchup_id: 1, starters: oppRaw.starters, players: oppRaw.players, points: 0, players_points: {} },
  { roster_id: 3, matchup_id: 2, starters: [], players: [], points: 0 },
  { roster_id: 4, matchup_id: 2, starters: [], players: [], points: 0 },
];
const matchups = rawMatchups.map(parseMatchup);
const users = [
  { userId: 'me', displayName: 'Me', teamName: 'My Team' },
  { userId: 'opp', displayName: 'Opp' },
];

describe('league rules', () => {
  it('parses settings that change decisions', () => {
    expect(league.rules).toMatchObject({ type: 'redraft', medianGame: true, numTeams: 4, playoffWeekStart: 15, tradeDeadline: 11, reserveSlots: 1, waiverBudget: 100 });
    expect(league.rules.reserveAllow.out).toBe(true);
  });
});

describe('playerRow', () => {
  it('rescores projections to league scoring incl. TE premium and prices DEF buckets', () => {
    const ctx = context();
    const te = playerRow('te1', league, ctx);
    expect(te.mu).toBeCloseTo(4 * 0.5 + 4.5 + 0.35 * 6 + 4 * 0.5, 6);
    expect(te.opponent).toBe('AAA');
    expect(te.home).toBe(true);
    expect(te.teamImplied).toBe(24);
    const def = playerRow('def1', league, ctx);
    expect(def.mu).toBeGreaterThan(2.5 + 1.6); // sacks + INTs + small bucket edge
    const out = playerRow('rb1', league, ctx);
    expect(out.p).toBe(0);
  });
  it('locks players whose game has started and records actual points', () => {
    const r = playerRow('wr1', league, context(), 14.2);
    expect(r.locked).toBe(true);
    expect(r.actual).toBe(14.2);
  });
});

describe('analyzeLineup', () => {
  const a = analyzeLineup(league, rosters, users, matchups, rosters[0]!, context());

  it('benches the Out starter and keeps the locked one', () => {
    const recIds = a.recommended.map((r) => r?.id);
    expect(recIds).not.toContain('rb1');
    expect(recIds).not.toContain('wr1'); // played Thursday on the bench: locked players can't come in
    expect(a.changes.some((c) => c.out?.id === 'rb1')).toBe(true);
    expect(a.gain).toBeGreaterThan(5);
  });

  it('flags the Out and Questionable starters', () => {
    const texts = a.problems.map((p) => p.text).join('\n');
    expect(texts).toMatch(/rb1 RB \(RB\) is Out/);
    expect(texts).toMatch(/wr3 WR \(FLEX\) is Questionable — 70% to play/);
    expect(texts).toMatch(/Better lineup available/);
  });

  it('computes win probabilities against the opponent and the median', () => {
    expect(a.opponent?.name).toBe('Opp');
    expect(a.winProbRecommended).toBeGreaterThan(a.winProbCurrent!);
    expect(a.winProbRecommended).toBeGreaterThan(0.5);
    // The other two teams are empty, so beating half the league is near-certain.
    expect(a.medianProb).toBeGreaterThan(0.9);
    expect(a.medianProb).toBeLessThanOrEqual(1);
  });

  it('lists IR candidates and uncovered scoring keys', () => {
    expect(a.uncoveredKeys).toEqual([]);
    expect(a.reserve.map((r) => r.id)).toEqual(['ir1']);
  });
});

describe('analyzeWaivers', () => {
  it('ranks the free agent who improves this week’s lineup first', () => {
    const w = analyzeWaivers(league, rosters, rosters[0]!, context(), new Map([['fa_wr', 120]]));
    expect(w[0]!.player.id).toBe('fa_rb');
    expect(w[0]!.gainThisWeek).toBeGreaterThan(3);
    const faWr = w.find((x) => x.player.id === 'fa_wr');
    expect(faWr?.trendingAdds).toBe(120);
    expect(faWr?.gainThisWeek).toBe(0);
  });
});
