import type { League, Matchup, Player, Roster } from '../domain/types';
import { bestAssignment } from '../engine/assignment';
import { canFill, startingSlots } from '../engine/lineup';
import { expectedStats, scoreStats } from '../engine/scoring';
import { pointSd } from '../engine/winprob';
import type { ProjectionIndex } from '../sleeper/parse';
import { teamIds } from './ros';

/** Wins, losses and ties. */
export interface Record3 {
  w: number;
  l: number;
  t: number;
}

export interface WeekReview {
  week: number;
  points: number;
  /** The head-to-head opponent and his points (null without a game that week). */
  opponent: number | null;
  oppPoints: number | null;
  result: 'W' | 'L' | 'T' | null;
  /** Best lineup in hindsight from the players on the roster that week (taxi squad aside). */
  best: number;
  /** Your score's place in the league that week (1 = most points). */
  rank: number;
  teams: number;
  /** Your score against every other team's that week. */
  allPlay: Record3;
  /** League-median game: above the median score or not. */
  median?: 'W' | 'L' | 'T';
  /** Points the app's lineup scored: its last pick saved on this device before the main Sunday kickoff. */
  app?: number;
}

export interface PlayerReview {
  id: string;
  /** Weeks he was projected to score and was on a roster in this league. */
  games: number;
  /** Per game, rescored to the league: Sleeper's projection if active, and his points. */
  projected: number;
  actual: number;
  /** The total gap in weekly SDs (the spreads the win chances use): beyond ±2, more than weekly swings explain. */
  z: number;
}

export interface SeasonReview {
  weeks: WeekReview[];
  /** Head-to-head games only (median games aside). */
  record: Record3;
  allPlay: Record3;
  median?: Record3;
  /** Head-to-head wins your scores would earn against an average schedule: each week's share of all-play wins. */
  expectedWins: number;
  /** Wins (ties half) above that: positive when the schedule has helped. */
  luck: number;
  points: number;
  best: number;
  /** Your points as a share of the best lineups in hindsight; the league average and your rank (1 = best) among teams with players. */
  efficiency: number;
  leagueEfficiency: number;
  efficiencyRank: number;
  efficiencyTeams: number;
  pointsAgainst: number;
  /** 1 = the most points scored against. */
  pointsAgainstRank: number;
  teams: number;
  /** Your current players against their projections, biggest gain first. */
  players: PlayerReview[];
}

export interface ReviewInput {
  league: League;
  rosters: readonly Roster[];
  rosterId: number;
  /** Final matchups of the weeks played: week → every team's. */
  played: ReadonlyMap<number, readonly Matchup[]>;
  players: ReadonlyMap<string, Player>;
  /** Sleeper's projections for those weeks (rows freeze around kickoff), for comparing players. */
  projections?: ReadonlyMap<number, ProjectionIndex>;
  /** The app's lineup picks saved on this device: week → starters. */
  advice?: ReadonlyMap<number, readonly string[]>;
}

/** Scores this close count as tied (Sleeper keeps two decimals). */
const TIE = 0.005;

const cmp = (a: number, b: number): 'W' | 'L' | 'T' => (a > b + TIE ? 'W' : a < b - TIE ? 'L' : 'T');

function add(r: Record3, res: 'W' | 'L' | 'T'): void {
  if (res === 'W') r.w++;
  else if (res === 'L') r.l++;
  else r.t++;
}

/** Most points any legal lineup from `ids` could have scored (slots may stay empty). */
export function bestPossible(slots: readonly string[], ids: readonly string[], points: Readonly<Record<string, number>>, fpos: (id: string) => readonly string[]): number {
  return bestAssignment(slots.length, ids.length, (s, k) => (canFill(slots[s]!, fpos(ids[k]!)) ? (points[ids[k]!] ?? 0) : null)).total;
}

function medianOf(values: readonly number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2;
}

/** 1 = highest. */
function rankOf(values: ReadonlyMap<number, number>, id: number): number {
  const mine = values.get(id) ?? 0;
  return 1 + [...values].filter(([k, v]) => k !== id && v > mine + TIE).length;
}

/**
 * The season so far for one team: each week's result, the best lineup it could have started, its score against every
 * team (all-play), and its current players against their projections. Weeks no team scored in are skipped.
 */
