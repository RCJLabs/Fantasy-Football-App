import type { League, Player, Roster } from '../domain/types';
import { bestAssignment } from '../engine/assignment';
import { canFill, startingSlots } from '../engine/lineup';
import { expectedStats, scoreStats } from '../engine/scoring';
import { playerDist, pointSd, type Dist } from '../engine/winprob';
import type { ProjectionIndex } from '../sleeper/parse';

/** Last NFL regular-season week. */
export const LAST_WEEK = 18;

/**
 * P(active) in a future week. Sleeper's future-week projections already drop players for the weeks
 * they're expected to miss (IR players reappear in their return week), so these only cover what the
 * projections can't know: new injuries (RBs most), and return dates slipping. [design] calibrate with
 * the archive.
 */
export const FUTURE_PLAY: Record<string, number> = { QB: 0.95, RB: 0.91, WR: 0.93, TE: 0.93, K: 0.98, DEF: 1 };
const FUTURE_PLAY_OTHER = 0.93;
export const RETURN_PLAY = 0.8;
const SIDELINED = new Set(['IR', 'PUP', 'NA', 'Sus', 'DNR', 'COV', 'Out', 'Doubtful']);

const OFFENSE = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
const IDP = ['DL', 'LB', 'DB'];

/** Positions to fetch future projections for: offense, K and DEF, plus IDP when the league starts IDPs. */
export function projectionPositions(league: League): string[] {
  const slots = startingSlots(league.rosterPositions);
  return slots.some((s) => IDP.some((p) => canFill(s, [p]))) ? [...OFFENSE, ...IDP] : OFFENSE;
}

/** Rounds in a playoff bracket of `teams` (first-round byes fill it to a power of two). */
export function playoffRounds(teams: number): number {
  return teams >= 2 ? Math.ceil(Math.log2(teams)) : 0;
}

export function playoffByes(teams: number): number {
  const rounds = playoffRounds(teams);
  return rounds ? 2 ** rounds - teams : 0;
}

/** Last regular-season week. Leagues without playoffs play matchups through week 18. */
export function regularSeasonEnd(league: League): number {
  const start = league.rules.playoffWeekStart;
  return start ? Math.min(LAST_WEEK, start - 1) : LAST_WEEK;
}

/** Last week that decides anything: the championship, or the end of the regular season without playoffs. */
export function seasonEnd(league: League): number {
  const { playoffWeekStart: start, playoffTeams = 0, playoffRoundType = 0 } = league.rules;
  if (!start) return LAST_WEEK;
  const rounds = Math.max(1, playoffRounds(playoffTeams));
  const weeks = playoffRoundType === 2 ? rounds * 2 : playoffRoundType === 1 ? rounds + 1 : rounds;
  return Math.min(LAST_WEEK, start + weeks - 1);
}

export interface PlayoffWeek {
  /** 1 = first round; `rounds` = championship. */
  round: number;
  rounds: number;
  /** Rounds can span two weeks (scores add up); this is the round's first or second week. */
  weekInRound: 1 | 2;
  roundWeeks: 1 | 2;
}

/** Where a week falls in the playoff bracket, or null outside the playoffs. */
export function playoffWeekInfo(league: League, week: number): PlayoffWeek | null {
  const { playoffWeekStart: start, playoffTeams = 0, playoffRoundType = 0 } = league.rules;
  const rounds = playoffRounds(playoffTeams);
  if (!start || !rounds || week < start) return null;
  const k = week - start;
  if (playoffRoundType === 2) {
    const round = Math.floor(k / 2) + 1;
    return round > rounds ? null : { round, rounds, weekInRound: k % 2 === 0 ? 1 : 2, roundWeeks: 2 };
  }
  if (playoffRoundType === 1 && k >= rounds - 1) {
    // Two-week championship after one-week rounds.
    const inFinal = k - (rounds - 1);
    return inFinal > 1 ? null : { round: rounds, rounds, weekInRound: inFinal === 0 ? 1 : 2, roundWeeks: 2 };
  }
  return k + 1 > rounds ? null : { round: k + 1, rounds, weekInRound: 1, roundWeeks: 1 };
}

/**
 * Weight of each week in rest-of-season values: regular-season weeks count fully; playoff weeks count in
 * proportion to the team's playoff odds ("playoff mode" shifts value toward them as odds firm up). [design]
 */
