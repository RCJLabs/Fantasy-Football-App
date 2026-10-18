import type { Game, League, LeagueUser, Matchup, Player, PracticeStatus, Roster, StatLine } from '../domain/types';
import { bestAssignment } from '../engine/assignment';
import { conditionalMean, playProbability } from '../engine/availability';
import { crossCovariance, pairCorrelation, withinCovariance, type CorrItem } from '../engine/correlation';
import { canFill, optimizeLineup, startingSlots, twoStageValue, type LineupPlayer, type LineupProblem } from '../engine/lineup';
import { expectedStats, scoreBreakdown, scoreStats, uncoveredScoringKeys } from '../engine/scoring';
import { pointSd, playerDist, probBeatAtLeast, sumDists, winProbability, type Dist } from '../engine/winprob';
import type { DefenseEdge, MatchupsFile, PlayerUsage } from '../data/contracts';
import type { ProjectionIndex } from '../sleeper/parse';
import { playoffWeekInfo, type PlayoffWeek } from './ros';

const HOUR = 3_600_000;
/** Typical game length used to estimate how much of an in-progress game remains. [design] */
const GAME_MS = 3.25 * HOUR;

export interface WeekContext {
  season: string;
  week: number;
  now: number;
  players: Map<string, Player>;
  projections: ProjectionIndex;
  /** This week's games keyed by Sleeper team code (both teams of each game). */
  gamesByTeam: Map<string, Game>;
  /** True when kickoff times come from game dates only (pipeline schedule unavailable). */
  kickoffsApproximate?: boolean;
  /** Recent usage by Sleeper id (pipeline usage.json), when available. */
  usage?: UsageIndex;
  /** Defense-vs-position edges and regular cornerbacks (pipeline matchups.json), when available. */
  matchups?: MatchupsFile;
  /** In-house baseline stat lines for this week (pipeline baseline.json), a second opinion, when available. */
  baseline?: BaselineIndex;
  /** 'baseline' when Sleeper's projections were missing and QB/RB/WR/TE projections come from the baseline. */
  projectionSource?: 'baseline';
}

export interface BaselineIndex {
  /** Last week of this season in the averages. */
  throughWeek: number;
  players: ReadonlyMap<string, StatLine>;
}

export interface UsageIndex {
  weeks: number[];
  players: ReadonlyMap<string, PlayerUsage>;
}

export interface PlayerRow {
  id: string;
  name: string;
  pos: string;
  fpos: string[];
  team: string | null;
  opponent?: string;
  home?: boolean;
  kickoff: number | null;
  injury: string | null;
  injuryBody?: string;
  practice?: PracticeStatus;
  /** `practice` is from the week's final report, so it sets the odds. */
  practiceFinal?: boolean;
  /** Not active in his team's last game: lowers a Questionable player's odds. */
  missedLast?: boolean;
  /** P(active). */
  p: number;
  /** League points if active. */
  mu: number;
  /** p × mu. */
  ev: number;
  sd: number;
  locked: boolean;
  /** Points scored so far (locked players). */
  actual?: number;
  hasProjection: boolean;
  /** Largest scoring contributions of the expected stat line. */
  breakdown: Array<{ key: string; points: number }>;
  teamImplied?: number;
  /** Recent usage (display only), with the weeks it covers. */
  usage?: PlayerUsage & { weeks: number[] };
  /** Matchup context (display only): the opponent against this position, and its regular cornerbacks who are out. */
  matchup?: { defense?: DefenseEdge; cbsOut?: Array<{ name: string; snap: number; status: string }> };
  /**
   * In-house baseline, league points if active, from games through `through` (this season): a labelled
   * second opinion, never blended into `mu`.
   */
  baseline?: { pts: number; through: number };
  /** `mu` comes from the in-house baseline because Sleeper's projections were missing this week. */
  fallback?: true;
  /** ESPN athlete id: player details load his recent news from ESPN. */
  espnId?: string;
}

