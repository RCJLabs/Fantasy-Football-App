// In-house projection baseline v0 (docs/PLAN.md §2; results in docs/baseline.md). Per stat: a
// recency-weighted trailing mean of the player's ffopportunity expected stats (`*_exp`; attempts are
// actual), shrunk toward the position's average player, then scaled by this week's implied team total
// over the implied totals of the games averaged. Stat-level, so any league's scoring applies to it the
// same way it applies to Sleeper's projections.
import type { StatLine } from '../app/src/domain/types';

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
