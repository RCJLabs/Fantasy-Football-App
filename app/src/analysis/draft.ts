// Draft helper (docs/draft.md): next season's board under this league's scoring, value over replacement, predicted
// keepers, the pick order, and a mock draft in which the other teams draft from the same board with noise.
import type { NextSeasonFile, NextSeasonRookie } from '../data/contracts';
import type { League, Player, Roster } from '../domain/types';
import type { RawDraft, RawDraftPick, RawTradedPick } from '../sleeper/raw';
import { canFill, SLOT_ELIGIBILITY } from '../engine/lineup';
import { projectedPoints } from '../engine/scoring';
import { gradeValues, type PartGrade, zScale } from './grades';
import { mulberry32 } from './season';

/** Positions the next-season file projects. IDP isn't projected. */
export const DRAFT_POSITIONS: readonly string[] = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

export interface BoardPlayer {
  /** Sleeper player id; `rookie:RB:1` for a rookie placeholder. */
  id: string;
  name: string;
  pos: string;
  fpos: readonly string[];
  team: string | null;
  age?: number;
  /** No contract past this season on record. */
  fa?: boolean;
  /** Chance he plays for another team next season. */
  chg?: number;
  /** A rookie of the coming NFL draft, by the order his position is taken. */
  rookie?: { order: number; named: boolean };
  games: number;
  /** League points a game when he plays. */
  ppg: number;
  /** Expected season points. */
  points: number;
  /** Value over replacement: (points a game − the replacement's) × games. */
  vor: number;
  /** Likely range of season points (10th to 90th percentile in the backtest). */
  range?: [number, number];
  /** 1 = best by value over replacement; position rank by expected points. */
  rank: number;
  posRank: number;
}

export interface Board {
  target: string;
  basis: { season: string; weeks: number };
  /** Best first by value over replacement. */
  players: BoardPlayer[];
  /** Replacement points a game by position. */
  replacement: Record<string, number>;
  /** One team's starting slots that the board fills. */
  slots: string[];
  numTeams: number;
}

export const isPlaceholder = (id: string): boolean => id.startsWith('rookie:');

const NOT_STARTING = new Set(['BN', 'IR', 'TAXI']);

/** Starting slots the board can fill: those a projected position can play (IDP slots left out). */
export function draftSlots(league: League): string[] {
  return league.rosterPositions.filter((s) => !NOT_STARTING.has(s) && DRAFT_POSITIONS.some((p) => canFill(s, [p])));
}

/** Flex slots last, the most restrictive first, so a fill leaves the widest slots for whoever remains. */
export function slotFillOrder(slots: readonly string[]): number[] {
  const width = (s: string) => SLOT_ELIGIBILITY[s]?.length ?? 0;
  return slots.map((_, i) => i).sort((a, b) => width(slots[a]!) - width(slots[b]!) || a - b);
}

/**
 * Replacement points a game at each position: the best player left over once every team's starting slots are
 * filled with the season's best, dedicated slots first, then flex slots league-wide.
 */
export function replacementLevels(rows: ReadonlyArray<Pick<BoardPlayer, 'pos' | 'fpos' | 'ppg' | 'points'>>, slots: readonly string[], numTeams: number): Record<string, number> {
  const byPoints = [...rows].sort((a, b) => b.points - a.points);
  const starters = new Map<string, number>();
  const free = slotFillOrder(slots).flatMap((i) => Array.from({ length: numTeams }, () => slots[i]!));
  const used = new Set<number>();
  // Dedicated slots, then flexes: a player takes the first open slot he can fill in that order.
  for (const p of byPoints) {
    const at = free.findIndex((s, i) => !used.has(i) && canFill(s, p.fpos.includes(p.pos) ? [p.pos] : p.fpos));
    if (at < 0) continue;
    used.add(at);
    starters.set(p.pos, (starters.get(p.pos) ?? 0) + 1);
    if (used.size === free.length) break;
  }
  const out: Record<string, number> = {};
  for (const pos of new Set(rows.map((r) => r.pos))) {
    const atPos = byPoints.filter((r) => r.pos === pos);
    out[pos] = atPos[starters.get(pos) ?? 0]?.ppg ?? 0;
  }
  return out;
}

