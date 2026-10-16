import { analyzeLineup, type LineupAnalysis, type LineupOptions, type WeekContext } from '../analysis/analyze';
import { buildOutlook, type LeagueOutlook } from '../analysis/outlook';
import { reviewSeason, type SeasonReview } from '../analysis/review';
import { playoffWeekInfo, projectionPositions, regularSeasonEnd, regularSeasonOver, RosModel, seasonEnd, teamIds } from '../analysis/ros';
import type { League, Roster } from '../domain/types';
import {
  loadBracket,
  loadLeagueData,
  loadLeagues,
  loadMatchups,
  loadPlayedPoints,
  loadRosWeeks,
  loadSchedule,
  loadState,
  loadTradedPicks,
  loadWaiverClaims,
  loadWeek,
  type DataNotes,
  type LeagueData,
} from '../data/repo';
import { findUserRoster } from '../sleeper/parse';
import type { RawTradedPick, RawTransaction } from '../sleeper/raw';
import { adviceCutoff, loadAdvice, saveAdvice } from './advice';
import { objectivePref, type Phase } from './prefs';
import type { Session } from './session';

export interface Overview {
  season: string;
  week: number;
  seasonType: string;
  leagues: League[];
}

export async function loadOverview(session: Session, force: boolean): Promise<Overview> {
  const state = (await loadState(force)).value;
  const season = state.league_season ?? state.season;
  const leagues = await loadLeagues(session.userId, season, force);
  return { season, week: Math.max(1, state.week || state.display_week || 1), seasonType: state.season_type, leagues };
}

// Several league cards load at once: share one in-flight week load instead of fetching projections N times.
let weekMemo: { key: string; at: number; promise: Promise<WeekContext & DataNotes> } | null = null;
export function sharedWeek(season: string, week: number, force: boolean): Promise<WeekContext & DataNotes> {
  const key = `${season}:${week}`;
  if (!force && weekMemo && weekMemo.key === key && Date.now() - weekMemo.at < 5 * 60_000) return weekMemo.promise;
  const promise = loadWeek(season, week, force);
  weekMemo = { key, at: Date.now(), promise };
  promise.catch(() => {
    if (weekMemo?.promise === promise) weekMemo = null;
  });
  return promise;
}

export interface LeagueBundle {
  league: League;
  week: number;
  phase: Phase;
  data: LeagueData;
  ctx: WeekContext & DataNotes;
  myRoster?: Roster;
  lineup?: LineupAnalysis;
  /** Two-week playoff rounds: the round's other week for both teams. */
  extra?: LineupOptions['extra'];
}

export function seasonPhase(league: League, week: number): Phase {
  const start = league.rules.playoffWeekStart;
  return start && week >= start ? 'playoffs' : 'regular';
}

/** Lineup analysis with this device's lineup-mode choice for the league and phase (default otherwise). */
export function lineupFor(bundle: LeagueBundle, objective = objectivePref(bundle.league.id, bundle.phase)): LineupAnalysis | undefined {
  const { league, data, myRoster, ctx, extra } = bundle;
  if (!myRoster || !(league.status === 'in_season' || league.status === 'post_season')) return undefined;
  const opts: LineupOptions = {};
  if (objective) opts.objective = objective;
  if (extra) opts.extra = extra;
  return analyzeLineup(league, data.rosters, data.users, data.matchups, myRoster, ctx, opts);
}

export async function loadLeagueBundle(league: League, week: number, session: Session, force: boolean): Promise<LeagueBundle> {
  const [data, ctx] = await Promise.all([loadLeagueData(league.id, week, force), sharedWeek(league.season, week, force)]);
  const myRoster = findUserRoster(data.rosters, session.userId);
  const bundle: LeagueBundle = { league, week, phase: seasonPhase(league, week), data, ctx: { ...ctx, now: Date.now() } };
  if (myRoster) {
    bundle.myRoster = myRoster;
    const extra = await roundExtra(bundle, myRoster).catch(() => undefined);
    if (extra) bundle.extra = extra;
    const lineup = lineupFor(bundle);
    if (lineup) {
      bundle.lineup = lineup;
      rememberAdvice(bundle, lineup);
    }
  }
  return bundle;
}

