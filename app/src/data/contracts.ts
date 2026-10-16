import type { Game, PracticeStatus, StatLine } from '../domain/types';

/** Bump when a published file changes shape; the app refuses files from a newer major version. */
export const DATA_SCHEMA_VERSION = 1;

/** Compact player record published by the pipeline (data/players.json). */
export interface CompactPlayer {
  id: string; // Sleeper player_id
  n: string; // name
  pos: string;
  fp?: string[]; // fantasy positions when they differ from [pos]
  t?: string; // team (Sleeper code)
  inj?: string; // Sleeper injury_status
  body?: string; // injury body part
  prac?: PracticeStatus; // latest practice status on the official report (nflverse); final once rpt is set
  rpt?: string; // official game status (Questionable/Doubtful/Out), given only on the week's final report
  dp?: string; // depth chart position
  do?: number; // depth chart order
  rk?: number; // Sleeper search_rank
  gsis?: string;
}

export interface PlayersFile {
  schemaVersion: number;
  generatedAt: string;
  season: string;
  week: number;
  /** Week of the official injury report that `prac`/`rpt` come from. */
  injuryReportWeek?: number;
  players: CompactPlayer[];
}

export interface ScheduleFile {
  schemaVersion: number;
  generatedAt: string;
  season: string;
  games: Game[];
}

/** Projection accuracy for one position (or 'ALL') over completed weeks, PPR scoring. */
export interface AccuracyRow {
  pos: string;
  /** Player-weeks: projected at least `minProjected` and played. */
  n: number;
  mae: number;
  /** Mean of actual − projected. */
  bias: number;
  rmse: number;
  corr: number;
  /** Share of outcomes inside the app's ±1 and ±2 SD bands (well calibrated: ~68% and ~95%). */
  within1: number;
  within2: number;
}

/** data/accuracy.json: aggregates only; no per-player projections are published. */
export interface AccuracyFile {
  schemaVersion: number;
  generatedAt: string;
  season: string;
  weeks: number[];
  minProjected: number;
  rows: AccuracyRow[];
}

/** Chance to play for one group of tagged players: mean predicted P(active) and the share active. */
export interface LedgerCalibrationRow {
  group: string;
  n: number;
  predicted: number;
  observed: number;
}

/** One scored week of the prediction ledger: the app's last predictions before each kickoff, against what happened. */
export interface LedgerWeek {
  season: string;
  week: number;
  games: number;
  /** Predictions with an outcome (played game, player on a game-day roster). */
  scored: number;
  /** Players tagged Questionable, Doubtful or Out: where the chance to play matters. */
  tagged: { n: number; brier: number; logLoss: number; calibration: LedgerCalibrationRow[] };
  /** Active players projected for at least `minProjected` PPR: points if active against the result. */
  points: { minProjected: number; n: number; mae: number; bias: number; within1: number; within2: number };
  /**
   * The shadow baseline against the app's own numbers, on active QB/RB/WR/TE that both predicted and
   * either put at `minProjected` or more (the backtest's population, docs/baseline.md).
   */
  baseline: { n: number; appMae: number; baselineMae: number; ratio: number };
  /**
   * The props shadow (`pr`) against the app's number from the same snapshot, on the same population; `blendMae`
   * averages the two (the question the blend gate asks).
   */
  props: { n: number; appMae: number; propsMae: number; blendMae: number; ratio: number };
}

/** data/ledger.json: each finished week of the prediction ledger, scored (aggregates only; docs/ledger.md). */
export interface LedgerFile {
  schemaVersion: number;
  generatedAt: string;
  season: string;
  /** Ascending by week. */
  weeks: LedgerWeek[];
}

/** One player's recent usage, each array aligned with `UsageFile.weeks`; null = didn't play (or no data yet). */
export interface PlayerUsage {
  /** Offensive snap share, whole percent. */
  snap: Array<number | null>;
  tgt: Array<number | null>;
  car: Array<number | null>;
  /** Share of the team's targets and carries, whole percent. */
  tshare: Array<number | null>;
  cshare: Array<number | null>;
}

/** A defense against one position: extra PPR per game beyond those players' usual (shrunk), over `n` games. */
export interface DefenseEdge {
  pg: number;
  n: number;
}

/** data/matchups.json: matchup context from nflverse (display only). */
export interface MatchupsFile {
  schemaVersion: number;
  generatedAt: string;
  season: string;
  weeks: number[];
  /** Pseudo-games of an average defense mixed into each sample. */
  priorGames: number;
  /** By Sleeper team code, then position (QB/RB/WR/TE). */
  defense: Record<string, Partial<Record<'QB' | 'RB' | 'WR' | 'TE', DefenseEdge>>>;
  /** Each defense's regular cornerbacks (Sleeper ids) with average defensive snap share, whole percent. */
  secondary: Record<string, Array<{ id: string; snap: number }>>;
}

/** data/usage.json: recent usage of QBs, RBs, WRs and TEs from nflverse (display only). */
export interface UsageFile {
  schemaVersion: number;
  generatedAt: string;
  season: string;
  /** The most recent weeks with data, ascending. */
  weeks: number[];
  /** By Sleeper player id. */
  players: Record<string, PlayerUsage>;
}

/**
 * data/baseline.json: the in-house baseline v0 (docs/baseline.md), a labelled second opinion that isn't
 * blended into projections. Derived from ffopportunity, so published CC-BY-SA 4.0.
 */
export interface BaselineFile {
  schemaVersion: number;
  generatedAt: string;
  season: string;
  week: number;
  /** Last week of this season whose games are in the averages (0 before the season's first). */
  throughWeek: number;
  /** Expected stat line if active (Sleeper stat keys), by Sleeper player id. */
  players: Record<string, StatLine>;
}

export interface ManifestEntry {
  updatedAt: string;
  source: string;
  license: string;
  credits?: string;
  /** Set when a failed build kept the previously published copy (its own date is `updatedAt`). */
  note?: string;
}

export interface Manifest {
  schemaVersion: number;
  generatedAt: string;
  files: Record<string, ManifestEntry>;
}
