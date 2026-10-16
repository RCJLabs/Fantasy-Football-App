import type { InjuryStatus, League, Player, Roster } from '../domain/types';
import { bestAssignment } from '../engine/assignment';
import { canFill, startingSlots } from '../engine/lineup';
import { expectedStats, scoreStats } from '../engine/scoring';
import { playerDist, pointSd, type Dist } from '../engine/winprob';
import type { ProjectionIndex } from '../sleeper/parse';

/** Last NFL regular-season week. */
export const LAST_WEEK = 18;

/**
 * P(active) k weeks ahead (index k − 1) for a player with no injury designation now: QB/RB/WR/TE pooled (separate
 * position curves did worse on held-out seasons), and kickers. Fitted on 2019–2025 game-day rosters
 * (scripts/calibrate/hazard.ts, docs/hazard.md): new injuries, reserve lists, benchings and releases add up with
 * distance. Sleeper's future-week projections don't discount for any of it (a healthy player's projection is flat
 * across the season), so this is applied on top. The last value holds beyond; IDP players get the QB/RB/WR/TE
 * curve [design].
 */
export const HEALTHY_PLAY: readonly number[] = [0.94, 0.91, 0.889, 0.876, 0.866, 0.855, 0.852, 0.845, 0.838, 0.832, 0.823, 0.815, 0.8, 0.787, 0.763];
export const KICKER_PLAY: readonly number[] = [0.954, 0.931, 0.914, 0.9, 0.894, 0.886, 0.88, 0.87, 0.863, 0.859, 0.857, 0.856, 0.852, 0.851];
/** Questionable now: about 82% in every later week (2019–2025), never above a healthy player's chance. */
export const QUESTIONABLE_PLAY = 0.822;
/**
 * Out, IR, PUP and the like, in weeks Sleeper projects him (his expected return and after). Not calibrated: past
 * projections don't record expected returns [design]. For scale, players Out now were active 74–78% of the time
 * four to eight weeks later, projected or not.
 */
export const RETURN_PLAY = 0.8;

/**
 * Persistent projection error: a QB/RB/WR/TE starter's level drifts from his projection by this share of it each
 * week ahead, like a random walk (injuries, role changes, pickups). The season simulation without it was too sure:
 * in a backtest on synthetic leagues built from 2022–2025 it put teams it gave 1% at 6% in reality and 88% at 78%.
 * The drift that predicted best was 0.3 with frozen rosters and 0.4 with weekly waiver pickups (0.3 within 0.3%);
 * log loss 0.520 → 0.484 (docs/ros-uncertainty.md). [measured]
 */
export const ROS_DRIFT = 0.3;

/**
 * A player's rest-of-season points miss his projection by a fixed share for the season, beyond weekly swings: SD 0.41
 * of his expected points from next week on. Fitted on 2022–2025 QB/RB/WR/TE (missed games as zeros) so 80% ranges
 * hold 80%: 79.7%, 82.0% and 81.5% over 4, 8 and 12 weeks, 81.1% and 80.5% on each half. A random walk fitted worse
 * (docs/ros-uncertainty.md). Teams' standings use ROS_DRIFT instead: roster changes pile up over a season. [measured]
 */
export const ROS_OFFSET = 0.41;
const DRIFT_POSITIONS = new Set(['QB', 'RB', 'WR', 'TE']);
const SIDELINED = new Set<InjuryStatus>(['IR', 'PUP', 'NA', 'Sus', 'DNR', 'COV', 'Out', 'Doubtful']);

/** P(active) `weeksAhead` weeks from now (1 = next week) for a player at `pos` with today's injury status. */
export function futurePlay(pos: string, injury: InjuryStatus | null | undefined, weeksAhead: number): number {
  if (pos === 'DEF') return 1;
  const curve = pos === 'K' ? KICKER_PLAY : HEALTHY_PLAY;
  const healthy = curve[Math.min(curve.length, Math.max(1, Math.round(weeksAhead))) - 1]!;
  if (injury && SIDELINED.has(injury)) return Math.min(RETURN_PLAY, healthy);
  if (injury === 'Questionable') return Math.min(QUESTIONABLE_PLAY, healthy);
  return healthy;
}

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

