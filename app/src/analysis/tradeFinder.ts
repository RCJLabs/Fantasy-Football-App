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

/** Positions traded on lineup value: kickers and defenses are streamed. */
export const TRADED = new Set(['QB', 'RB', 'WR', 'TE']);

/** Market value one side gets beyond which the other may see a trade as lopsided: 1.4× what it gives. [design] */
export const LOPSIDED = 1.4;

const pairs = (pool: readonly string[]) => pool.flatMap((a, i) => pool.slice(i + 1).map((b) => [a, b] as [string, string]));

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
export async function findTrades(o: LeagueOutlook, ctx: WeekContext, myId: number, opts: FinderOptions = {}): Promise<TradeIdea[]> {
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
    const result = evaluateTrade(o, ctx, myId, c.partner, c.give, c.get);
    if (result.me.delta >= minMine && result.them.delta >= minTheirs) ideas.push({ ...c, mine: result.me.delta, theirs: result.them.delta, result });
  }
  return ideas.sort((a, b) => b.mine - a.mine).slice(0, limit);
}

export interface PackageOptions {
  /** My players considered: my most valuable QBs, RBs, WRs and TEs by rest-of-season points. */
  depth?: number;
  /** Packages returned. */
  limit?: number;
  /** Least gain for me (weighted rest-of-season points) for a package to count. */
  minMine?: number;
  /** Market values by player (FantasyCalc), when loaded: packages they'd see as lopsided go last. */
  market?: ReadonlyMap<string, { value: number }> | null;
}

/** Market values given and received; players without one count as nothing. */
export interface PackageMarket {
  give: number;
  get: number;
  /** Players given who have no market value. */
  unvalued: number;
}

/** One way to get the target: the trade, plus market values when his is known. */
export interface TargetPackage extends TradeIdea {
  market?: PackageMarket;
}

export interface TargetSearch {
  partner: number;
  /** Weeks ahead he'd be in my best lineup if I added him to my roster as it is, out of all the weeks ahead. */
  starts: number;
  weeks: number;
  /** Packages of one or two of my players that both best lineups gain from: fair-looking first, then cheapest for me. */
  packages: TargetPackage[];
  /** When there are none: the packages their lineup gains from that cost mine least. */
  closest: TargetPackage[];
}

/**
 * What it would take to get one player from another team: the trade finder turned around. Every package of one or two
 * of my most valuable QBs, RBs, WRs and TEs for him is screened on both rosters' weighted best-lineup points, their
 * side first. Packages both sides gain from are kept, each of my players in at most two, and the best get the trade
 * tab's evaluation, which is what's reported. "Cheapest" is in my lineup's terms: the most points left over after the
 * trade. With market values, packages that give them under 1/1.4 of his market value go last. As in the trade tab, no
 * free agent fills a spot a package opens.
 */
export async function findPackages(o: LeagueOutlook, ctx: WeekContext, myId: number, target: string, opts: PackageOptions = {}): Promise<TargetSearch | null> {
  const { model } = o;
  const meTeam = o.teams.get(myId);
  const partner = [...o.teams.values()].find((t) => t.rosterId !== myId && teamIds(t.roster).includes(target));
  if (!meTeam || !partner || !o.weeks.length) return null;
  const limit = opts.limit ?? 5;
  const minMine = opts.minMine ?? 1;
  const spots = rosterLimit(o.league);
  const me = side(model, meTeam, opts.depth ?? 12, spots);
  const them = side(model, partner, 0, spots);
  const marketOf = (give: readonly string[]): PackageMarket | undefined => {
    const m = opts.market;
    const get = m?.get(target)?.value;
    if (!m || !get) return undefined;
    return { give: give.reduce((a, id) => a + (m.get(id)?.value ?? 0), 0), get, unvalued: give.filter((id) => !m.get(id)?.value).length };
  };
  const light = (c: { market?: PackageMarket }) => (c.market && c.market.get > c.market.give * LOPSIDED ? 1 : 0);
  const order = <T extends { mine: number; market?: PackageMarket }>(a: T, b: T) => light(a) - light(b) || b.mine - a.mine;

  type Candidate = { give: string[]; mine: number; theirs: number; market?: PackageMarket };
  // Players with no rest-of-season value add nothing to a package.
  const pool = me.pool.filter((id) => model.total(id) > 0);
  const theyGain: Candidate[] = [];
  for (const give of [...pool.map((p) => [p]), ...pairs(pool)]) {
    const theirs = change(model, them, [target], give);
    if (theirs < 0) continue;
    const market = marketOf(give);
    theyGain.push({ give, theirs, mine: change(model, me, give, [target]), ...(market ? { market } : {}) });
  }
  const evaluate = async (list: readonly Candidate[]): Promise<TargetPackage[]> => {
    const out: TargetPackage[] = [];
    for (const c of list) {
      const result = evaluateTrade(o, ctx, myId, partner.rosterId, c.give, [target]);
      out.push({ partner: partner.rosterId, give: c.give, get: [target], mine: result.me.delta, theirs: result.them.delta, result, ...(c.market ? { market: c.market } : {}) });
      // The evaluation simulates the season: let the page breathe between packages.
      await new Promise((r) => setTimeout(r, 0));
    }
    return out;
  };
  const ok = (p: TargetPackage) => p.mine >= minMine && p.theirs >= 0;

  // Each of my players in at most two packages, for variety.
  const perPlayer = new Map<string, number>();
  const shortlist: Candidate[] = [];
  for (const c of theyGain.filter((x) => x.mine >= minMine).sort(order)) {
    if (c.give.some((id) => (perPlayer.get(id) ?? 0) >= 2)) continue;
    shortlist.push(c);
    for (const id of c.give) perPlayer.set(id, (perPlayer.get(id) ?? 0) + 1);
    if (shortlist.length >= limit * 2) break;
  }
  const evaluated = await evaluate(shortlist);
  let packages = evaluated.filter(ok).sort(order).slice(0, limit);
  let closest: TargetPackage[] = [];
  if (!packages.length) {
    // None passed: also evaluate the few their side gains from that screen best for mine, and report the closest.
    const seen = new Set(shortlist);
    const all = [...evaluated, ...(await evaluate([...theyGain].sort((a, b) => b.mine - a.mine).filter((c) => !seen.has(c)).slice(0, 3)))];
    packages = all.filter(ok).sort(order).slice(0, limit);
    if (!packages.length) closest = all.filter((p) => p.theirs >= 0).sort((a, b) => b.mine - a.mine).slice(0, 3);
  }
  const withHim = [...me.ids, target];
  const starts = o.weeks.filter((_, i) => model.lineupWeek(withHim, i).starters.includes(target)).length;
  return { partner: partner.rosterId, starts, weeks: o.weeks.length, packages, closest };
}