function rookieName(r: NextSeasonRookie, players: ReadonlyMap<string, Player>): string {
  const p = r.id ? players.get(r.id) : undefined;
  if (p) return p.name;
  const nth = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth'][r.order - 1] ?? `#${r.order}`;
  return `Rookie ${r.pos}: the ${nth} taken`;
}

/** The board: every projected player this league can start, scored by its scoring settings. */
export function buildBoard(league: League, next: NextSeasonFile, players: ReadonlyMap<string, Player>): Board {
  const slots = draftSlots(league);
  const startable = new Set(DRAFT_POSITIONS.filter((p) => slots.some((s) => canFill(s, [p]))));
  const numTeams = league.rules.numTeams;
  type Row = Omit<BoardPlayer, 'vor' | 'rank' | 'posRank'>;
  const rows: Row[] = [];
  const add = (row: Omit<Row, 'ppg' | 'points' | 'range'>, stats: Readonly<Record<string, number>>) => {
    if (!startable.has(row.pos)) return;
    const ppg = projectedPoints(stats, league.scoring, row.pos);
    const points = ppg * row.games;
    const q = next.range[row.pos];
    rows.push({ ...row, ppg, points, ...(q ? { range: [points * q[0], points * q[1]] as [number, number] } : {}) });
  };
  for (const [id, p] of Object.entries(next.players)) {
    const meta = players.get(id);
    const pos = p.pos ?? meta?.pos;
    if (!pos) continue;
    add(
      {
        id,
        name: meta?.name ?? p.n ?? id,
        pos,
        fpos: meta?.fpos.includes(pos) ? meta.fpos : [pos],
        team: meta?.team ?? null,
        games: p.g,
        ...(p.age !== undefined ? { age: p.age } : {}),
        ...(p.fa ? { fa: true } : {}),
        ...(p.chg !== undefined ? { chg: p.chg } : {}),
      },
      p.s,
    );
  }
  for (const r of next.rookies) {
    const meta = r.id ? players.get(r.id) : undefined;
    add(
      {
        id: r.id ?? `rookie:${r.pos}:${r.order}`,
        name: rookieName(r, players),
        pos: r.pos,
        fpos: [r.pos],
        team: meta?.team ?? null,
        games: r.g,
        rookie: { order: r.order, named: !!r.id },
      },
      r.s,
    );
  }
  const replacement = replacementLevels(rows, slots, numTeams);
  const ranked = rows
    .map((r) => ({ ...r, vor: (r.ppg - (replacement[r.pos] ?? 0)) * r.games, rank: 0, posRank: 0 }))
    .sort((a, b) => b.vor - a.vor || b.points - a.points);
  ranked.forEach((p, i) => (p.rank = i + 1));
  for (const pos of startable) {
    ranked
      .filter((p) => p.pos === pos)
      .sort((a, b) => b.points - a.points)
      .forEach((p, i) => (p.posRank = i + 1));
  }
  return { target: next.target, basis: next.basis, players: ranked, replacement, slots, numTeams };
}

// ---- Rosters and lineups -------------------------------------------------------------------------------------

/** A bench player's value over replacement counts at this share: he plays when a starter is hurt or on a bye. [design] */
export const BENCH_SHARE = 0.3;

/** A team's best starters by value over replacement (slots filled dedicated first), and the rest on the bench. */
export function fillLineup(team: readonly BoardPlayer[], slots: readonly string[]): { starters: Array<BoardPlayer | null>; bench: BoardPlayer[] } {
  const starters: Array<BoardPlayer | null> = slots.map(() => null);
  const bench: BoardPlayer[] = [];
  const order = slotFillOrder(slots);
  for (const p of [...team].sort((a, b) => b.vor - a.vor)) {
    const at = order.find((i) => !starters[i] && canFill(slots[i]!, p.fpos));
    if (at === undefined) bench.push(p);
    else starters[at] = p;
  }
  return { starters, bench };
}

/** What a roster is worth: its starters' value over replacement plus a share of its bench's. */
export function lineupValue(team: readonly BoardPlayer[], slots: readonly string[]): number {
  const { starters, bench } = fillLineup(team, slots);
  return starters.reduce((a, p) => a + (p?.vor ?? 0), 0) + BENCH_SHARE * bench.reduce((a, p) => a + Math.max(0, p.vor), 0);
}

