import { analyzeLineup, type LineupAnalysis, type WeekContext } from '../analysis/analyze';
import { buildOutlook, type LeagueOutlook } from '../analysis/outlook';
import { projectionPositions, regularSeasonEnd, seasonEnd } from '../analysis/ros';
import type { League, Roster } from '../domain/types';
import {
  loadLeagueData,
  loadLeagues,
  loadRosWeeks,
  loadSchedule,
  loadState,
  loadWaiverClaims,
  loadWeek,
  type DataNotes,
  type LeagueData,
} from '../data/repo';
import { findUserRoster } from '../sleeper/parse';
import type { RawTransaction } from '../sleeper/raw';
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
  data: LeagueData;
  ctx: WeekContext & DataNotes;
  myRoster?: Roster;
  lineup?: LineupAnalysis;
}

export async function loadLeagueBundle(league: League, week: number, session: Session, force: boolean): Promise<LeagueBundle> {
  const [data, ctx] = await Promise.all([loadLeagueData(league.id, week, force), sharedWeek(league.season, week, force)]);
  const myRoster = findUserRoster(data.rosters, session.userId);
  const bundle: LeagueBundle = { league, week, data, ctx: { ...ctx, now: Date.now() } };
  if (myRoster) {
    bundle.myRoster = myRoster;
    if (league.status === 'in_season' || league.status === 'post_season') {
      bundle.lineup = analyzeLineup(league, data.rosters, data.users, data.matchups, myRoster, bundle.ctx);
    }
  }
  return bundle;
}

export interface SeasonBundle {
  outlook: LeagueOutlook;
  /** Future weeks whose projections couldn't be loaded (valued as zero). */
  missingWeeks: number[];
  claims: RawTransaction[];
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
  const [ros, schedule, claims] = await Promise.all([
    loadRosWeeks(league.season, weeks, projectionPositions(league)),
    loadSchedule(league.id, weeks.filter((w) => w <= regularSeasonEnd(league))),
    league.rules.waiverType === 2 ? loadWaiverClaims(league.id, week).catch(() => []) : Promise.resolve([]),
  ]);
  if (weeks.length && ros.missing.length === weeks.length) throw new Error('Could not load future-week projections from Sleeper.');
  const outlook = buildOutlook({ league, rosters: data.rosters, users: data.users, matchups: data.matchups, ctx, byWeek: ros.byWeek, schedule });
  return { outlook, missingWeeks: ros.missing, claims };
}

export async function findLeague(session: Session, leagueId: string, force: boolean): Promise<{ overview: Overview; league: League }> {
  const overview = await loadOverview(session, force);
  const league = overview.leagues.find((l) => l.id === leagueId);
  if (!league) throw new Error('League not found for this user and season.');
  return { overview, league };
}
