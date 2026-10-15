import type { Game, League, LeagueUser, Matchup, Player, PracticeStatus, Roster } from '../domain/types';
import { bestAssignment } from '../engine/assignment';
import { conditionalMean, playProbability } from '../engine/availability';
import { canFill, optimizeLineup, startingSlots, type LineupPlayer } from '../engine/lineup';
import { expectedStats, scoreBreakdown, scoreStats, uncoveredScoringKeys } from '../engine/scoring';
import { pointSd, playerDist, probBeatAtLeast, sumDists, winProbability, type Dist } from '../engine/winprob';
import type { ProjectionIndex } from '../sleeper/parse';

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
}

export type ProblemLevel = 'error' | 'warn' | 'info';
export interface Problem {
  level: ProblemLevel;
  text: string;
}

export interface LineupChange {
  slot: string;
  out: PlayerRow | null;
  in: PlayerRow | null;
}

export interface TeamSide {
  rosterId: number;
  name: string;
  rows: Array<PlayerRow | null>;
  dist: Dist;
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
  winProbCurrent?: number;
  winProbRecommended?: number;
  medianProb?: number;
  problems: Problem[];
  uncoveredKeys: string[];
}

export function teamName(roster: Roster | undefined, users: readonly LeagueUser[]): string {
  if (!roster) return 'Unknown';
  const u = users.find((x) => x.userId === roster.ownerId);
  return u?.teamName ?? u?.displayName ?? `Team ${roster.rosterId}`;
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
  const game = team ? ctx.gamesByTeam.get(team) : undefined;
  const kickoff = game ? Date.parse(game.kickoff) : null;
  const locked = kickoff !== null && kickoff <= ctx.now;

  const stats = proj?.stats ?? {};
  const hasProjection = Object.keys(stats).length > 0;
  const expected = hasProjection ? expectedStats(stats, pos) : {};
  const projected = hasProjection ? scoreStats(expected, league.scoring) : 0;
  const p = game ? playProbability(injury, practice) : 0;
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
  if (practice) row.practice = practice;
  if (game && team) {
    row.home = game.home === team;
    row.opponent = row.home ? game.away : game.home;
    const implied = row.home ? game.homeImplied : game.awayImplied;
    if (implied !== undefined) row.teamImplied = implied;
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

function lineupDist(rows: ReadonlyArray<PlayerRow | null>, now: number): Dist {
  return sumDists(rows.filter((r): r is PlayerRow => r !== null).map((r) => starterDist(r, now)));
}

export function analyzeLineup(
  league: League,
  rosters: readonly Roster[],
  users: readonly LeagueUser[],
  matchups: readonly Matchup[],
  myRoster: Roster,
  ctx: WeekContext,
): LineupAnalysis {
  const slots = startingSlots(league.rosterPositions);
  const myMatchup = matchups.find((m) => m.rosterId === myRoster.rosterId);
  const points = myMatchup?.playersPoints ?? {};
  const unavailable = new Set([...myRoster.reserve, ...myRoster.taxi]);
  const ids = myRoster.players.filter((id) => !unavailable.has(id));
  const rows = ids.map((id) => playerRow(id, league, ctx, points[id]));
  const indexOf = new Map(ids.map((id, i) => [id, i]));

  const lineupPlayers: LineupPlayer[] = rows.map((r) => ({
    id: r.id,
    fpos: r.fpos,
    mu: r.mu,
    p: r.p,
    kickoff: r.kickoff,
    locked: r.locked,
    lockedPoints: r.locked ? starterDist(r, ctx.now).mean : r.ev,
  }));
  const current = slots.map((_, s) => {
    const id = myRoster.starters[s];
    return id && id !== '0' ? (indexOf.get(id) ?? -1) : -1;
  });
  const result = optimizeLineup({ slots, players: lineupPlayers, current, now: ctx.now });

  const pick = (lineup: readonly number[]) => lineup.map((i) => (i >= 0 ? rows[i]! : null));
  const currentRows = pick(current);
  const recommendedRows = pick(result.lineup);
  const changes: LineupChange[] = [];
  const currentSet = new Set(current.filter((i) => i >= 0));
  const recommendedSet = new Set(result.lineup.filter((i) => i >= 0));
  slots.forEach((slot, s) => {
    const before = current[s]!;
    const after = result.lineup[s]!;
    if (before === after) return;
    const out = before >= 0 && !recommendedSet.has(before) ? rows[before]! : null;
    const into = after >= 0 && !currentSet.has(after) ? rows[after]! : null;
    if (out || into) changes.push({ slot, out, in: into });
  });
  // Moves between slots (same players, different positions) without anyone entering or leaving.
  const reshuffled = changes.length === 0 && current.some((c, s) => c !== result.lineup[s]);

  const bench = rows.filter((_, i) => !recommendedSet.has(i)).sort((a, b) => b.ev - a.ev);
  const reserve = [...myRoster.reserve, ...myRoster.taxi].map((id) => playerRow(id, league, ctx, points[id]));

  const me: TeamSide = { rosterId: myRoster.rosterId, name: teamName(myRoster, users), rows: recommendedRows, dist: lineupDist(recommendedRows, ctx.now) };
  const meCurrentDist = lineupDist(currentRows, ctx.now);

  const sideFor = (roster: Roster): TeamSide => {
    const m = matchups.find((x) => x.rosterId === roster.rosterId);
    const starters = (m?.starters.length ? m.starters : roster.starters).filter((id) => id && id !== '0');
    const r = starters.map((id) => playerRow(id, league, ctx, m?.playersPoints[id]));
    return { rosterId: roster.rosterId, name: teamName(roster, users), rows: r, dist: lineupDist(r, ctx.now) };
  };

  let opponent: TeamSide | undefined;
  if (myMatchup?.matchupId != null) {
    const opp = matchups.find((m) => m.matchupId === myMatchup.matchupId && m.rosterId !== myRoster.rosterId);
    const oppRoster = opp ? rosters.find((r) => r.rosterId === opp.rosterId) : undefined;
    if (oppRoster) opponent = sideFor(oppRoster);
  }

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
    problems: [],
    uncoveredKeys: uncoveredScoringKeys(league.scoring, ctx.projections.statKeys),
  };
  if (opponent) {
    analysis.opponent = opponent;
    analysis.winProbCurrent = winProbability(meCurrentDist, opponent.dist);
    analysis.winProbRecommended = winProbability(me.dist, opponent.dist);
  }
  if (league.rules.medianGame && rosters.length > 2) {
    const others = rosters.filter((r) => r.rosterId !== myRoster.rosterId).map((r) => sideFor(r).dist);
    analysis.medianProb = probBeatAtLeast(me.dist, others, Math.floor(rosters.length / 2));
  }
  analysis.problems = lineupProblems(analysis, reshuffled, league, myRoster);
  return analysis;
}

function lineupProblems(a: LineupAnalysis, reshuffled: boolean, league: League, roster: Roster): Problem[] {
  const out: Problem[] = [];
  // The summary leads: it's the actionable line when a card shows only the top few problems.
  if (a.gain >= 0.5) out.push({ level: 'warn', text: `Better lineup available: +${a.gain.toFixed(1)} expected points` });
  else if (reshuffled && a.gain > 0.05) out.push({ level: 'info', text: `Slot reshuffle adds +${a.gain.toFixed(1)} via late-swap flexibility` });
  a.current.forEach((row, s) => {
    const slot = a.slots[s]!;
    if (!row) out.push({ level: 'error', text: `Empty ${slot} slot` });
    else if (row.locked) return;
    else if (row.kickoff === null) out.push({ level: 'error', text: `${row.name} (${slot}) has no game this week` });
    else if (row.p === 0) out.push({ level: 'error', text: `${row.name} (${slot}) is ${row.injury ?? 'not expected to play'}` });
    else if (row.p < 0.95) out.push({ level: 'warn', text: `${row.name} (${slot}) is ${row.injury}${row.practice ? `, ${row.practice} practice` : ''} — ${Math.round(row.p * 100)}% to play` });
  });
  const freeIr = league.rules.reserveSlots - roster.reserve.length;
  if (freeIr > 0) {
    const irEligible = a.bench.filter((r) => r.injury && ['IR', 'Out', 'PUP', 'Sus', 'NA', 'DNR', 'COV', 'Doubtful'].includes(r.injury) && league.rules.reserveAllow[irKey(r.injury)] !== false);
    if (irEligible.length) out.push({ level: 'info', text: `${irEligible[0]!.name} (${irEligible[0]!.injury}) could move to IR to free a bench spot` });
  }
  if (a.uncoveredKeys.length) out.push({ level: 'info', text: `Scoring keys without projections: ${a.uncoveredKeys.join(', ')}` });
  return out;
}

const irKey = (status: string) => (status === 'Doubtful' ? 'doubtful' : status === 'Out' ? 'out' : status === 'Sus' ? 'sus' : status === 'NA' ? 'na' : status === 'DNR' ? 'dnr' : status === 'COV' ? 'cov' : 'ir');

export interface WaiverRow {
  player: PlayerRow;
  /** Gain in this week's best lineup (expected points) if added. */
  gainThisWeek: number;
  trendingAdds?: number;
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
  const allSlots = startingSlots(league.rosterPositions);
  const rostered = new Set(rosters.flatMap((r) => [...r.players, ...r.reserve, ...r.taxi]));
  const unavailable = new Set([...myRoster.reserve, ...myRoster.taxi]);
  const mine = myRoster.players.filter((id) => !unavailable.has(id)).map((id) => playerRow(id, league, ctx));
  // Starters whose games have started keep their slots; only the open slots can still improve.
  const lockedIds = new Set(mine.filter((r) => r.locked).map((r) => r.id));
  const slots = allSlots.filter((_, s) => !lockedIds.has(myRoster.starters[s] ?? ''));
  const pool = mine.filter((r) => !r.locked);
  const fillable = (r: PlayerRow) => slots.some((s) => canFill(s, r.fpos));

  const best = (rows: readonly PlayerRow[]) =>
    bestAssignment(slots.length, rows.length, (s, i) => (canFill(slots[s]!, rows[i]!.fpos) ? rows[i]!.ev : null)).total;
  const baseline = best(pool);

  const candidates = [...ctx.projections.byPlayer.keys()]
    .filter((id) => !rostered.has(id))
    .map((id) => playerRow(id, league, ctx))
    .filter((r) => r.hasProjection && !r.locked && fillable(r) && (r.ev > 0.5 || trending.has(r.id)))
    .sort((a, b) => b.ev - a.ev)
    .slice(0, 80);

  return candidates
    .map((r) => {
      const row: WaiverRow = { player: r, gainThisWeek: Math.max(0, best([...pool, r]) - baseline) };
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