/** Most players a team carries at each position. [design] about what managers do: two QBs, two TEs, one K and DEF */
export function positionCaps(slots: readonly string[]): Record<string, number> {
  const count = (p: string) => slots.filter((s) => s === p).length;
  const flex = (p: string) => slots.filter((s) => SLOT_ELIGIBILITY[s]?.includes(p)).length;
  return {
    QB: count('QB') + flex('QB') + 1,
    RB: count('RB') + flex('RB') + 4,
    WR: count('WR') + flex('WR') + 4,
    TE: count('TE') + 1,
    K: count('K'),
    DEF: count('DEF'),
  };
}

/** Whether a team would draft this player with `picksLeft` picks to go (this one included). */
export function allowedPick(team: readonly BoardPlayer[], p: BoardPlayer, picksLeft: number, slots: readonly string[], caps: Readonly<Record<string, number>>): boolean {
  if (team.filter((x) => x.pos === p.pos).length >= (caps[p.pos] ?? Infinity)) return false;
  const { starters } = fillLineup(team, slots);
  const open = slots.filter((_, i) => !starters[i]);
  // Kickers and defenses wait for the last picks that open slots need.
  if (p.pos === 'K' || p.pos === 'DEF') {
    const kd = open.filter((s) => s === 'K' || s === 'DEF').length;
    if (picksLeft > kd + 1) return false;
  }
  // With only enough picks left for the open starting slots, fill them.
  if (picksLeft <= open.length && !open.some((s) => canFill(s, p.fpos))) return false;
  return true;
}

// ---- Keepers -------------------------------------------------------------------------------------------------

/**
 * What a keeper costs: nothing (he fills one of the team's last picks, which are worth about nothing), the round he was
 * drafted in last year, or one round earlier.
 */
export type KeeperCost = 'last' | 'drafted' | 'earlier';
export interface KeeperRules {
  count: number;
  cost: KeeperCost;
}
export interface Keeper {
  rosterId: number;
  id: string;
  /** The round whose pick he takes. */
  round: number;
  /** Value over replacement less the value of that round's pick. */
  surplus: number;
}

/** The average value over replacement of a pick in each round (index 0 = round 1), from the board's order. */
export function roundValues(board: Board, rounds: number): number[] {
  return Array.from({ length: rounds }, (_, r) => {
    const picks = board.players.slice(r * board.numTeams, (r + 1) * board.numTeams);
    return picks.length ? picks.reduce((a, p) => a + p.vor, 0) / picks.length : 0;
  });
}

export function keeperRound(id: string, rules: KeeperRules, rounds: number, drafted: ReadonlyMap<string, number>): number {
  const d = drafted.get(id);
  if (rules.cost === 'last' || d === undefined) return rounds;
  return rules.cost === 'earlier' ? Math.max(1, d - 1) : Math.min(rounds, d);
}

/**
 * Each team's likely keepers: the players whose value over replacement beats the pick they cost by the most, up to
 * the league's count. [design] Managers who keep for other reasons (a favourite player, a long view) will differ.
 */
export function predictKeepers(board: Board, rosters: readonly Roster[], rules: KeeperRules, rounds: number, drafted: ReadonlyMap<string, number> = new Map()): Keeper[] {
  const values = roundValues(board, rounds);
  const byId = new Map(board.players.map((p) => [p.id, p]));
  const out: Keeper[] = [];
  for (const r of rosters) {
    const ids = [...new Set([...r.players, ...r.reserve, ...r.taxi])];
    const cands = ids.flatMap((id) => {
      const p = byId.get(id);
      if (!p) return [];
      const round = keeperRound(id, rules, rounds, drafted);
      return [{ rosterId: r.rosterId, id, round, surplus: p.vor - (values[round - 1] ?? 0) }];
    });
    out.push(...cands.filter((c) => c.surplus > 0).sort((a, b) => b.surplus - a.surplus).slice(0, rules.count));
  }
  return out;
}

// ---- Pick order ----------------------------------------------------------------------------------------------

/** Snake reverses every round; third-round reversal also repeats round 2's direction in round 3 (Sleeper's option). */
export type DraftStyle = 'snake' | 'linear' | '3rr';