export type ProblemLevel = 'error' | 'warn' | 'info';
export interface Problem {
  level: ProblemLevel;
  text: string;
}

/**
 * swap: start `in` over `out` in `slot`; start: `in` fills `slot` (nobody benched there);
 * bench: `out` leaves the lineup; move: `in` changes slot (already starting).
 */
export interface LineupChange {
  kind: 'swap' | 'start' | 'bench' | 'move';
  slot: string;
  out: PlayerRow | null;
  in: PlayerRow | null;
}

export interface TeamSide {
  rosterId: number;
  name: string;
  rows: Array<PlayerRow | null>;
  /** Starters by starting slot (null: empty), assumed fill-ins in place. */
  bySlot: Array<PlayerRow | null>;
  /** Sleeper's points so far this week (live during games). */
  points: number;
  dist: Dist;
  /** Bench players assumed to start in place of starters who can't play (opponents fix their holes). */
  assumed?: string[];
}

/** What a lineup recommendation maximizes. */
export type Objective = 'points' | 'win';

export interface LineupOptions {
  /** Defaults to 'win' in the playoffs, 'points' otherwise. */
  objective?: Objective;
  /**
   * The other week of a two-week playoff round, for both teams: points already scored (second week)
   * or projected (first week). Round winners are decided by the two-week total.
   */
  extra?: { me: Dist; opp: Dist };
}

export interface LineupAnalysis {
  week: number;
  slots: string[];
  current: Array<PlayerRow | null>;
  recommended: Array<PlayerRow | null>;
  changes: LineupChange[];
  expectedCurrent: number;
  expectedRecommended: number;
  gain: number;
  bench: PlayerRow[];
  reserve: PlayerRow[];
  me: TeamSide;
  opponent?: TeamSide;
  /** Chance to win this week's game (the whole round in a two-week playoff round). */
  winProbCurrent?: number;
  winProbRecommended?: number;
  /** Chance to beat the league median (regular season in median leagues). */
  medianProbCurrent?: number;
  medianProb?: number;
  objective: Objective;
  defaultObjective: Objective;
  playoff?: PlayoffWeek;
  /** In win-chance mode: what the max-expected-points lineup would give, for comparison. */
  maxPoints?: {
    expected: number;
    winProb?: number;
    medianProb?: number;
    same: boolean;
    /** Why the win-chance lineup differs: correlations its new starters bring. */
    reasons: string[];
  };
  problems: Problem[];
  uncoveredKeys: string[];
}

/** A win-chance lineup must beat the max-points lineup by this much to be recommended. [design] */
const WIN_EDGE = 0.005;
const ZERO: Dist = { mean: 0, variance: 0 };

export function teamName(roster: Roster | undefined, users: readonly LeagueUser[]): string {
  if (!roster) return 'Unknown';
  const u = users.find((x) => x.userId === roster.ownerId);
  return u?.teamName ?? u?.displayName ?? `Team ${roster.rosterId}`;
}

const OFFENSE = new Set(['QB', 'RB', 'WR', 'TE']);
const SIDELINED = new Set(['Out', 'Doubtful', 'IR', 'PUP', 'Sus']);

/** The opponent's record against this position, and (for pass catchers) its regular cornerbacks who are out. */
function matchupContext(ctx: WeekContext, pos: string, opponent: string): PlayerRow['matchup'] | undefined {
  if (!OFFENSE.has(pos)) return undefined;
  const defense = ctx.matchups!.defense[opponent]?.[pos as 'QB' | 'RB' | 'WR' | 'TE'];
  const cbsOut =
    pos === 'WR' || pos === 'TE'
      ? (ctx.matchups!.secondary[opponent] ?? []).flatMap((cb) => {
          const p = ctx.players.get(cb.id);
          return p?.injury && SIDELINED.has(p.injury) ? [{ name: p.name, snap: cb.snap, status: p.injury }] : [];
        })
      : [];
  if (!defense && !cbsOut.length) return undefined;
  return { ...(defense ? { defense } : {}), ...(cbsOut.length ? { cbsOut } : {}) };
}

