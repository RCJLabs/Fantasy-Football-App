import type { RawLeague, RawMatchup, RawPlayer, RawProjection, RawRoster, RawState, RawTradedPick, RawTransaction, RawTrending, RawUser } from './raw';

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

/** GET JSON with a timeout, retrying 429/5xx/network errors with backoff. 404 is not retried. */
export async function getJson<T>(url: string, opts: { timeoutMs?: number; retries?: number } = {}): Promise<T> {
  const { timeoutMs = 20_000, retries = 2 } = opts;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
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

export const sleeperApi = {
  state: () => getJson<RawState>(`${API}/state/nfl`),
  /** Sleeper returns `null` for unknown usernames. */
  user: (usernameOrId: string) => getJson<RawUser | null>(`${API}/user/${encodeURIComponent(usernameOrId.trim())}`),
  leagues: (userId: string, season: string) => getJson<RawLeague[]>(`${API}/user/${userId}/leagues/nfl/${season}`),
  league: (leagueId: string) => getJson<RawLeague>(`${API}/league/${leagueId}`),
  rosters: (leagueId: string) => getJson<RawRoster[]>(`${API}/league/${leagueId}/rosters`),
  users: (leagueId: string) => getJson<RawUser[]>(`${API}/league/${leagueId}/users`),
  matchups: (leagueId: string, week: number) => getJson<RawMatchup[]>(`${API}/league/${leagueId}/matchups/${week}`),
  transactions: (leagueId: string, week: number) => getJson<RawTransaction[]>(`${API}/league/${leagueId}/transactions/${week}`),
  tradedPicks: (leagueId: string) => getJson<RawTradedPick[]>(`${API}/league/${leagueId}/traded_picks`),
  trending: (type: 'add' | 'drop', hours = 24, limit = 100) =>
    getJson<RawTrending[]>(`${API}/players/nfl/trending/${type}?lookback_hours=${hours}&limit=${limit}`),
  /** Undocumented endpoint used by Sleeper's own app (RotoWire projections). */
  projections: (season: string, week: number, positions: readonly string[] = ALL_POSITIONS) =>
    getJson<RawProjection[]>(
      `${WEB}/projections/nfl/${season}/${week}?season_type=regular&${positions.map((p) => `position[]=${p}`).join('&')}`,
      { timeoutMs: 45_000 },
    ),
  /** Full player dump (~15 MB raw). Sleeper asks for at most one call per day; fallback only. */
  players: () => getJson<Record<string, RawPlayer>>(`${API}/players/nfl`, { timeoutMs: 90_000 }),
};

export type SleeperApi = typeof sleeperApi;
