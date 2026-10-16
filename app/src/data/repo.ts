import type { BracketMatch, Game, League, LeagueUser, Matchup, Player, Roster, StatLine } from '../domain/types';
import { type BaselineIndex, gamesByTeam, type UsageIndex, type WeekContext } from '../analysis/analyze';
import { sleeperApi, SleeperError } from '../sleeper/api';
import { indexProjections, parseBracket, parseLeague, parseMatchup, parsePlayersDump, parseRoster, parseUser, type ProjectionIndex } from '../sleeper/parse';
import type { RawProjection, RawState, RawTradedPick, RawTransaction, RawUser } from '../sleeper/raw';
import { cached } from './cache';
import {
  DATA_SCHEMA_VERSION,
  type AccuracyFile,
  type BaselineFile,
  type CompactPlayer,
  type LedgerFile,
  type Manifest,
  type MatchupsFile,
  type PlayersFile,
  type ScheduleFile,
  type UsageFile,
} from './contracts';

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

/** Game statuses appear only on a team's final injury report of the week. */
const GAME_STATUSES = new Set(['Questionable', 'Doubtful', 'Out']);

/**
 * Players from the pipeline file. Practice statuses count only when the report is for `week` (early
 * in the week the file still holds last week's) and are final once the player has a game status.
 */
export function playersFromFile(file: PlayersFile, week: number): Map<string, Player> {
  const current = file.injuryReportWeek === week;
  const out = new Map<string, Player>();
  for (const c of file.players) out.set(c.id, fromCompact(c, current));
  return out;
}

/**
 * Projection rows carry Sleeper's current injury tags (refreshed every few minutes): they win over
 * the daily player file. A player Sleeper no longer tags keeps no practice status either.
 */
export function mergeProjectionPlayers(players: Map<string, Player>, fromProjections: ReadonlyMap<string, Player>): Map<string, Player> {
  for (const [id, pp] of fromProjections) {
    const cur = players.get(id);
    if (!cur) players.set(id, pp);
    else {
      const merged: Player = { ...cur, injury: pp.injury, team: pp.team ?? cur.team };
      if (pp.injuryBody) merged.injuryBody = pp.injuryBody;
      else if (!pp.injury) delete merged.injuryBody;
      if (!pp.injury) {
        delete merged.practice;
        delete merged.practiceFinal;
      }
      players.set(id, merged);
    }
  }
  return players;
}

function fromCompact(c: CompactPlayer, currentReport: boolean): Player {
  const p: Player = { id: c.id, name: c.n, pos: c.pos, fpos: c.fp ?? [c.pos], team: c.t ?? null, injury: c.inj ?? null };
  if (c.body) p.injuryBody = c.body;
  if (c.prac && currentReport) {
    p.practice = c.prac;
    if (c.rpt && GAME_STATUSES.has(c.rpt)) p.practiceFinal = true;
  }
  if (c.dp) p.depthPos = c.dp;
  if (c.do !== undefined) p.depthOrder = c.do;
  if (c.rk !== undefined) p.rank = c.rk;
  if (c.gsis) p.gsis = c.gsis;
  if (c.ml) p.missedLast = true;
  return p;
}

const OFFENSE_STATS = ['pass_yd', 'rush_yd', 'rec', 'rec_yd'];

/** True when the rows carry any QB/RB/WR/TE projection. */
export function hasOffenseProjections(index: ProjectionIndex): boolean {
  for (const p of index.byPlayer.values()) if (OFFENSE_STATS.some((k) => (p.stats[k] ?? 0) > 0)) return true;
  return false;
}

/** QB/RB/WR/TE projection rows from the in-house baseline, for a week without Sleeper projections. */
export function baselineProjectionRows(baseline: BaselineIndex, players: ReadonlyMap<string, Player>): RawProjection[] {
  return [...baseline.players].map(([id, stats]) => ({ player_id: id, stats: { ...stats }, team: players.get(id)?.team ?? null }));
}