/** Everything the app knows about one player this week, scored for one league. */
export function playerRow(id: string, league: League, ctx: WeekContext, actualPoints?: number): PlayerRow {
  const proj = ctx.projections.byPlayer.get(id);
  const fromProj = ctx.projections.players.get(id);
  const base = ctx.players.get(id) ?? fromProj;
  const pos = base?.pos ?? 'UNK';
  const team = base?.team ?? proj?.team ?? null;
  // The pipeline's player file has fresher injury data than projection rows; prefer it.
  const injury = base?.injury ?? fromProj?.injury ?? null;
  const practice = base?.practice;
  // The practice odds are calibrated on final reports; before that the overall Questionable rate applies.
  const finalPractice = base?.practiceFinal ? practice : undefined;
  const game = team ? ctx.gamesByTeam.get(team) : undefined;
  const kickoff = game ? Date.parse(game.kickoff) : null;
  const locked = kickoff !== null && kickoff <= ctx.now;

  const stats = proj?.stats ?? {};
  const hasProjection = Object.keys(stats).length > 0;
  const expected = hasProjection ? expectedStats(stats, pos) : {};
  const projected = hasProjection ? scoreStats(expected, league.scoring) : 0;
  const p = game ? playProbability(injury, finalPractice, { body: base?.injuryBody ?? null, missedLast: base?.missedLast ?? false, pos }) : 0;
  const mu = Math.max(0, conditionalMean(projected, injury));

  const row: PlayerRow = {
    id,
    name: base?.name || id,
    pos,
    fpos: base?.fpos?.length ? base.fpos : [pos],
    team,
    kickoff,
    injury,
    p,
    mu,
    ev: p * mu,
    sd: pointSd(pos, mu),
    locked,
    hasProjection,
    breakdown: hasProjection ? scoreBreakdown(expected, league.scoring).slice(0, 6) : [],
  };
  if (base?.injuryBody) row.injuryBody = base.injuryBody;
  if (base?.espnId) row.espnId = base.espnId;
  const line = ctx.baseline?.players.get(id);
  if (ctx.projectionSource === 'baseline' && line && hasProjection) row.fallback = true;
  if (line && game && !row.fallback) row.baseline = { pts: scoreStats(expectedStats(line, pos), league.scoring), through: ctx.baseline!.throughWeek };
  const usage = ctx.usage?.players.get(id);
  if (usage) row.usage = { ...usage, weeks: ctx.usage!.weeks };
  if (practice) row.practice = practice;
  if (finalPractice) row.practiceFinal = true;
  if (base?.missedLast) row.missedLast = true;
  if (game && team) {
    row.home = game.home === team;
    row.opponent = row.home ? game.away : game.home;
    const implied = row.home ? game.homeImplied : game.awayImplied;
    if (implied !== undefined) row.teamImplied = implied;
    const matchup = ctx.matchups ? matchupContext(ctx, pos, row.opponent) : undefined;
    if (matchup) row.matchup = matchup;
  }
  if (locked && actualPoints !== undefined) row.actual = actualPoints;
  return row;
}

/** Points distribution for a starter, accounting for games already under way. */
export function starterDist(row: PlayerRow, now: number): Dist {
  if (row.locked && row.kickoff !== null) {
    const done = Math.min(1, Math.max(0, (now - row.kickoff) / GAME_MS));
    const actual = row.actual ?? 0;
    const remaining = 1 - done;
    return { mean: actual + remaining * row.mu, variance: remaining * row.sd * row.sd };
  }
  return playerDist(row.mu, row.p, row.sd);
}

const isRow = (r: PlayerRow | null): r is PlayerRow => r !== null;

