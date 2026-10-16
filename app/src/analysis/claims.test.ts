import { describe, expect, it } from 'vitest';
import { MIN_CLAIM, planClaims, type ClaimInput } from './claims';

// A toy league: one RB slot and one WR slot, each worth its best player's value.
const POS: Record<string, 'RB' | 'WR'> = { x: 'RB', y: 'WR', z: 'RB', a: 'RB', b: 'RB', c: 'WR', d: 'WR' };
const VAL: Record<string, number> = { x: 5, y: 4, z: 1, a: 10, b: 8, c: 6, d: 4.5 };
const value = (team: readonly string[]) =>
  (['RB', 'WR'] as const).reduce((s, pos) => s + Math.max(0, ...team.filter((id) => POS[id] === pos).map((id) => VAL[id]!)), 0);

const input = (over: Partial<ClaimInput> = {}): ClaimInput => ({
  value,
  team: ['x', 'y', 'z'],
  droppable: ['x', 'y', 'z'],
  openSpots: 0,
  candidates: ['a', 'b', 'c', 'd'],
  ...over,
});

describe('planClaims', () => {
  it('orders claims, each with its cheapest drop, assuming the ones above went through', () => {
    const plan = planClaims(input());
    // 1: the 10-point RB for the bench RB (who adds nothing); 2: the 6-point WR, now for the old starting RB.
    expect(plan.map((c) => [c.add, c.drop, c.rosGain])).toEqual([
      ['a', 'z', 5],
      ['c', 'x', 2],
    ]);
  });

  it('backs a claim up with the next best player for the same drop', () => {
    const [first, second] = planClaims(input());
    expect(first!.backup).toMatchObject({ add: 'b', drop: 'z', rosGain: 3 });
    // The backup RB isn't claimed again later; the 4.5 WR would add only 0.5 after the 6.
    expect(second!.backup).toBeUndefined();
  });

  it('stops below the smallest gain worth a claim', () => {
    expect(planClaims(input({ candidates: ['d'] }))).toEqual([]);
    expect(MIN_CLAIM).toBe(2);
  });

  it('counts this week, and uses open spots without drops or backups', () => {
    const plan = planClaims(input({ openSpots: 1, thisWeek: (_, id) => (id === 'c' ? 3 : 0) }));
    // The WR's 2 for the season plus 3 this week beats nothing; the RB's 5 still leads.
    expect(plan[0]).toMatchObject({ add: 'a', rosGain: 5, now: 0 });
    expect(plan[0]!.drop).toBeUndefined();
    expect(plan[0]!.backup).toBeUndefined();
    expect(plan[1]).toMatchObject({ add: 'c', drop: 'x', rosGain: 2, now: 3 });
  });

  it('bids from the budget left after the claims above, and never more on a backup', () => {
    const plan = planClaims(input({ budget: 20, bid: (id, gain, left) => Math.min(left, Math.round(gain * (id === 'b' ? 6 : 2))) }));
    expect(plan.map((c) => c.bid)).toEqual([10, 4]);
    // The backup's own price (3 × 6 = 18) is capped at its claim's 10.
    expect(plan[0]!.backup!.bid).toBe(10);
    const tight = planClaims(input({ budget: 11, bid: (_, gain, left) => Math.min(left, Math.round(gain * 2)) }));
    expect(tight.map((c) => c.bid)).toEqual([10, 1]);
  });

  it('stops at the claim limit', () => {
    expect(planClaims(input({ maxClaims: 1 }))).toHaveLength(1);
  });
});