// Home's league cards and its across-leagues card share one bundle load per league. Kept briefly, so coming back to
// Home still picks up lineup changes made in Sleeper; a forced reload reuses one another card forced a moment ago.
const bundleMemo = new Map<string, { at: number; promise: Promise<LeagueBundle> }>();
export function sharedBundle(league: League, week: number, session: Session, force: boolean): Promise<LeagueBundle> {
  const key = `${session.userId}:${league.id}:${week}`;
  const hit = bundleMemo.get(key);
  const age = hit ? Date.now() - hit.at : Infinity;
  if (hit && age < (force ? 2000 : 30_000)) return hit.promise;
  const promise = loadLeagueBundle(league, week, session, force);
  bundleMemo.set(key, { at: Date.now(), promise });
  promise.catch(() => {
    if (bundleMemo.get(key)?.promise === promise) bundleMemo.delete(key);
  });
  return promise;
}

/** Keeps the week's recommended starters on this device (until the main Sunday kickoff) for the season review. */
export function rememberAdvice(bundle: LeagueBundle, a: LineupAnalysis): void {
  if (bundle.league.rules.bestBall || a.week !== bundle.week) return;
  const starters = a.recommended.flatMap((r) => (r ? [r.id] : []));
  saveAdvice(bundle.league.id, a.week, starters, Date.now(), adviceCutoff(bundle.ctx.gamesByTeam.values()));
}

/**
 * In a two-week playoff round the total decides it: the first week's final scores (when this is the
 * second week), or both teams' best projected lineups next week (when this is the first).
 */
async function roundExtra(bundle: LeagueBundle, myRoster: Roster): Promise<LineupOptions['extra']> {
  const { league, week, data, ctx } = bundle;
  const info = playoffWeekInfo(league, week);
  if (info?.roundWeeks !== 2) return undefined;
  const mine = data.matchups.find((m) => m.rosterId === myRoster.rosterId);
  const opp = mine?.matchupId != null ? data.matchups.find((m) => m.matchupId === mine.matchupId && m.rosterId !== myRoster.rosterId) : undefined;
  const oppRoster = opp ? data.rosters.find((r) => r.rosterId === opp.rosterId) : undefined;
  if (!opp || !oppRoster) return undefined;
  if (info.weekInRound === 2) {
    const prev = await loadMatchups(league.id, week - 1);
    const scored = (rosterId: number) => ({ mean: prev.find((m) => m.rosterId === rosterId)?.points ?? 0, variance: 0 });
    return { me: scored(myRoster.rosterId), opp: scored(opp.rosterId) };
  }
  const ros = await loadRosWeeks(league.season, [week + 1], projectionPositions(league));
  if (ros.missing.length) return undefined;
  const model = new RosModel({ league, weeks: [week + 1], currentWeek: week, byWeek: ros.byWeek, players: ctx.players });
  return { me: model.bestWeek(teamIds(myRoster), 0), opp: model.bestWeek(teamIds(oppRoster), 0) };
}

export interface SeasonBundle {
  outlook: LeagueOutlook;
  /** Future weeks whose projections couldn't be loaded (valued as zero). */
  missingWeeks: number[];
  claims: RawTransaction[];
  /** Dynasty leagues that trade picks: the picks that changed hands (null when Sleeper didn't answer). */
  tradedPicks?: RawTradedPick[] | null;
}

const range = (from: number, to: number) => Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);

// Waivers, Trade and Season tabs share one rest-of-season load per league bundle.
const seasonMemo = new WeakMap<LeagueBundle, Promise<SeasonBundle>>();
export function loadSeason(bundle: LeagueBundle): Promise<SeasonBundle> {
  let p = seasonMemo.get(bundle);
  if (!p) {
    p = buildSeason(bundle);
    seasonMemo.set(bundle, p);
    p.catch(() => seasonMemo.delete(bundle));
  }
  return p;
}

