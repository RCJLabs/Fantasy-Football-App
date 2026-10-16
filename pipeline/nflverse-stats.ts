// nflverse weekly player stats → Sleeper stat keys, so a league's scoring settings can score nflverse
// lines the way Sleeper scores its own (PLAN §5 Phase 2 item 8; checked in docs/stat-mapping.md).
// QB/RB/WR/TE stats only: kicking, team defense, IDP and distance tiers (e.g. pass_td_40p) aren't mapped.
import type { StatLine } from '../app/src/domain/types';

/** nflverse `stats_player_week` columns → Sleeper stat keys (first downs are handled separately). */
export const NFLVERSE_STATS: ReadonlyArray<readonly [string, string]> = [
  ['completions', 'pass_cmp'],
  ['attempts', 'pass_att'],
  ['passing_yards', 'pass_yd'],
  ['passing_tds', 'pass_td'],
  ['passing_interceptions', 'pass_int'],
  ['sacks_suffered', 'pass_sack'],
  ['passing_2pt_conversions', 'pass_2pt'],
  ['carries', 'rush_att'],
  ['rushing_yards', 'rush_yd'],
  ['rushing_tds', 'rush_td'],
  ['rushing_2pt_conversions', 'rush_2pt'],
  ['targets', 'rec_tgt'],
  ['receptions', 'rec'],
  ['receiving_yards', 'rec_yd'],
  ['receiving_tds', 'rec_td'],
  ['receiving_2pt_conversions', 'rec_2pt'],
  ['special_teams_tds', 'st_td'],
  ['fumble_recovery_tds', 'fum_rec_td'],
];

const num = (s: string | undefined): number => {
  const v = Number(s);
  return s === undefined || s === '' || s === 'NA' || !Number.isFinite(v) ? 0 : v;
};

/** First downs: nflverse column, its touchdown column, Sleeper key. */
const FIRST_DOWNS: ReadonlyArray<readonly [string, string, string]> = [
  ['passing_first_downs', 'passing_tds', 'pass_fd'],
  ['rushing_first_downs', 'rushing_tds', 'rush_fd'],
  ['receiving_first_downs', 'receiving_tds', 'rec_fd'],
];

/**
 * Yardage and volume bonuses Sleeper sets as 0/1 per game: stat → tiers, lowest first. The tiers are
 * exclusive: only the highest one reached is set.
 */
const TIERS: ReadonlyArray<readonly [string, ReadonlyArray<readonly [string, number]>]> = [
  ['pass_yd', [['bonus_pass_yd_300', 300], ['bonus_pass_yd_400', 400]]],
  ['pass_cmp', [['bonus_pass_cmp_25', 25]]],
  ['rush_yd', [['bonus_rush_yd_100', 100], ['bonus_rush_yd_200', 200]]],
  ['rush_att', [['bonus_rush_att_20', 20]]],
  ['rec_yd', [['bonus_rec_yd_100', 100], ['bonus_rec_yd_200', 200]]],
  ['rush_rec_yd', [['bonus_rush_rec_yd_100', 100], ['bonus_rush_rec_yd_200', 200]]],
];

/**
 * One nflverse row as an actual Sleeper-keyed stat line for a player at `pos`, with the per-game bonuses
 * an actual line implies (thresholds met, position reception and first-down bonuses).
 */
export function nflverseStatLine(r: Readonly<Record<string, string>>, pos: string): StatLine {
  const out: StatLine = {};
  for (const [col, key] of NFLVERSE_STATS) {
    const v = num(r[col]);
    if (v !== 0) out[key] = v;
  }
  // nflverse counts a touchdown as a first down; Sleeper doesn't.
  for (const [fd, td, key] of FIRST_DOWNS) {
    const v = Math.max(0, num(r[fd]) - num(r[td]));
    if (v) out[key] = v;
  }
  const fumLost = r.fumbles_lost_total !== undefined && r.fumbles_lost_total !== '' && r.fumbles_lost_total !== 'NA'
    ? num(r.fumbles_lost_total)
    : num(r.sack_fumbles_lost) + num(r.rushing_fumbles_lost) + num(r.receiving_fumbles_lost);
  if (fumLost) out.fum_lost = fumLost;
  const rushRec = (out.rush_yd ?? 0) + (out.rec_yd ?? 0);
  if (rushRec) out.rush_rec_yd = rushRec;
  for (const [stat, tiers] of TIERS) {
    const reached = tiers.filter(([, threshold]) => (out[stat] ?? 0) >= threshold).pop();
    if (reached) out[reached[0]] = 1;
  }
  const p = pos.toLowerCase();
  if (['RB', 'WR', 'TE'].includes(pos) && out.rec) out[`bonus_rec_${p}`] = out.rec;
  // Sleeper's first-down bonus counts every first down the player produced: passing, rushing and receiving.
  if (['QB', 'RB', 'WR', 'TE'].includes(pos)) {
    const fd = (out.pass_fd ?? 0) + (out.rush_fd ?? 0) + (out.rec_fd ?? 0);
    if (fd) out[`bonus_fd_${p}`] = fd;
  }
  return out;
}