/** The team (roster id) on the clock at each overall pick, from round 1's order. */
export function pickOrder(order: readonly number[], rounds: number, style: DraftStyle): number[] {
  const out: number[] = [];
  for (let r = 1; r <= rounds; r++) {
    const reversed = style === 'linear' ? false : style === '3rr' && r >= 3 ? r % 2 === 1 : r % 2 === 0;
    out.push(...(reversed ? [...order].reverse() : order));
  }
  return out;
}

/** Round 1's order with `rosterId` moved to pick `slot` (1-based), the others keeping their order. */
export function withSlot(order: readonly number[], rosterId: number, slot: number): number[] {
  const rest = order.filter((r) => r !== rosterId);
  rest.splice(Math.max(0, Math.min(rest.length, slot - 1)), 0, rosterId);
  return rest;
}

/**
 * Round 1's order from Sleeper's draft, once set. `draft_order` maps users to slots (on real drafts, 2026-10-17,
 * `slot_to_roster_id` was empty even once finished), so slots go to rosters through their owners and co-owners; a team
 * without an owner takes a slot left over. Undefined until the order covers the league.
 */
export function sleeperDraftOrder(draft: Pick<RawDraft, 'draft_order' | 'slot_to_roster_id'> | undefined, rosters: readonly Roster[]): number[] | undefined {
  const n = rosters.length;
  if (draft?.draft_order && Object.keys(draft.draft_order).length) {
    const byUser = new Map<string, number>();
    for (const r of rosters) {
      if (r.ownerId) byUser.set(r.ownerId, r.rosterId);
      for (const c of r.coOwners) if (!byUser.has(c)) byUser.set(c, r.rosterId);
    }
    const slots: Array<number | undefined> = Array.from({ length: n }, () => undefined);
    for (const [user, slot] of Object.entries(draft.draft_order)) {
      const r = byUser.get(user);
      if (r !== undefined && slot >= 1 && slot <= n && slots[slot - 1] === undefined && !slots.includes(r)) slots[slot - 1] = r;
    }
    const left = rosters.map((r) => r.rosterId).filter((r) => !slots.includes(r));
    const order = slots.map((r) => r ?? left.shift());
    if (order.every((r): r is number => r !== undefined)) return order;
  }
  const bySlot = draft?.slot_to_roster_id;
  if (bySlot) {
    const order = Object.entries(bySlot)
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([, r]) => r);
    if (order.length === n && new Set(order).size === n && order.every((r) => rosters.some((x) => x.rosterId === r))) return order;
  }
  return undefined;
}

/** Each pick's owner after trades: `traded` lists the season's picks that changed hands, by round and original team. */
export function pickOwners(original: readonly number[], numTeams: number, traded: readonly RawTradedPick[], season: string): number[] {
  const owner = new Map(traded.filter((t) => String(t.season) === season).map((t) => [`${t.round}:${t.roster_id}`, t.owner_id]));
  return original.map((r, i) => owner.get(`${Math.floor(i / numTeams) + 1}:${r}`) ?? r);
}

/**
 * Sleeper's picks so far, by overall pick (pick_no − 1): the player, and the team that made it (which a trade during
 * the draft can change).
 */
export function livePicks(picks: readonly Pick<RawDraftPick, 'pick_no' | 'player_id' | 'roster_id'>[], length: number): { taken: Array<string | undefined>; by: Array<number | undefined> } {
  const taken: Array<string | undefined> = Array.from({ length }, () => undefined);
  const by: Array<number | undefined> = Array.from({ length }, () => undefined);
  for (const p of picks) {
    const i = p.pick_no - 1;
    if (!(i >= 0 && i < length) || !p.player_id) continue;
    taken[i] = p.player_id;
    if (p.roster_id != null) by[i] = p.roster_id;
  }
  return { taken, by };
}

/**
 * Keepers placed at their teams' picks in their rounds; a clash moves the later one to the nearest free earlier round.
 * Picks already made (`taken`, a live draft's) aren't free.
 */