/** The part of a starter's points that still moves with his game (for correlations between players). */
export function corrItem(row: PlayerRow, now: number): CorrItem {
  let sd = row.p * row.sd;
  if (row.locked && row.kickoff !== null) sd = Math.sqrt(1 - Math.min(1, Math.max(0, (now - row.kickoff) / GAME_MS))) * row.sd;
  return { pos: row.pos, team: row.team, opponent: row.opponent ?? null, sd };
}

/** Distribution of a lineup's total, including correlations between starters in the same NFL games. */
function lineupDist(rows: ReadonlyArray<PlayerRow | null>, now: number): Dist {
  const starters = rows.filter(isRow);
  const base = sumDists(starters.map((r) => starterDist(r, now)));
  return { mean: base.mean, variance: Math.max(0, base.variance + withinCovariance(starters.map((r) => corrItem(r, now)))) };
}

/**
 * A team's starters this week (as set in Sleeper) and the distribution of its score, points so far
 * included. Starters who can't play (Out, bye, empty slot) are assumed replaced by the best eligible bench
 * player whose game hasn't started: managers fix obvious holes before kickoff.
 */
export function teamSide(league: League, roster: Roster, users: readonly LeagueUser[], matchups: readonly Matchup[], ctx: WeekContext): TeamSide {
  const m = matchups.find((x) => x.rosterId === roster.rosterId);
  const slots = startingSlots(league.rosterPositions);
  const set = m?.starters.length ? m.starters : roster.starters;
  const row = (id: string) => playerRow(id, league, ctx, m?.playersPoints[id]);
  const starting = slots.map((_, s) => {
    const id = set[s];
    return id && id !== '0' ? row(id) : null;
  });
  const used = new Set(starting.filter(isRow).map((r) => r.id));
  const off = new Set([...roster.reserve, ...roster.taxi]);
  const bench = roster.players
    .filter((id) => !used.has(id) && !off.has(id))
    .map(row)
    .filter((r) => !r.locked && r.ev > 0)
    .sort((a, b) => b.ev - a.ev);
  const assumed: string[] = [];
  const rows = starting.map((r, s) => {
    if (r && (r.locked || r.ev > 0)) return r;
    const k = bench.findIndex((b) => canFill(slots[s]!, b.fpos));
    if (k < 0) return r;
    const sub = bench.splice(k, 1)[0]!;
    assumed.push(sub.id);
    return sub;
  });
  const live = rows.filter(isRow);
  const side: TeamSide = { rosterId: roster.rosterId, name: teamName(roster, users), rows: live, bySlot: rows, points: m?.points ?? 0, dist: lineupDist(live, ctx.now) };
  if (assumed.length) side.assumed = assumed;
  return side;
}

/** A roster's lineup choice this week: who can start where, with games already under way locked at their points so far. */
export function lineupProblem(league: League, roster: Roster, matchups: readonly Matchup[], ctx: WeekContext): { problem: LineupProblem; rows: PlayerRow[] } {
  const slots = startingSlots(league.rosterPositions);
  const points = matchups.find((m) => m.rosterId === roster.rosterId)?.playersPoints ?? {};
  const unavailable = new Set([...roster.reserve, ...roster.taxi]);
  const ids = roster.players.filter((id) => !unavailable.has(id));
  const rows = ids.map((id) => playerRow(id, league, ctx, points[id]));
  const indexOf = new Map(ids.map((id, i) => [id, i]));
  const players: LineupPlayer[] = rows.map((r) => ({
    id: r.id,
    fpos: r.fpos,
    mu: r.mu,
    p: r.p,
    kickoff: r.kickoff,
    locked: r.locked,
    lockedPoints: r.locked ? starterDist(r, ctx.now).mean : r.ev,
  }));
  const current = slots.map((_, s) => {
    const id = roster.starters[s];
    return id && id !== '0' ? (indexOf.get(id) ?? -1) : -1;
  });
  return { problem: { slots, players, current, now: ctx.now }, rows };
}

