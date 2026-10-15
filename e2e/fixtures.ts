// Mock Sleeper responses and pipeline data files for the end-to-end test. Shapes follow the live
// responses recorded in docs/spikes.md; names and numbers are invented.
import type { CompactPlayer, PlayersFile, ScheduleFile, UsageFile } from '../app/src/data/contracts';
import type { RawLeague, RawMatchup, RawProjection, RawRoster, RawTradedPick, RawTransaction } from '../app/src/sleeper/raw';

const H = 3_600_000;
export const now = Date.now();
const iso = (h: number) => new Date(now + h * H).toISOString();

export const state = { week: 6, leg: 6, season: '2026', season_type: 'regular', league_season: '2026', display_week: 6 };
export const user = { user_id: 'u1', username: 'testuser', display_name: 'Test User' };

export const league: RawLeague = {
  league_id: '1001',
  name: 'Saturday Night Gridiron',
  season: '2026',
  status: 'in_season',
  total_rosters: 4,
  roster_positions: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF', 'BN', 'BN', 'BN', 'BN'],
  scoring_settings: { pass_yd: 0.04, pass_td: 4, pass_int: -1, rush_yd: 0.1, rush_td: 6, rec: 0.5, rec_yd: 0.1, rec_td: 6, fum_lost: -2, bonus_rec_te: 0.5, fgm: 3, xpm: 1, sack: 1, int: 2, fum_rec: 2, pts_allow_0: 10, pts_allow_1_6: 7, pts_allow_7_13: 4, pts_allow_14_20: 1, pts_allow_28_34: -1, pts_allow_35p: -4 },
  settings: {
    type: 1, // keeper: exercises the long-term views
    max_keepers: 2,
    num_teams: 4,
    league_average_match: 1,
    playoff_week_start: 15,
    playoff_teams: 2,
    trade_deadline: 11,
    reserve_slots: 1,
    reserve_allow_out: 1,
    waiver_budget: 100,
    waiver_type: 2,
    last_scored_leg: 5,
  },
};
export const otherLeague: RawLeague = { ...league, league_id: '1002', name: 'Dynasty Startup', status: 'pre_draft', settings: { ...league.settings, type: 2 } };
/** In-season dynasty league with the same teams: exercises draft picks. */
export const dynastyLeague: RawLeague = { ...league, league_id: '1003', name: 'Gridiron Dynasty', settings: { ...league.settings, type: 2, pick_trading: 1, draft_rounds: 2 } };

/** Dynasty league: I own Rival Raiders' 2027 1st; they own my 2028 2nd. */
export const tradedPicks: RawTradedPick[] = [
  { season: '2027', round: 1, roster_id: 2, owner_id: 1, previous_owner_id: 2 },
  { season: '2028', round: 2, roster_id: 1, owner_id: 2, previous_owner_id: 1 },
];

// Teams: AAA@BBB live (kicked off 1h ago), CCC@DDD in 5h, EEE@FFF in 8h; GGG is on bye.
export const schedule: ScheduleFile = {
  schemaVersion: 1,
  generatedAt: iso(-2),
  season: '2026',
  games: [
    { id: '2026_06_AAA_BBB', week: 6, away: 'AAA', home: 'BBB', kickoff: iso(-1), spread: 3, total: 44, homeImplied: 23.5, awayImplied: 20.5 },
    { id: '2026_06_CCC_DDD', week: 6, away: 'CCC', home: 'DDD', kickoff: iso(5), spread: -6.5, total: 48.5, homeImplied: 21, awayImplied: 27.5 },
    { id: '2026_06_EEE_FFF', week: 6, away: 'EEE', home: 'FFF', kickoff: iso(8), spread: 1, total: 41, homeImplied: 21, awayImplied: 20 },
  ],
};

