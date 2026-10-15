import type { Game, PracticeStatus } from '../domain/types';

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

export interface ManifestEntry {
  updatedAt: string;
  source: string;
  license: string;
  credits?: string;
}

export interface Manifest {
  schemaVersion: number;
  generatedAt: string;
  files: Record<string, ManifestEntry>;
}