export function analyzeLineup(
  league: League,
  rosters: readonly Roster[],
  users: readonly LeagueUser[],
  matchups: readonly Matchup[],
  myRoster: Roster,
  ctx: WeekContext,
  opts: LineupOptions = {},
): LineupAnalysis {
  const slots = startingSlots(league.rosterPositions);
  const myMatchup = matchups.find((m) => m.rosterId === myRoster.rosterId);
  const points = myMatchup?.playersPoints ?? {};
  const { problem, rows } = lineupProblem(league, myRoster, matchups, ctx);
  const current = [...problem.current];
  const best = optimizeLineup(problem);
  const pick = (lineup: readonly number[]) => lineup.map((i) => (i >= 0 ? rows[i]! : null));

  let opponent: TeamSide | undefined;
  if (myMatchup?.matchupId != null) {
    const opp = matchups.find((m) => m.matchupId === myMatchup.matchupId && m.rosterId !== myRoster.rosterId);
    const oppRoster = opp ? rosters.find((r) => r.rosterId === opp.rosterId) : undefined;
    if (oppRoster) opponent = teamSide(league, oppRoster, users, matchups, ctx);
  }

  // The median game is a regular-season thing; playoff weeks are single (or two-week) eliminations.
  const playoff = playoffWeekInfo(league, ctx.week);
  const start = league.rules.playoffWeekStart;
  const median =
    league.rules.medianGame && rosters.length > 2 && !(start && ctx.week >= start)
      ? {
          others: rosters.filter((r) => r.rosterId !== myRoster.rosterId).map((r) => teamSide(league, r, users, matchups, ctx).dist),
          need: Math.floor(rosters.length / 2),
        }
      : undefined;
  const extra = opts.extra ?? { me: ZERO, opp: ZERO };
  const oppItems = opponent ? opponent.rows.filter(isRow).map((r) => corrItem(r, ctx.now)) : [];
  const oppDist = opponent ? { mean: opponent.dist.mean + extra.opp.mean, variance: opponent.dist.variance + extra.opp.variance } : undefined;

  /** Chance to win the game (round) and to beat the median with a lineup worth `expected` points. */
  const odds = (lineup: readonly number[], expected: number) => {
    const starters = pick(lineup).filter(isRow);
    const items = starters.map((r) => corrItem(r, ctx.now));
    const variance = sumDists(starters.map((r) => starterDist(r, ctx.now))).variance + withinCovariance(items);
    const mine = { mean: expected + extra.me.mean, variance: Math.max(0, variance) + extra.me.variance };
    return {
      win: oppDist ? winProbability(mine, oppDist, crossCovariance(items, oppItems)) : undefined,
      median: median ? probBeatAtLeast(mine, median.others, median.need) : undefined,
    };
  };
  const wins = (o: { win?: number | undefined; median?: number | undefined }) => (o.win ?? 0) + (o.median ?? 0);

  const defaultObjective: Objective = playoff && opponent ? 'win' : 'points';
  const objective: Objective = opponent || median ? (opts.objective ?? defaultObjective) : 'points';
  let result = best;
  let maxPoints: LineupAnalysis['maxPoints'];
  if (objective === 'win') {
    const base = odds(best.lineup, best.expected);
    const tuned = optimizeLineup(problem, { score: (l) => wins(odds(l, twoStageValue(problem, l))), starts: [best.lineup] });
    // Only trade expected points for win chance when the model sees a real edge, not noise.
    if (tuned.score > wins(base) + WIN_EDGE) result = tuned;
    const reasons = result === best ? [] : correlationReasons(pick(result.lineup), pick(best.lineup), opponent?.rows ?? []);
    maxPoints = { expected: best.expected, same: result === best, reasons };
    if (base.win !== undefined) maxPoints.winProb = base.win;
    if (base.median !== undefined) maxPoints.medianProb = base.median;
  }

  const currentRows = pick(current);
  const recommendedRows = pick(result.lineup);
  const changes = lineupChanges(slots, current, result.lineup, rows);
  const recommendedSet = new Set(result.lineup.filter((i) => i >= 0));
  // Moves between slots (same players, different positions) without anyone entering or leaving.
  const reshuffled = changes.length > 0 && changes.every((c) => c.kind === 'move');
  const bench = rows.filter((_, i) => !recommendedSet.has(i)).sort((a, b) => b.ev - a.ev);
  const reserve = [...myRoster.reserve, ...myRoster.taxi].map((id) => playerRow(id, league, ctx, points[id]));
  const me: TeamSide = {
    rosterId: myRoster.rosterId,
    name: teamName(myRoster, users),
    rows: recommendedRows,
    bySlot: recommendedRows,
    points: myMatchup?.points ?? 0,
    dist: lineupDist(recommendedRows, ctx.now),
  };

  const analysis: LineupAnalysis = {
    week: ctx.week,
    slots,
    current: currentRows,
    recommended: recommendedRows,
    changes,
    expectedCurrent: result.currentExpected,
    expectedRecommended: result.expected,
    gain: result.expected - result.currentExpected,
    bench,
    reserve,
    me,
    objective,
    defaultObjective,
    problems: [],
    uncoveredKeys: uncoveredScoringKeys(league.scoring, ctx.projections.statKeys),
  };
  if (playoff) analysis.playoff = playoff;
  if (maxPoints) analysis.maxPoints = maxPoints;
  const oddsCurrent = odds(current, result.currentExpected);
  const oddsRecommended = odds(result.lineup, result.expected);
  if (opponent) {
    analysis.opponent = opponent;
    analysis.winProbCurrent = oddsCurrent.win!;
    analysis.winProbRecommended = oddsRecommended.win!;
  }
  if (median) {
    analysis.medianProbCurrent = oddsCurrent.median!;
    analysis.medianProb = oddsRecommended.median!;
  }
  analysis.problems = lineupProblems(analysis, reshuffled, league, myRoster);
  return analysis;
}