/** Every regular-season week is scored, or the playoffs have begun: standings are final. */
export function regularSeasonOver(league: League, week: number): boolean {
  const end = regularSeasonEnd(league);
  return week > end || (league.rules.lastScoredWeek ?? 0) >= end;
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
 * Weight of each week in rest-of-season values: regular-season weeks count fully and playoff weeks by the playoff
 * odds (`fallback` without them). Every round is a must-win, so a later round counts as much as the first even
 * though fewer teams get there; but a first-round bye week counts only by the chance of playing it (playoff odds
 * minus bye odds). Simulated title-odds gains from extra points per round have this shape; weighting rounds by the
 * chance of playing them would sink the final below round 1, the reverse of it (docs/title-odds.md). [design]
 */
export function weekWeights(league: League, weeks: readonly number[], odds?: { pPlayoffs: number; pBye: number }, fallback = 1): number[] {
  const start = league.rules.playoffWeekStart;
  return weeks.map((w) => {
    if (!start || w < start) return 1;
    if (!odds) return fallback;
    return playoffWeekInfo(league, w)?.round === 1 ? Math.max(0, odds.pPlayoffs - odds.pBye) : odds.pPlayoffs;
  });
}

/**
 * Indices into `weeks` of each playoff round's weeks (two for a two-week round), or undefined unless every
 * playoff week is still ahead: once the bracket has started, its real matchups decide.
 */
export function playoffRoundWeeks(league: League, weeks: readonly number[]): number[][] | undefined {
  const start = league.rules.playoffWeekStart;
  const rounds = playoffRounds(league.rules.playoffTeams ?? 0);
  if (!start || !rounds) return undefined;
  const out: number[][] = Array.from({ length: rounds }, () => []);
  for (let w = start; w <= seasonEnd(league); w++) {
    const info = playoffWeekInfo(league, w);
    if (!info) continue;
    const i = weeks.indexOf(w);
    if (i < 0) return undefined;
    out[info.round - 1]!.push(i);
  }
  return out.every((r) => r.length) ? out : undefined;
}

/**
 * Weekly SD of a team's persistent drift (season.ts `drift`): ROS_DRIFT of each QB/RB/WR/TE starter's expected
 * points, added in quadrature, averaged over the next few weeks so a bye doesn't shrink it.
 */
export function teamDrift(model: RosModel, ids: readonly string[], weeks = 4): number {
  const n = Math.min(weeks, model.weeks.length);
  if (!n) return 0;
  let squares = 0;
  for (let i = 0; i < n; i++) {
    for (const id of model.lineupWeek(ids, i).starters) {
      if (DRIFT_POSITIONS.has(model.player(id)?.pos ?? '')) squares += (ROS_DRIFT * model.ev(id)[i]!) ** 2;
    }
  }
  return Math.sqrt(squares / n);
}

/**
 * Variance of a roster change's weighted rest-of-season points: each player who arrives (or leaves) counts in the
 * weeks he'd start for the roster given, with his weekly variance and a fixed offset of ROS_OFFSET of his weighted
 * points. Players are independent.
 */
export function changeVariance(model: RosModel, moves: ReadonlyArray<{ id: string; roster: readonly string[] }>, weights: readonly number[]): number {
  const startersOf = new Map<readonly string[], Array<Set<string>>>();
  const starters = (roster: readonly string[]) => {
    let weeks = startersOf.get(roster);
    if (!weeks) {
      weeks = model.weeks.map((_, i) => new Set(model.lineupWeek(roster, i).starters));
      startersOf.set(roster, weeks);
    }
    return weeks;
  };
  let total = 0;
  for (const { id, roster } of moves) {
    const ev = model.ev(id);
    const variance = model.variance(id);
    const starts = starters(roster);
    let points = 0;
    for (let i = 0; i < model.weeks.length; i++) {
      if (!starts[i]!.has(id)) continue;
      const w = weights[i] ?? 1;
      points += w * ev[i]!;
      total += w * w * variance[i]!;
    }
    total += (ROS_OFFSET * points) ** 2;
  }
  return total;
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
  /** The week now: availability falls with the weeks ahead of it. Default: the week before the first valued one. */
  currentWeek?: number;
  byWeek: ReadonlyMap<number, ProjectionIndex>;
  players: ReadonlyMap<string, Player>;
}

/** Rest-of-season expected points per player and per lineup, scored for one league. */
export class RosModel {
  readonly slots: string[];
  readonly weeks: readonly number[];
  private readonly currentWeek: number;
  private readonly evs = new Map<string, Float64Array>();
  private readonly vars = new Map<string, Float64Array>();
  private readonly plays = new Map<string, Float64Array>();

  constructor(private readonly input: RosInput) {
    this.slots = startingSlots(input.league.rosterPositions);
    this.weeks = input.weeks;
    this.currentWeek = input.currentWeek ?? (input.weeks[0] ?? 1) - 1;
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

  /** P(active) in week index `i`, if he's projected to play then. */
  play(id: string, i: number): number {
    if (!this.plays.has(id)) this.compute(id);
    return this.plays.get(id)![i] ?? 0;
  }

  /** Unweighted rest-of-season expected points of a player on his own. */
  total(id: string): number {
    return this.ev(id).reduce((a, b) => a + b, 0);
  }

  private compute(id: string): void {
    const n = this.weeks.length;
    const e = new Float64Array(n);
    const v = new Float64Array(n);
    const plays = new Float64Array(n);
    const pl = this.input.players.get(id);
    const pos = pl?.pos ?? 'UNK';
    this.weeks.forEach((w, i) => {
      const p = futurePlay(pos, pl?.injury, w - this.currentWeek);
      plays[i] = p;
      const stats = this.input.byWeek.get(w)?.byPlayer.get(id)?.stats;
      if (!stats) return;
      const mu = Math.max(0, scoreStats(expectedStats(stats, pos), this.input.league.scoring));
      if (mu === 0) return;
      e[i] = p * mu;
      v[i] = playerDist(mu, p, pointSd(pos, mu)).variance;
    });
    this.plays.set(id, plays);
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
      const miss = 1 - this.play(id, i);
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
