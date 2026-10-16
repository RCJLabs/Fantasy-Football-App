import type { WeekContext } from './analyze';
import { evaluateTrade, type LeagueOutlook, type TeamOutlook, type TradeResult } from './outlook';
import { activeIds, rosterLimit, teamIds, type RosModel } from './ros';

/** A trade worth proposing: both sides' best lineups gain over the rest of the season. */
export interface TradeIdea {
  partner: number;
  give: string[];
  get: string[];
  /** Weighted rest-of-season points each side gains (the trade tab's full evaluation, with drops and fills). */
  mine: number;
  theirs: number;
  result: TradeResult;
}

export interface FinderOptions {
  /** Players per team considered: each team's most valuable QB/RB/WR/TE by rest-of-season points. */
  depth?: number;
  /** Ideas returned. */
  limit?: number;
  /** Least gain for me, and for them, for an idea to count (weighted rest-of-season points). */
  minMine?: number;
  minTheirs?: number;
  /** Also try two of mine for one of theirs, and one of mine for two of theirs. */
  uneven?: boolean;
  /** Ideas per partner, and per player I'd give up (variety over near-duplicates). */
  perPartner?: number;
  /** Called after each team is searched, for progress. */
  onProgress?: (done: number, total: number) => void;
}

const TRADED = new Set(['QB', 'RB', 'WR', 'TE']);

interface Side {
  team: TeamOutlook;
  ids: string[];
  base: number;
  /** Players worth trading: the team's most valuable QB/RB/WR/TE. */
  pool: string[];
  /** What losing each active player costs this team: the cheapest go first when a trade overfills the roster. */
  cost: Map<string, number>;
  /** Active roster spots still open. */
  open: number;
}

function side(model: RosModel, team: TeamOutlook, depth: number, spots: number): Side {
  const ids = teamIds(team.roster);
  const active = activeIds(team.roster);
  const base = model.value(ids, team.weights);
  const pool = ids
    .filter((id) => TRADED.has(model.player(id)?.pos ?? ''))
    .sort((a, b) => model.total(b) - model.total(a))
    .slice(0, depth);
  const cost = new Map(active.map((id) => [id, base - model.value(ids.filter((x) => x !== id), team.weights)]));
  return { team, ids, base, pool, cost, open: Math.max(0, spots - active.length) };
}

/**
 * A side's weighted rest-of-season change from a trade, for screening: its best lineups after the swap, less its
 * cheapest players (by what losing them cost before the trade) when it ends up with more than its spots.
 */
function change(model: RosModel, s: Side, out: readonly string[], inn: readonly string[]): number {
  let ids = [...s.ids.filter((id) => !out.includes(id)), ...inn];
  const over = inn.length - out.length - s.open;
  if (over > 0) {
    const drops = [...s.cost].filter(([id]) => !out.includes(id)).sort((a, b) => a[1] - b[1]).slice(0, over).map(([id]) => id);
    ids = ids.filter((id) => !drops.includes(id));
  }
  return model.value(ids, s.team.weights) - s.base;
}

/**
 * Trades with every other team that improve both best lineups over the rest of the season, best for me first.
 *
 * Search: one-for-one swaps among each team's most valuable QB/RB/WR/TE, plus two-for-one either way when the one
 * is worth more than either of the two (a consolidation). Every candidate is scored on both rosters' weighted
 * best-lineup points; their side first, since most candidates fail it. The best few then get the trade tab's full
 * evaluation (forced drops, free-agent fills, ranges, playoff odds), which is what's reported.
 */
export async function findTrades(o: LeagueOutlook, ctx: WeekContext, myId: number, freeAgents: readonly string[], opts: FinderOptions = {}): Promise<TradeIdea[]> {
  const { model } = o;
  const depth = opts.depth ?? 8;
  const limit = opts.limit ?? 6;
  const minMine = opts.minMine ?? 3;
  const minTheirs = opts.minTheirs ?? 0;
  const spots = rosterLimit(o.league);
  const meTeam = o.teams.get(myId);
  if (!meTeam || !o.weeks.length) return [];
  const me = side(model, meTeam, depth, spots);
  const others = [...o.teams.values()].filter((t) => t.rosterId !== myId);

  type Candidate = { partner: number; give: string[]; get: string[]; mine: number; theirs: number };
  const found: Candidate[] = [];
  for (let k = 0; k < others.length; k++) {
    const them = side(model, others[k]!, depth, spots);
    const tries: Array<[string[], string[]]> = [];
    for (const p of me.pool) for (const q of them.pool) tries.push([[p], [q]]);
    if (opts.uneven ?? true) {
      const pairs = (pool: string[]) => pool.flatMap((a, i) => pool.slice(i + 1).map((b) => [a, b] as [string, string]));
      for (const [a, b] of pairs(me.pool)) for (const q of them.pool) if (model.total(q) > Math.max(model.total(a), model.total(b))) tries.push([[a, b], [q]]);
      for (const [a, b] of pairs(them.pool)) for (const p of me.pool) if (model.total(p) > Math.max(model.total(a), model.total(b))) tries.push([[p], [a, b]]);
    }
    for (const [give, get] of tries) {
      const theirs = change(model, them, get, give);
      if (theirs < minTheirs) continue;
      const mine = change(model, me, give, get);
      if (mine >= minMine) found.push({ partner: them.team.rosterId, give, get, mine, theirs });
    }
    opts.onProgress?.(k + 1, others.length);
    // Let the page breathe between teams.
    await new Promise((r) => setTimeout(r, 0));
  }

  // Best for me first; at most two ideas per partner, and each player I'd give up at most twice.
  found.sort((a, b) => b.mine - a.mine || b.theirs - a.theirs);
  const cap = opts.perPartner ?? 2;
  const perPartner = new Map<number, number>();
  const perPlayer = new Map<string, number>();
  const shortlist: Candidate[] = [];
  for (const c of found) {
    if ((perPartner.get(c.partner) ?? 0) >= cap || c.give.some((id) => (perPlayer.get(id) ?? 0) >= cap)) continue;
    shortlist.push(c);
    perPartner.set(c.partner, (perPartner.get(c.partner) ?? 0) + 1);
    for (const id of c.give) perPlayer.set(id, (perPlayer.get(id) ?? 0) + 1);
    if (shortlist.length >= limit * 2) break;
  }
  const ideas: TradeIdea[] = [];
  for (const c of shortlist) {
    const result = evaluateTrade(o, ctx, myId, c.partner, c.give, c.get, freeAgents);
    if (result.me.delta >= minMine && result.them.delta >= minTheirs) ideas.push({ ...c, mine: result.me.delta, theirs: result.them.delta, result });
  }
  return ideas.sort((a, b) => b.mine - a.mine).slice(0, limit);
}
