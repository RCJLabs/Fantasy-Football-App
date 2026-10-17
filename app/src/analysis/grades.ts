import type { League, Matchup, Roster } from '../domain/types';
import { bestAssignment } from '../engine/assignment';
import { canFill, optimizeLineup } from '../engine/lineup';
import { lineupProblem, type WeekContext } from './analyze';
import type { LeagueOutlook } from './outlook';
import { seasonEnd, teamIds } from './ros';

export type Grade = 'S' | 'A' | 'B' | 'C' | 'D' | 'F';

/** What each team is graded on. */
export type Part = 'week' | 'ros' | 'depth' | 'odds';

/**
 * Weights of the parts in the overall grade [design]. Strength over the rest of the season counts most; the odds
 * bring in the record and schedule; this week and the bench count less. Starters, weekly projections and
 * rest-of-season rankings all come from the same projections, so they aren't added up separately.
 */
export const GRADE_WEIGHTS: Readonly<Record<Part, number>> = { ros: 0.45, odds: 0.25, week: 0.15, depth: 0.15 };

/**
 * Grade from a z-score within the league [design]: S stands clearly above the rest (1.5 SD), A to F are half-SD
 * bands around the league average (A from +0.75, B from +0.25, C within ±0.25, D down to −0.75, F below).
 */
export function gradeOf(z: number): Grade {
  return z >= 1.5 ? 'S' : z >= 0.75 ? 'A' : z >= 0.25 ? 'B' : z > -0.25 ? 'C' : z > -0.75 ? 'D' : 'F';
}

/** The SD that z-scores within the league divide by: the league's own, or the floor when that's larger. */
export function zScale(values: readonly number[], minSd: number): number {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
  return Math.max(sd, minSd);
}

/** z-scores within the league. The SD has a floor, so teams that are nearly level stay near average instead of spreading over every grade. */
export function zScores(values: readonly number[], minSd: number): number[] {
  if (!values.length) return [];
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const scale = zScale(values, minSd);
  return values.map((v) => (scale > 0 ? (v - mean) / scale : 0));
}

/** Each value graded against the others: its z-score (zScores), grade and rank (1 = highest). */
export function gradeValues(values: readonly number[], minSd: number): PartGrade[] {
  const zs = zScores(values, minSd);
  const order = values.map((_, i) => i).sort((a, b) => values[b]! - values[a]!);
  const rank = new Map(order.map((i, r) => [i, r + 1]));
  return values.map((v, i) => ({ value: v, z: zs[i]!, grade: gradeOf(zs[i]!), rank: rank.get(i)! }));
}

export interface PartGrade {
  value: number;
  z: number;
  grade: Grade;
  /** 1 = best in the league. */
  rank: number;
}

export interface TeamGrade {
  rosterId: number;
  grade: Grade;
  /** The weighted blend of the parts, as a z-score within the league. */
  z: number;
  rank: number;
  parts: Partial<Record<Part, PartGrade>>;
}

export interface LeagueGrades {
  /** Best first. */
  teams: TeamGrade[];
  /** The parts graded: one is left out when it doesn't apply (no weeks left, no odds). */
  parts: Part[];
  /** What the odds part is: playoff odds in the regular season, title odds once the playoffs start, 1st place without playoffs. */
  odds?: 'playoffs' | 'title' | 'first';
}

/** This week's best lineup: expected points, with points already scored for games under way. */
export function bestThisWeek(league: League, roster: Roster, matchups: readonly Matchup[], ctx: WeekContext): number {
  return optimizeLineup(lineupProblem(league, roster, matchups, ctx).problem).expected;
}

/**
 * Points per week the bench adds over the rest of the season: best lineups from the whole roster, less those from
 * the team's core (the starting lineup of its most valuable players over the season). Byes and injury chances are
 * where the bench earns them.
 */
export function benchDepth(o: LeagueOutlook, roster: Roster): number {
  const { model } = o;
  const ids = teamIds(roster);
  if (!o.weeks.length || !ids.length) return 0;
  const { assignment } = bestAssignment(model.slots.length, ids.length, (s, k) => (canFill(model.slots[s]!, model.fpos(ids[k]!)) ? model.total(ids[k]!) : null));
  const core = assignment.filter((k) => k >= 0).map((k) => ids[k]!);
  let added = 0;
  for (let i = 0; i < o.weeks.length; i++) added += model.bestWeek(ids, i).mean - model.bestWeek(core, i).mean;
  return added / o.weeks.length;
}

/** Floors on each part's SD (see zScores) [design]: 3% of the league average for points, 1 point a week for depth, 5 points of odds. */
const MIN_SD: Record<Part, (mean: number) => number> = { week: (m) => 0.03 * m, ros: (m) => 0.03 * m, depth: () => 1, odds: () => 0.05 };

/**
 * Grades every team in the league, S to F, against the others: on this week's best lineup, its best lineups per
 * week over the rest of the season, what its bench adds, and its playoff (or title) odds; then overall, from
 * those weighted by GRADE_WEIGHTS. Needs at least three teams with players.
 */
export function leagueGrades(o: LeagueOutlook, matchups: readonly Matchup[], ctx: WeekContext): LeagueGrades | undefined {
  const teams = [...o.teams.values()];
  if (teams.length < 3 || teams.every((t) => !t.roster.players.length)) return undefined;
  const values = new Map<Part, number[]>();
  if (ctx.week <= seasonEnd(o.league)) values.set('week', teams.map((t) => bestThisWeek(o.league, t.roster, matchups, ctx)));
  if (o.weeks.length) {
    values.set('ros', teams.map((t) => t.future.reduce((s, d) => s + d.mean, 0) / o.weeks.length));
    values.set('depth', teams.map((t) => benchDepth(o, t.roster)));
  }
  let odds: LeagueGrades['odds'];
  if (o.bracket) {
    odds = 'title';
    values.set('odds', teams.map((t) => o.bracket!.odds.get(t.rosterId)?.pTitle ?? 0));
  } else if (o.odds) {
    odds = o.league.rules.playoffWeekStart ? 'playoffs' : 'first';
    values.set('odds', teams.map((t) => (odds === 'playoffs' ? o.odds!.get(t.rosterId)?.pPlayoffs : o.odds!.get(t.rosterId)?.pFirst) ?? 0));
  }
  if (!values.size) return undefined;

  const parts = [...values.keys()];
  const graded = new Map<Part, PartGrade[]>();
  for (const [part, vs] of values) {
    const mean = vs.reduce((a, b) => a + b, 0) / vs.length;
    graded.set(part, gradeValues(vs, MIN_SD[part](Math.abs(mean))));
  }
  const weight = parts.reduce((s, p) => s + GRADE_WEIGHTS[p], 0);
  const blend = teams.map((_, i) => parts.reduce((s, p) => s + GRADE_WEIGHTS[p] * graded.get(p)![i]!.z, 0) / weight);
  // Re-scaled so the overall grade uses the same bands; the floor keeps a league of near-equals near C.
  const overall = zScores(blend, 0.5);
  const out: TeamGrade[] = teams.map((t, i) => ({
    rosterId: t.rosterId,
    grade: gradeOf(overall[i]!),
    z: overall[i]!,
    rank: 0,
    parts: Object.fromEntries(parts.map((p) => [p, graded.get(p)![i]!])),
  }));
  out.sort((a, b) => b.z - a.z);
  out.forEach((t, i) => (t.rank = i + 1));
  return { teams: out, parts, ...(odds ? { odds } : {}) };
}
