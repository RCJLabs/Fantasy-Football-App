// In-house team defense v0 (docs/PLAN.md §2, the K/DST row; results in docs/dst.md). A defense's expected
// stat line for one game:
// - points allowed: the opponent's implied total, plus the average gap between Sleeper's points allowed and
//   the implied total (Sleeper leaves out points the defense didn't give up);
// - sacks, interceptions, fumbles and yards: the defense's own recent rate times the rate the opponent's
//   offense has allowed, over the league rate (each shrunk toward the league), with a home/away factor;
// - defensive TDs follow takeaways at the league rate; return TDs, safeties and blocked kicks are league rates.
// Stat-level, so each league's scoring prices it, buckets included.
import type { StatLine } from '../app/src/domain/types';
import type { SleeperRow } from './baseline';

/** Per-game rates combined defense × offense. */
export const RATE_STATS = ['sack', 'int', 'fum_rec', 'ff', 'yds_allow'] as const;
/** Rare events taken at the league rate. */
export const LEAGUE_STATS = ['def_st_td', 'safe', 'blk_kick'] as const;
/** Home/away factors apply to the pass-rush and takeaway stats only. */
const HOME_STATS = new Set<string>(['sack', 'int', 'fum_rec', 'ff']);

/** One defense's actual line in one game (a Sleeper DEF stats row). */
export interface DefGame {
  season: number;
  week: number;
  team: string;
  opp: string;
  home?: boolean;
  /** Opponent's implied total for that game, when lines were posted. */
  oppImplied?: number;
  stats: StatLine;
}

export interface DstParams {
  /** Games until a game's weight halves, per team. */
  halfLife: number;
  maxGames: number;
  /** Extra weight factor for games from earlier seasons. */
  priorSeasonWeight: number;
  /** Pseudo-games of the league rate mixed into each team's rates. */
  shrinkGames: number;
}

/**
 * Best of a 36-point grid on 2023 alone (docs/dst.md); 2024 on is the out-of-sample test. The grid was flat:
 * shrinking team rates all the way to the league's did as well, so team sack and turnover rates add little.
 */
export const DST_V0: DstParams = { halfLife: 3, maxGames: 17, priorSeasonWeight: 1, shrinkGames: 32 };

export interface LeagueRates {
  /** Mean per team-game. */
  mean: StatLine;
  /** Mean of (points allowed − opponent's implied total) over games with lines. */
  ptsGap: number;
  /** Home rate ÷ overall rate for the home/away stats (away gets the mirror). */
  home: StatLine;
  /** Defensive TDs per takeaway. */
  tdPerTakeaway: number;
}

