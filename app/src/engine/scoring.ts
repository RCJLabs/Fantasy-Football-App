import type { ScoringSettings, StatLine } from '../domain/types';
import { normInterval, probAtLeast } from './math';

/**
 * League points for a stat line: Σ scoring[key] × stats[key].
 * Works for actual stat lines (Sleeper stats) and for expected stat lines (see `expectedStats`).
 */
export function scoreStats(stats: StatLine, scoring: ScoringSettings): number {
  let pts = 0;
  for (const key in scoring) {
    const v = stats[key];
    const s = scoring[key];
    if (v !== undefined && s !== undefined && s !== 0) pts += s * v;
  }
  return pts;
}

/** Per-key contributions (non-zero only), largest first — used by explanations. */
export function scoreBreakdown(stats: StatLine, scoring: ScoringSettings): Array<{ key: string; points: number }> {
  const out: Array<{ key: string; points: number }> = [];
  for (const key in scoring) {
    const v = stats[key];
    const s = scoring[key];
    if (v !== undefined && s !== undefined && s !== 0 && v !== 0) out.push({ key, points: s * v });
  }
  return out.sort((a, b) => Math.abs(b.points) - Math.abs(a.points));
}

// ---- Expected values for scoring keys that projections don't carry -------------------------------
// Sleeper/RotoWire projections give means. Threshold bonuses and DEF buckets depend on the
// distribution, so we price them from a normal approximation. Spreads are [design] defaults to be
// calibrated against archived projections vs. actuals.

/** sd of a yardage/volume stat given its projected mean. [design] */
const STAT_SD: Record<string, (mean: number) => number> = {
  pass_yd: (m) => Math.max(40, 0.27 * m),
  rush_yd: (m) => Math.max(12, 0.55 * m),
  rec_yd: (m) => Math.max(12, 0.65 * m),
  pass_cmp: (m) => Math.max(3, 0.22 * m),
  rush_att: (m) => Math.max(3, 0.3 * m),
};

/**
 * Yardage/volume threshold bonuses: scoring key → [stat it thresholds, threshold, the next tier up]. Sleeper's
 * tiers are exclusive: a game that reaches the next tier gets only that one (its own stat lines, 2022–26:
 * 86 of 86 such games; docs/stat-mapping.md).
 */
const THRESHOLD_BONUSES: Record<string, [string, number, number?]> = {
  bonus_pass_yd_300: ['pass_yd', 300, 400],
  bonus_pass_yd_400: ['pass_yd', 400],
  bonus_rush_yd_100: ['rush_yd', 100, 200],
  bonus_rush_yd_200: ['rush_yd', 200],
  bonus_rec_yd_100: ['rec_yd', 100, 200],
  bonus_rec_yd_200: ['rec_yd', 200],
  bonus_rush_rec_yd_100: ['rush_rec_yd', 100, 200],
  bonus_rush_rec_yd_200: ['rush_rec_yd', 200],
  bonus_pass_cmp_25: ['pass_cmp', 25],
  bonus_rush_att_20: ['rush_att', 20],
};

/** Share of TDs that are long (≥40 / ≥50 yards). [design] typical NFL rates; calibrate later. */
const LONG_TD_SHARE: Record<string, [string, number]> = {
  pass_td_40p: ['pass_td', 0.12],
  pass_td_50p: ['pass_td', 0.08],
  rush_td_40p: ['rush_td', 0.06],
  rush_td_50p: ['rush_td', 0.04],
  rec_td_40p: ['rec_td', 0.12],
  rec_td_50p: ['rec_td', 0.08],
};

/** DEF points-allowed and yards-allowed buckets (Sleeper keys) with [lo, hi) ranges. */
export const PTS_ALLOW_BUCKETS: Array<[string, number, number]> = [
  ['pts_allow_0', -Infinity, 0.5],
  ['pts_allow_1_6', 0.5, 6.5],
  ['pts_allow_7_13', 6.5, 13.5],
  ['pts_allow_14_20', 13.5, 20.5],
  ['pts_allow_21_27', 20.5, 27.5],
  ['pts_allow_28_34', 27.5, 34.5],
  ['pts_allow_35p', 34.5, Infinity],
];
export const YDS_ALLOW_BUCKETS: Array<[string, number, number]> = [
  ['yds_allow_0_100', -Infinity, 100],
  ['yds_allow_100_199', 100, 200],
  ['yds_allow_200_299', 200, 300],
  ['yds_allow_300_349', 300, 350],
  ['yds_allow_350_399', 350, 400],
  ['yds_allow_400_449', 400, 450],
  ['yds_allow_450_499', 450, 500],
  ['yds_allow_500_549', 500, 550],
  ['yds_allow_550p', 550, Infinity],
];
/** Game-level spread of points/yards allowed. [design] calibrate from nflverse. */
export const PTS_ALLOW_SD = 9.5;
export const YDS_ALLOW_SD = 70;
/** Share of 50+ yard field goals made from 60+. [design] roughly recent NFL seasons; calibrate later. */
const FG_60P_SHARE = 0.06;

