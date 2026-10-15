import type { League, Roster } from '../domain/types';
import type { MarketValue } from '../data/fantasycalc';

/** Fallback keeper count when a keeper league doesn't say. [design] */
const DEFAULT_KEEPERS = 3;

export interface CorePlayer {
  id: string;
  value: number;
  age?: number;
}

export interface TeamLongTerm {
  rosterId: number;
  /** Long-term value of what the team carries forward: players, plus draft picks when given. */
  total: number;
  /** Value of the draft picks it owns (dynasty). */
  picks: number;
  core: CorePlayer[];
  rank: number;
}

/**
 * How many players a team carries into next season: its keepers in keeper leagues, everyone in
 * dynasty leagues (undefined), none in redraft.
 */
export function carriedForward(league: League): number | undefined {
  if (league.rules.type === 'dynasty') return undefined;
  if (league.rules.type === 'keeper') return league.rules.maxKeepers || DEFAULT_KEEPERS;
  return 0;
}

/** A roster's most valuable players long-term (IR and taxi included), best first, `keep` of them if set. */
export function longTermCore(roster: Roster, values: ReadonlyMap<string, MarketValue>, keep?: number): CorePlayer[] {
  const ids = [...new Set([...roster.players, ...roster.reserve, ...roster.taxi])];
  const ranked = ids
    .map((id): CorePlayer => {
      const v = values.get(id);
      const p: CorePlayer = { id, value: v?.value ?? 0 };
      if (v?.age !== undefined) p.age = v.age;
      return p;
    })
    .filter((p) => p.value > 0)
    .sort((a, b) => b.value - a.value);
  return keep === undefined ? ranked : ranked.slice(0, keep);
}

/** Teams ranked by the long-term value of what they carry forward (`picks`: pick value by roster id). */
export function longTermRanking(
  rosters: readonly Roster[],
  values: ReadonlyMap<string, MarketValue>,
  keep?: number,
  picks?: ReadonlyMap<number, number>,
): TeamLongTerm[] {
  return rosters
    .map((r) => {
      const core = longTermCore(r, values, keep);
      const pickValue = picks?.get(r.rosterId) ?? 0;
      return { rosterId: r.rosterId, total: core.reduce((a, p) => a + p.value, 0) + pickValue, picks: pickValue, core, rank: 0 };
    })
    .sort((a, b) => b.total - a.total)
    .map((t, i) => ({ ...t, rank: i + 1 }));
}
