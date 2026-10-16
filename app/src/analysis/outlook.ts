import type { League, LeagueUser, Matchup, Roster } from '../domain/types';
import { winProbability, type Dist } from '../engine/winprob';
import type { ProjectionIndex } from '../sleeper/parse';
import type { RawTransaction } from '../sleeper/raw';
import { playerRow, rosteredIds, startable, teamName, teamSide, thisWeekGain, type PlayerRow, type WeekContext } from './analyze';
import { faabMarket, suggestBid, tierOf, type BidAdvice, type FaabMarket } from './faab';
import { activeIds, addGains, cheapestDrops, playoffRoundWeeks, regularSeasonEnd, RosModel, rosterLimit, seasonEnd, teamDrift, teamIds, weekWeights } from './ros';
import { simulateSeason, type SeasonTeam, type TeamOdds } from './season';

export interface OutlookInput {
  league: League;
  rosters: readonly Roster[];
  users: readonly LeagueUser[];
  /** This week's matchups (starters, points so far). */
  matchups: readonly Matchup[];
  ctx: WeekContext;
  /** Projections for future weeks. */
  byWeek: ReadonlyMap<number, ProjectionIndex>;
  /** Pairings for future weeks. */
  schedule: ReadonlyMap<number, readonly Matchup[]>;
  sims?: number;
}

export interface TeamOutlook {
  rosterId: number;
  name: string;
  roster: Roster;
  /** Best-lineup points for each future week (aligned with `LeagueOutlook.weeks`). */
  future: Dist[];
  /** Score distribution for each regular-season week still to decide (aligned with `regularWeeks`). */
  regular: Dist[];
  /** Weights of future weeks in this team's rest-of-season values. */
  weights: number[];
  /** Opponent's roster id in each future week (null = no game or unknown). */
  opponents: Array<number | null>;
  /** Weekly SD of the team's persistent drift in the season simulation (ros.ts teamDrift). */
  drift: number;
}

export interface LeagueOutlook {
  league: League;
  model: RosModel;
  /** Future weeks valued: next week through the end of the season. */
  weeks: number[];
  /** Regular-season weeks still to decide (the current one included until it's scored). */
  regularWeeks: number[];
  teams: Map<number, TeamOutlook>;
  /** Simulated standings; absent once the regular season is over. */
  odds?: Map<number, TeamOdds>;
  /** Each playoff round's indices into `weeks`, while the whole bracket is ahead: the simulation then plays it out. */
  playoffRounds?: number[][];
  pairings: Map<number, Map<number, number | null>>;
  sims: number;
}

const range = (from: number, to: number) => Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);

export function buildOutlook(input: OutlookInput): LeagueOutlook {
  const { league, ctx, rosters } = input;
  const regEnd = regularSeasonEnd(league);
  const weeks = range(ctx.week + 1, seasonEnd(league));
  const model = new RosModel({ league, weeks, currentWeek: ctx.week, byWeek: input.byWeek, players: ctx.players });
  const currentScored = (league.rules.lastScoredWeek ?? 0) >= ctx.week;
  const includeCurrent = !currentScored && ctx.week <= regEnd;
  const futureRegular = weeks.filter((w) => w <= regEnd);
  const regularWeeks = [...(includeCurrent ? [ctx.week] : []), ...futureRegular];

  const pairings = new Map<number, Map<number, number | null>>();
  const addPairings = (w: number, ms: readonly Matchup[]) => pairings.set(w, new Map(ms.map((m) => [m.rosterId, m.matchupId])));
  addPairings(ctx.week, input.matchups);
  for (const [w, ms] of input.schedule) addPairings(w, ms);

  const teams = new Map<number, TeamOutlook>();
  for (const roster of rosters) {
    const ids = teamIds(roster);
    const future = weeks.map((_, i) => model.bestWeek(ids, i));
    const regular = [...(includeCurrent ? [teamSide(league, roster, input.users, input.matchups, ctx).dist] : []), ...future.slice(0, futureRegular.length)];
    const opponents = weeks.map((w) => opponentOf(pairings.get(w), roster.rosterId));
    const drift = teamDrift(model, ids);
    teams.set(roster.rosterId, { rosterId: roster.rosterId, name: teamName(roster, input.users), roster, future, regular, weights: [], opponents, drift });
  }

  const sims = input.sims ?? 4000;
  const outlook: LeagueOutlook = { league, model, weeks, regularWeeks, teams, pairings, sims };
  const rounds = playoffRoundWeeks(league, weeks);
  if (rounds) outlook.playoffRounds = rounds;
  if (regularWeeks.length) outlook.odds = simulate(outlook, new Map());
  const fallback = league.rules.playoffTeams && league.rules.numTeams ? Math.min(1, league.rules.playoffTeams / league.rules.numTeams) : 1;
  for (const t of teams.values()) t.weights = weekWeights(league, weeks, outlook.odds?.get(t.rosterId), fallback);
  return outlook;
}