/** Scoring keys `expectedStats` can derive even when a projection lacks them. */
export const DERIVED_KEYS = new Set<string>([
  ...Object.keys(THRESHOLD_BONUSES),
  ...Object.keys(LONG_TD_SHARE),
  ...PTS_ALLOW_BUCKETS.map(([k]) => k),
  ...YDS_ALLOW_BUCKETS.map(([k]) => k),
  'rush_rec_yd',
  'bonus_fd_qb',
  'bonus_fd_rb',
  'bonus_fd_wr',
  'bonus_fd_te',
  'bonus_rec_rb',
  'bonus_rec_wr',
  'bonus_rec_te',
  'fgmiss',
  'fgm_50_59',
  'fgm_60p',
]);

/**
 * Rare special-teams and return events that projections don't carry. Each is worth a few tenths of a
 * point per game at most and roughly the same for every team, so leaving them out doesn't change
 * decisions and isn't worth a warning. [design]
 */
export const MINOR_SCORING_KEYS = new Set<string>([
  'st_td',
  'st_ff',
  'st_fum_rec',
  'st_tkl_solo',
  'def_st_td',
  'def_st_ff',
  'def_st_fum_rec',
  'def_st_tkl_solo',
  'fum_rec_td',
  'kr_td',
  'pr_td',
]);

/**
 * Turn a projected stat line (means) into the expected value of every scoring key we can price.
 * Keys already present are kept as-is, except DEF buckets: Sleeper projections set the bucket that
 * contains the projected mean to 1 (one-hot), so we replace them with probabilities.
 */
export function expectedStats(stats: StatLine, pos: string): StatLine {
  const out: StatLine = { ...stats };
  const has = (k: string) => out[k] !== undefined;

  if (!has('rush_rec_yd') && (has('rush_yd') || has('rec_yd'))) {
    out.rush_rec_yd = (out.rush_yd ?? 0) + (out.rec_yd ?? 0);
  }

  for (const [key, [stat, threshold, nextTier]] of Object.entries(THRESHOLD_BONUSES)) {
    if (has(key)) continue;
    const mean = out[stat];
    if (mean === undefined || mean <= 0) continue;
    const sd = (STAT_SD[stat] ?? ((m: number) => Math.max(12, 0.6 * m)))(mean);
    const reached = probAtLeast(mean, sd, threshold);
    out[key] = Math.max(0, nextTier === undefined ? reached : reached - probAtLeast(mean, sd, nextTier));
  }

  for (const [key, [stat, share]] of Object.entries(LONG_TD_SHARE)) {
    if (has(key)) continue;
    const tds = out[stat];
    if (tds !== undefined && tds > 0) out[key] = tds * share;
  }

  // Position reception bonuses (TE premium and the like) for sources that carry only receptions; Sleeper's
  // rows set them (bonus_rec_te = a TE's receptions).
  const recKey = `bonus_rec_${pos.toLowerCase()}`;
  if (['RB', 'WR', 'TE'].includes(pos) && !has(recKey) && (out.rec ?? 0) > 0) out[recKey] = out.rec!;

  // Position-specific first-down bonuses: every first down the player produced, passing, rushing and
  // receiving (Sleeper's own stat lines, 2024–25: QB 100%, RB/WR/TE 99.7–99.9%; docs/stat-mapping.md).
  const fdKey = `bonus_fd_${pos.toLowerCase()}`;
  if (['QB', 'RB', 'WR', 'TE'].includes(pos) && !has(fdKey)) {
    const fd = (out.pass_fd ?? 0) + (out.rush_fd ?? 0) + (out.rec_fd ?? 0);
    if (fd > 0) out[fdKey] = fd;
  }

  if (!has('fgmiss') && has('fga') && has('fgm')) out.fgmiss = Math.max(0, out.fga! - out.fgm!);
  const long = out.fgm_50p;
  if (long !== undefined) {
    if (!has('fgm_50_59')) out.fgm_50_59 = long * (1 - FG_60P_SHARE);
    if (!has('fgm_60p')) out.fgm_60p = long * FG_60P_SHARE;
  }

  if (pos === 'DEF') {
    const pa = out.pts_allow;
    if (pa !== undefined) {
      for (const [key, lo, hi] of PTS_ALLOW_BUCKETS) out[key] = normInterval(pa, PTS_ALLOW_SD, lo, hi);
    }
    const ya = out.yds_allow;
    if (ya !== undefined) {
      for (const [key, lo, hi] of YDS_ALLOW_BUCKETS) out[key] = normInterval(ya, YDS_ALLOW_SD, lo, hi);
    }
  }
  return out;
}

/** Expected league points for a projected stat line. */
export function projectedPoints(stats: StatLine, scoring: ScoringSettings, pos: string): number {
  return scoreStats(expectedStats(stats, pos), scoring);
}

/** Scoring keys with non-zero points that no projection carries, we can't derive, and that matter. */
export function uncoveredScoringKeys(scoring: ScoringSettings, projectedKeys: Set<string>): string[] {
  return Object.entries(scoring)
    .filter(([key, pts]) => pts !== 0 && !projectedKeys.has(key) && !DERIVED_KEYS.has(key) && !MINOR_SCORING_KEYS.has(key))
    .map(([key]) => key)
    .sort();
}
