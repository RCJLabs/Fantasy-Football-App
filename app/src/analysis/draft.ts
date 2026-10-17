// Draft helper (docs/draft.md): next season's board under this league's scoring, value over replacement, predicted
// keepers, the pick order, and a mock draft in which the other teams draft from the same board with noise.
import type { NextSeasonFile, NextSeasonRookie } from '../data/contracts';
import type { League, Player, Roster } from '../domain/types';
import { canFill, SLOT_ELIGIBILITY } from '../engine/lineup';
import { projectedPoints } from '../engine/scoring';
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

/** What a keeper costs: one of the team's last picks, the round he was drafted in last year, or one round earlier. */
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

/** Keepers placed at their teams' picks in their rounds; a clash moves the later one to the nearest free earlier round. */
export function placeKeepers(picks: readonly number[], numTeams: number, keepers: readonly Keeper[]): Map<number, string> {
  const rounds = Math.ceil(picks.length / numTeams);
  const fixed = new Map<number, string>();
  const teamPick = (rosterId: number, round: number) => {
    for (let i = (round - 1) * numTeams; i < Math.min(picks.length, round * numTeams); i++) if (picks[i] === rosterId) return i;
    return -1;
  };
  for (const k of [...keepers].sort((a, b) => b.round - a.round || b.surplus - a.surplus)) {
    for (const round of [k.round, ...Array.from({ length: rounds }, (_, i) => k.round - 1 - i), ...Array.from({ length: rounds }, (_, i) => k.round + 1 + i)]) {
      if (round < 1 || round > rounds) continue;
      const at = teamPick(k.rosterId, round);
      if (at >= 0 && !fixed.has(at)) {
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
  /** Chance he's still there at your next pick, if you don't take him now. */
  nextAvailable?: number;
}

/** The next overall pick of `rosterId` after `after`, or undefined. */
export function nextPick(s: Pick<DraftSetup, 'picks' | 'taken'>, rosterId: number, after: number): number | undefined {
  for (let i = after + 1; i < s.picks.length; i++) if (s.picks[i] === rosterId && s.taken[i] === undefined) return i;
  return undefined;
}

/**
 * Suggestions for the pick at `at` (yours): the players who add most to your lineup, and how often each is still
 * there at your next pick when the teams in between draft by the noisy board.
 */
export function suggest(s: DraftSetup, at: number, opts: { sims?: number; seed?: number; noise?: number; count?: number } = {}): Suggestion[] {
  const { sims = 200, seed = 1, noise = DRAFT_NOISE, count = 8 } = opts;
  const me = s.picks[at]!;
  const caps = positionCaps(s.board.slots);
  const st = startState(s);
  const team = st.teams.get(me)!;
  const left = picksLeftFor(s.picks, me, at, st.taken);
  const base = lineupValue(team, s.board.slots);
  const out: Suggestion[] = [];
  for (let i = 0; i < s.board.players.length && out.length < count * 3; i++) {
    const p = s.board.players[i]!;
    if (!st.available[i] || !allowedPick(team, p, left, s.board.slots, caps)) continue;
    out.push({ player: p, gain: lineupValue([...team, p], s.board.slots) - base });
  }
  out.sort((a, b) => b.gain - a.gain);
  const top = out.slice(0, count);
  const next = nextPick(s, me, at);
  if (next !== undefined) {
    const rand = mulberry32(seed);
    const index = new Map(s.board.players.map((p, i) => [p.id, i]));
    const hits = top.map(() => 0);
    for (let k = 0; k < sims; k++) {
      const sim: SimState = { available: [...st.available], teams: new Map([...st.teams].map(([r, t]) => [r, [...t]])), taken: [...st.taken] };
      // Your pick now is left open: each suggestion's chance is for when you take someone else.
      sim.taken[at] = 'mine';
      run(sim, s, at + 1, next, noisyOrder(s.board, rand, noise), undefined, caps);
      top.forEach((t, j) => (hits[j]! += sim.available[index.get(t.player.id)!] ? 1 : 0));
    }
    top.forEach((t, j) => (t.nextAvailable = hits[j]! / sims));
  }
  return top;
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
export function compareSlots(input: { board: Board; order: readonly number[]; rounds: number; style: DraftStyle; me: number; keepers?: readonly Keeper[] }, opts: { sims?: number; seed?: number; noise?: number } = {}): SlotValue[] {
  const { sims = 40, seed = 7, noise = DRAFT_NOISE } = opts;
  const caps = positionCaps(input.board.slots);
  const n = input.order.length;
  return Array.from({ length: n }, (_, k) => {
    const picks = pickOrder(withSlot(input.order, input.me, k + 1), input.rounds, input.style);
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
