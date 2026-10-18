// Mock Sleeper responses and pipeline data files for the end-to-end test. Shapes follow the live
// responses recorded in docs/spikes.md; names and numbers are invented.
import type { BaselineFile, CompactPlayer, LedgerFile, LedgerWeek, MatchupsFile, NextSeasonFile, NextSeasonPlayer, PlayersFile, ScheduleFile, UsageFile } from '../app/src/data/contracts';
import type { RawBracketMatch, RawDraft, RawDraftPick, RawLeague, RawMatchup, RawProjection, RawRoster, RawTradedPick, RawTransaction } from '../app/src/sleeper/raw';

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
  // CCC's backups, free agents: the next men up behind my QB and my (Out) RB.
  ['q2', 'Backup Passer', 'QB', 'CCC', { pass_yd: 12, pass_td: 0.1 }],
  ['r9', 'Next Man Runner', 'RB', 'CCC', { rush_yd: 30, rush_td: 0.2, rec: 1, rec_yd: 8 }],
  // A free agent on IR whom Sleeper projects again from week 10: an IR stash.
  ['fx', 'Stash Runner', 'RB', 'HHH', { rush_yd: 70, rush_td: 0.5, rec: 2, rec_yd: 15 }, 'IR'],
];
/** Sleeper depth charts (position, order) for CCC's QBs and RBs. */
const DEPTH: Record<string, [string, number]> = { q1: ['QB', 1], q2: ['QB', 2], r1: ['RB', 1], r9: ['RB', 2] };

const projectionRow = ([id, name, pos, team, stats, injury]: P, sidelined: boolean): RawProjection => ({
  player_id: id,
  // Sleeper rows carry pts_ppr; the rest-of-season cache uses it to skip near-zero players.
  stats: sidelined ? {} : { ...stats, pts_ppr: 10 },
  team,
  company: 'rotowire',
  player: { first_name: name.split(' ')[0], last_name: name.split(' ').slice(1).join(' '), position: pos, fantasy_positions: [pos], team, injury_status: injury ?? null },
});

export const projections: RawProjection[] = PLAYERS.map((p) => projectionRow(p, p[5] === 'Out' || p[5] === 'IR'));

/** Weeks 7+: the Out RB is back; team GGG is on bye in week 8; the IR stash returns in week 10. */
export const futureProjections = (week: number): RawProjection[] =>
  PLAYERS.filter((p) => !(week === 8 && p[3] === 'GGG')).map((p) => projectionRow(p, p[5] === 'IR' && !(p[0] === 'fx' && week >= 10)));

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
    ...(DEPTH[id] ? { dp: DEPTH[id][0], do: DEPTH[id][1] } : {}),
    ...(id === 'w2' ? { prac: 'Limited' as const, rpt: 'Questionable', body: 'Hamstring' } : {}),
    ...(id === 'r1' ? { body: 'Knee' } : {}),
    ...(id === 'w2' ? { espn: '9000002' } : {}),
    ...(id === 'w1' ? { espn: '9000001' } : {}),
  })).concat([{ id: 'cb1', n: 'Corner Back', pos: 'CB', t: 'CCC', inj: 'Out' }]),
};

export const manifest = { schemaVersion: 1, generatedAt: iso(-3), files: {} };

/** Three scored weeks of the prediction ledger (numbers invented), enough for the About page to show it. */
const ledgerWeek = (week: number, questionable: { n: number; observed: number }): LedgerWeek => ({
  season: '2026',
  week,
  games: 14,
  scored: 410,
  tagged: {
    n: questionable.n + 10,
    brier: 0.09,
    logLoss: 0.31,
    calibration: [
      { group: 'Out', n: 10, predicted: 0, observed: 0 },
      { group: 'Questionable, Limited (final report)', n: questionable.n, predicted: 0.71, observed: questionable.observed },
    ],
  },
  points: { minProjected: 5, n: 150, mae: 4.4, bias: -0.2, within1: 0.67, within2: 0.94 },
  baseline: { n: 0, appMae: 0, baselineMae: 0, ratio: 0 },
  props: { n: 0, appMae: 0, propsMae: 0, blendMae: 0, ratio: 0 },
});
export const ledger: LedgerFile = {
  schemaVersion: 1,
  generatedAt: iso(-3),
  season: '2026',
  weeks: [ledgerWeek(6, { n: 10, observed: 0.7 }), ledgerWeek(7, { n: 12, observed: 0.75 }), ledgerWeek(8, { n: 8, observed: 0.625 })],
};

/** Matchup context (numbers invented): CCC has been soft on WRs and its top cornerback is out. */
export const matchupContext: MatchupsFile = {
  schemaVersion: 1,
  generatedAt: iso(-3),
  season: '2026',
  weeks: [1, 2, 3, 4, 5],
  priorGames: 4,
  defense: { CCC: { WR: { pg: 2.3, n: 5 } } },
  secondary: { CCC: [{ id: 'cb1', snap: 92 }] },
};