/** Correlations the win-chance lineup's new starters bring, in words (at most two). */
function correlationReasons(chosen: ReadonlyArray<PlayerRow | null>, maxPoints: ReadonlyArray<PlayerRow | null>, opponents: ReadonlyArray<PlayerRow | null>): string[] {
  const before = new Set(maxPoints.filter(isRow).map((r) => r.id));
  const mine = chosen.filter(isRow);
  const out: string[] = [];
  for (const p of mine.filter((r) => !before.has(r.id))) {
    for (const q of mine) {
      if (q.id !== p.id && pairCorrelation(p, q) >= 0.15) out.push(`${p.name} pairs with your ${q.name}`);
    }
    for (const o of opponents.filter(isRow)) {
      const r = pairCorrelation(p, o);
      if (r >= 0.15) out.push(`${p.name} moves with their ${o.name}`);
      else if (r <= -0.15) out.push(`${p.name} works against their ${o.name}`);
    }
  }
  return [...new Set(out)].slice(0, 2);
}

/**
 * Describe how to get from the current lineup to the recommended one. Each newcomer is paired with a
 * benched starter (same slot first, then same slot type, then any); moves between slots of the same
 * type (RB ↔ RB) aren't changes.
 */
export function lineupChanges(slots: readonly string[], current: readonly number[], next: readonly number[], rows: readonly PlayerRow[]): LineupChange[] {
  const slotOf = (lineup: readonly number[]) => new Map(lineup.flatMap((i, s) => (i >= 0 ? [[i, s] as const] : [])));
  const curSlot = slotOf(current);
  const nextSlot = slotOf(next);
  const unpaired = new Set([...curSlot.keys()].filter((i) => !nextSlot.has(i)));
  const changes: LineupChange[] = [];
  for (const [i, s] of nextSlot) {
    if (curSlot.has(i)) continue;
    let out = -1;
    let outRank = 3;
    for (const o of unpaired) {
      const os = curSlot.get(o)!;
      const r = os === s ? 0 : slots[os] === slots[s] ? 1 : 2;
      if (r < outRank) [out, outRank] = [o, r];
    }
    if (out >= 0) {
      unpaired.delete(out);
      changes.push({ kind: 'swap', slot: slots[s]!, in: rows[i]!, out: rows[out]! });
    } else changes.push({ kind: 'start', slot: slots[s]!, in: rows[i]!, out: null });
  }
  for (const o of unpaired) changes.push({ kind: 'bench', slot: slots[curSlot.get(o)!] ?? 'BN', in: null, out: rows[o]! });
  for (const [i, s] of nextSlot) {
    const before = curSlot.get(i);
    if (before !== undefined && slots[before] !== slots[s]) changes.push({ kind: 'move', slot: slots[s]!, in: rows[i]!, out: null });
  }
  const order = { swap: 0, start: 1, bench: 2, move: 3 };
  return changes.sort((a, b) => order[a.kind] - order[b.kind]);
}

