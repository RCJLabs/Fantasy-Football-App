// In-house projection baseline v0 (docs/PLAN.md §2; results in docs/baseline.md). Per stat: a
// recency-weighted trailing mean of the player's ffopportunity expected stats (`*_exp`; attempts are
// actual), shrunk toward the position's average player, then scaled by this week's implied team total
// over the implied totals of the games averaged. Stat-level, so any league's scoring applies to it the
// same way it applies to Sleeper's projections.
import { type BaselineFile, DATA_SCHEMA_VERSION } from '../app/src/data/contracts';
import type { StatLine } from '../app/src/domain/types';

export const SKILL: readonly string[] = ['QB', 'RB', 'WR', 'TE'];

/** An api.sleeper.com projection or stats row with position and team at the top level. */
export interface SleeperRow {
  player_id: string;
  position?: string | null;
  team?: string | null;
  stats?: Record<string, number> | null;
}

/** Took the field: a game played or an offensive snap (Sleeper stats). */
export const played = (s: Readonly<StatLine> | null | undefined): boolean => (s?.gp ?? 0) > 0 || (s?.off_snp ?? 0) > 0;

/** ffopportunity `ep_weekly` columns → Sleeper stat keys. Expected values where the model has them. */
export const FFOPP_STATS: ReadonlyArray<readonly [string, string]> = [
  ['pass_attempt', 'pass_att'],
  ['pass_completions_exp', 'pass_cmp'],
  ['pass_yards_gained_exp', 'pass_yd'],
  ['pass_touchdown_exp', 'pass_td'],
  ['pass_interception_exp', 'pass_int'],
  ['pass_two_point_conv_exp', 'pass_2pt'],
  ['pass_first_down_exp', 'pass_fd'],
  ['rec_attempt', 'rec_tgt'],
  ['receptions_exp', 'rec'],
  ['rec_yards_gained_exp', 'rec_yd'],
  ['rec_touchdown_exp', 'rec_td'],
  ['rec_two_point_conv_exp', 'rec_2pt'],
  ['rec_first_down_exp', 'rec_fd'],
  ['rush_attempt', 'rush_att'],
  ['rush_yards_gained_exp', 'rush_yd'],
  ['rush_touchdown_exp', 'rush_td'],
  ['rush_two_point_conv_exp', 'rush_2pt'],
  ['rush_first_down_exp', 'rush_fd'],
];

const num = (s: string | undefined): number => {
  const v = Number(s);
  return s === undefined || s === '' || s === 'NA' || !Number.isFinite(v) ? 0 : v;
};

/** One `ep_weekly` row → a Sleeper-keyed stat line. Fumbles lost have no expected version: actual. */
export function ffoppStats(r: Readonly<Record<string, string>>): StatLine {
  const out: StatLine = {};
  for (const [col, key] of FFOPP_STATS) {
    const v = num(r[col]);
    if (v !== 0) out[key] = v;
  }
  const fum = num(r.rec_fumble_lost) + num(r.rush_fumble_lost);
  if (fum !== 0) out.fum_lost = fum;
  return out;
}

/** A game the player played before the target week. */
export interface BaselineGame {
  season: number;
  week: number;
  /** His team's implied total for that game, when lines were posted. */
  implied?: number;
  /** Expected stats; empty when he played without an opportunity (a real zero). */
  stats: StatLine;
}

export interface BaselineParams {
  /** Games until a game's weight halves; the most recent game weighs 1. */
  halfLife: number;
  /** Most recent games used. */
  maxGames: number;
  /** Extra weight factor for games from earlier seasons (roles change over the offseason). */
  priorSeasonWeight: number;
  /** Pseudo-games of the position average mixed in (shrinkage toward it). */
  shrinkGames: number;
  /** Exponent on this week's implied total ÷ the weighted implied total of the games averaged. */
  elasticity: number;
  /** Bounds on that implied-total factor. */
  minFactor: number;
  maxFactor: number;
}

/**
 * Set a priori. On 2023 alone none of 81 grid settings beat it by more than 0.02 MAE, so it stays untuned
 * and 2024–25 remain a clean out-of-sample test (docs/baseline.md).
 */
