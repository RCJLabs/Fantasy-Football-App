import type { RawBracketMatch, RawDraft, RawDraftPick, RawLeague, RawMatchup, RawPlayer, RawProjection, RawRoster, RawState, RawTradedPick, RawTransaction, RawTrending, RawUser } from './raw';

const API = 'https://api.sleeper.app/v1';
const WEB = 'https://api.sleeper.com';
export const ALL_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB'];

export class SleeperError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'SleeperError';
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * GET JSON with a timeout, retrying 429/5xx/network errors with backoff. 404 is not retried. `cache` is the fetch cache
 * mode: `no-cache` asks the server every time instead of taking the browser's copy.
 */
export async function getJson<T>(url: string, opts: { timeoutMs?: number; retries?: number; cache?: RequestCache } = {}): Promise<T> {
  const { timeoutMs = 20_000, retries = 2, cache } = opts;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, cache ? { signal: ctrl.signal, cache } : { signal: ctrl.signal });
      if (res.ok) return (await res.json()) as T;
      if (res.status === 404) throw new SleeperError(`Not found: ${url}`, 404);
      lastError = new SleeperError(`HTTP ${res.status} from ${url}`, res.status);
      if (res.status !== 429 && res.status < 500) throw lastError;
    } catch (e) {
      if (e instanceof SleeperError && e.status !== undefined && e.status !== 429 && e.status < 500) throw e;
      lastError = e;
    } finally {
      clearTimeout(timer);
    }
    if (attempt < retries) await sleep(800 * 2 ** attempt);
  }
  throw lastError instanceof Error ? lastError : new SleeperError(`Request failed: ${url}`);
}

/**
 * For what the app checks again and again (live scores, lineups, stat lines, a draft under way): the browser asks Sleeper
 * every time. On game day Sleeper's stats come with `s-maxage=4, stale-while-revalidate=600` and no `max-age` (spike
 * 2026-10-18), and Chromium then answers each request with the copy from the request before, refreshing it behind the scenes.
 */
const EVERY_TIME = { cache: 'no-cache' } as const;

export const sleeperApi = {
  state: () => getJson<RawState>(`${API}/state/nfl`),
  /** Sleeper returns `null` for unknown usernames. */
  user: (usernameOrId: string) => getJson<RawUser | null>(`${API}/user/${encodeURIComponent(usernameOrId.trim())}`),
  leagues: (userId: string, season: string) => getJson<RawLeague[]>(`${API}/user/${userId}/leagues/nfl/${season}`),
  league: (leagueId: string) => getJson<RawLeague>(`${API}/league/${leagueId}`),
  rosters: (leagueId: string) => getJson<RawRoster[]>(`${API}/league/${leagueId}/rosters`, EVERY_TIME),
  users: (leagueId: string) => getJson<RawUser[]>(`${API}/league/${leagueId}/users`),
  matchups: (leagueId: string, week: number) => getJson<RawMatchup[]>(`${API}/league/${leagueId}/matchups/${week}`, EVERY_TIME),
  transactions: (leagueId: string, week: number) => getJson<RawTransaction[]>(`${API}/league/${leagueId}/transactions/${week}`),
  tradedPicks: (leagueId: string) => getJson<RawTradedPick[]>(`${API}/league/${leagueId}/traded_picks`),
  winnersBracket: (leagueId: string) => getJson<RawBracketMatch[] | null>(`${API}/league/${leagueId}/winners_bracket`),
  drafts: (leagueId: string) => getJson<RawDraft[] | null>(`${API}/league/${leagueId}/drafts`),
  draft: (draftId: string) => getJson<RawDraft>(`${API}/draft/${draftId}`, EVERY_TIME),
  draftPicks: (draftId: string) => getJson<RawDraftPick[] | null>(`${API}/draft/${draftId}/picks`, EVERY_TIME),
  /** Picks traded during (or for) a draft, shaped like the league's traded picks [unverified: Sleeper's docs]. */
  draftTradedPicks: (draftId: string) => getJson<RawTradedPick[] | null>(`${API}/draft/${draftId}/traded_picks`),
  trending: (type: 'add' | 'drop', hours = 24, limit = 100) =>
    getJson<RawTrending[]>(`${API}/players/nfl/trending/${type}?lookback_hours=${hours}&limit=${limit}`),
  /** Undocumented endpoint used by Sleeper's own app (RotoWire projections). */
  projections: (season: string, week: number, positions: readonly string[] = ALL_POSITIONS) =>
    getJson<RawProjection[]>(
      `${WEB}/projections/nfl/${season}/${week}?season_type=regular&${positions.map((p) => `position[]=${p}`).join('&')}`,
      { timeoutMs: 45_000 },
    ),
  /**
   * Undocumented: the week's stats so far, rows shaped like projections (docs/spikes.md (g)). During games its copy changes
   * about once a minute; a CDN edge can still answer with one a few minutes old (docs/gameday.md).
   */
  stats: (season: string, week: number, positions: readonly string[] = ALL_POSITIONS) =>
    getJson<RawProjection[]>(`${WEB}/stats/nfl/${season}/${week}?season_type=regular&${positions.map((p) => `position[]=${p}`).join('&')}`, {
      timeoutMs: 45_000,
      ...EVERY_TIME,
    }),
  /** Full player dump (~15 MB raw). Sleeper asks for at most one call per day; fallback only. */
  players: () => getJson<Record<string, RawPlayer>>(`${API}/players/nfl`, { timeoutMs: 90_000 }),
};

export type SleeperApi = typeof sleeperApi;