function lineupProblems(a: LineupAnalysis, reshuffled: boolean, league: League, roster: Roster): Problem[] {
  const out: Problem[] = [];
  // The summary leads: it's the actionable line when a card shows only the top few problems.
  if (a.objective === 'win') {
    const before = (a.winProbCurrent ?? 0) + (a.medianProbCurrent ?? 0);
    const after = (a.winProbRecommended ?? 0) + (a.medianProb ?? 0);
    const pctOf = (x: number) => `${Math.round(x * 100)}%`;
    if (a.changes.length && after - before >= WIN_EDGE) {
      out.push({
        level: 'warn',
        text:
          a.medianProb !== undefined
            ? `Better lineup available: +${(after - before).toFixed(2)} expected wins`
            : `Better lineup available: win chance ${pctOf(before)} → ${pctOf(after)}`,
      });
    }
  } else if (a.gain >= 0.5) out.push({ level: 'warn', text: `Better lineup available: +${a.gain.toFixed(1)} expected points` });
  else if (reshuffled && a.gain > 0.05) out.push({ level: 'info', text: `Slot reshuffle adds +${a.gain.toFixed(1)} via late-swap flexibility` });
  a.current.forEach((row, s) => {
    const slot = a.slots[s]!;
    if (!row) out.push({ level: 'error', text: `Empty ${slot} slot` });
    else if (row.locked) return;
    else if (row.kickoff === null) out.push({ level: 'error', text: `${row.name} (${slot}) has no game this week` });
    else if (row.p === 0) out.push({ level: 'error', text: `${row.name} (${slot}) is ${row.injury ?? 'not expected to play'}` });
    else if (row.p < 0.95) out.push({ level: 'warn', text: `${row.name} (${slot}) is ${row.injury}${row.practice ? `, ${row.practice} practice${row.practiceFinal ? '' : ' so far'}` : ''} — ${Math.round(row.p * 100)}% to play` });
  });
  const freeIr = league.rules.reserveSlots - roster.reserve.length;
  if (freeIr > 0) {
    const eligible = a.bench.filter((r) => irEligible(league, r.injury));
    if (eligible.length) out.push({ level: 'info', text: `${eligible[0]!.name} (${eligible[0]!.injury}) could move to IR to free a bench spot` });
  }
  if (a.uncoveredKeys.length) out.push({ level: 'info', text: `Scoring keys without projections: ${a.uncoveredKeys.join(', ')}` });
  return out;
}

const irKey = (status: string) => (status === 'Doubtful' ? 'doubtful' : status === 'Out' ? 'out' : status === 'Sus' ? 'sus' : status === 'NA' ? 'na' : status === 'DNR' ? 'dnr' : status === 'COV' ? 'cov' : 'ir');