export const BASELINE_V0: BaselineParams = {
  halfLife: 4,
  maxGames: 16,
  priorSeasonWeight: 0.5,
  shrinkGames: 1,
  elasticity: 1,
  minFactor: 0.67,
  maxFactor: 1.5,
};

export interface Trailing {
  stats: StatLine;
  /** Sum of game weights (effective games). */
  weight: number;
  /** Weighted implied total over the games that had lines. */
  implied?: number;
}

/** Recency-weighted mean of a player's games before the target week of `season`; undefined without any. */
export function trailingMean(games: readonly BaselineGame[], season: number, p: BaselineParams): Trailing | undefined {
  const recent = [...games].sort((a, b) => b.season - a.season || b.week - a.week).slice(0, p.maxGames);
  if (!recent.length) return undefined;
  const sums: StatLine = {};
  let weight = 0;
  let impliedSum = 0;
  let impliedWeight = 0;
  recent.forEach((g, age) => {
    const w = 0.5 ** (age / p.halfLife) * (g.season < season ? p.priorSeasonWeight : 1);
    weight += w;
    for (const k in g.stats) sums[k] = (sums[k] ?? 0) + w * g.stats[k]!;
    if (g.implied !== undefined) {
      impliedSum += w * g.implied;
      impliedWeight += w;
    }
  });
  const stats: StatLine = {};
  for (const k in sums) stats[k] = sums[k]! / weight;
  return { stats, weight, ...(impliedWeight > 0 ? { implied: impliedSum / impliedWeight } : {}) };
}

/** Unweighted mean stat line (missing keys count as 0): the shrinkage target for a position. */
export function averageLine(lines: readonly StatLine[]): StatLine {
  const out: StatLine = {};
  if (!lines.length) return out;
  for (const l of lines) for (const k in l) out[k] = (out[k] ?? 0) + l[k]!;
  for (const k in out) out[k] = out[k]! / lines.length;
  return out;
}

/** Implied-total factor for this week: (this week ÷ the games averaged)^elasticity, bounded; 1 without lines. */
export function impliedFactor(trailingImplied: number | undefined, implied: number | undefined, p: BaselineParams): number {
  if (trailingImplied === undefined || implied === undefined || trailingImplied <= 0 || implied <= 0) return 1;
  return Math.min(p.maxFactor, Math.max(p.minFactor, (implied / trailingImplied) ** p.elasticity));
}

/** This week's baseline stat line: shrunk trailing mean × implied-total factor. */
export function baselineStats(t: Trailing, prior: Readonly<StatLine>, implied: number | undefined, p: BaselineParams): StatLine {
  const f = impliedFactor(t.implied, implied, p);
  const out: StatLine = {};
  for (const k of new Set([...Object.keys(t.stats), ...Object.keys(prior)])) {
    const v = ((t.stats[k] ?? 0) * t.weight + (prior[k] ?? 0) * p.shrinkGames) / (t.weight + p.shrinkGames);
    if (v !== 0) out[k] = v * f;
  }
  return out;
}

/** Lookups the baseline joins on, in the backtest and live. */
export interface BaselineSources {
  gsisBySleeper: ReadonlyMap<string, string>;
  /** ffopportunity expected stats keyed `${gsis}|${season}|${week}`. */
  expected: ReadonlyMap<string, StatLine>;
  /** Team implied totals keyed `${season}|${week}|${team}` (Sleeper team codes). */
  implied: ReadonlyMap<string, number>;
}

/** Adds one week's played games (Sleeper stats rows) to each skill player's history. */
export function recordWeek(history: Map<string, BaselineGame[]>, season: number, week: number, stats: readonly SleeperRow[], src: BaselineSources): void {
  for (const s of stats) {
    const gsis = src.gsisBySleeper.get(s.player_id);
    if (!gsis || !SKILL.includes(s.position ?? '') || !played(s.stats)) continue;
    const implied = src.implied.get(`${season}|${week}|${s.team ?? ''}`);
    const game: BaselineGame = { season, week, stats: src.expected.get(`${gsis}|${season}|${week}`) ?? {}, ...(implied !== undefined ? { implied } : {}) };
    (history.get(s.player_id) ?? history.set(s.player_id, []).get(s.player_id)!).push(game);
  }
}

