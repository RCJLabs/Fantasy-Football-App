// Recent usage per player from nflverse (CC-BY 4.0): offensive snap share (snap counts, compiled by
// Pro Football Reference) plus targets and carries with their share of the team's (weekly player
// stats). With ffopportunity's expected stats, also points and touchdowns against what the usage was worth
// (docs/luck.md). The app shows it as context only; it doesn't change projections.
import { DATA_SCHEMA_VERSION, type PlayerUsage, type UsageFile } from '../app/src/data/contracts';
import type { StatLine } from '../app/src/domain/types';
import { scoreStats } from '../app/src/engine/scoring';
import { SLEEPER_PPR } from './lib';
import { nflverseStatLine } from './nflverse-stats';

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
  /** ffopportunity expected stats this season, keyed `${gsis}|${week}` (Sleeper stat keys). */
  expected?: ReadonlyMap<string, StatLine>;
  weeks?: number;
}

/** Fewest games behind a luck figure, as in the backtest (docs/luck.md). */
const LUCK_GAMES = 3;
const tds = (s: Readonly<StatLine>) => (s.pass_td ?? 0) + (s.rush_td ?? 0) + (s.rec_td ?? 0);
const round1 = (x: number) => Math.round(x * 10) / 10;

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
  const luck = new Map<string, { g: number; pts: number; xpts: number; td: number; xtd: number }>();
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
    // Only games ffopportunity has processed: both sides of the comparison cover the same games.
    const exp = input.expected?.get(`${r.player_id}|${Number(r.week)}`);
    if (!exp) continue;
    const line = nflverseStatLine(r, r.position ?? '');
    const l = luck.get(id) ?? { g: 0, pts: 0, xpts: 0, td: 0, xtd: 0 };
    l.g++;
    l.pts += scoreStats(line, SLEEPER_PPR);
    l.xpts += scoreStats(exp, SLEEPER_PPR);
    l.td += tds(line);
    l.xtd += tds(exp);
    luck.set(id, l);
  }
  for (const [id, l] of luck) {
    if (l.g >= LUCK_GAMES) usage(id).luck = { g: l.g, pts: [round1(l.pts / l.g), round1(l.xpts / l.g)], td: [round1(l.td), round1(l.xtd)] };
  }

  return { schemaVersion: DATA_SCHEMA_VERSION, generatedAt: input.now, season: input.season, weeks, players: Object.fromEntries(players) };
}

/** Sleeper id by gsis id (the pipeline's map runs the other way). */
export function invert(gsisBySleeper: ReadonlyMap<string, string>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [sleeper, gsis] of gsisBySleeper) if (!out.has(gsis)) out.set(gsis, sleeper);
  return out;
}