export function placeKeepers(picks: readonly number[], numTeams: number, keepers: readonly Keeper[], taken: ReadonlyArray<string | undefined> = []): Map<number, string> {
  const rounds = Math.ceil(picks.length / numTeams);
  const fixed = new Map<number, string>();
  const teamPick = (rosterId: number, round: number) => {
    for (let i = (round - 1) * numTeams; i < Math.min(picks.length, round * numTeams); i++) if (picks[i] === rosterId && taken[i] === undefined && !fixed.has(i)) return i;
    return -1;
  };
  for (const k of [...keepers].sort((a, b) => b.round - a.round || b.surplus - a.surplus)) {
    for (const round of [k.round, ...Array.from({ length: rounds }, (_, i) => k.round - 1 - i), ...Array.from({ length: rounds }, (_, i) => k.round + 1 + i)]) {
      if (round < 1 || round > rounds) continue;
      const at = teamPick(k.rosterId, round);
      if (at >= 0 && !fixed.has(at) && taken[at] === undefined) {
        fixed.set(at, k.id);
        break;
      }
    }
  }
  return fixed;
}

// ---- Mock draft ----------------------------------------------------------------------------------------------

export interface DraftSetup {
  board: Board;
  /** Roster id on the clock at each overall pick. */
  picks: number[];
  numTeams: number;
  /** Players taken so far by overall pick (keepers and picks made); undefined = not yet. */
  taken: ReadonlyArray<string | undefined>;
}

/** Spread of the other teams' picks around the board: the log of a player's rank moves by this much (1 SD). [design] */
export const DRAFT_NOISE = 0.3;
const CANDIDATES = 15;

const normal = (rand: () => number) => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());

interface SimState {
  available: boolean[];
  teams: Map<number, BoardPlayer[]>;
  taken: Array<string | undefined>;
}

/** Players taken so far (keepers included) are on their teams and off the board. */
function startState(s: DraftSetup): SimState {
  const index = new Map(s.board.players.map((p, i) => [p.id, i]));
  const available = s.board.players.map(() => true);
  const teams = new Map<number, BoardPlayer[]>(s.picks.map((r) => [r, []]));
  const taken = Array.from({ length: s.picks.length }, (_, i) => s.taken[i]);
  taken.forEach((id, i) => {
    const at = id === undefined ? undefined : index.get(id);
    // A keeper the board doesn't project (IDP, say) still uses the pick.
    if (at === undefined) return;
    available[at] = false;
    teams.get(s.picks[i]!)!.push(s.board.players[at]!);
  });
  return { available, teams, taken };
}

const picksLeftFor = (picks: readonly number[], rosterId: number, from: number, taken: ReadonlyArray<string | undefined>) =>
  picks.reduce((n, r, i) => (i >= from && r === rosterId && taken[i] === undefined ? n + 1 : n), 0);

/** The pick that adds the most to this team's lineup value among the best available players it would take. */
export function bestGain(team: readonly BoardPlayer[], board: Board, available: readonly boolean[], picksLeft: number, caps: Readonly<Record<string, number>>): { player: BoardPlayer; gain: number } | undefined {
  const base = lineupValue(team, board.slots);
  let best: { player: BoardPlayer; gain: number } | undefined;
  let seen = 0;
  for (let i = 0; i < board.players.length && seen < CANDIDATES; i++) {
    const p = board.players[i]!;
    if (!available[i] || !allowedPick(team, p, picksLeft, board.slots, caps)) continue;
    seen++;
    const gain = lineupValue([...team, p], board.slots) - base;
    if (!best || gain > best.gain) best = { player: p, gain };
  }
  return best;
}

/** The other teams draft by the board with noise: each sim draws every player's spot once. */
function noisyOrder(board: Board, rand: () => number, noise: number): number[] {
  const key = board.players.map((p) => Math.log(p.rank) + noise * normal(rand));
  return board.players.map((_, i) => i).sort((a, b) => key[a]! - key[b]!);
}

function pickFor(rosterId: number, st: SimState, s: DraftSetup, i: number, order: readonly number[] | null, caps: Readonly<Record<string, number>>): number {
  const team = st.teams.get(rosterId)!;
  const left = picksLeftFor(s.picks, rosterId, i, st.taken);
  if (order) {
    for (const at of order) if (st.available[at] && allowedPick(team, s.board.players[at]!, left, s.board.slots, caps)) return at;
  } else {
    const g = bestGain(team, s.board, st.available, left, caps);
    if (g) return s.board.players.indexOf(g.player);
  }
  return st.available.indexOf(true);
}

