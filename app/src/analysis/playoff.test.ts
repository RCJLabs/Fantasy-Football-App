import { describe, expect, it } from 'vitest';
import type { Game } from '../domain/types';
import { indexProjections, parseLeague, parseMatchup, parseRoster } from '../sleeper/parse';
import type { RawLeague, RawProjection } from '../sleeper/raw';
import { analyzeLineup, gamesByTeam, teamSide, type WeekContext } from './analyze';
import { playoffWeekInfo } from './ros';

const H = 3_600_000;
const now = Date.UTC(2026, 11, 20, 12, 0); // Sun Dec 20, week 15
const iso = (h: number) => new Date(now + h * H).toISOString();
const games: Game[] = [
  ['KC', 'BUF'],
  ['DAL', 'NYG'],
  ['SEA', 'SF'],
  ['LV', 'DEN'],
].map(([away, home], i) => ({ id: `g${i}`, week: 15, away: away!, home: home!, kickoff: iso(5) }));

const rawLeague: RawLeague = {
  league_id: 'P',
  name: 'Playoffs',
  season: '2026',
  status: 'in_season',
  total_rosters: 2,
  roster_positions: ['QB', 'WR', 'TE', 'BN', 'BN', 'BN', 'BN'],
  scoring_settings: { pass_yd: 0.04, pass_td: 4, rec: 1, rec_yd: 0.1, rec_td: 6 },
  settings: { type: 0, num_teams: 2, playoff_week_start: 15, playoff_teams: 4, league_average_match: 1 },
};
const league = parseLeague(rawLeague);

const row = (id: string, pos: string, team: string, stats: Record<string, number>, injury: string | null = null): RawProjection => ({
  player_id: id,
  stats,
  team,
  player: { first_name: id, last_name: pos, position: pos, fantasy_positions: [pos], team, injury_status: injury },
});
const qb = (pass_yd: number, pass_td: number) => ({ pass_yd, pass_td });
const rec = (n: number, yd: number) => ({ rec: n, rec_yd: yd });
const mine = [
  row('myqb', 'QB', 'KC', qb(250, 2)), // 18
  row('wr_kc', 'WR', 'KC', rec(4, 60)), // 10.0, stacks with my QB
  row('wr_dal', 'WR', 'DAL', rec(4, 60)), // 10.0, same team as the favorite case's opposing QB
  row('wr_sea', 'WR', 'SEA', rec(4, 62)), // 10.2, uncorrelated
  row('te_kc', 'TE', 'KC', rec(3, 50)), // 8.0
  row('te_dal', 'TE', 'DAL', rec(3, 50)), // 8.0
  row('te_sf', 'TE', 'SF', rec(3, 52)), // 8.2
];
const strongOpp = [row('oqb', 'QB', 'LV', qb(330, 2.5)), row('owr', 'WR', 'LV', rec(8, 110)), row('ote', 'TE', 'DEN', rec(6, 70))];
const weakOpp = [row('oqb', 'QB', 'DAL', qb(180, 1)), row('owr', 'WR', 'DEN', rec(3, 30)), row('ote', 'TE', 'DEN', rec(1, 10))];

function setup(opp: RawProjection[], extraRows: RawProjection[] = []) {
  const projections = indexProjections([...mine, ...opp, ...extraRows], 15);
  const ctx: WeekContext = { season: '2026', week: 15, now, players: new Map(projections.players), projections, gamesByTeam: gamesByTeam(games, 15) };
  const myStarters = ['myqb', 'wr_sea', 'te_sf'];
  const rosters = [
    parseRoster({ roster_id: 1, owner_id: 'me', players: mine.map((r) => r.player_id), starters: myStarters }),
    parseRoster({ roster_id: 2, owner_id: 'opp', players: [...opp, ...extraRows].map((r) => r.player_id), starters: ['oqb', 'owr', 'ote'] }),
  ];
  const matchups = [
    parseMatchup({ roster_id: 1, matchup_id: 1, starters: myStarters, players: rosters[0]!.players, points: 0 }),
    parseMatchup({ roster_id: 2, matchup_id: 1, starters: ['oqb', 'owr', 'ote'], players: rosters[1]!.players, points: 0 }),
  ];
  return { ctx, rosters, matchups };
}
const ids = (rows: ReadonlyArray<{ id: string } | null>) => rows.map((r) => r?.id);

