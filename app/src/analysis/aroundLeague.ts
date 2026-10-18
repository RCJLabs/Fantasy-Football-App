// Around the league (the Matchup tab, docs/gameday.md): every matchup this week as it stands, each side modelled like
// your opponent (lineups as set, assumed fill-ins for starters who can't play), and the distributions the playoff odds
// swap in for this week: as the games stand, or before any of them started.
import type { League, LeagueUser, Matchup, Roster } from '../domain/types';
import { crossCovariance } from '../engine/correlation';
import { winProbability, type Dist } from '../engine/winprob';
import { corrItem, teamSide, type PlayerRow, type WeekContext } from './analyze';

export interface TeamNow {
  rosterId: number;
  name: string;
  /** Sleeper's points so far. */
  points: number;
  /** Score distribution: points so far plus what's left of the lineup. */
  dist: Dist;
}

export interface PairNow {
  a: TeamNow;
  /** Absent: no opponent this week. */
  b?: TeamNow;
  /** a's chance to win. */
  winA?: number;
}

const isRow = (r: PlayerRow | null): r is PlayerRow => r !== null;

/** This week's matchups as they stand, the one with `firstRosterId` first, then in Sleeper's order. */
export function leagueMatchups(league: League, rosters: readonly Roster[], users: readonly LeagueUser[], matchups: readonly Matchup[], ctx: WeekContext, firstRosterId?: number): PairNow[] {
  const sides = new Map(rosters.map((r) => [r.rosterId, teamSide(league, r, users, matchups, ctx)]));
  const items = (id: number) => (sides.get(id)?.rows ?? []).filter(isRow).map((r) => corrItem(r, ctx.now));
  const now = (id: number): TeamNow | undefined => {
    const s = sides.get(id);
    return s ? { rosterId: id, name: s.name, points: s.points, dist: s.dist } : undefined;
  };
  const pairs: PairNow[] = [];
  const seen = new Set<number>();
  for (const m of matchups) {
    if (seen.has(m.rosterId)) continue;
    const a = now(m.rosterId);
    if (!a) continue;
    seen.add(m.rosterId);
    const other = m.matchupId == null ? undefined : matchups.find((x) => x.matchupId === m.matchupId && x.rosterId !== m.rosterId);
    const b = other ? now(other.rosterId) : undefined;
    if (!b) {
      pairs.push({ a });
      continue;
    }
    seen.add(b.rosterId);
    pairs.push({ a, b, winA: winProbability(a.dist, b.dist, crossCovariance(items(a.rosterId), items(b.rosterId))) });
  }
  // Yours first, on your side.
  const mine = pairs.findIndex((p) => p.a.rosterId === firstRosterId || p.b?.rosterId === firstRosterId);
  if (mine > 0) pairs.unshift(...pairs.splice(mine, 1));
  const p0 = pairs[0];
  if (p0?.b && p0.b.rosterId === firstRosterId) pairs[0] = { a: p0.b, b: p0.a, ...(p0.winA !== undefined ? { winA: 1 - p0.winA } : {}) };
  return pairs;
}

/** Each team's score distribution as it was before this week's first kickoff: nothing locked, no points. */
export function weekStartDists(league: League, rosters: readonly Roster[], users: readonly LeagueUser[], matchups: readonly Matchup[], ctx: WeekContext): Map<number, Dist> {
  const kickoffs = [...ctx.gamesByTeam.values()].map((g) => Date.parse(g.kickoff)).filter(Number.isFinite);
  const { clock: _clock, ...rest } = ctx;
  const before: WeekContext = { ...rest, now: kickoffs.length ? Math.min(...kickoffs) - 1 : ctx.now };
  return new Map(rosters.map((r) => [r.rosterId, teamSide(league, r, users, matchups, before).dist]));
}

/** The distributions of `pairs`, by roster id, for the odds as the games stand. */
export function currentDists(pairs: readonly PairNow[]): Map<number, Dist> {
  return new Map(pairs.flatMap((p) => [[p.a.rosterId, p.a.dist] as const, ...(p.b ? [[p.b.rosterId, p.b.dist] as const] : [])]));
}