type P = [id: string, name: string, pos: string, team: string, stats: Record<string, number>, injury?: string];
const PLAYERS: P[] = [
  ['q1', 'Casey Quarterback', 'QB', 'CCC', { pass_yd: 265, pass_td: 1.9, pass_int: 0.7, rush_yd: 18 }],
  ['r1', 'Riley Runner', 'RB', 'CCC', { rush_yd: 82, rush_td: 0.65, rec: 3, rec_yd: 22 }, 'Out'],
  ['r2', 'Morgan Halfback', 'RB', 'EEE', { rush_yd: 64, rush_td: 0.45, rec: 2.5, rec_yd: 18 }],
  ['r3', 'Jordan Back', 'RB', 'GGG', { rush_yd: 70, rush_td: 0.5 }],
  ['r4', 'Casey Depth', 'RB', 'EEE', { rush_yd: 40, rush_td: 0.3, rec: 1.5, rec_yd: 10 }],
  ['w1', 'Taylor Wideout', 'WR', 'AAA', { rec: 6, rec_yd: 82, rec_td: 0.5 }],
  ['w2', 'Drew Flanker', 'WR', 'DDD', { rec: 5, rec_yd: 66, rec_td: 0.4 }, 'Questionable'],
  ['w3', 'Sam Slot', 'WR', 'FFF', { rec: 4.5, rec_yd: 55, rec_td: 0.35 }],
  ['t1', 'Avery Tightend', 'TE', 'DDD', { rec: 4, rec_yd: 44, rec_td: 0.35, bonus_rec_te: 4 }],
  ['k1', 'Kai Kicker', 'K', 'CCC', { fgm: 1.9, xpm: 2.6 }],
  ['d1', 'Fff Defense', 'DEF', 'FFF', { sack: 2.6, int: 0.8, fum_rec: 0.6, pts_allow: 20.5 }],
  ['ir', 'Pat Injured', 'WR', 'BBB', {}, 'IR'],
  ['fa1', 'Free Agent Runner', 'RB', 'EEE', { rush_yd: 88, rush_td: 0.7, rec: 3, rec_yd: 24 }],
  ['fa2', 'Waiver Receiver', 'WR', 'FFF', { rec: 3, rec_yd: 35, rec_td: 0.2 }],
  ['o1', 'Opp Passer', 'QB', 'BBB', { pass_yd: 240, pass_td: 1.6, pass_int: 0.8 }],
  ['o2', 'Opp Rusher', 'RB', 'DDD', { rush_yd: 75, rush_td: 0.55, rec: 2, rec_yd: 12 }],
];

const projectionRow = ([id, name, pos, team, stats, injury]: P, sidelined: boolean): RawProjection => ({
  player_id: id,
  // Sleeper rows carry pts_ppr; the rest-of-season cache uses it to skip near-zero players.
  stats: sidelined ? {} : { ...stats, pts_ppr: 10 },
  team,
  company: 'rotowire',
  player: { first_name: name.split(' ')[0], last_name: name.split(' ').slice(1).join(' '), position: pos, fantasy_positions: [pos], team, injury_status: injury ?? null },
});

export const projections: RawProjection[] = PLAYERS.map((p) => projectionRow(p, p[5] === 'Out' || p[5] === 'IR'));

/** Weeks 7+: the Out RB is back; team GGG is on bye in week 8. */
export const futureProjections = (week: number): RawProjection[] =>
  PLAYERS.filter((p) => !(week === 8 && p[3] === 'GGG')).map((p) => projectionRow(p, p[5] === 'IR'));

export const playersFile: PlayersFile = {
  schemaVersion: 1,
  generatedAt: iso(-3),
  season: '2026',
  week: 6,
  injuryReportWeek: 6,
  players: PLAYERS.map(([id, name, pos, team, , injury]): CompactPlayer => ({
    id,
    n: name,
    pos,
    t: team,
    ...(injury ? { inj: injury } : {}),
    ...(id === 'w2' ? { prac: 'Limited' as const, rpt: 'Questionable', body: 'Hamstring' } : {}),
  })),
};

export const manifest = { schemaVersion: 1, generatedAt: iso(-3), files: {} };

/** Recent usage (nflverse-shaped, numbers invented): the free-agent RB's role is growing. */
export const usage: UsageFile = {
  schemaVersion: 1,
  generatedAt: iso(-3),
  season: '2026',
  weeks: [2, 3, 4, 5],
  players: {
    fa1: { snap: [30, 45, 61, 84], tgt: [1, 2, 2, 3], car: [5, 8, 12, 18], tshare: [3, 6, 6, 9], cshare: [20, 30, 45, 62] },
    w2: { snap: [80, 85, null, 90], tgt: [6, 7, null, 9], car: [0, 0, null, 0], tshare: [20, 22, null, 25], cshare: [0, 0, null, 0] },
  },
};

