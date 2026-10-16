/**
 * A waiver claim plan (docs/claims.md): claims in order, each with its drop and bid, each assuming the ones above it
 * went through, and a backup per claim that uses the same drop. Once that player is gone the backup can't go
 * through, so it only lands if the claim above it failed.
 */

/** Smallest gain worth a claim, in weighted rest-of-season points plus this week's [design]: below it, the waiver board bids the minimum. */
export const MIN_CLAIM = 2;
/** Cheapest drops tried for each candidate (as the waiver board does). */
const DROPS_TRIED = 3;

export interface ClaimInput {
  /** Weighted rest-of-season points of a roster (RosModel.value). */
  value: (team: readonly string[]) => number;
  /** Gain in this week's best lineup from adding `id` to `team`. */
  thisWeek?: (team: readonly string[], id: string) => number;
  /** Your players as the rest-of-season values count them. */
  team: readonly string[];
  /** Players you could drop: active, games not started. */
  droppable: readonly string[];
  openSpots: number;
  /** Free agents to consider, best first. */
  candidates: readonly string[];
  /** FAAB: the bid for a claim, given its gain and the budget left after the claims above it. */
  bid?: (id: string, rosGain: number, remaining: number) => number;
  budget?: number;
  maxClaims?: number;
}

export interface ClaimStep {
  add: string;
  drop?: string;
  /** Weighted rest-of-season gain, after the drop. */
  rosGain: number;
  /** Gain in this week's best lineup. */
  now: number;
  bid?: number;
}

export interface Claim extends ClaimStep {
  /** If this claim fails: the next best player for the same drop. */
  backup?: ClaimStep;
}

/** Each candidate's best claim against the roster as it stands, best first. */
function options(input: ClaimInput, team: readonly string[], droppable: readonly string[], spots: number, candidates: readonly string[]): ClaimStep[] {
  const base = input.value(team);
  const drops = spots > 0 ? [undefined] : droppable.map((d) => ({ d, cost: base - input.value(team.filter((x) => x !== d)) })).sort((a, b) => a.cost - b.cost).slice(0, DROPS_TRIED).map((x) => x.d);
  const out: ClaimStep[] = [];
  for (const add of candidates) {
    let best: ClaimStep | undefined;
    for (const drop of drops) {
      const after = drop === undefined ? [...team, add] : [...team.filter((x) => x !== drop), add];
      const rosGain = input.value(after) - base;
      if (!best || rosGain > best.rosGain) best = { add, ...(drop !== undefined ? { drop } : {}), rosGain, now: 0 };
    }
    if (!best) continue;
    const rest = best.drop === undefined ? team : team.filter((x) => x !== best!.drop);
    best.now = input.thisWeek ? Math.max(0, input.thisWeek(rest, add)) : 0;
    out.push(best);
  }
  return out.sort((a, b) => b.rosGain + b.now - (a.rosGain + a.now));
}

/** The best claim for a given drop: what a backup for that drop would be. */
function forDrop(input: ClaimInput, team: readonly string[], drop: string, candidates: readonly string[]): ClaimStep | undefined {
  const base = input.value(team);
  const rest = team.filter((x) => x !== drop);
  let best: ClaimStep | undefined;
  for (const add of candidates) {
    const rosGain = input.value([...rest, add]) - base;
    const now = input.thisWeek ? Math.max(0, input.thisWeek(rest, add)) : 0;
    if (rosGain + now >= MIN_CLAIM && (!best || rosGain + now > best.rosGain + best.now)) best = { add, drop, rosGain, now };
  }
  return best;
}

/**
 * Up to `maxClaims` claims (default 3). Each takes the best remaining free agent for the roster as it would be after
 * the claims above, with the drop that costs least. Then each claim with a drop gets a backup: the best player who
 * isn't one of the claims, for the same drop. With FAAB, each bid comes from the budget left after the claims above;
 * a backup never bids more than its claim.
 */
export function planClaims(input: ClaimInput): Claim[] {
  let team = [...input.team];
  let droppable = [...input.droppable];
  let spots = input.openSpots;
  let budget = input.budget;
  const out: Claim[] = [];
  const before: Array<{ team: string[]; budget: number | undefined }> = [];
  for (let k = 0; k < (input.maxClaims ?? 3); k++) {
    const best = options(input, team, droppable, spots, input.candidates.filter((id) => !out.some((c) => c.add === id)))[0];
    if (!best || best.rosGain + best.now < MIN_CLAIM) break;
    const claim: Claim = { ...best };
    if (input.bid && budget !== undefined) claim.bid = input.bid(best.add, best.rosGain, budget);
    before.push({ team, budget });
    out.push(claim);
    team = best.drop === undefined ? [...team, best.add] : [...team.filter((x) => x !== best.drop), best.add];
    droppable = droppable.filter((x) => x !== best.drop);
    if (best.drop === undefined) spots--;
    if (budget !== undefined && claim.bid !== undefined) budget = Math.max(0, budget - claim.bid);
  }
  // A backup is conditional only through a shared drop; with an open spot it would simply be a second add.
  const taken = new Set(out.map((c) => c.add));
  out.forEach((claim, k) => {
    if (claim.drop === undefined) return;
    const state = before[k]!;
    const backup = forDrop(input, state.team, claim.drop, input.candidates.filter((id) => !taken.has(id)));
    if (!backup) return;
    claim.backup = backup;
    if (input.bid && state.budget !== undefined) backup.bid = Math.min(claim.bid ?? Infinity, input.bid(backup.add, backup.rosGain, state.budget));
    taken.add(backup.add);
  });
  return out;
}
