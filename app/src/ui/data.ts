import { analyzeLineup, analyzeWaivers, type LineupAnalysis, type WaiverRow, type WeekContext } from '../analysis/analyze';
import type { League, Roster } from '../domain/types';
import { loadLeagueData, loadLeagues, loadState, loadTrending, loadWeek, type DataNotes, type LeagueData } from '../data/repo';
import { findUserRoster } from '../sleeper/parse';
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

export async function loadWaivers(bundle: LeagueBundle): Promise<WaiverRow[]> {
  if (!bundle.myRoster) return [];
  const trending = await loadTrending();
  return analyzeWaivers(bundle.league, bundle.data.rosters, bundle.myRoster, bundle.ctx, trending);
}

export async function findLeague(session: Session, leagueId: string, force: boolean): Promise<{ overview: Overview; league: League }> {
  const overview = await loadOverview(session, force);
  const league = overview.leagues.find((l) => l.id === leagueId);
  if (!league) throw new Error('League not found for this user and season.');
  return { overview, league };
}