const me: RawRoster = {
  roster_id: 1,
  owner_id: 'u1',
  players: ['q1', 'r1', 'r2', 'r3', 'r4', 'w1', 'w2', 'w3', 't1', 'k1', 'd1', 'ir'],
  starters: ['q1', 'r1', 'r3', 'w1', 'w2', 't1', 'w3', 'k1', 'd1'],
  reserve: ['ir'],
  settings: { wins: 4, losses: 1, fpts: 612, waiver_budget_used: 30 },
};
const opp: RawRoster = { roster_id: 2, owner_id: 'u2', players: ['o1', 'o2'], starters: ['o1', 'o2', '0', '0', '0', '0', '0', '0', '0'], settings: { wins: 3, losses: 2 } };
export const rosters: RawRoster[] = [me, opp, { roster_id: 3, owner_id: 'u3', players: [], starters: [] }, { roster_id: 4, owner_id: 'u4', players: [], starters: [] }];
export const users = [
  { user_id: 'u1', display_name: 'Test User', metadata: { team_name: 'Test Titans' } },
  { user_id: 'u2', display_name: 'Rival', metadata: { team_name: 'Rival Raiders' } },
  { user_id: 'u3', display_name: 'Three' },
  { user_id: 'u4', display_name: 'Four' },
];
export const matchups: RawMatchup[] = [
  { roster_id: 1, matchup_id: 1, starters: me.starters, players: me.players, points: 11.4, players_points: { w1: 11.4 } },
  { roster_id: 2, matchup_id: 1, starters: opp.starters, players: opp.players, points: 6.2, players_points: { o1: 6.2 } },
  { roster_id: 3, matchup_id: 2, starters: [], players: [], points: 0 },
  { roster_id: 4, matchup_id: 2, starters: [], players: [], points: 0 },
];
/** Regular season runs through week 14: pairings rotate among the four teams. */
export const futureMatchups = (week: number): RawMatchup[] => {
  const pairs = [
    [[1, 3], [2, 4]],
    [[1, 4], [2, 3]],
    [[1, 2], [3, 4]],
  ][week % 3]!;
  return pairs.flatMap(([a, b], i) => [a!, b!].map((r) => ({ roster_id: r, matchup_id: i + 1, starters: [], players: [], points: 0 })));
};

/** Winning and losing FAAB claims for weeks 1–5. */
export const transactions: RawTransaction[] = [
  [1, 'x1', 32],
  [1, 'x2', 14],
  [2, 'x3', 21],
  [2, 'x4', 6],
  [3, 'x5', 11],
  [4, 'x6', 3],
  [5, 'x7', 18],
].map(([leg, id, bid]) => ({ type: 'waiver', status: 'complete', leg: leg as number, adds: { [id as string]: 2 }, settings: { waiver_bid: bid as number } }));

/** FantasyCalc rows (shape verified 2026-10-15); values invented. K and DEF have none, as on FantasyCalc. */
export const marketValues = [
  ['q1', 5200],
  ['r1', 4100],
  ['r2', 3000],
  ['w1', 4800],
  ['w2', 2600],
  ['w3', 2100],
  ['t1', 1900],
  ['o1', 3900],
  ['o2', 3400],
].map(([id, value]) => ({ value, redraftValue: value, trend30Day: 0, positionRank: 10, player: { sleeperId: id, name: id, position: 'X' } }));

/** Dynasty lists add rookie picks (names and ids as FantasyCalc sends them); values invented. */
export const pickValues = (
  [
    ['2027 1st (Early)', 4600],
    ['2027 1st (Mid)', 3000],
    ['2027 1st', 2800],
    ['2027 1st (Late)', 2300],
    ['2027 2nd', 1500],
    ['2028 1st', 2100],
    ['2028 2nd', 1300],
  ] as const
).map(([name, value], i) => ({ value, redraftValue: 0, trend30Day: 0, positionRank: i + 1, player: { sleeperId: `FP_${i}`, name, position: 'PICK' } }));

export const trending = [
  { player_id: 'fa2', count: 1520 },
  { player_id: 'fa1', count: 830 },
];