const mean = (xs: readonly number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** League rates over `games` (any order). */
export function leagueRates(games: readonly DefGame[]): LeagueRates {
  const m: StatLine = {};
  for (const k of [...RATE_STATS, ...LEAGUE_STATS, 'def_td', 'pts_allow']) m[k] = mean(games.map((g) => g.stats[k] ?? 0));
  const withLines = games.filter((g) => g.oppImplied !== undefined && g.stats.pts_allow !== undefined);
  const home: StatLine = {};
  for (const k of HOME_STATS) {
    const h = mean(games.filter((g) => g.home === true).map((g) => g.stats[k] ?? 0));
    const a = mean(games.filter((g) => g.home === false).map((g) => g.stats[k] ?? 0));
    home[k] = h + a > 0 ? (2 * h) / (h + a) : 1;
  }
  const takeaways = (m.int ?? 0) + (m.fum_rec ?? 0);
  return {
    mean: m,
    ptsGap: mean(withLines.map((g) => g.stats.pts_allow! - g.oppImplied!)),
    home,
    tdPerTakeaway: takeaways > 0 ? (m.def_td ?? 0) / takeaways : 0,
  };
}

/** Recency-weighted, shrunk per-game rates from a team's games (most recent first after sorting). */
export function teamRate(lines: ReadonlyArray<{ season: number; week: number; stats: StatLine }>, season: number, league: Readonly<StatLine>, p: DstParams): StatLine {
  const recent = [...lines].sort((a, b) => b.season - a.season || b.week - a.week).slice(0, p.maxGames);
  const sums: StatLine = {};
  let weight = 0;
  recent.forEach((g, age) => {
    const w = 0.5 ** (age / p.halfLife) * (g.season < season ? p.priorSeasonWeight : 1);
    weight += w;
    for (const k of RATE_STATS) sums[k] = (sums[k] ?? 0) + w * (g.stats[k] ?? 0);
  });
  const out: StatLine = {};
  for (const k of RATE_STATS) out[k] = ((sums[k] ?? 0) + p.shrinkGames * (league[k] ?? 0)) / (weight + p.shrinkGames);
  return out;
}

/**
 * A defense's expected line against `opp`, from earlier games only: `history` holds every team's DEF lines
 * before this game (what a defense recorded is what its opponent's offense allowed).
 */
export function dstStats(
  team: string,
  opp: string,
  home: boolean | undefined,
  oppImplied: number | undefined,
  season: number,
  history: readonly DefGame[],
  league: LeagueRates,
  p: DstParams,
): StatLine {
  const defense = teamRate(history.filter((g) => g.team === team), season, league.mean, p);
  const offense = teamRate(history.filter((g) => g.opp === opp), season, league.mean, p);
  const out: StatLine = {};
  for (const k of RATE_STATS) {
    const base = league.mean[k] ?? 0;
    let v = base > 0 ? ((defense[k] ?? 0) * (offense[k] ?? 0)) / base : 0;
    if (home !== undefined && HOME_STATS.has(k)) {
      const f = league.home[k] ?? 1;
      v *= home ? f : Math.max(0, 2 - f);
    }
    out[k] = v;
  }
  out.def_td = ((out.int ?? 0) + (out.fum_rec ?? 0)) * league.tdPerTakeaway;
  for (const k of LEAGUE_STATS) out[k] = league.mean[k] ?? 0;
  // Points allowed: the market's view of the opponent, adjusted to Sleeper's definition. Without a line,
  // fall back to the league average.
  out.pts_allow = Math.max(0, oppImplied !== undefined ? oppImplied + league.ptsGap : (league.mean.pts_allow ?? 0));
  return out;
}

/** Game context by `${season}|${week}|${team}`: home or away, and the opponent's implied total. */
export type GameContext = ReadonlyMap<string, { home: boolean; oppImplied?: number }>;

/** A week's Sleeper DEF stats rows as defense games (rows without points allowed or an opponent are skipped). */
export function defGames(season: number, week: number, rows: readonly SleeperRow[], context: GameContext): DefGame[] {
  const out: DefGame[] = [];
  for (const r of rows) {
    const opp = r.opponent;
    if (r.position !== 'DEF' || !opp || r.stats?.pts_allow === undefined) continue;
    const team = r.team ?? r.player_id;
    const c = context.get(`${season}|${week}|${team}`);
    const game: DefGame = { season, week, team, opp, stats: r.stats };
    if (c) {
      game.home = c.home;
      if (c.oppImplied !== undefined) game.oppImplied = c.oppImplied;
    }
    out.push(game);
  }
  return out;
}

/**
 * This week's team defense lines, by team: every team in `matchups` (team → opponent), from the DEF lines of
 * earlier weeks of this season and last.
 */
export function dstWeek(
  season: number,
  week: number,
  history: readonly DefGame[],
  matchups: ReadonlyMap<string, string>,
  context: GameContext,
  p: DstParams = DST_V0,
): Record<string, StatLine> {
  // This season and last only, as the live pipeline fetches.
  const earlier = history.filter((g) => g.season >= season - 1 && (g.season < season || g.week < week));
  if (!earlier.length) return {};
  const league = leagueRates(earlier);
  const out: Record<string, StatLine> = {};
  for (const [team, opp] of matchups) {
    const c = context.get(`${season}|${week}|${team}`);
    out[team] = dstStats(team, opp, c?.home, c?.oppImplied, season, earlier, league, p);
  }
  return out;
}
