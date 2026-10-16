import type { PlayerUsage } from '../data/contracts';
import { regularStarters, type LeagueOutlook } from './outlook';
import { teamIds } from './ros';

/**
 * PPR points a game between a player's recent scoring and what his usage was worth before he counts as running hot or
 * cold: a little over one SD of that gap over 3–4 games (2.7 on 2022–23; docs/luck.md). [design]
 */
export const STREAK_GAP = 3;

/** Rest-of-season expected points a week before a streak is worth trading on: the backtest's 5+ projected. [design] */
const MIN_WEEKLY = 5;

/** A player's recent points against what his usage was worth (pipeline usage.json, from ffopportunity). Display only. */
export interface Streak {
  games: number;
  /** PPR points a game: scored, and what his usage was worth. */
  pts: number;
  expected: number;
  /** Touchdowns over those games: scored, and expected. */
  td: number;
  expectedTd: number;
}

/** His streak, when the gap is big enough to mention. */
export function streak(usage: PlayerUsage | undefined): Streak | undefined {
  const l = usage?.luck;
  if (!l || Math.abs(l.pts[0] - l.pts[1]) < STREAK_GAP) return undefined;
  return { games: l.g, pts: l.pts[0], expected: l.pts[1], td: l.td[0], expectedTd: l.td[1] };
}

export interface StreakPick {
  id: string;
  /** Who has him. */
  rosterId: number;
  streak: Streak;
  /** Rest-of-season expected points a week on his own, as in the trade builder. */
  perWeek: number;
}

/**
 * Sell high: your players running hot, the biggest gap first. Buy low: other teams' players running cold who'd be regular
 * starters for you, the most valuable first. Projections already price streaks in (in 2022–25 a streak didn't predict
 * how players did against them afterwards; docs/luck.md), so no value changes: the chance is a manager who goes by
 * recent points.
 */
export function buyLowSellHigh(o: LeagueOutlook, rosterId: number, usage: ReadonlyMap<string, PlayerUsage>, limit = 4): { sell: StreakPick[]; buy: StreakPick[] } {
  const me = o.teams.get(rosterId);
  if (!me) return { sell: [], buy: [] };
  const perWeek = (id: string) => (o.weeks.length ? o.model.total(id) / o.weeks.length : 0);
  const sell: StreakPick[] = [];
  const buy: StreakPick[] = [];
  for (const t of o.teams.values()) {
    for (const id of teamIds(t.roster)) {
      const s = streak(usage.get(id));
      const pick = s ? { id, rosterId: t.rosterId, streak: s, perWeek: perWeek(id) } : undefined;
      if (!pick || pick.perWeek < MIN_WEEKLY) continue;
      const hot = pick.streak.pts > pick.streak.expected;
      if (t.rosterId === rosterId ? hot : !hot) (hot ? sell : buy).push(pick);
    }
  }
  const gap = (p: StreakPick) => p.streak.pts - p.streak.expected;
  const mine = teamIds(me.roster);
  const startsForMe: StreakPick[] = [];
  for (const p of buy.sort((a, b) => b.perWeek - a.perWeek)) {
    if (startsForMe.length >= limit) break;
    if (regularStarters(o.model, [...mine, p.id]).has(p.id)) startsForMe.push(p);
  }
  return { sell: sell.sort((a, b) => gap(b) - gap(a)).slice(0, limit), buy: startsForMe };
}