export function reviewSeason(input: ReviewInput): SeasonReview | undefined {
  const { league, rosterId } = input;
  const slots = startingSlots(league.rosterPositions);
  const taxi = new Map(input.rosters.map((r) => [r.rosterId, new Set(r.taxi)]));
  const fpos = (id: string): readonly string[] => {
    const p = input.players.get(id);
    return p?.fpos.length ? p.fpos : p ? [p.pos] : [];
  };
  const weeks: WeekReview[] = [];
  const totals = new Map<number, { points: number; best: number; against: number }>();
  const pointsByWeek = new Map<number, Map<string, number>>();
  const record: Record3 = { w: 0, l: 0, t: 0 };
  const allPlay: Record3 = { w: 0, l: 0, t: 0 };
  const median: Record3 = { w: 0, l: 0, t: 0 };
  let expectedWins = 0;

  for (const [week, ms] of [...input.played].sort((a, b) => a[0] - b[0])) {
    const mine = ms.find((m) => m.rosterId === rosterId);
    if (!mine || !ms.some((m) => m.points > 0)) continue;
    const scored = new Map<string, number>();
    for (const m of ms) for (const [id, p] of Object.entries(m.playersPoints)) scored.set(id, p);
    pointsByWeek.set(week, scored);
    let myBest = mine.points;
    for (const m of ms) {
      const off = taxi.get(m.rosterId);
      const best = Math.max(m.points, bestPossible(slots, off?.size ? m.players.filter((id) => !off.has(id)) : m.players, m.playersPoints, fpos));
      const opp = m.matchupId == null ? undefined : ms.find((x) => x.matchupId === m.matchupId && x.rosterId !== m.rosterId);
      const t = totals.get(m.rosterId) ?? { points: 0, best: 0, against: 0 };
      totals.set(m.rosterId, { points: t.points + m.points, best: t.best + best, against: t.against + (opp?.points ?? 0) });
      if (m === mine) myBest = best;
    }
    const opp = mine.matchupId == null ? undefined : ms.find((x) => x.matchupId === mine.matchupId && x.rosterId !== rosterId);
    const others = ms.filter((m) => m.rosterId !== rosterId);
    const ap: Record3 = { w: 0, l: 0, t: 0 };
    for (const o of others) add(ap, cmp(mine.points, o.points));
    allPlay.w += ap.w;
    allPlay.l += ap.l;
    allPlay.t += ap.t;
    const result = opp ? cmp(mine.points, opp.points) : null;
    const row: WeekReview = {
      week,
      points: mine.points,
      opponent: opp?.rosterId ?? null,
      oppPoints: opp?.points ?? null,
      result,
      best: myBest,
      rank: 1 + others.filter((o) => o.points > mine.points + TIE).length,
      teams: ms.length,
      allPlay: ap,
    };
    if (result) {
      add(record, result);
      if (others.length) expectedWins += (ap.w + ap.t / 2) / others.length;
    }
    if (league.rules.medianGame && ms.length > 1) {
      row.median = cmp(mine.points, medianOf(ms.map((m) => m.points)));
      add(median, row.median);
    }
    const pick = input.advice?.get(week);
    if (pick?.length) row.app = pick.reduce((s, id) => s + (scored.get(id) ?? 0), 0);
    weeks.push(row);
  }
  if (!weeks.length) return undefined;

  const me = totals.get(rosterId)!;
  const shares = new Map([...totals].filter(([, t]) => t.best > 0).map(([id, t]) => [id, t.points / t.best]));
  const out: SeasonReview = {
    weeks,
    record,
    allPlay,
    expectedWins,
    luck: record.w + record.t / 2 - expectedWins,
    points: me.points,
    best: me.best,
    efficiency: me.best > 0 ? me.points / me.best : 1,
    leagueEfficiency: shares.size ? [...shares.values()].reduce((a, b) => a + b, 0) / shares.size : 1,
    efficiencyRank: rankOf(shares, rosterId),
    efficiencyTeams: shares.size,
    pointsAgainst: me.against,
    pointsAgainstRank: rankOf(new Map([...totals].map(([id, t]) => [id, t.against])), rosterId),
    teams: totals.size,
    players: playerReviews(input, pointsByWeek),
  };
  if (league.rules.medianGame) out.median = median;
  return out;
}

/** Current players (taxi squad aside): points against Sleeper's projection in the weeks both are known. */
function playerReviews(input: ReviewInput, pointsByWeek: ReadonlyMap<number, ReadonlyMap<string, number>>): PlayerReview[] {
  const roster = input.rosters.find((r) => r.rosterId === input.rosterId);
  if (!roster || !input.projections) return [];
  const out: PlayerReview[] = [];
  for (const id of teamIds(roster)) {
    const pos = input.players.get(id)?.pos ?? 'UNK';
    let games = 0;
    let projected = 0;
    let actual = 0;
    let variance = 0;
    for (const [week, scored] of pointsByWeek) {
      const points = scored.get(id);
      const stats = input.projections.get(week)?.byPlayer.get(id)?.stats;
      if (points === undefined || !stats) continue;
      const mu = Math.max(0, scoreStats(expectedStats(stats, pos), input.league.scoring));
      if (mu <= 0) continue;
      games++;
      projected += mu;
      actual += points;
      variance += pointSd(pos, mu) ** 2;
    }
    if (games) out.push({ id, games, projected: projected / games, actual: actual / games, z: variance > 0 ? (actual - projected) / Math.sqrt(variance) : 0 });
  }
  return out.sort((a, b) => b.actual - b.projected - (a.actual - a.projected));
}
