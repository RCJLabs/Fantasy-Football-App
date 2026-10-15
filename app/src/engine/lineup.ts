import { bestAssignment } from './assignment';

/** Which fantasy positions each Sleeper roster slot accepts. Unknown slots accept their own name only. */
export const SLOT_ELIGIBILITY: Record<string, readonly string[]> = {
  FLEX: ['RB', 'WR', 'TE'],
  WRRB_FLEX: ['WR', 'RB'],
  REC_FLEX: ['WR', 'TE'],
  SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'],
  IDP_FLEX: ['DL', 'LB', 'DB'],
};

export function canFill(slotType: string, fpos: readonly string[]): boolean {
  const allowed = SLOT_ELIGIBILITY[slotType] ?? [slotType];
  return fpos.some((p) => allowed.includes(p));
}

/** Starting slots of a league (Sleeper `roster_positions` minus bench). */
export function startingSlots(rosterPositions: readonly string[]): string[] {
  return rosterPositions.filter((s) => s !== 'BN');
}

export interface LineupPlayer {
  id: string;
  fpos: readonly string[];
  /** Expected points if active. */
  mu: number;
  /** Probability of being active. */
  p: number;
  /** Kickoff (epoch ms); null = no game this week. */
  kickoff: number | null;
  /** Game has started: the player can't be moved. */
  locked: boolean;
  /** Points credited to a locked starter (actual so far, or projection if unknown). */
  lockedPoints?: number;
}

export interface LineupProblem {
  slots: readonly string[];
  players: readonly LineupPlayer[];
  /** Current lineup: player index per slot (-1 = empty). */
  current: readonly number[];
  now: number;
  /** Inactives are announced this long before kickoff. */
  revealLeadMs?: number;
}

export interface LineupResult {
  lineup: number[];
  /** Expected points including the option to swap out players ruled inactive. */
  expected: number;
  /** Σ p·μ (no swap option). */
  staticExpected: number;
  currentExpected: number;
  currentStatic: number;
}

const DEFAULT_LEAD = 90 * 60 * 1000;
/** Players below this P(active) carry a real inactive risk worth planning around. */
const UNCERTAIN_BELOW = 0.95;
/** Cap on enumerated inactive scenarios (2^k). Extra uncertain starters are valued statically. */
const MAX_UNCERTAIN = 5;

const staticValue = (pl: LineupPlayer): number =>
  pl.locked ? (pl.lockedPoints ?? pl.p * pl.mu) : pl.kickoff === null ? 0 : pl.p * pl.mu;

const isUncertain = (pl: LineupPlayer): boolean =>
  !pl.locked && pl.kickoff !== null && pl.p > 0 && pl.p < UNCERTAIN_BELOW;

export function staticLineupValue(problem: LineupProblem, lineup: readonly number[]): number {
  let total = 0;
  for (const idx of lineup) if (idx >= 0) total += staticValue(problem.players[idx]!);
  return total;
}

/**
 * Expected points of a lineup when you can react to inactives: for every combination of
 * uncertain starters being active/inactive, each inactive starter's slot (and any other slot whose
 * player hasn't kicked off yet) is re-optimized at the reveal time from players not yet locked.
 */
export function twoStageValue(problem: LineupProblem, lineup: readonly number[]): number {
  const { players, slots } = problem;
  const lead = problem.revealLeadMs ?? DEFAULT_LEAD;
  const revealAt = (i: number) => Math.max(problem.now, (players[i]!.kickoff ?? problem.now) - lead);

  const uncertain = lineup
    .filter((i) => i >= 0 && isUncertain(players[i]!))
    .sort((a, b) => revealAt(a) - revealAt(b))
    .slice(0, MAX_UNCERTAIN);
  if (uncertain.length === 0) return staticLineupValue(problem, lineup);

  const k = uncertain.length;
  let expected = 0;
  for (let mask = 0; mask < 1 << k; mask++) {
    let prob = 1;
    const active = new Map<number, boolean>();
    for (let b = 0; b < k; b++) {
      const i = uncertain[b]!;
      const on = (mask & (1 << b)) !== 0;
      active.set(i, on);
      prob *= on ? players[i]!.p : 1 - players[i]!.p;
    }
    if (prob === 0) continue;

    const assignment = [...lineup];
    const revealed = new Map<number, boolean>();
    for (const u of uncertain) {
      const t = revealAt(u);
      revealed.set(u, active.get(u)!);
      if (active.get(u)) continue;
      reoptimizeAt(problem, assignment, t, revealed);
    }

    let value = 0;
    for (const idx of assignment) {
      if (idx < 0) continue;
      const pl = players[idx]!;
      if (active.has(idx)) value += active.get(idx) ? pl.mu : 0;
      else value += staticValue(pl);
    }
    expected += prob * value;
  }
  return expected;

  function reoptimizeAt(p: LineupProblem, assignment: number[], t: number, revealed: Map<number, boolean>) {
    const movable = (i: number) => {
      const pl = p.players[i]!;
      return !pl.locked && (pl.kickoff === null || pl.kickoff > t);
    };
    const freeSlots: number[] = [];
    const items: number[] = [];
    const inLineup = new Set(assignment.filter((i) => i >= 0));
    assignment.forEach((occ, s) => {
      if (occ < 0 || movable(occ)) {
        freeSlots.push(s);
        if (occ >= 0) items.push(occ);
      }
    });
    p.players.forEach((_, i) => {
      if (!inLineup.has(i) && movable(i)) items.push(i);
    });
    const val = (i: number) => {
      const pl = p.players[i]!;
      if (revealed.has(i)) return revealed.get(i) ? pl.mu : 0;
      return staticValue(pl);
    };
    const { assignment: best } = bestAssignment(freeSlots.length, items.length, (s, it) =>
      canFill(slots[freeSlots[s]!]!, p.players[items[it]!]!.fpos) ? val(items[it]!) : null,
    );
    best.forEach((it, s) => {
      assignment[freeSlots[s]!] = it >= 0 ? items[it]! : -1;
    });
  }
}