/** A team's score in each playoff round: the round's weeks added up (independent weeks). */
function roundDists(future: readonly Dist[], rounds: readonly number[][]): Dist[] {
  return rounds.map((idx) =>
    idx.reduce((d, i) => ({ mean: d.mean + future[i]!.mean, variance: d.variance + future[i]!.variance }), { mean: 0, variance: 0 }),
  );
}

function opponentOf(pairs: ReadonlyMap<number, number | null> | undefined, rosterId: number): number | null {
  const mid = pairs?.get(rosterId);
  if (pairs === undefined || mid == null) return null;
  for (const [rid, m] of pairs) if (m === mid && rid !== rosterId) return rid;
  return null;
}

/**
 * Simulate the rest of the regular season, and the playoff bracket while all of it is ahead; `override` swaps
 * in other future-week distributions (and drifts) for some teams.
 */
function simulate(o: LeagueOutlook, override: ReadonlyMap<number, { future: Dist[]; drift: number }>): Map<number, TeamOdds> {
  const futureCount = o.regularWeeks.filter((w) => o.weeks.includes(w)).length;
  const current = o.regularWeeks.length - futureCount; // 1 while this week's result is still open
  const rounds = o.playoffRounds;
  const teams: SeasonTeam[] = [...o.teams.values()].map((t) => {
    const swap = override.get(t.rosterId);
    const future = swap?.future;
    const weeks = future ? [...t.regular.slice(0, current), ...future.slice(0, futureCount)] : t.regular;
    const r = t.roster;
    const team: SeasonTeam = { rosterId: t.rosterId, wins: r.wins, losses: r.losses, ties: r.ties, pointsFor: r.pointsFor, weeks, drift: swap?.drift ?? t.drift };
    if (rounds) team.playoff = roundDists(future ?? t.future, rounds);
    return team;
  });
  return simulateSeason({
    teams,
    weeks: o.regularWeeks,
    pairings: o.pairings,
    medianGame: o.league.rules.medianGame,
    playoffTeams: o.league.rules.playoffWeekStart ? (o.league.rules.playoffTeams ?? 0) : 0,
    ...(rounds ? { playoffRounds: rounds.length, reseed: o.league.rules.playoffSeedType === 1, playoffRoundWeeks: rounds.map((r) => r.length) } : {}),
    // This week's projections (and, once it's scored, next week's) are fresh; the drift starts after them.
    freshWeeks: 1,
    sims: o.sims,
  });
}

/** Win probability in each future week against the scheduled opponent (best lineups on both sides). */
export function scheduleOutlook(o: LeagueOutlook, rosterId: number): Array<{ week: number; opponent: number | null; winProb: number | null; mean: number }> {
  const me = o.teams.get(rosterId);
  if (!me) return [];
  return o.weeks.map((week, i) => {
    const oppId = me.opponents[i] ?? null;
    const opp = oppId === null ? undefined : o.teams.get(oppId);
    return { week, opponent: oppId, winProb: opp ? winProbability(me.future[i]!, opp.future[i]!) : null, mean: me.future[i]!.mean };
  });
}

// ---- Waivers -----------------------------------------------------------------------------------

export interface WaiverAdvice {
  player: PlayerRow;
  gainThisWeek: number;
  /** Weighted rest-of-season points added (after the suggested drop). */
  rosGain: number;
  drop?: PlayerRow;
  bid?: BidAdvice;
  trendingAdds?: number;
}

export interface WaiverBoard {
  rows: WaiverAdvice[];
  market: FaabMarket | null;
  remaining?: number;
  openSpots: number;
}