async function buildSeason(bundle: LeagueBundle): Promise<SeasonBundle> {
  const { league, week, data, ctx } = bundle;
  const weeks = range(week + 1, seasonEnd(league));
  const withPicks = league.rules.type === 'dynasty' && league.rules.pickTrading;
  // Once the regular season is over, the odds come from Sleeper's bracket and the points already scored in it.
  const start = league.rules.playoffWeekStart;
  const playoffs = !!start && regularSeasonOver(league, week);
  const playedWeeks = playoffs ? range(start, Math.min(week - 1, seasonEnd(league))) : [];
  const [ros, schedule, claims, tradedPicks, bracket, played] = await Promise.all([
    loadRosWeeks(league.season, weeks, projectionPositions(league)),
    loadSchedule(league.id, weeks.filter((w) => w <= regularSeasonEnd(league))),
    league.rules.waiverType === 2 ? loadWaiverClaims(league.id, week).catch(() => []) : Promise.resolve([]),
    withPicks ? loadTradedPicks(league.id).catch(() => null) : Promise.resolve(undefined),
    playoffs ? loadBracket(league.id).catch(() => []) : Promise.resolve([]),
    playedWeeks.length ? loadPlayedPoints(league.id, playedWeeks) : Promise.resolve(undefined),
  ]);
  if (weeks.length && ros.missing.length === weeks.length) throw new Error('Could not load future-week projections from Sleeper.');
  const outlook = buildOutlook({
    league,
    rosters: data.rosters,
    users: data.users,
    matchups: data.matchups,
    ctx,
    byWeek: ros.byWeek,
    schedule,
    ...(bracket.length ? { bracket } : {}),
    ...(played ? { played } : {}),
  });
  return { outlook, missingWeeks: ros.missing, claims, ...(tradedPicks !== undefined ? { tradedPicks } : {}) };
}

/** Regular-season weeks already scored. */
export function playedWeeks(league: League, week: number): number[] {
  return range(1, Math.min(league.rules.lastScoredWeek ?? week - 1, week - 1, regularSeasonEnd(league)));
}

// The review loads every played week's matchups and projections: once per league bundle.
const reviewMemo = new WeakMap<LeagueBundle, Promise<SeasonReview | undefined>>();
export function loadReview(bundle: LeagueBundle): Promise<SeasonReview | undefined> {
  let p = reviewMemo.get(bundle);
  if (!p) {
    p = buildReview(bundle);
    reviewMemo.set(bundle, p);
    p.catch(() => reviewMemo.delete(bundle));
  }
  return p;
}

async function buildReview(bundle: LeagueBundle): Promise<SeasonReview | undefined> {
  const { league, week, data, ctx, myRoster } = bundle;
  const weeks = playedWeeks(league, week);
  if (!myRoster || !weeks.length) return undefined;
  // Projections only feed the players' comparison: the rest stands without them.
  const [played, projections] = await Promise.all([
    loadSchedule(league.id, weeks),
    loadRosWeeks(league.season, weeks, projectionPositions(league)).catch(() => undefined),
  ]);
  if (!played.size) throw new Error('Could not load past weeks from Sleeper.');
  return reviewSeason({
    league,
    rosters: data.rosters,
    rosterId: myRoster.rosterId,
    played,
    players: ctx.players,
    ...(projections?.byWeek.size ? { projections: projections.byWeek } : {}),
    advice: loadAdvice(league.id, weeks),
  });
}

export async function findLeague(session: Session, leagueId: string, force: boolean): Promise<{ overview: Overview; league: League }> {
  const overview = await loadOverview(session, force);
  const league = overview.leagues.find((l) => l.id === leagueId);
  if (!league) throw new Error('League not found for this user and season.');
  return { overview, league };
}