describe('playoff calendar', () => {
  it('finds the round and the week within multi-week rounds', () => {
    const six = parseLeague({ ...rawLeague, settings: { ...rawLeague.settings, playoff_teams: 6 } });
    expect(playoffWeekInfo(six, 14)).toBeNull();
    expect(playoffWeekInfo(six, 15)).toEqual({ round: 1, rounds: 3, weekInRound: 1, roundWeeks: 1 });
    expect(playoffWeekInfo(six, 17)).toEqual({ round: 3, rounds: 3, weekInRound: 1, roundWeeks: 1 });
    expect(playoffWeekInfo(six, 18)).toBeNull();
    const twoWeekFinal = parseLeague({ ...rawLeague, settings: { ...rawLeague.settings, playoff_teams: 4, playoff_round_type: 1 } });
    expect(playoffWeekInfo(twoWeekFinal, 15)).toMatchObject({ round: 1, roundWeeks: 1 });
    expect(playoffWeekInfo(twoWeekFinal, 17)).toMatchObject({ round: 2, weekInRound: 2, roundWeeks: 2 });
    const twoWeekRounds = parseLeague({ ...rawLeague, settings: { ...rawLeague.settings, playoff_teams: 4, playoff_round_type: 2 } });
    expect(playoffWeekInfo(twoWeekRounds, 16)).toMatchObject({ round: 1, weekInRound: 2 });
    expect(playoffWeekInfo(twoWeekRounds, 17)).toMatchObject({ round: 2, weekInRound: 1 });
  });
});

describe('playoff mode', () => {
  it('as the underdog, stacks pass-catchers with its QB to raise the ceiling', () => {
    const { ctx, rosters, matchups } = setup(strongOpp);
    const a = analyzeLineup(league, rosters, [], matchups, rosters[0]!, ctx);
    expect(a.objective).toBe('win');
    expect(a.medianProb).toBeUndefined(); // no median game in the playoffs
    expect(ids(a.recommended)).toEqual(['myqb', 'wr_kc', 'te_kc']);
    expect(a.maxPoints!.same).toBe(false);
    expect(a.winProbRecommended!).toBeGreaterThan(a.maxPoints!.winProb! + 0.005);
    expect(a.expectedRecommended).toBeLessThan(a.maxPoints!.expected);
    expect(a.problems[0]!.text).toMatch(/win chance \d+% → \d+%/);
    // Points mode keeps the higher-mean, uncorrelated options.
    const p = analyzeLineup(league, rosters, [], matchups, rosters[0]!, ctx, { objective: 'points' });
    expect(ids(p.recommended)).toEqual(['myqb', 'wr_sea', 'te_sf']);
  });

  it('as the favorite, hedges with players who move with the opposing QB', () => {
    const { ctx, rosters, matchups } = setup(weakOpp);
    const a = analyzeLineup(league, rosters, [], matchups, rosters[0]!, ctx);
    expect(ids(a.recommended)).toEqual(['myqb', 'wr_dal', 'te_dal']);
    expect(a.winProbRecommended!).toBeGreaterThan(0.5);
    expect(a.winProbRecommended!).toBeGreaterThan(a.maxPoints!.winProb! + 0.005);
  });

  it('counts the other week of a two-week round', () => {
    const { ctx, rosters, matchups } = setup(strongOpp);
    const behind = analyzeLineup(league, rosters, [], matchups, rosters[0]!, ctx);
    const ahead = analyzeLineup(league, rosters, [], matchups, rosters[0]!, ctx, { extra: { me: { mean: 60, variance: 0 }, opp: { mean: 30, variance: 0 } } });
    expect(ahead.winProbRecommended!).toBeGreaterThan(0.6);
    expect(ahead.winProbRecommended!).toBeGreaterThan(behind.winProbRecommended!);
  });

  it('assumes the opponent replaces a starter who is out', () => {
    const { ctx, rosters, matchups } = setup(
      [row('oqb', 'QB', 'LV', qb(330, 2.5)), row('owr', 'WR', 'LV', {}, 'Out'), row('ote', 'TE', 'DEN', rec(6, 70))],
      [row('obench', 'WR', 'DEN', rec(5, 70))],
    );
    const side = teamSide(league, rosters[1]!, [], matchups, ctx);
    expect(side.assumed).toEqual(['obench']);
    expect(ids(side.rows)).toContain('obench');
  });
});