/** Free agents ranked by this week's gain plus rest-of-season gain, with a drop and a FAAB bid. */
export function waiverBoard(
  o: LeagueOutlook,
  myRoster: Roster,
  ctx: WeekContext,
  trending: ReadonlyMap<string, number>,
  claims: readonly RawTransaction[],
  limit = 25,
): WaiverBoard {
  const { league, model } = o;
  const rostered = rosteredIds([...o.teams.values()].map((t) => t.roster));
  // Cheap prefilter: anyone projected this week, any future week (cached rows skip near-zero players), or trending.
  const ids = new Set<string>();
  for (const [id, p] of ctx.projections.byPlayer) if (roughPoints(p.stats) >= 1) ids.add(id);
  for (let i = 0; i < model.weeks.length; i++) for (const id of model.projected(i)) ids.add(id);
  for (const id of trending.keys()) ids.add(id);
  const free = [...ids].filter((id) => !rostered.has(id) && startable(league, fposOf(o, ctx, id)));
  const rows = new Map(free.map((id) => [id, playerRow(id, league, ctx)]));
  const byWeekEv = [...free].sort((a, b) => rows.get(b)!.ev - rows.get(a)!.ev).slice(0, 60);
  const byRos = [...free].sort((a, b) => model.total(b) - model.total(a)).slice(0, 60);
  const pool = [...new Set([...byWeekEv, ...byRos, ...free.filter((id) => trending.has(id))])].filter((id) => !rows.get(id)!.locked || model.total(id) > 0);

  const gainNow = thisWeekGain(league, myRoster, ctx);
  const me = o.teams.get(myRoster.rosterId)!;
  const active = activeIds(myRoster);
  const lockedIds = new Set(active.filter((id) => playerRow(id, league, ctx).locked));
  const openSpots = Math.max(0, rosterLimit(league) - active.length);
  const gains = new Map(addGains(model, teamIds(myRoster), active.filter((id) => !lockedIds.has(id)), openSpots, pool, me.weights).map((g) => [g.id, g]));

  const fab = league.rules.waiverType === 2 && league.rules.waiverBudget ? league.rules.waiverBudget : 0;
  const posOf = (id: string) => ctx.players.get(id)?.pos ?? model.player(id)?.pos;
  const market = fab ? faabMarket(claims, fab, posOf) : null;
  const remaining = fab ? Math.max(0, fab - myRoster.waiverBudgetUsed) : undefined;
  const others = [...o.teams.values()].map((t) => Math.max(0, fab - t.roster.waiverBudgetUsed));
  const avgRemaining = others.length ? others.reduce((a, b) => a + b, 0) / others.length : 0;
  // Market tier: rank among available players at the same position by rest-of-season points.
  const tierRank = new Map<string, number>();
  const seen = new Map<string, number>();
  for (const id of [...free].sort((a, b) => model.total(b) - model.total(a))) {
    const pos = posOf(id) ?? '?';
    tierRank.set(id, seen.get(pos) ?? 0);
    seen.set(pos, (seen.get(pos) ?? 0) + 1);
  }

  const out: WaiverAdvice[] = pool.map((id) => {
    const player = rows.get(id)!;
    const g = gains.get(id);
    const row: WaiverAdvice = { player, gainThisWeek: gainNow(player), rosGain: Math.max(0, g?.gain ?? 0) };
    if (g?.drop) row.drop = playerRow(g.drop, league, ctx);
    if (market && remaining !== undefined)
      row.bid = suggestBid(market, player.pos, tierOf(tierRank.get(id) ?? 99), row.rosGain, remaining, avgRemaining, league.rules.waiverBidMin ?? 0);
    const t = trending.get(id);
    if (t !== undefined) row.trendingAdds = t;
    return row;
  });
  out.sort((a, b) => b.gainThisWeek + b.rosGain - (a.gainThisWeek + a.rosGain) || (b.trendingAdds ?? 0) - (a.trendingAdds ?? 0));
  const board: WaiverBoard = { rows: out.slice(0, limit), market, openSpots };
  if (remaining !== undefined) board.remaining = remaining;
  return board;
}