/** Run the draft from pick `from` to `to` (exclusive): `me` picks by lineup gain, everyone else by the noisy board. */
function run(st: SimState, s: DraftSetup, from: number, to: number, order: readonly number[], me: number | undefined, caps: Readonly<Record<string, number>>): void {
  for (let i = from; i < Math.min(to, s.picks.length); i++) {
    if (st.taken[i] !== undefined) continue;
    const r = s.picks[i]!;
    const at = pickFor(r, st, s, i, r === me ? null : order, caps);
    if (at < 0) return;
    const p = s.board.players[at]!;
    st.available[at] = false;
    st.taken[i] = p.id;
    st.teams.get(r)!.push(p);
  }
}

export interface Suggestion {
  player: BoardPlayer;
  /** What he adds to your lineup value now. */
  gain: number;
  /** Chance he's still there at your next pick: the one after this when you're on the clock, else the coming one. */
  nextAvailable?: number;
}

/** The next overall pick of `rosterId` after `after`, or undefined. */
export function nextPick(s: Pick<DraftSetup, 'picks' | 'taken'>, rosterId: number, after: number): number | undefined {
  for (let i = after + 1; i < s.picks.length; i++) if (s.picks[i] === rosterId && s.taken[i] === undefined) return i;
  return undefined;
}

type SimOpts = { sims?: number; seed?: number; noise?: number };

/** The players who add most to `rosterId`'s lineup with its pick at `at`, best first. */
function bestFor(st: SimState, s: DraftSetup, rosterId: number, at: number, count: number): Suggestion[] {
  const caps = positionCaps(s.board.slots);
  const team = st.teams.get(rosterId) ?? [];
  const left = picksLeftFor(s.picks, rosterId, at, st.taken);
  const base = lineupValue(team, s.board.slots);
  const out: Suggestion[] = [];
  for (let i = 0; i < s.board.players.length && out.length < count * 3; i++) {
    const p = s.board.players[i]!;
    if (!st.available[i] || !allowedPick(team, p, left, s.board.slots, caps)) continue;
    out.push({ player: p, gain: lineupValue([...team, p], s.board.slots) - base });
  }
  return out.sort((a, b) => b.gain - a.gain).slice(0, count);
}

/** How often each player is still on the board at pick `to`, with the picks from `from` up to it made by the noisy board. */
function lasting(st: SimState, s: DraftSetup, from: number, to: number, ids: readonly string[], opts: SimOpts): number[] {
  const { sims = 200, seed = 1, noise = DRAFT_NOISE } = opts;
  const caps = positionCaps(s.board.slots);
  const rand = mulberry32(seed);
  const index = new Map(s.board.players.map((p, i) => [p.id, i]));
  const hits = ids.map(() => 0);
  for (let k = 0; k < sims; k++) {
    const sim: SimState = { available: [...st.available], teams: new Map([...st.teams].map(([r, t]) => [r, [...t]])), taken: [...st.taken] };
    run(sim, s, from, to, noisyOrder(s.board, rand, noise), undefined, caps);
    ids.forEach((id, j) => (hits[j]! += sim.available[index.get(id)!] ? 1 : 0));
  }
  return hits.map((h) => h / sims);
}

/**
 * Suggestions for the pick at `at` (yours): the players who add most to your lineup, and how often each is still
 * there at your next pick when the teams in between draft by the noisy board.
 */
export function suggest(s: DraftSetup, at: number, opts: SimOpts & { count?: number } = {}): Suggestion[] {
  const st = startState(s);
  const top = bestFor(st, s, s.picks[at]!, at, opts.count ?? 8);
  const next = nextPick(s, s.picks[at]!, at);
  if (next !== undefined) {
    // Your pick now is left open: each suggestion's chance is for when you take someone else.
    st.taken[at] = 'mine';
    lasting(st, s, at + 1, next, top.map((t) => t.player.id), opts).forEach((p, j) => (top[j]!.nextAvailable = p));
  }
  return top;
}

/**
 * While another team is on the clock (pick `current`): the players who'd add most to `me`'s lineup at its next pick,
 * and how often each lasts until then.
 */
export function suggestAhead(s: DraftSetup, me: number, current: number, opts: SimOpts & { count?: number } = {}): { at: number; suggestions: Suggestion[] } | undefined {
  const at = s.picks.findIndex((r, i) => i >= current && r === me && s.taken[i] === undefined);
  if (at < 0) return undefined;
  if (at === current) return { at, suggestions: suggest(s, at, opts) };
  const st = startState(s);
  const top = bestFor(st, s, me, at, opts.count ?? 8);
  lasting(st, s, current, at, top.map((t) => t.player.id), opts).forEach((p, j) => (top[j]!.nextAvailable = p));
  return { at, suggestions: top };
}