/** In-house baseline (numbers invented): a second opinion on the Questionable WR. */
export const baseline: BaselineFile = {
  schemaVersion: 1,
  generatedAt: iso(-3),
  season: '2026',
  week: 6,
  throughWeek: 5,
  // Real DEF ids are team codes; the fixture's defense is d1.
  players: { w2: { rec: 4, rec_yd: 50, rec_td: 0.3 }, d1: { sack: 2.5, int: 0.8, fum_rec: 0.6, pts_allow: 21 } },
};

/**
 * Recent usage (nflverse-shaped, numbers invented): the free-agent RB's role is growing. My WR is running hot (points
 * well above what his usage was worth), the rival's RB cold.
 */
export const usage: UsageFile = {
  schemaVersion: 1,
  generatedAt: iso(-3),
  season: '2026',
  weeks: [2, 3, 4, 5],
  players: {
    fa1: { snap: [30, 45, 61, 84], tgt: [1, 2, 2, 3], car: [5, 8, 12, 18], tshare: [3, 6, 6, 9], cshare: [20, 30, 45, 62] },
    w2: {
      snap: [80, 85, null, 90],
      tgt: [6, 7, null, 9],
      car: [0, 0, null, 0],
      tshare: [20, 22, null, 25],
      cshare: [0, 0, null, 0],
      luck: { g: 3, pts: [19.4, 13.1], td: [4, 1.2] },
    },
    o2: {
      snap: [70, 72, 68, 71],
      tgt: [3, 2, 4, 3],
      car: [16, 18, 15, 17],
      tshare: [9, 7, 12, 10],
      cshare: [60, 65, 58, 62],
      luck: { g: 4, pts: [8.2, 13.6], td: [0, 2.1] },
    },
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
/** ESPN's fantasy news for the Questionable WR (invented text, ESPN's response shape). */
export const espnNews = {
  resultsCount: 2,
  feed: [
    {
      id: 7001,
      type: 'Rotowire',
      headline: 'Drew Flanker: Limited again Friday',
      description: 'Drew Flanker: Limited again Friday',
      published: iso(-20),
      links: { web: {} },
    },
    {
      id: 7002,
      type: 'Story',
      headline: 'Invented notebook: receivers to watch',
      description: 'An invented look at the receiver room.',
      published: iso(-30),
      links: { web: { href: 'https://www.espn.com/nfl/story/_/id/7002/invented' } },
    },
  ],
};

/** Sleeper's stats so far for the live game (AAA@BBB): lines that add up to the points above, last saved 5 minutes ago. */
export const weekStats: RawProjection[] = [
  { player_id: 'w1', stats: { rec: 5, rec_tgt: 7, rec_yd: 89, pts_ppr: 13.9 }, team: 'AAA', updated_at: now - 5 * 60_000 },
  { player_id: 'o1', stats: { pass_cmp: 9, pass_att: 14, pass_yd: 80, pass_td: 1, pass_int: 1 }, team: 'BBB', updated_at: now - 6 * 60_000 },
];
/** The live game after a touchdown catch by the wideout (Sleeper's score first; its stat line catches up later). */
export const matchupsAfterScore: RawMatchup[] = matchups.map((m) => (m.roster_id === 1 ? { ...m, points: 17.4, players_points: { w1: 17.4 } } : m));
export const weekStatsAfterScore: RawProjection[] = weekStats.map((r) =>
  r.player_id === 'w1' ? { ...r, stats: { rec: 6, rec_tgt: 8, rec_yd: 123, rec_td: 1, pts_ppr: 24.3 }, updated_at: now - 60_000 } : r,
);

/** ESPN's game summary for the live game (its response shape; invented): the wideout's touchdown, a minute ago. */
export const espnSummary = {
  scoringPlays: [
    {
      id: 701,
      text: 'Taylor Wideout 34 Yd pass from Alex Thrower (Sam Boot Kick)',
      period: { number: 2 },
      clock: { displayValue: '9:12' },
      scoringType: { abbreviation: 'TD' },
      awayScore: 10,
      homeScore: 7,
    },
  ],
  drives: { previous: [{ plays: [{ id: 701, scoringPlay: true, wallclock: iso(-0.02) }] }] },
  boxscore: { players: [{ statistics: [{ name: 'receiving', athletes: [{ athlete: { id: '9000001', displayName: 'Taylor Wideout' } }] }] }] },
};

/** ESPN's scoreboard (its response shape; invented games): AAA has the ball in BBB's red zone, the other games to come. */
const espnTeam = (homeAway: string, id: string, abbreviation: string, score: string) => ({ homeAway, score, team: { id, abbreviation } });
const espnLater = (id: string, away: string, home: string) => ({
  id,
  status: { clock: 900, displayClock: '15:00', period: 0, type: { name: 'STATUS_SCHEDULED', state: 'pre' } },
  competitions: [{ competitors: [espnTeam('home', `${id}h`, home, '0'), espnTeam('away', `${id}a`, away, '0')] }],
});
export const scoreboard = {
  week: { number: 6 },
  season: { type: 2, year: 2026 },
  events: [
    {
      id: '501',
      status: { clock: 523, displayClock: '8:43', period: 2, type: { name: 'STATUS_IN_PROGRESS', state: 'in' } },
      competitions: [
        {
          competitors: [espnTeam('home', '2', 'BBB', '7'), espnTeam('away', '1', 'AAA', '10')],
          situation: { possession: '1', downDistanceText: '1st & Goal at BBB 4', isRedZone: true },
        },
      ],
    },
    espnLater('502', 'CCC', 'DDD'),
    espnLater('503', 'EEE', 'FFF'),
  ],
};
/**
 * Weeks 1–5, final: 4-1 on scores that beat 10 of 15 others (all-play), and 3-2 against the median. My starters are the same
 * every week; the bench outscored them in weeks 3 (Morgan Halfback, 22) and 5 (Casey Depth, 12).
 */
const PAST: Array<{ pairs: number[][]; me: Record<string, number>; others: Record<number, number> }> = [
  { pairs: [[1, 4], [2, 3]], me: {}, others: { 2: 105, 3: 110, 4: 90 } },
  { pairs: [[1, 2], [3, 4]], me: { q1: 29 }, others: { 2: 120, 3: 100, 4: 85 } },
  { pairs: [[1, 3], [2, 4]], me: { w1: 33, r2: 22 }, others: { 2: 125, 3: 105, 4: 121 } },
  { pairs: [[1, 4], [2, 3]], me: { q1: 30, r1: 24, w2: 18, r2: 5 }, others: { 2: 120, 3: 115, 4: 95 } },
  { pairs: [[1, 2], [3, 4]], me: { w1: 30, t1: 20, d1: 15, r4: 12 }, others: { 2: 100, 3: 120, 4: 90 } },
];
const BASE_POINTS: Record<string, number> = { q1: 20, r1: 14, r2: 9, r3: 9, r4: 3, w1: 15, w2: 11, w3: 10, t1: 8, k1: 8, d1: 6 };
export const pastMatchups = (week: number): RawMatchup[] => {
  const w = PAST[week - 1]!;
  const pp = { ...BASE_POINTS, ...w.me };
  const points = (r: number) => (r === 1 ? (me.starters ?? []).reduce((s, id) => s + (pp[id] ?? 0), 0) : w.others[r]!);
  return [1, 2, 3, 4].map((r) => ({
    roster_id: r,
    matchup_id: w.pairs.findIndex((p) => p.includes(r)) + 1,
    starters: r === 1 ? me.starters : [],
    players: r === 1 ? me.players : [],
    points: points(r),
    ...(r === 1 ? { players_points: pp } : {}),
  }));
};

/** Regular season runs through week 14: pairings rotate among the four teams. */
export const futureMatchups = (week: number): RawMatchup[] => {
  const pairs = [
    [[1, 3], [2, 4]],
    [[1, 4], [2, 3]],
    [[1, 2], [3, 4]],
  ][week % 3]!;
  return pairs.flatMap(([a, b], i) => [a!, b!].map((r) => ({ roster_id: r, matchup_id: i + 1, starters: [], players: [], points: 0 })));
};

/** Playoffs: four teams in one-week rounds (weeks 15–16). Round 1 is decided; the final is under way in week 16. */
export const playoffLeague: RawLeague = { ...league, settings: { ...league.settings, playoff_teams: 4, last_scored_leg: 15 } };
export const bracket: RawBracketMatch[] = [
  { m: 1, r: 1, t1: 1, t2: 4, w: 1, l: 4 },
  { m: 2, r: 1, t1: 2, t2: 3, w: 2, l: 3 },
  { m: 3, r: 2, p: 1, t1: null, t2: null, t1_from: { w: 1 }, t2_from: { w: 2 }, w: null, l: null },
  { m: 4, r: 2, p: 3, t1: null, t2: null, t1_from: { l: 1 }, t2_from: { l: 2 }, w: null, l: null },
];
export const playoffMatchups = (week: number): RawMatchup[] =>
  week === 15
    ? [
        { roster_id: 1, matchup_id: 1, starters: me.starters, players: me.players, points: 128.4 },
        { roster_id: 4, matchup_id: 1, starters: [], players: [], points: 97.1 },
        { roster_id: 2, matchup_id: 2, starters: opp.starters, players: opp.players, points: 110.2 },
        { roster_id: 3, matchup_id: 2, starters: [], players: [], points: 101.5 },
      ]
    : [
        { roster_id: 1, matchup_id: 1, starters: me.starters, players: me.players, points: 0 },
        { roster_id: 2, matchup_id: 1, starters: opp.starters, players: opp.players, points: 0 },
        { roster_id: 3, matchup_id: 2, starters: [], players: [], points: 0 },
        { roster_id: 4, matchup_id: 2, starters: [], players: [], points: 0 },
      ];
/** Week 16: every team plays later today or tomorrow. */
export const playoffSchedule: ScheduleFile = {
  ...schedule,
  games: [
    ['AAA', 'BBB', 4],
    ['CCC', 'DDD', 6],
    ['EEE', 'FFF', 8],
    ['GGG', 'HHH', 30],
  ].map(([away, home, h]) => ({ id: `2026_16_${away}_${home}`, week: 16, away: away as string, home: home as string, kickoff: iso(h as number), total: 44, homeImplied: 22, awayImplied: 22 })),
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

/**
 * Next season's projections (numbers invented): the fixture's players plus invented ones, enough for a 4-team, 13-round
 * mock draft. My WR1 has no contract for 2027.
 */
const nextLine = (pos: string, k: number): NextSeasonPlayer['s'] =>
  pos === 'QB' ? { pass_yd: 280 - 12 * k, pass_td: 1.9 - 0.08 * k, pass_int: 0.7, rush_yd: 15 }
  : pos === 'RB' ? { rush_yd: 85 - 4 * k, rush_td: 0.6 - 0.03 * k, rec: 3 - 0.1 * k, rec_yd: 22 - k }
  : pos === 'WR' ? { rec: 6.5 - 0.25 * k, rec_yd: 85 - 3.5 * k, rec_td: 0.5 - 0.02 * k }
  : pos === 'TE' ? { rec: 4.5 - 0.4 * k, rec_yd: 48 - 4 * k, rec_td: 0.35 - 0.03 * k }
  : pos === 'K' ? { fgm: 1.8 - 0.05 * k, xpm: 2.4 }
  : { sack: 2.6 - 0.1 * k, int: 0.8, fum_rec: 0.6, pts_allow: 21 + k };
const NEXT_IDS: Record<string, string[]> = {
  QB: ['q1', 'o1', 'q2'],
  RB: ['r1', 'o2', 'fa1', 'r2', 'r3', 'r4', 'r9', 'fx'],
  WR: ['w1', 'w2', 'w3', 'fa2'],
  TE: ['t1'],
  K: ['k1'],
  DEF: ['d1'],
};
const NEXT_COUNTS: Record<string, number> = { QB: 8, RB: 20, WR: 22, TE: 8, K: 5, DEF: 5 };
export const nextSeason: NextSeasonFile = {
  schemaVersion: 1,
  generatedAt: iso(-3),
  season: '2026',
  target: '2027',
  basis: { season: '2026', weeks: 6 },
  players: Object.fromEntries(
    Object.entries(NEXT_COUNTS).flatMap(([pos, n]) =>
      Array.from({ length: n }, (_, k) => {
        const id = NEXT_IDS[pos]![k] ?? `x${pos}${k}`;
        const p: NextSeasonPlayer = { pos, s: nextLine(pos, k), g: pos === 'DEF' ? 17 : 13.5, age: 24 + (k % 9) };
        if (!NEXT_IDS[pos]![k]) p.n = `Invented ${pos === 'DEF' ? 'Defense' : pos} ${k + 1}`;
        if (id === 'w1') Object.assign(p, { fa: 1, chg: 0.54 });
        return [id, p];
      }),
    ),
  ),
  rookies: [{ pos: 'RB', order: 1, s: { rush_att: 15, rush_yd: 67, rush_td: 0.5, rec: 2.2, rec_yd: 18 }, g: 14.3 }],
  range: { QB: [0.2, 1.6], RB: [0.05, 1.95], WR: [0.2, 1.75], TE: [0.15, 1.8] },
};

/** The keeper league's 2026 draft, finished: the rounds my players went in. */
export const drafts: RawDraft[] = [{ draft_id: 'd2026', season: '2026', status: 'complete', type: 'snake', settings: { rounds: 13, teams: 4 } }];
export const draftPicks: RawDraftPick[] = (
  [
    ['q1', 1],
    ['w1', 2],
    ['r1', 3],
    ['t1', 4],
    ['r2', 9],
  ] as const
).map(([player_id, round], i) => ({ player_id, round, pick_no: i * 4 + 1, roster_id: 1, picked_by: 'u1', is_keeper: false }));