/** Projections + players + schedule for one week, with notes on anything stale or approximate. */
export async function loadWeek(season: string, week: number, force = false): Promise<WeekContext & DataNotes> {
  const notes: string[] = [];
  // The in-house baseline: a second opinion, and the fallback for a week without Sleeper projections.
  let baseline: BaselineIndex | undefined;
  let baselineAt = 0;
  try {
    const file = (await cached('data:baseline', 3 * HOUR, () => fetchDataFile<BaselineFile>('baseline.json'), { force })).value;
    if (file.season === season && file.week === week) {
      baseline = { throughWeek: file.throughWeek, players: new Map(Object.entries(file.players)) };
      baselineAt = Date.parse(file.generatedAt) || 0;
    }
  } catch {
    /* no second opinion or fallback */
  }

  let projRows: RawProjection[] = [];
  let asOf = Date.now();
  try {
    const projRes = await cached(`projections:${season}:${week}`, 30 * MIN, () => sleeperApi.projections(season, week), { force });
    if (projRes.stale) notes.push('Projections could not be refreshed; showing a saved copy.');
    projRows = projRes.value;
    asOf = projRes.savedAt;
  } catch (e) {
    if (!baseline) throw e;
  }
  let projections = indexProjections(projRows, week);

  // Player DB: pipeline file first (daily), then Sleeper's full dump (once a day), then projection rows.
  let players = new Map<string, Player>();
  try {
    const file = await cached('data:players', 3 * HOUR, () => fetchDataFile<PlayersFile>('players.json'), { force });
    players = playersFromFile(file.value, week);
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
  mergeProjectionPlayers(players, projections.players);

  let projectionSource: WeekContext['projectionSource'];
  if (baseline && !hasOffenseProjections(projections)) {
    // Baseline rows go on top: any K/DEF projections Sleeper did return stay.
    projections = indexProjections([...projRows, ...baselineProjectionRows(baseline, players)], week);
    projectionSource = 'baseline';
    if (baselineAt) asOf = Math.min(asOf, baselineAt);
    notes.push(
      `Sleeper's projections aren't available for week ${week}, so QB, RB, WR, TE and DEF projections come from our baseline (less accurate in backtests, about equal for DEF). Kickers have none.`,
    );
  }

  let games: Game[] = [];
  let kickoffsApproximate = false;
  try {
    const sched = await cached('data:schedule', 3 * HOUR, () => fetchDataFile<ScheduleFile>('schedule.json'), { force });
    if (sched.value.season === season) games = sched.value.games;
  } catch {
    /* fall through to approximation */
  }
  // Recent usage and matchup context are display only: the app works the same without them.
  let usage: UsageIndex | undefined;
  try {
    const file = (await cached('data:usage', 3 * HOUR, () => fetchDataFile<UsageFile>('usage.json'), { force })).value;
    if (file.season === season) usage = { weeks: file.weeks, players: new Map(Object.entries(file.players)) };
  } catch {
    /* no usage shown */
  }
  let matchups: MatchupsFile | undefined;
  try {
    const file = (await cached('data:matchups', 3 * HOUR, () => fetchDataFile<MatchupsFile>('matchups.json'), { force })).value;
    if (file.season === season) matchups = file;
  } catch {
    /* no matchup context shown */
  }

  if (!games.some((g) => g.week === week)) {
    games = approximateGames(projRows, week);
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
    ...(usage ? { usage } : {}),
    ...(matchups ? { matchups } : {}),
    ...(baseline ? { baseline } : {}),
    ...(projectionSource ? { projectionSource } : {}),
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

/** Projection row trimmed for the rest-of-season cache: no player object, no zero or ranking stats. */
export interface CompactProjection {
  id: string;
  s: StatLine;
  t?: string;
  o?: string;
}

const RANKING_KEY = /^(adp_|pos_adp_|rank_|pos_rank_)/;

export function compactProjections(rows: readonly RawProjection[]): CompactProjection[] {
  const out: CompactProjection[] = [];
  for (const r of rows) {
    const stats = r.stats ?? {};
    // Offense, K and DEF rows carry pts_*; skip deep reserves projected for (almost) nothing. IDP rows lack pts_*.
    const pts = stats.pts_ppr ?? stats.pts_half_ppr ?? stats.pts_std;
    if (pts !== undefined && pts < 0.2) continue;
    const s: StatLine = {};
    let any = false;
    for (const k in stats) {
      const v = stats[k];
      if (typeof v !== 'number' || v === 0 || RANKING_KEY.test(k)) continue;
      s[k] = v;
      any = true;
    }
    if (any) out.push({ id: r.player_id, s, ...(r.team ? { t: r.team } : {}), ...(r.opponent ? { o: r.opponent } : {}) });
  }
  return out;
}

export function indexCompact(rows: readonly CompactProjection[], week: number): ProjectionIndex {
  const byPlayer: ProjectionIndex['byPlayer'] = new Map();
  const statKeys = new Set<string>();
  for (const r of rows) {
    for (const k in r.s) statKeys.add(k);
    byPlayer.set(r.id, { playerId: r.id, week, stats: r.s, ...(r.t ? { team: r.t } : {}), ...(r.o ? { opponent: r.o } : {}) });
  }
  return { byPlayer, players: new Map(), statKeys };
}

export interface RosWeeks {
  byWeek: Map<number, ProjectionIndex>;
  /** Weeks that couldn't be loaded (valued as zero). */
  missing: number[];
}

/** Future weeks' projections for rest-of-season values. Future projections move slowly: refresh twice a day. */
export async function loadRosWeeks(season: string, weeks: readonly number[], positions: readonly string[], force = false): Promise<RosWeeks> {
  const results = await Promise.allSettled(
    weeks.map((w) =>
      cached(`ros:${season}:${w}:${positions.join('.')}`, 12 * HOUR, async () => compactProjections(await sleeperApi.projections(season, w, positions)), { force }),
    ),
  );
  const byWeek = new Map<number, ProjectionIndex>();
  const missing: number[] = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') byWeek.set(weeks[i]!, indexCompact(r.value.value, weeks[i]!));
    else missing.push(weeks[i]!);
  });
  return { byWeek, missing };
}

/** One week's matchups (e.g. last week's final scores in a two-week playoff round). */
export async function loadMatchups(leagueId: string, week: number, force = false): Promise<Matchup[]> {
  return (await cached(`matchups:${leagueId}:${week}`, 10 * MIN, () => sleeperApi.matchups(leagueId, week), { force })).value.map(parseMatchup);
}

/** Matchup pairings for future weeks (Sleeper generates the whole regular-season schedule up front). */
export async function loadSchedule(leagueId: string, weeks: readonly number[], force = false): Promise<Map<number, Matchup[]>> {
  const results = await Promise.allSettled(weeks.map((w) => cached(`matchups:${leagueId}:${w}`, 6 * HOUR, () => sleeperApi.matchups(leagueId, w), { force })));
  const out = new Map<number, Matchup[]>();
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') out.set(weeks[i]!, r.value.value.map(parseMatchup));
  });
  return out;
}