/**
 * Baseline stat lines for one week of `season`: each player's trailing mean, shrunk toward the average of
 * the players at his position, times his team's implied-total factor. No line without a previous game.
 */
export function baselineWeek(
  players: ReadonlyArray<{ id: string; pos: string; team?: string | null }>,
  history: ReadonlyMap<string, readonly BaselineGame[]>,
  season: number,
  impliedOf: (team: string) => number | undefined,
  p: BaselineParams,
): Map<string, StatLine> {
  const trailing = new Map<string, { pos: string; team?: string | null; t: Trailing }>();
  for (const pl of players) {
    if (!SKILL.includes(pl.pos)) continue;
    const t = trailingMean(history.get(pl.id) ?? [], season, p);
    if (t) trailing.set(pl.id, { pos: pl.pos, team: pl.team, t });
  }
  const all = [...trailing.values()];
  const priors = new Map(SKILL.map((pos) => [pos, averageLine(all.filter((x) => x.pos === pos).map((x) => x.t.stats))]));
  const out = new Map<string, StatLine>();
  for (const [id, x] of trailing) out.set(id, baselineStats(x.t, priors.get(x.pos) ?? {}, x.team ? impliedOf(x.team) : undefined, p));
  return out;
}

export interface BaselineShardInput extends BaselineSources {
  season: number;
  week: number;
  now: string;
  /** Sleeper stats rows of earlier weeks: the previous season's and this season's so far. */
  weeks: ReadonlyArray<{ season: number; week: number; stats: readonly SleeperRow[] }>;
  /**
   * Everyone in this week's Sleeper projection rows (membership only, not values), as in the backtest: they
   * make up the position averages. Lines are published for those whose team plays this week.
   */
  players: ReadonlyArray<{ id: string; pos: string; team?: string | null }>;
  /** Teams with a game this week. */
  playing: ReadonlySet<string>;
  params?: BaselineParams;
}

const r2 = (x: number) => Math.round(x * 100) / 100;

/** data/baseline.json for this week, or null when there's nothing to project. */
export function buildBaselineFile(input: BaselineShardInput): BaselineFile | null {
  const params = input.params ?? BASELINE_V0;
  // Only weeks ffopportunity already covers: a played game it hasn't processed would count as zero opportunities.
  const covered = new Set<string>();
  for (const key of input.expected.keys()) covered.add(key.slice(key.indexOf('|') + 1));
  const weeks = input.weeks
    .filter((w) => (w.season < input.season || (w.season === input.season && w.week < input.week)) && covered.has(`${w.season}|${w.week}`))
    .sort((a, b) => a.season - b.season || a.week - b.week);
  const history = new Map<string, BaselineGame[]>();
  for (const w of weeks) recordWeek(history, w.season, w.week, w.stats, input);
  const lines = baselineWeek(input.players, history, input.season, (team) => input.implied.get(`${input.season}|${input.week}|${team}`), params);
  const teamOf = new Map(input.players.map((p) => [p.id, p.team]));
  const players: Record<string, StatLine> = {};
  for (const [id, line] of [...lines].sort(([a], [b]) => a.localeCompare(b))) {
    const team = teamOf.get(id);
    if (!team || !input.playing.has(team)) continue;
    const out: StatLine = {};
    for (const k of Object.keys(line).sort()) if (Math.abs(line[k]!) >= 0.005) out[k] = r2(line[k]!);
    players[id] = out;
  }
  if (!Object.keys(players).length) return null;
  return {
    schemaVersion: DATA_SCHEMA_VERSION,
    generatedAt: input.now,
    season: String(input.season),
    week: input.week,
    throughWeek: Math.max(0, ...weeks.filter((w) => w.season === input.season).map((w) => w.week)),
    players,
  };
}