export function weekWeights(league: League, weeks: readonly number[], pPlayoffs: number): number[] {
  const start = league.rules.playoffWeekStart;
  return weeks.map((w) => (start && w >= start ? pPlayoffs : 1));
}

/** Players a roster can field: everyone except taxi-squad players (IR players count once they return). */
export function teamIds(roster: Roster): string[] {
  const taxi = new Set(roster.taxi);
  return roster.players.filter((id) => !taxi.has(id));
}

/** Players occupying active roster spots (not IR, not taxi). */
export function activeIds(roster: Roster): string[] {
  const off = new Set([...roster.reserve, ...roster.taxi]);
  return roster.players.filter((id) => !off.has(id));
}

/** Active roster size: starters plus bench. */
export function rosterLimit(league: League): number {
  return league.rosterPositions.length;
}

export interface RosInput {
  league: League;
  /** Weeks to value, ascending (next week through the end of the season). */
  weeks: readonly number[];
  byWeek: ReadonlyMap<number, ProjectionIndex>;
  players: ReadonlyMap<string, Player>;
}

/** Rest-of-season expected points per player and per lineup, scored for one league. */
export class RosModel {
  readonly slots: string[];
  readonly weeks: readonly number[];
  private readonly evs = new Map<string, Float64Array>();
  private readonly vars = new Map<string, Float64Array>();
  private readonly plays = new Map<string, number>();

  constructor(private readonly input: RosInput) {
    this.slots = startingSlots(input.league.rosterPositions);
    this.weeks = input.weeks;
  }

  player(id: string): Player | undefined {
    return this.input.players.get(id);
  }

  /** Ids with a projection in week index `i`. */
  projected(i: number): Iterable<string> {
    const w = this.weeks[i];
    return (w === undefined ? undefined : this.input.byWeek.get(w)?.byPlayer.keys()) ?? [];
  }

  private readonly playing = new Map<number, Set<string>>();

  /** NFL teams with projections in week index `i`; teams missing from a loaded week are on bye. */
  teamsPlaying(i: number): Set<string> | undefined {
    const w = this.weeks[i];
    const index = w === undefined ? undefined : this.input.byWeek.get(w);
    if (!index) return undefined;
    let set = this.playing.get(i);
    if (!set) {
      set = new Set([...index.byPlayer.values()].map((p) => p.team).filter((t): t is string => !!t));
      this.playing.set(i, set);
    }
    return set;
  }

  /** True when the player's NFL team has no game in week index `i` (unknown week or team: false). */
  onBye(id: string, i: number): boolean {
    const team = this.input.players.get(id)?.team;
    const playing = this.teamsPlaying(i);
    return !!team && !!playing && playing.size > 0 && !playing.has(team);
  }

  fpos(id: string): readonly string[] {
    const p = this.input.players.get(id);
    return p?.fpos.length ? p.fpos : p ? [p.pos] : [];
  }

  /** Expected points per week (P(active) × points if active); zero on byes and without a projection. */
  ev(id: string): Float64Array {
    if (!this.evs.has(id)) this.compute(id);
    return this.evs.get(id)!;
  }

  variance(id: string): Float64Array {
    if (!this.vars.has(id)) this.compute(id);
    return this.vars.get(id)!;
  }

  /** P(active) in weeks he's projected to play. */
  play(id: string): number {
    if (!this.plays.has(id)) this.compute(id);
    return this.plays.get(id)!;
  }

  /** Unweighted rest-of-season expected points of a player on his own. */
  total(id: string): number {
    return this.ev(id).reduce((a, b) => a + b, 0);
  }

  private compute(id: string): void {
    const n = this.weeks.length;
    const e = new Float64Array(n);
    const v = new Float64Array(n);
    const pl = this.input.players.get(id);
    const pos = pl?.pos ?? 'UNK';
    const p = pl?.injury && SIDELINED.has(pl.injury) ? RETURN_PLAY : (FUTURE_PLAY[pos] ?? FUTURE_PLAY_OTHER);
    this.plays.set(id, p);
    this.weeks.forEach((w, i) => {
      const stats = this.input.byWeek.get(w)?.byPlayer.get(id)?.stats;
      if (!stats) return;
      const mu = Math.max(0, scoreStats(expectedStats(stats, pos), this.input.league.scoring));
      if (mu === 0) return;
      e[i] = p * mu;
      v[i] = playerDist(mu, p, pointSd(pos, mu)).variance;
    });
    this.evs.set(id, e);
    this.vars.set(id, v);
  }