/** Sleeper's own fantasy points on a projection row, for prefiltering (IDP rows have none: keep them). */
function roughPoints(stats: Readonly<Record<string, number>>): number {
  return stats.pts_ppr ?? stats.pts_half_ppr ?? stats.pts_std ?? (Object.keys(stats).length ? 1 : 0);
}

function fposOf(o: LeagueOutlook, ctx: WeekContext, id: string): readonly string[] {
  const f = o.model.fpos(id);
  return f.length ? f : (ctx.players.get(id)?.fpos ?? []);
}

// ---- Trades ------------------------------------------------------------------------------------

export interface ByeWeek {
  week: number;
  /** Regular starters on the roster after the trade whose NFL team is off this week. */
  byes: string[];
  /** Best-lineup expected points before and after the trade. */
  before: number;
  after: number;
  /** Starting slots nobody with a game can fill. */
  openBefore: number;
  openAfter: number;
}

/** Players who start in at least half the weeks they play: their bye weeks are the ones that hurt. */
export function regularStarters(model: RosModel, ids: readonly string[]): Set<string> {
  const starts = new Map<string, number>();
  const plays = new Map<string, number>();
  for (let i = 0; i < model.weeks.length; i++) {
    for (const id of model.lineupWeek(ids, i).starters) starts.set(id, (starts.get(id) ?? 0) + 1);
    for (const id of ids) if (model.ev(id)[i]! > 0) plays.set(id, (plays.get(id) ?? 0) + 1);
  }
  return new Set(ids.filter((id) => (plays.get(id) ?? 0) > 0 && (starts.get(id) ?? 0) / plays.get(id)! >= 0.5));
}

/** Week by week: who's on bye, and the lineup before and after a roster change. */
export function byeGrid(model: RosModel, before: readonly string[], after: readonly string[]): ByeWeek[] {
  const regulars = [...regularStarters(model, after)];
  return model.weeks.map((week, i) => {
    const b = model.lineupWeek(before, i);
    const a = model.lineupWeek(after, i);
    return { week, byes: regulars.filter((id) => model.onBye(id, i)), before: b.mean, after: a.mean, openBefore: b.open, openAfter: a.open };
  });
}

export interface TradeSideResult {
  rosterId: number;
  name: string;
  /** Week-by-week byes and lineup points before and after. */
  byes: ByeWeek[];
  /** Weighted rest-of-season points before and after (incl. forced drops and open-spot adds). */
  before: number;
  after: number;
  delta: number;
  /** Change in best-lineup expected points per future week. */
  weekly: number[];
  drops: string[];
  adds: string[];
  pBefore?: number;
  pAfter?: number;
  /** Chance of winning the title, while the whole bracket is ahead. */
  titleBefore?: number;
  titleAfter?: number;
  /** For leagues without playoffs: chance of finishing first. */
  firstBefore?: number;
  firstAfter?: number;
}

export interface TradeResult {
  me: TradeSideResult;
  them: TradeSideResult;
  deadlinePassed: boolean;
}