/** Simulate the rest of the draft: you pick by lineup gain, the others by the noisy board. */
export function simulateRest(s: DraftSetup, me: number, opts: { seed?: number; noise?: number; to?: number } = {}): Array<string | undefined> {
  const { seed = 1, noise = DRAFT_NOISE, to = s.picks.length } = opts;
  const st = startState(s);
  const from = st.taken.findIndex((t) => t === undefined);
  if (from >= 0) run(st, s, from, to, noisyOrder(s.board, mulberry32(seed), noise), me, positionCaps(s.board.slots));
  return st.taken;
}

export interface SlotValue {
  slot: number;
  /** Your lineup value over replacement after the draft, averaged over the simulations. */
  value: number;
}

/**
 * Your expected lineup value from each first-round slot, for a draft whose order isn't set: the draft is simulated
 * with you at each slot and the other teams in the given order.
 */
export function compareSlots(
  input: { board: Board; order: readonly number[]; rounds: number; style: DraftStyle; me: number; keepers?: readonly Keeper[]; traded?: readonly RawTradedPick[] },
  opts: { sims?: number; seed?: number; noise?: number } = {},
): SlotValue[] {
  const { sims = 40, seed = 7, noise = DRAFT_NOISE } = opts;
  const caps = positionCaps(input.board.slots);
  const n = input.order.length;
  return Array.from({ length: n }, (_, k) => {
    // Traded picks move with the team they came from, wherever it picks.
    const picks = pickOwners(pickOrder(withSlot(input.order, input.me, k + 1), input.rounds, input.style), n, input.traded ?? [], input.board.target);
    const fixed = placeKeepers(picks, n, input.keepers ?? []);
    const setup: DraftSetup = { board: input.board, picks, numTeams: n, taken: picks.map((_, i) => fixed.get(i)) };
    const rand = mulberry32(seed + k);
    let total = 0;
    for (let i = 0; i < sims; i++) {
      const st = startState(setup);
      run(st, setup, 0, picks.length, noisyOrder(input.board, rand, noise), input.me, caps);
      total += lineupValue(st.teams.get(input.me)!, input.board.slots);
    }
    return { slot: k + 1, value: total / sims };
  });
}

// ---- Grades --------------------------------------------------------------------------------------------------

/** Games a season: a starter's missed games are played at replacement level. */
const SEASON_GAMES = 17;
/**
 * SD floors for the grades (see zScores) [design], as Team grades has them: 3% of the average team's season points for
 * a roster and for its picks, one point a week for a position.
 */
const ROSTER_MIN_SD = 0.03;
const POSITION_MIN_SD = SEASON_GAMES;

/** A roster's lineup value by position: its starters there, plus its bench there at BENCH_SHARE. They add up to lineupValue. */
export function positionValues(team: readonly BoardPlayer[], slots: readonly string[]): Record<string, number> {
  const { starters, bench } = fillLineup(team, slots);
  const out: Record<string, number> = {};
  for (const p of starters) if (p) out[p.pos] = (out[p.pos] ?? 0) + p.vor;
  for (const p of bench) out[p.pos] = (out[p.pos] ?? 0) + BENCH_SHARE * Math.max(0, p.vor);
  return out;
}

export interface DraftTeamGrade extends PartGrade {
  rosterId: number;
  /** What its picks added to its keepers' lineup value, graded the same way: when the draft has keepers. */
  picks?: PartGrade;
  /** By position: what its players there add to the lineup value. */
  positions: Record<string, PartGrade>;
}

export interface DraftGrades {
  /** Best roster first. */
  teams: DraftTeamGrade[];
  /** The positions graded: those the league starts. */
  positions: string[];
  /** Lineup value that one grade step spans (half the SD graded on): for rosters, and for picks alone with keepers. */
  step: { team: number; picks?: number };
}

/**
 * Every team's draft graded S–F against the others, in Team grades' bands (analysis/grades.ts): on the lineup value of
 * the roster it ends with, keepers included; with keepers, also on what its picks added to them (a roster's grade is
 * then mostly its keepers'); and position by position. `keeperPicks`: the overall picks keepers took. Needs three
 * teams or more.
 */