  /**
   * Best lineup from `ids` in week index `i`: mean and variance of its points. The mean includes bench
   * insurance: when a starter turns out inactive, the best eligible bench player takes his slot
   * (first order: one absence at a time). Without it, depth would be worth nothing outside bye weeks.
   */
  bestWeek(ids: readonly string[], i: number): Dist {
    const { mean, variance } = this.lineupWeek(ids, i);
    return { mean, variance };
  }

  /** `bestWeek` plus who starts and how many slots nobody with a projection can fill. */
  lineupWeek(ids: readonly string[], i: number): Dist & { starters: string[]; open: number } {
    const { assignment, total } = bestAssignment(this.slots.length, ids.length, (s, k) =>
      canFill(this.slots[s]!, this.fpos(ids[k]!)) ? this.ev(ids[k]!)[i]! : null,
    );
    const starting = new Set(assignment.filter((k) => k >= 0));
    const starters: string[] = [];
    let open = 0;
    let variance = 0;
    let insurance = 0;
    assignment.forEach((k, s) => {
      if (k < 0 || this.ev(ids[k]!)[i]! === 0) {
        open++;
        return;
      }
      const id = ids[k]!;
      starters.push(id);
      variance += this.variance(id)[i]!;
      const miss = 1 - this.play(id);
      if (miss <= 0) return;
      let backup = 0;
      ids.forEach((b, j) => {
        if (!starting.has(j) && canFill(this.slots[s]!, this.fpos(b))) backup = Math.max(backup, this.ev(b)[i]!);
      });
      insurance += miss * backup;
    });
    return { mean: total + insurance, variance, starters, open };
  }

  /** Σ over weeks of weight × best-lineup expected points. */
  value(ids: readonly string[], weights: readonly number[]): number {
    let total = 0;
    for (let i = 0; i < this.weeks.length; i++) {
      const w = weights[i] ?? 0;
      if (w) total += w * this.bestWeek(ids, i).mean;
    }
    return total;
  }
}

export interface AddGain {
  id: string;
  /** Weighted rest-of-season points gained by adding the player (after the best drop, if one is needed). */
  gain: number;
  drop?: string;
}

/**
 * What each candidate adds to a team over the rest of the season. With a full roster, the candidate
 * replaces whichever of the three cheapest-to-lose droppable players costs least.
 */
export function addGains(
  model: RosModel,
  team: readonly string[],
  droppable: readonly string[],
  openSpots: number,
  candidates: readonly string[],
  weights: readonly number[],
): AddGain[] {
  const base = model.value(team, weights);
  if (openSpots > 0) return candidates.map((id) => ({ id, gain: model.value([...team, id], weights) - base }));
  const drops = droppable
    .map((d) => ({ d, cost: base - model.value(team.filter((x) => x !== d), weights) }))
    .sort((a, b) => a.cost - b.cost)
    .slice(0, 3)
    .map((x) => x.d);
  return candidates.map((id) => {
    let best: AddGain = { id, gain: 0 };
    for (const d of drops) {
      const gain = model.value([...team.filter((x) => x !== d), id], weights) - base;
      if (best.drop === undefined || gain > best.gain) best = { id, gain, drop: d };
    }
    return best;
  });
}

/** Players to cut so `team` fits in `spots` active places: repeatedly drop whoever costs least. */
export function cheapestDrops(model: RosModel, team: readonly string[], candidates: readonly string[], count: number, weights: readonly number[]): string[] {
  const out: string[] = [];
  let cur = [...team];
  for (let n = 0; n < count; n++) {
    const base = model.value(cur, weights);
    let pick: string | undefined;
    let pickCost = Infinity;
    for (const d of candidates) {
      if (out.includes(d) || !cur.includes(d)) continue;
      const cost = base - model.value(cur.filter((x) => x !== d), weights);
      if (cost < pickCost) [pick, pickCost] = [d, cost];
    }
    if (pick === undefined) break;
    out.push(pick);
    cur = cur.filter((x) => x !== pick);
  }
  return out;
}