/** Evaluate `give` (from my roster) for `get` (from theirs) over the rest of the season, for both teams. */
export function evaluateTrade(o: LeagueOutlook, ctx: WeekContext, myId: number, theirId: number, give: readonly string[], get: readonly string[], freeAgents: readonly string[]): TradeResult {
  const me = o.teams.get(myId)!;
  const them = o.teams.get(theirId)!;
  const locked = (id: string) => playerRow(id, o.league, ctx).locked;
  const side = (t: TeamOutlook, out: readonly string[], inn: readonly string[], taken: Set<string>) => {
    const before = teamIds(t.roster);
    let after = [...before.filter((id) => !out.includes(id)), ...inn];
    const activeBefore = activeIds(t.roster);
    const active = [...activeBefore.filter((id) => !out.includes(id)), ...inn];
    const limit = rosterLimit(o.league);
    let drops: string[] = [];
    const adds: string[] = [];
    if (active.length > limit) {
      drops = cheapestDrops(o.model, after, active.filter((id) => !locked(id)), active.length - limit, t.weights);
      after = after.filter((id) => !drops.includes(id));
    } else {
      // Only spots the trade frees: spots already open before it are open either way.
      const freed = Math.max(0, limit - active.length) - Math.max(0, limit - activeBefore.length);
      for (let open = freed; open > 0; open--) {
        const pool = freeAgents.filter((id) => !taken.has(id));
        const best = addGains(o.model, after, [], 1, pool, t.weights).sort((a, b) => b.gain - a.gain)[0];
        if (!best || best.gain <= 0) break;
        adds.push(best.id);
        taken.add(best.id);
        after.push(best.id);
      }
    }
    const beforeVal = o.model.value(before, t.weights);
    const afterVal = o.model.value(after, t.weights);
    const futureAfter = o.weeks.map((_, i) => o.model.bestWeek(after, i));
    const res: TradeSideResult = {
      rosterId: t.rosterId,
      name: t.name,
      byes: byeGrid(o.model, before, after),
      before: beforeVal,
      after: afterVal,
      delta: afterVal - beforeVal,
      weekly: futureAfter.map((d, i) => d.mean - t.future[i]!.mean),
      drops,
      adds,
    };
    return { res, futureAfter, drift: teamDrift(o.model, after) };
  };
  const taken = new Set<string>();
  const a = side(me, give, get, taken);
  const b = side(them, get, give, taken);
  if (o.odds) {
    const after = simulate(
      o,
      new Map([
        [myId, { future: a.futureAfter, drift: a.drift }],
        [theirId, { future: b.futureAfter, drift: b.drift }],
      ]),
    );
    const fill = (r: TradeSideResult) => {
      const pre = o.odds!.get(r.rosterId)!;
      const post = after.get(r.rosterId)!;
      if (o.league.rules.playoffWeekStart) {
        r.pBefore = pre.pPlayoffs;
        r.pAfter = post.pPlayoffs;
        if (pre.pTitle !== undefined && post.pTitle !== undefined) {
          r.titleBefore = pre.pTitle;
          r.titleAfter = post.pTitle;
        }
      } else {
        r.firstBefore = pre.pFirst;
        r.firstAfter = post.pFirst;
      }
    };
    fill(a.res);
    fill(b.res);
  }
  const deadline = o.league.rules.tradeDeadline;
  return { me: a.res, them: b.res, deadlinePassed: deadline !== undefined && deadline > 0 && ctx.week > deadline };
}

/** Free agents worth considering as fillers, best rest-of-season value first. */
export function freeAgentPool(o: LeagueOutlook, ctx: WeekContext, size = 40): string[] {
  const rostered = rosteredIds([...o.teams.values()].map((t) => t.roster));
  const ids = new Set<string>();
  for (let i = 0; i < o.weeks.length; i++) for (const id of o.model.projected(i)) ids.add(id);
  return [...ids]
    .filter((id) => !rostered.has(id) && startable(o.league, fposOf(o, ctx, id)))
    .sort((a, b) => o.model.total(b) - o.model.total(a))
    .slice(0, size);
}

// ---- Streaming ---------------------------------------------------------------------------------

export interface StreamRow {
  player: PlayerRow;
  /** Expected points in the next weeks (aligned with `LeagueOutlook.weeks`). */
  next: number[];
  mine: boolean;
}

/** DEF or K options: yours plus the best free agents, by this week and the next two. */
export function streamers(o: LeagueOutlook, myRoster: Roster, ctx: WeekContext, pos: 'DEF' | 'K', count = 6): StreamRow[] {
  const { league, model } = o;
  if (!startable(league, [pos])) return [];
  const rostered = rosteredIds([...o.teams.values()].map((t) => t.roster));
  const ids = new Set<string>([...ctx.projections.byPlayer.keys(), ...(o.weeks.length ? model.projected(0) : [])]);
  const isPos = (id: string) => (ctx.players.get(id)?.pos ?? model.player(id)?.pos) === pos;
  const horizon = (id: string) => model.ev(id).slice(0, 2);
  const row = (id: string, mine: boolean): StreamRow => ({ player: playerRow(id, league, ctx), next: [...horizon(id)], mine });
  const mine = myRoster.players.filter(isPos).map((id) => row(id, true));
  const score = (r: StreamRow) => r.player.ev + r.next.reduce((a, b) => a + b, 0);
  const free = [...ids]
    .filter((id) => isPos(id) && !rostered.has(id))
    .map((id) => row(id, false))
    .sort((a, b) => score(b) - score(a))
    .slice(0, count);
  return [...mine, ...free];
}
