// Recent usage per player from nflverse (CC-BY 4.0): offensive snap share (snap counts, compiled by
// Pro Football Reference) plus targets and carries with their share of the team's (weekly player
// stats). The app shows it as context only; it doesn't change projections.
import { DATA_SCHEMA_VERSION, type PlayerUsage, type UsageFile } from '../app/src/data/contracts';

const POSITIONS = new Set(['QB', 'RB', 'FB', 'WR', 'TE']);
/** Weeks of history kept. [design] */
export const USAGE_WEEKS = 4;

export interface UsageInput {
  season: string;
  now: string;
  /** nflverse snap_counts_<season>.csv rows (keyed by pfr_player_id). */
  snaps: ReadonlyArray<Record<string, string>>;
  /** nflverse stats_player_week_<season>.csv rows (keyed by gsis player_id). */
  stats: ReadonlyArray<Record<string, string>>;
  /** nflverse weekly rosters: pfr_id → gsis_id. */
  rosters: ReadonlyArray<Record<string, string>>;
  /** gsis id → Sleeper id. */
  sleeperByGsis: ReadonlyMap<string, string>;
  weeks?: number;
}

const value = (s: string | undefined): number | undefined => {
  if (s === undefined || s.trim() === '' || s === 'NA') return undefined;
  const x = Number(s);
  return Number.isFinite(x) ? x : undefined;
};
const percent = (fraction: number) => Math.round(fraction * 100);
const regular = (r: Record<string, string>) => (r.game_type || r.season_type || 'REG') === 'REG';

export function buildUsage(input: UsageInput): UsageFile | null {
  const span = input.weeks ?? USAGE_WEEKS;
  const snaps = input.snaps.filter((r) => regular(r) && POSITIONS.has(r.position ?? ''));
  const stats = input.stats.filter(regular);
  const played = [...snaps, ...stats].map((r) => Number(r.week)).filter((w) => Number.isInteger(w) && w > 0);
  if (!played.length) return null;
  const last = Math.max(...played);
  const weeks = Array.from({ length: Math.min(span, last) }, (_, i) => last - Math.min(span, last) + 1 + i);
  const slot = new Map(weeks.map((w, i) => [w, i]));

  const gsisByPfr = new Map<string, string>();
  for (const r of input.rosters) if (r.pfr_id && r.gsis_id) gsisByPfr.set(r.pfr_id, r.gsis_id);
  const players = new Map<string, PlayerUsage>();
  const usage = (id: string) => {
    let u = players.get(id);
    if (!u) {
      const blank = () => weeks.map((): number | null => null);
      u = { snap: blank(), tgt: blank(), car: blank(), tshare: blank(), cshare: blank() };
      players.set(id, u);
    }
    return u;
  };

  for (const r of snaps) {
    const i = slot.get(Number(r.week));
    const gsis = gsisByPfr.get(r.pfr_player_id ?? '');
    const id = gsis ? input.sleeperByGsis.get(gsis) : undefined;
    const pct = value(r.offense_pct);
    if (i === undefined || !id || pct === undefined) continue;
    usage(id).snap[i] = percent(pct);
  }

  // Every player's carries count toward the team's total (QB scrambles included).
  const teamCarries = new Map<string, number>();
  for (const r of stats) teamCarries.set(`${r.week}:${r.team}`, (teamCarries.get(`${r.week}:${r.team}`) ?? 0) + (value(r.carries) ?? 0));
  for (const r of stats) {
    const i = slot.get(Number(r.week));
    const id = input.sleeperByGsis.get(r.player_id ?? '');
    if (i === undefined || !id || !POSITIONS.has(r.position ?? '')) continue;
    const u = usage(id);
    const carries = value(r.carries) ?? 0;
    const team = teamCarries.get(`${r.week}:${r.team}`) ?? 0;
    u.tgt[i] = value(r.targets) ?? 0;
    u.car[i] = carries;
    u.tshare[i] = percent(value(r.target_share) ?? 0);
    u.cshare[i] = team > 0 ? percent(carries / team) : 0;
  }

  return { schemaVersion: DATA_SCHEMA_VERSION, generatedAt: input.now, season: input.season, weeks, players: Object.fromEntries(players) };
}

/** Sleeper id by gsis id (the pipeline's map runs the other way). */
export function invert(gsisBySleeper: ReadonlyMap<string, string>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [sleeper, gsis] of gsisBySleeper) if (!out.has(gsis)) out.set(gsis, sleeper);
  return out;
}
