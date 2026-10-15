// Prediction ledger: the app's own numbers for every player whose game hasn't started, built from
// exactly what the app reads (Sleeper's projection rows plus the deployed players and schedule
// files). Each archive snapshot stores them encrypted and publishes their SHA-256 before kickoff,
// so they can be scored later and nobody (us included) can quietly revise them.
import { createHash } from 'node:crypto';
import { gamesByTeam, playerRow, type WeekContext } from '../app/src/analysis/analyze';
import type { PlayersFile, ScheduleFile } from '../app/src/data/contracts';
import { mergeProjectionPlayers, playersFromFile } from '../app/src/data/repo';
import type { PracticeStatus } from '../app/src/domain/types';
import { indexProjections, parseLeague } from '../app/src/sleeper/parse';
import type { RawLeague, RawProjection } from '../app/src/sleeper/raw';

const POSITIONS = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DEF']);
/** Game-week designations. IR, PUP and the like are season-long, so they predict nothing new. */
const GAME_TAGS = new Set(['Questionable', 'Doubtful', 'Out']);

/** One fixed format (full PPR, Sleeper's default kicker and defense scoring) so snapshots and weeks compare. */
const LEDGER_LEAGUE: RawLeague = {
  league_id: 'ledger',
  name: 'Prediction ledger (PPR)',
  season: '',
  status: 'in_season',
  total_rosters: 12,
  roster_positions: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF'],
  scoring_settings: {
    pass_yd: 0.04, pass_td: 4, pass_int: -2, pass_2pt: 2,
    rush_yd: 0.1, rush_td: 6, rush_2pt: 2,
    rec: 1, rec_yd: 0.1, rec_td: 6, rec_2pt: 2, fum_lost: -2,
    fgm_0_19: 3, fgm_20_29: 3, fgm_30_39: 3, fgm_40_49: 4, fgm_50p: 5, fgmiss: -1, xpm: 1, xpmiss: -1,
    sack: 1, int: 2, fum_rec: 2, ff: 1, def_td: 6, def_st_td: 6, safe: 2, blk_kick: 2,
    pts_allow_0: 10, pts_allow_1_6: 7, pts_allow_7_13: 4, pts_allow_14_20: 1, pts_allow_28_34: -1, pts_allow_35p: -4,
  },
  settings: { type: 0, num_teams: 12 },
};

/** Archive rows are slimmed: the player fields the app reads sit at the top level. Both shapes are accepted. */
export interface ArchivedProjection {
  player_id: string;
  stats?: Record<string, number> | null;
  team?: string | null;
  opponent?: string | null;
  date?: string | null;
  position?: string | null;
  injury_status?: string | null;
  injury_body_part?: string | null;
  player?: RawProjection['player'];
}

export function toRawProjection(r: ArchivedProjection): RawProjection {
  if (r.player) return { ...r, stats: r.stats ?? null, player: r.player };
  return {
    player_id: r.player_id,
    stats: r.stats ?? null,
    team: r.team ?? null,
    opponent: r.opponent ?? null,
    date: r.date ?? null,
    player: { ...(r.position ? { position: r.position } : {}), team: r.team ?? null, injury_status: r.injury_status ?? null, injury_body_part: r.injury_body_part ?? null },
  };
}

export interface PlayerPrediction {
  id: string;
  gsis?: string;
  pos: string;
  team: string;
  game: string;
  /** Sleeper's injury tag when the prediction was made. */
  inj?: string;
  prac?: PracticeStatus;
  /** The practice status came from the week's final report, so it set the odds. */
  final?: true;
  /** P(active). */
  p: number;
  /** Full-PPR points if active. */
  mu: number;
  /** The app's weekly spread around `mu`. */
  sd: number;
}

export interface PredictionFile {
  schemaVersion: 1;
  createdAt: string;
  season: string;
  week: number;
  scoring: 'ppr';
  /** Commit of the code that made the predictions. */
  code?: string;
  /** Games not yet started when the predictions were made. */
  games: Array<{ id: string; kickoff: string }>;
  players: PlayerPrediction[];
}

export interface PredictionInput {
  season: string;
  week: number;
  now: number;
  projections: readonly ArchivedProjection[];
  players: PlayersFile;
  schedule: ScheduleFile;
  code?: string;
}

const round = (x: number, digits: number) => Number(x.toFixed(digits));

/** The app's prediction for every player with a projection or a game-week injury tag whose game hasn't started. */
export function buildPredictions(input: PredictionInput): PredictionFile {
  const { season, week, now } = input;
  const index = indexProjections(input.projections.map(toRawProjection), week);
  const players = mergeProjectionPlayers(playersFromFile(input.players, week), index.players);
  const games = input.schedule.season === season ? input.schedule.games.filter((g) => g.week === week) : [];
  const ctx: WeekContext = { season, week, now, players, projections: index, gamesByTeam: gamesByTeam(games, week) };
  const league = parseLeague({ ...LEDGER_LEAGUE, season });
  const open = games.filter((g) => Date.parse(g.kickoff) > now).sort((a, b) => a.kickoff.localeCompare(b.kickoff) || a.id.localeCompare(b.id));
  const openIds = new Set(open.map((g) => g.id));

  const out: PlayerPrediction[] = [];
  for (const id of index.byPlayer.keys()) {
    const row = playerRow(id, league, ctx);
    const game = row.team ? ctx.gamesByTeam.get(row.team) : undefined;
    if (!game || !openIds.has(game.id) || !POSITIONS.has(row.pos)) continue;
    if (!(row.mu > 0) && !GAME_TAGS.has(row.injury ?? '')) continue; // nothing to predict
    const pred: PlayerPrediction = { id, pos: row.pos, team: row.team!, game: game.id, p: round(row.p, 4), mu: round(row.mu, 2), sd: round(row.sd, 2) };
    const gsis = players.get(id)?.gsis;
    if (gsis) pred.gsis = gsis;
    if (row.injury) pred.inj = row.injury;
    if (row.practice) pred.prac = row.practice;
    if (row.practiceFinal) pred.final = true;
    out.push(pred);
  }
  out.sort((a, b) => a.game.localeCompare(b.game) || a.id.localeCompare(b.id));
  return {
    schemaVersion: 1,
    createdAt: new Date(now).toISOString(),
    season,
    week,
    scoring: 'ppr',
    ...(input.code ? { code: input.code } : {}),
    games: open.map((g) => ({ id: g.id, kickoff: g.kickoff })),
    players: out,
  };
}

/** Public commitment to a predictions file: its SHA-256 and what it covers, nothing else. */
export interface Commitment {
  schemaVersion: 1;
  createdAt: string;
  season: string;
  week: number;
  code?: string;
  /** SHA-256 (hex) of the exact predictions.json bytes. */
  sha256: string;
  players: number;
  games: string[];
}

export const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

export function commitment(file: PredictionFile, text: string): Commitment {
  return {
    schemaVersion: 1,
    createdAt: file.createdAt,
    season: file.season,
    week: file.week,
    ...(file.code ? { code: file.code } : {}),
    sha256: sha256(text),
    players: file.players.length,
    games: file.games.map((g) => g.id),
  };
}