export function draftGrades(s: DraftSetup, keeperPicks: ReadonlySet<number> = new Set()): DraftGrades | undefined {
  const ids = [...new Set(s.picks)];
  if (ids.length < 3) return undefined;
  const { board } = s;
  const byId = new Map(board.players.map((p) => [p.id, p]));
  const roster = (rosterId: number, keepersOnly: boolean) =>
    s.picks.flatMap((r, i) => {
      const p = r === rosterId && (!keepersOnly || keeperPicks.has(i)) ? byId.get(s.taken[i] ?? '') : undefined;
      return p ? [p] : [];
    });
  const teams = ids.map((r) => roster(r, false));
  const values = teams.map((t) => lineupValue(t, board.slots));
  // The floor is a share of the average team's season points: a replacement-level team's, plus the average value.
  const slotReplacement = (slot: string) => Math.max(0, ...Object.entries(board.replacement).flatMap(([pos, ppg]) => (canFill(slot, [pos]) ? [ppg] : [])));
  const replacementTeam = board.slots.reduce((a, slot) => a + slotReplacement(slot) * SEASON_GAMES, 0);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const minSd = ROSTER_MIN_SD * Math.max(0, replacementTeam + mean);
  const overall = gradeValues(values, minSd);
  const added = keeperPicks.size ? ids.map((r, k) => values[k]! - lineupValue(roster(r, true), board.slots)) : undefined;
  const picks = added ? gradeValues(added, minSd) : undefined;
  const positions = DRAFT_POSITIONS.filter((p) => board.slots.some((slot) => canFill(slot, [p])));
  const byPosition = teams.map((t) => positionValues(t, board.slots));
  const atPosition = new Map(positions.map((p) => [p, gradeValues(byPosition.map((v) => v[p] ?? 0), POSITION_MIN_SD)]));
  const out: DraftTeamGrade[] = ids.map((rosterId, k) => ({
    rosterId,
    ...overall[k]!,
    ...(picks ? { picks: picks[k]! } : {}),
    positions: Object.fromEntries(positions.map((p) => [p, atPosition.get(p)![k]!])),
  }));
  out.sort((a, b) => a.rank - b.rank);
  return { teams: out, positions, step: { team: zScale(values, minSd) / 2, ...(added ? { picks: zScale(added, minSd) / 2 } : {}) } };
}

/** One pick against the board's order. */
export interface PickValue {
  /** Overall pick, 0-based. */
  at: number;
  player: BoardPlayer;
  /** Picks after (+) or before (−) his place on the board he went. */
  spots: number;
  /** His value over replacement less that of the board's player for that pick. */
  gain: number;
}

const VALUE_POSITIONS = new Set(['QB', 'RB', 'WR', 'TE']);

/**
 * A team's best value and biggest reach: its QB, RB, WR and TE picks against the board's order, with keepers left out
 * of both the picks and the board. A pick within half a round of his place counts as on the board. [design]
 */
export function valueAndReach(s: DraftSetup, rosterId: number, keeperPicks: ReadonlySet<number> = new Set()): { value?: PickValue; reach?: PickValue } {
  const kept = new Set([...keeperPicks].map((i) => s.taken[i]));
  const order = s.board.players.filter((p) => !kept.has(p.id));
  const place = new Map(order.map((p, i) => [p.id, i + 1]));
  const byId = new Map(order.map((p) => [p.id, p]));
  const mine: PickValue[] = [];
  let made = 0;
  s.taken.forEach((id, i) => {
    if (id === undefined || keeperPicks.has(i)) return;
    made++;
    const p = byId.get(id);
    if (s.picks[i] !== rosterId || !p || !VALUE_POSITIONS.has(p.pos)) return;
    const expected = order[Math.min(made, order.length) - 1]!;
    mine.push({ at: i, player: p, spots: made - place.get(id)!, gain: p.vor - expected.vor });
  });
  const half = s.numTeams / 2;
  const value = mine.filter((m) => m.spots > half).sort((a, b) => b.gain - a.gain)[0];
  const reach = mine.filter((m) => m.spots < -half).sort((a, b) => a.gain - b.gain)[0];
  return { ...(value ? { value } : {}), ...(reach ? { reach } : {}) };
}