/** This season's waiver claims (won and lost, with bids) for FAAB pricing. */
export async function loadWaiverClaims(leagueId: string, throughWeek: number, force = false): Promise<RawTransaction[]> {
  const weeks = Array.from({ length: Math.max(0, throughWeek) }, (_, i) => i + 1);
  const results = await Promise.allSettled(
    weeks.map((w) =>
      cached(
        `waivers:${leagueId}:${w}`,
        w < throughWeek ? 24 * HOUR : HOUR,
        async () =>
          (await sleeperApi.transactions(leagueId, w))
            .filter((t) => t.type === 'waiver')
            .map((t): RawTransaction => ({
              type: t.type,
              status: t.status,
              leg: t.leg,
              adds: t.adds ?? null,
              ...(t.settings?.waiver_bid !== undefined ? { settings: { waiver_bid: t.settings.waiver_bid } } : {}),
              ...(t.metadata?.notes ? { metadata: { notes: t.metadata.notes } } : {}),
            })),
        { force },
      ),
    ),
  );
  return results.flatMap((r) => (r.status === 'fulfilled' ? r.value.value : []));
}

/** The winners' bracket: playoff games and their results (filled in as each round is decided). */
export async function loadBracket(leagueId: string, force = false): Promise<BracketMatch[]> {
  return parseBracket((await cached(`bracket:${leagueId}`, 10 * MIN, () => sleeperApi.winnersBracket(leagueId), { force })).value);
}

/** Final points by roster for weeks already played (e.g. earlier weeks of the playoffs). */
export async function loadPlayedPoints(leagueId: string, weeks: readonly number[], force = false): Promise<Map<number, Map<number, number>>> {
  const results = await Promise.allSettled(weeks.map((w) => loadMatchups(leagueId, w, force)));
  const out = new Map<number, Map<number, number>>();
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') out.set(weeks[i]!, new Map(r.value.map((m) => [m.rosterId, m.points])));
  });
  return out;
}

/** Future draft picks that changed hands (Sleeper lists no others). */
export async function loadTradedPicks(leagueId: string, force = false): Promise<RawTradedPick[]> {
  return (await cached(`picks:${leagueId}`, HOUR, () => sleeperApi.tradedPicks(leagueId), { force })).value;
}

export async function loadTrending(): Promise<Map<string, number>> {
  try {
    const res = await cached('trending:add', HOUR, () => sleeperApi.trending('add', 24, 200));
    return new Map(res.value.map((t) => [t.player_id, t.count]));
  } catch {
    return new Map();
  }
}

export async function loadAccuracy(): Promise<AccuracyFile | null> {
  try {
    return (await cached('data:accuracy', 6 * HOUR, () => fetchDataFile<AccuracyFile>('accuracy.json'))).value;
  } catch {
    return null;
  }
}

/** The app's pre-kickoff predictions, scored each finished week (null before the first is scored). */
export async function loadLedger(): Promise<LedgerFile | null> {
  try {
    return (await cached('data:ledger', 6 * HOUR, () => fetchDataFile<LedgerFile>('ledger.json'))).value;
  } catch {
    return null;
  }
}

export async function loadManifest(): Promise<Manifest | null> {
  try {
    return await fetchDataFile<Manifest>('manifest.json');
  } catch {
    return null;
  }
}
