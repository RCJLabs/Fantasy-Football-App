import { rosteredIds, startable } from './analyze';
import { regularStarters, scheduleOutlook, type LeagueOutlook } from './outlook';
import { playoffWeekInfo, teamIds, type PlayoffWeek } from './ros';

/** Out now: the planner looks for the week Sleeper projects them again. */
const SIDELINED = new Set(['IR', 'PUP', 'NA', 'Sus', 'DNR', 'COV', 'Out', 'Doubtful']);

/** Smallest one-week gain worth naming as a pickup [design]. */
export const MIN_PICKUP = 1;

/** Free agents tried per position for a week's pickup: the best by that week's expected points. */
const PICKUP_POOL = 6;

export interface PlanWeek {
  week: number;
  opponent: number | null;
  winProb: number | null;
  /** Expected points of your best lineup. */
  mean: number;
  /** Where that ranks among the league's best lineups that week (1 = highest). */
  rank: number;
  teams: number;
  playoff: PlayoffWeek | null;
  /** Your regular starters (start in at least half the weeks they play) whose NFL team is off. */
  byes: string[];
  /** Regular starters Sleeper doesn't project that week, without a bye: injured, suspended or released. */
  unprojected: string[];
  /** Players out now whom Sleeper projects again from this week. */
  back: string[];
  /** Starting slots nobody with a projection can fill. */
  open: number;
  /** In a week with a hole: the free agent who adds most to that week's best lineup (before any drop). */
  pickup?: { id: string; gain: number };
}

/**
 * Week by week through the end of the season: the matchup and win chance, which regular starters are missing (bye or
 * no projection), who comes back, and in weeks with a hole, the best free agent to fill it.
 */
export function planWeeks(o: LeagueOutlook, rosterId: number): PlanWeek[] {
  const me = o.teams.get(rosterId);
  if (!me) return [];
  const { model, league } = o;
  const ids = teamIds(me.roster);
  const regulars = [...regularStarters(model, ids)];
  const reserve = new Set(me.roster.reserve);
  const sidelined = ids.filter((id) => reserve.has(id) || SIDELINED.has(model.player(id)?.injury ?? ''));
  const returns = new Map(sidelined.map((id) => [id, model.ev(id).findIndex((x) => x > 0)]));
  const rostered = rosteredIds([...o.teams.values()].map((t) => t.roster));
  const schedule = scheduleOutlook(o, rosterId);
  const teams = [...o.teams.values()];

  return o.weeks.map((week, i) => {
    // A week whose projections didn't load has no players to judge.
    const loaded = !!model.teamsPlaying(i)?.size;
    const lineup = model.lineupWeek(ids, i);
    const s = schedule[i]!;
    const row: PlanWeek = {
      week,
      opponent: s.opponent,
      winProb: s.winProb,
      mean: s.mean,
      rank: 1 + teams.filter((t) => t.rosterId !== rosterId && t.future[i]!.mean > s.mean).length,
      teams: teams.length,
      playoff: playoffWeekInfo(league, week),
      byes: loaded ? regulars.filter((id) => model.onBye(id, i)) : [],
      unprojected: loaded ? regulars.filter((id) => !model.onBye(id, i) && model.ev(id)[i] === 0) : [],
      back: sidelined.filter((id) => returns.get(id) === i),
      open: loaded ? lineup.open : 0,
    };
    if (row.byes.length || row.unprojected.length || row.open) {
      const pickup = bestPickup(o, ids, rostered, i, lineup.mean);
      if (pickup) row.pickup = pickup;
    }
    return row;
  });
}

/** The free agent whose addition raises week `i`'s best lineup most, if by at least MIN_PICKUP. */
function bestPickup(o: LeagueOutlook, ids: readonly string[], rostered: ReadonlySet<string>, i: number, base: number): { id: string; gain: number } | undefined {
  const { model, league } = o;
  const byPos = new Map<string, string[]>();
  for (const id of model.projected(i)) {
    if (rostered.has(id) || !(model.ev(id)[i]! > 0) || !startable(league, model.fpos(id))) continue;
    const pos = model.player(id)?.pos ?? model.fpos(id)[0] ?? '?';
    byPos.set(pos, [...(byPos.get(pos) ?? []), id]);
  }
  let best: { id: string; gain: number } | undefined;
  for (const group of byPos.values()) {
    for (const id of group.sort((a, b) => model.ev(b)[i]! - model.ev(a)[i]!).slice(0, PICKUP_POOL)) {
      const gain = model.lineupWeek([...ids, id], i).mean - base;
      if (gain >= MIN_PICKUP && (!best || gain > best.gain)) best = { id, gain };
    }
  }
  return best;
}