/** The league lets a player with this status into an IR slot (Sleeper's `reserve_allow_*`; IR itself always). */
export function irEligible(league: League, injury: string | null | undefined): boolean {
  return !!injury && ['IR', 'Out', 'PUP', 'Sus', 'NA', 'DNR', 'COV', 'Doubtful'].includes(injury) && league.rules.reserveAllow[irKey(injury)] !== false;
}

export interface WaiverRow {
  player: PlayerRow;
  /** Gain in this week's best lineup (expected points) if added. */
  gainThisWeek: number;
  trendingAdds?: number;
}

/** Players on no roster in the league (IR and taxi included). */
export function rosteredIds(rosters: readonly Roster[]): Set<string> {
  return new Set(rosters.flatMap((r) => [...r.players, ...r.reserve, ...r.taxi]));
}

/** Whether a player can fill any starting slot in the league. */
export function startable(league: League, fpos: readonly string[]): boolean {
  return startingSlots(league.rosterPositions).some((s) => canFill(s, fpos));
}

/**
 * Gain in this week's best lineup from adding one player. Starters whose games have started keep their
 * slots; only the open slots can still improve.
 */
export function thisWeekGain(league: League, myRoster: Roster, ctx: WeekContext): (r: PlayerRow) => number {
  const allSlots = startingSlots(league.rosterPositions);
  const unavailable = new Set([...myRoster.reserve, ...myRoster.taxi]);
  const mine = myRoster.players.filter((id) => !unavailable.has(id)).map((id) => playerRow(id, league, ctx));
  const lockedIds = new Set(mine.filter((r) => r.locked).map((r) => r.id));
  const slots = allSlots.filter((_, s) => !lockedIds.has(myRoster.starters[s] ?? ''));
  const pool = mine.filter((r) => !r.locked);
  const best = (rows: readonly PlayerRow[]) =>
    bestAssignment(slots.length, rows.length, (s, i) => (canFill(slots[s]!, rows[i]!.fpos) ? rows[i]!.ev : null)).total;
  const baseline = best(pool);
  return (r) => (r.locked || !slots.some((s) => canFill(s, r.fpos)) ? 0 : Math.max(0, best([...pool, r]) - baseline));
}

/** Free agents ranked by how much they'd improve this week's best lineup, with trending adds. */
export function analyzeWaivers(
  league: League,
  rosters: readonly Roster[],
  myRoster: Roster,
  ctx: WeekContext,
  trending: ReadonlyMap<string, number>,
  limit = 25,
): WaiverRow[] {
  const rostered = rosteredIds(rosters);
  const gain = thisWeekGain(league, myRoster, ctx);
  const candidates = [...ctx.projections.byPlayer.keys()]
    .filter((id) => !rostered.has(id))
    .map((id) => playerRow(id, league, ctx))
    .filter((r) => r.hasProjection && !r.locked && startable(league, r.fpos) && (r.ev > 0.5 || trending.has(r.id)))
    .sort((a, b) => b.ev - a.ev)
    .slice(0, 80);

  return candidates
    .map((r) => {
      const row: WaiverRow = { player: r, gainThisWeek: gain(r) };
      const t = trending.get(r.id);
      if (t !== undefined) row.trendingAdds = t;
      return row;
    })
    .sort((a, b) => b.gainThisWeek - a.gainThisWeek || (b.trendingAdds ?? 0) - (a.trendingAdds ?? 0) || b.player.ev - a.player.ev)
    .slice(0, limit);
}

/** Index this week's games by team. */
export function gamesByTeam(games: readonly Game[], week: number): Map<string, Game> {
  const out = new Map<string, Game>();
  for (const g of games) {
    if (g.week !== week) continue;
    out.set(g.away, g);
    out.set(g.home, g);
  }
  return out;
}
