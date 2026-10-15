import type { Game, League, LeagueUser, Matchup, Player, Roster } from '../domain/types';
import { gamesByTeam, type WeekContext } from '../analysis/analyze';
import { sleeperApi, SleeperError } from '../sleeper/api';
import { indexProjections, parseLeague, parseMatchup, parsePlayersDump, parseRoster, parseUser } from '../sleeper/parse';
import type { RawState, RawUser } from '../sleeper/raw';
import { cached } from './cache';
import { DATA_SCHEMA_VERSION, type CompactPlayer, type Manifest, type PlayersFile, type ScheduleFile } from './contracts';

const MIN = 60_000;
const HOUR = 60 * MIN;

export interface DataNotes {
  /** Human-readable notes about stale or fallback data, shown in the UI. */
  notes: string[];
  /** Oldest timestamp among the sources used. */
  asOf: number;
}

const dataUrl = (file: string) => `${import.meta.env.BASE_URL}data/${file}`;

async function fetchDataFile<T extends { schemaVersion: number }>(file: string): Promise<T> {
  const res = await fetch(dataUrl(file), { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
  const json = (await res.json()) as T;
  if (Math.floor(json.schemaVersion) > DATA_SCHEMA_VERSION) throw new Error(`${file} needs a newer app version — reload the app`);
  return json;
}

export async function loadState(force = false) {
  return cached<RawState>('state', 10 * MIN, () => sleeperApi.state(), { force });
}

export async function lookupUser(username: string): Promise<RawUser> {
  const user = await sleeperApi.user(username);
  if (!user?.user_id) throw new SleeperError(`No Sleeper user named “${username}”`, 404);
  return user;
}

export async function loadLeagues(userId: string, season: string, force = false): Promise<League[]> {
  const res = await cached(`leagues:${userId}:${season}`, 30 * MIN, () => sleeperApi.leagues(userId, season), { force });
  const order: Record<string, number> = { in_season: 0, post_season: 1, drafting: 2, pre_draft: 3, complete: 4 };
  return res.value.map(parseLeague).sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || a.name.localeCompare(b.name));
}

export interface LeagueData {
  rosters: Roster[];
  users: LeagueUser[];
  matchups: Matchup[];
  savedAt: number;
  stale: boolean;
}

export async function loadLeagueData(leagueId: string, week: number, force = false): Promise<LeagueData> {
  const [rosters, users, matchups] = await Promise.all([
    cached(`rosters:${leagueId}`, 2 * MIN, () => sleeperApi.rosters(leagueId), { force }),
    cached(`users:${leagueId}`, 6 * HOUR, () => sleeperApi.users(leagueId), { force }),
    cached(`matchups:${leagueId}:${week}`, 2 * MIN, () => sleeperApi.matchups(leagueId, week), { force }),
  ]);
  return {
    rosters: rosters.value.map(parseRoster),
    users: users.value.map(parseUser),
    matchups: matchups.value.map(parseMatchup),
    savedAt: Math.min(rosters.savedAt, matchups.savedAt),
    stale: rosters.stale || matchups.stale,
  };
}

function playersFromFile(file: PlayersFile): Map<string, Player> {
  const out = new Map<string, Player>();
  for (const c of file.players) out.set(c.id, fromCompact(c));
  return out;
}

function fromCompact(c: CompactPlayer): Player {
  const p: Player = { id: c.id, name: c.n, pos: c.pos, fpos: c.fp ?? [c.pos], team: c.t ?? null, injury: c.inj ?? null };
  if (c.body) p.injuryBody = c.body;
  if (c.prac) p.practice = c.prac;
  if (c.dp) p.depthPos = c.dp;
  if (c.do !== undefined) p.depthOrder = c.do;
  if (c.rk !== undefined) p.rank = c.rk;
  if (c.gsis) p.gsis = c.gsis;
  return p;
}

/** Projections + players + schedule for one week, with notes on anything stale or approximate. */
export async function loadWeek(season: string, week: number, force = false): Promise<WeekContext & DataNotes> {
  const notes: string[] = [];
  const projRes = await cached(`projections:${season}:${week}`, 30 * MIN, () => sleeperApi.projections(season, week), { force });
  if (projRes.stale) notes.push('Projections could not be refreshed; showing a saved copy.');
  const projections = indexProjections(projRes.value, week);
  let asOf = projRes.savedAt;

  // Player DB: pipeline file first (daily), then Sleeper's full dump (once a day), then projection rows.
  let players = new Map<string, Player>();
  try {
    const file = await cached('data:players', 3 * HOUR, () => fetchDataFile<PlayersFile>('players.json'), { force });
    players = playersFromFile(file.value);
    asOf = Math.min(asOf, Date.parse(file.value.generatedAt) || asOf);
  } catch {
    try {
      const dump = await cached('sleeper:players', 24 * HOUR, () => sleeperApi.players());
      players = parsePlayersDump(dump.value);
      notes.push('Practice reports unavailable (app data files missing); using Sleeper injury tags only.');
    } catch {
      notes.push('Player database unavailable; names and injuries come from projection rows.');
    }
  }
  // Projection rows carry Sleeper's current injury tags (refreshed every few minutes): prefer them.
  for (const [id, pp] of projections.players) {
    const cur = players.get(id);
    if (!cur) players.set(id, pp);
    else {
      const merged: Player = { ...cur, injury: pp.injury, team: pp.team ?? cur.team };
      if (pp.injuryBody) merged.injuryBody = pp.injuryBody;
      else if (!pp.injury) delete merged.injuryBody;
      if (!pp.injury) delete merged.practice;
      players.set(id, merged);
    }
  }

  let games: Game[] = [];
  let kickoffsApproximate = false;
  try {
    const sched = await cached('data:schedule', 3 * HOUR, () => fetchDataFile<ScheduleFile>('schedule.json'), { force });
    if (sched.value.season === season) games = sched.value.games;
  } catch {
    /* fall through to approximation */
  }
  if (!games.some((g) => g.week === week)) {
    games = approximateGames(projRes.value, week);
    kickoffsApproximate = true;
    notes.push('Kickoff times are approximate (schedule file unavailable); lock handling may be off.');
  }

  return {
    season,
    week,
    now: Date.now(),
    players,
    projections,
    gamesByTeam: gamesByTeam(games, week),
    kickoffsApproximate,
    notes,
    asOf,
  };
}

/** Games from projection rows (team, opponent, date) with a 1 pm ET kickoff guess. */
function approximateGames(rows: ReadonlyArray<{ team?: string | null; opponent?: string | null; date?: string | null }>, week: number): Game[] {
  const seen = new Map<string, Game>();
  for (const r of rows) {
    if (!r.team || !r.opponent || !r.date) continue;
    const key = [r.team, r.opponent].sort().join('-');
    if (!seen.has(key)) seen.set(key, { id: `${r.date}_${key}`, week, away: r.team, home: r.opponent, kickoff: `${r.date}T17:00:00.000Z` });
  }
  return [...seen.values()];
}

export async function loadTrending(): Promise<Map<string, number>> {
  try {
    const res = await cached('trending:add', HOUR, () => sleeperApi.trending('add', 24, 200));
    return new Map(res.value.map((t) => [t.player_id, t.count]));
  } catch {
    return new Map();
  }
}

export async function loadManifest(): Promise<Manifest | null> {
  try {
    return await fetchDataFile<Manifest>('manifest.json');
  } catch {
    return null;
  }
}