/** Best lineup by Σ p·μ over slots that aren't locked (locked starters stay where they are). */
export function staticOptimalLineup(problem: LineupProblem): number[] {
  const { players, slots, current } = problem;
  const lineup = [...current];
  while (lineup.length < slots.length) lineup.push(-1);
  const lockedSlot = (s: number) => lineup[s]! >= 0 && players[lineup[s]!]!.locked;
  const freeSlots = slots.map((_, s) => s).filter((s) => !lockedSlot(s));
  const inLocked = new Set(lineup.filter((i, s) => i >= 0 && lockedSlot(s)));
  const items = players.map((_, i) => i).filter((i) => !players[i]!.locked && !inLocked.has(i));
  const { assignment } = bestAssignment(freeSlots.length, items.length, (s, it) =>
    canFill(slots[freeSlots[s]!]!, players[items[it]!]!.fpos) ? staticValue(players[items[it]!]!) : null,
  );
  assignment.forEach((it, s) => {
    lineup[freeSlots[s]!] = it >= 0 ? items[it]! : -1;
  });
  return lineup;
}

/**
 * Lineup maximizing two-stage expected points: start from the static optimum (and the current
 * lineup), then hill-climb over single replacements and slot swaps among unlocked players.
 */
export function optimizeLineup(problem: LineupProblem): LineupResult {
  const { players, slots } = problem;
  const current = [...problem.current];
  while (current.length < slots.length) current.push(-1);

  const movableSlot = (lineup: number[], s: number) => lineup[s]! < 0 || !players[lineup[s]!]!.locked;
  const benchFor = (lineup: number[]) => {
    const used = new Set(lineup.filter((i) => i >= 0));
    return players.map((_, i) => i).filter((i) => !used.has(i) && !players[i]!.locked);
  };

  const climb = (start: number[]): { lineup: number[]; value: number } => {
    let best = [...start];
    let bestVal = twoStageValue(problem, best);
    for (let iter = 0; iter < 60; iter++) {
      let improved = false;
      let candBest = best;
      let candVal = bestVal;
      const bench = benchFor(best);
      for (let s = 0; s < slots.length; s++) {
        if (!movableSlot(best, s)) continue;
        for (const b of bench) {
          if (!canFill(slots[s]!, players[b]!.fpos)) continue;
          const next = [...best];
          next[s] = b;
          const v = twoStageValue(problem, next);
          if (v > candVal + 1e-9) {
            candVal = v;
            candBest = next;
            improved = true;
          }
        }
        for (let s2 = s + 1; s2 < slots.length; s2++) {
          if (!movableSlot(best, s2)) continue;
          const a = best[s]!;
          const b = best[s2]!;
          if (a === b) continue;
          if (a >= 0 && !canFill(slots[s2]!, players[a]!.fpos)) continue;
          if (b >= 0 && !canFill(slots[s]!, players[b]!.fpos)) continue;
          const next = [...best];
          next[s] = b;
          next[s2] = a;
          const v = twoStageValue(problem, next);
          if (v > candVal + 1e-9) {
            candVal = v;
            candBest = next;
            improved = true;
          }
        }
      }
      if (!improved) break;
      best = candBest;
      bestVal = candVal;
    }
    return { lineup: best, value: bestVal };
  };

  const fromStatic = climb(staticOptimalLineup(problem));
  const fromCurrent = climb(current);
  const winner = fromCurrent.value > fromStatic.value + 1e-9 ? fromCurrent : fromStatic;
  return {
    lineup: winner.lineup,
    expected: winner.value,
    staticExpected: staticLineupValue(problem, winner.lineup),
    currentExpected: twoStageValue(problem, current),
    currentStatic: staticLineupValue(problem, current),
  };
}
