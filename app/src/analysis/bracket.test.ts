import { describe, expect, it } from 'vitest';
import type { BracketMatch } from '../domain/types';
import { parseBracket } from '../sleeper/parse';
import type { RawBracketMatch } from '../sleeper/raw';
import { bracketState, simulateBracket, titlePath, type BracketTeam } from './bracket';

// The shape of a real 6-team winners' bracket (a league pull, 2026-10-15): two first-round games, the top two seeds
// waiting in round 2, and placement games for 5th and 3rd beside the final.
const raw: RawBracketMatch[] = [
  { m: 6, r: 3, p: 1, t1: null, t2: null, t1_from: { w: 3 }, t2_from: { w: 4 }, w: null, l: null },
  { m: 1, r: 1, t1: 1, t2: 3, w: null, l: null },
  { m: 2, r: 1, t1: 9, t2: 7, w: null, l: null },
  { m: 3, r: 2, t1: 2, t2: null, t2_from: { w: 1 }, w: null, l: null },
  { m: 4, r: 2, t1: 6, t2: null, t2_from: { w: 2 }, w: null, l: null },
  { m: 5, r: 2, p: 5, t1: null, t2: null, t1_from: { l: 1 }, t2_from: { l: 2 }, w: null, l: null },
  { m: 7, r: 3, p: 3, t1: null, t2: null, t1_from: { l: 3 }, t2_from: { l: 4 }, w: null, l: null },
];
const bracket = parseBracket(raw);
// Seeds by regular-season finish: 2 and 6 have the byes.
const seeds = new Map([
  [2, 1],
  [6, 2],
  [1, 3],
  [9, 4],
  [7, 5],
  [3, 6],
]);
const decide = (b: BracketMatch[], results: Record<number, [number, number]>): BracketMatch[] =>
  b.map((m) => (results[m.id] ? { ...m, winner: results[m.id]![0], loser: results[m.id]![1] } : m));
/** Every team scores the same certain total in every round (three rounds). */
const fixed = (scores: Record<number, number>, variance = 0): BracketTeam[] =>
  Object.entries(scores).map(([id, mean]) => ({ rosterId: Number(id), rounds: [0, 1, 2].map(() => ({ mean, variance })) }));
const scores = { 1: 100, 3: 110, 9: 90, 7: 95, 2: 105, 6: 120 };

describe('Sleeper bracket', () => {
  it('parses slots, sources and placement games, in round order', () => {
    expect(bracket.map((m) => m.id)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(bracket[2]).toEqual({ id: 3, round: 2, slots: [{ rosterId: 2 }, { rosterId: null, from: { match: 1, take: 'winner' } }], winner: null, loser: null });
    expect(bracket[4]!.slots[0]).toEqual({ rosterId: null, from: { match: 1, take: 'loser' } });
    expect(bracket[5]!.place).toBe(1);
    expect(parseBracket(null)).toEqual([]);
    // The title path leaves out the 5th- and 3rd-place games.
    expect(titlePath(bracket).map((m) => m.id)).toEqual([1, 2, 3, 4, 6]);
  });

  it('knows who is alive, who had a bye, and the round being played', () => {
    const before = bracketState(bracket);
    expect([...before.alive].sort()).toEqual([1, 2, 3, 6, 7, 9]);
    expect([...before.byes].sort()).toEqual([2, 6]);
    expect([before.rounds, before.currentRound]).toEqual([3, 1]);

    const afterRound1 = bracketState(decide(bracket, { 1: [3, 1], 2: [7, 9] }));
    expect([...afterRound1.alive].sort()).toEqual([2, 3, 6, 7]);
    expect(afterRound1.outIn.get(1)).toBe(1);
    expect(afterRound1.currentRound).toBe(2);
    expect(afterRound1.games.find((g) => g.match === 3)!.teams).toEqual([2, 3]);
    expect(afterRound1.games.find((g) => g.match === 4)!.teams).toEqual([6, 7]);

    const done = bracketState(decide(bracket, { 1: [3, 1], 2: [7, 9], 3: [3, 2], 4: [6, 7], 6: [6, 3] }));
    expect(done.champion).toBe(6);
    expect(done.currentRound).toBe(4);
    expect([...done.alive]).toEqual([6]);
  });
});

// A finished 6-team bracket as Sleeper returns it (a 2025 league, roster ids changed): once a game is decided, Sleeper
// fills the later slots it feeds and keeps the `from` reference beside them.
const finished: RawBracketMatch[] = [
  { m: 1, r: 1, t1: 9, t2: 3, w: 3, l: 9 },
  { m: 2, r: 1, t1: 5, t2: 8, w: 8, l: 5 },
  { m: 3, r: 2, t1: 1, t2: 3, t2_from: { w: 1 }, w: 1, l: 3 },
  { m: 4, r: 2, t1: 4, t2: 8, t2_from: { w: 2 }, w: 8, l: 4 },
  { m: 5, r: 2, p: 5, t1: 9, t2: 5, t1_from: { l: 1 }, t2_from: { l: 2 }, w: 9, l: 5 },
  { m: 6, r: 3, p: 1, t1: 1, t2: 8, t1_from: { w: 3 }, t2_from: { w: 4 }, w: 8, l: 1 },
  { m: 7, r: 3, p: 3, t1: 3, t2: 4, t1_from: { l: 3 }, t2_from: { l: 4 }, w: 4, l: 3 },
];

describe('a finished bracket as Sleeper returns it', () => {
  const done = parseBracket(finished);
  const teams = fixed({ 1: 120, 3: 110, 4: 100, 5: 90, 8: 80, 9: 70 });
  const seeded = new Map([1, 4, 8, 9, 3, 5].map((t, i) => [t, i + 1]));

  it('reads filled slots with their sources, and the champion', () => {
    expect(done[2]!.slots[1]).toEqual({ rosterId: 3, from: { match: 1, take: 'winner' } });
    const st = bracketState(done);
    expect(st.champion).toBe(8);
    expect([...st.alive]).toEqual([8]);
    expect([...st.byes].sort()).toEqual([1, 4]);
    expect([...st.outIn].sort((a, b) => a[0] - b[0])).toEqual([
      [1, 3],
      [3, 2],
      [4, 2],
      [5, 1],
      [9, 1],
    ]);
  });

  it('keeps every result, however the projections lean', () => {
    // The lowest-projected teams won; decided games stand.
    const odds = simulateBracket({ matches: done, teams, seeds: seeded, sims: 20 });
    expect(odds.get(8)).toMatchObject({ pTitle: 1, pRound: [1, 1, 1], pWin: [1, 1, 1] });
    expect(odds.get(1)).toMatchObject({ bye: true, pTitle: 0, pRound: [0, 1, 1], pWin: [0, 1, 0] });
    expect(odds.get(9)).toMatchObject({ alive: false, pRound: [1, 0, 0] });
  });

  it('after round 1, with the round-2 slots filled and no winners yet', () => {
    const mid = done.map((m) => (m.round > 1 ? { ...m, winner: null, loser: null } : m)).map((m) =>
      m.round === 3 ? { ...m, slots: m.slots.map((s) => ({ ...s, rosterId: null })) as typeof m.slots } : m,
    );
    const st = bracketState(mid);
    expect([...st.alive].sort()).toEqual([1, 3, 4, 8]);
    expect(st.currentRound).toBe(2);
    expect(st.games.find((g) => g.match === 3)!.teams).toEqual([1, 3]);
    // 1 and 3 meet, 4 and 8 meet, then the final: 1 (120) beats everyone.
    expect(simulateBracket({ matches: mid, teams, seeds: seeded, sims: 20 }).get(1)!.pTitle).toBe(1);
  });
});

describe('simulateBracket', () => {
  it('plays out the open games from each round’s scores', () => {
    const odds = simulateBracket({ matches: bracket, teams: fixed(scores), seeds, sims: 20 });
    // Round 1: 3 beats 1, 7 beats 9. Round 2: 3 beats 2, 6 beats 7. Final: 6.
    expect(odds.get(6)).toMatchObject({ alive: true, bye: true, pTitle: 1, pRound: [0, 1, 1], pWin: [0, 1, 1] });
    expect(odds.get(3)).toMatchObject({ pTitle: 0, pRound: [1, 1, 1], pWin: [1, 1, 0] });
    expect(odds.get(1)).toMatchObject({ pRound: [1, 0, 0], pWin: [0, 0, 0] });
    expect(odds.get(2)).toMatchObject({ bye: true, pRound: [0, 1, 0] });
  });

  it('keeps decided games as they went, whatever the projections say', () => {
    // 1 and 9 won round 1 although projected to lose; then they meet the bye teams.
    const odds = simulateBracket({ matches: decide(bracket, { 1: [1, 3], 2: [9, 7] }), teams: fixed(scores), seeds, sims: 20 });
    expect(odds.get(3)).toMatchObject({ alive: false, pTitle: 0, pRound: [1, 0, 0], pWin: [0, 0, 0] });
    expect(odds.get(1)).toMatchObject({ alive: true, pRound: [1, 1, 0], pWin: [1, 0, 0] });
    expect(odds.get(6)!.pTitle).toBe(1);
  });

  it('settles the final once Sleeper records it', () => {
    const odds = simulateBracket({ matches: decide(bracket, { 1: [3, 1], 2: [7, 9], 3: [2, 3], 4: [7, 6], 6: [7, 2] }), teams: fixed(scores), seeds, sims: 20 });
    expect(odds.get(7)!.pTitle).toBe(1);
    expect([...odds.values()].filter((x) => x.alive).map((x) => x.rosterId)).toEqual([7]);
  });

  it('gives a tied game to the better seed', () => {
    const odds = simulateBracket({ matches: bracket, teams: fixed({ 1: 100, 3: 100, 9: 100, 7: 100, 2: 100, 6: 100 }), seeds, sims: 20 });
    // 1 (seed 3) beats 3 (seed 6), 9 (seed 4) beats 7 (seed 5); then the bye seeds 2 and 6 win out; seed 1 (team 2) wins the final.
    expect(odds.get(2)!.pTitle).toBe(1);
    expect(odds.get(1)!.pWin).toEqual([1, 0, 0]);
    expect(odds.get(9)!.pWin).toEqual([1, 0, 0]);
  });

  it('splits an even final, and drift makes a lopsided one less sure', () => {
    const final = decide(bracket, { 1: [3, 1], 2: [7, 9], 3: [3, 2], 4: [6, 7] });
    const even = simulateBracket({ matches: final, teams: fixed({ ...scores, 3: 120, 6: 120 }, 400), seeds, sims: 4000 });
    expect(even.get(3)!.pTitle + even.get(6)!.pTitle).toBeCloseTo(1, 9);
    expect(even.get(3)!.pTitle).toBeCloseTo(0.5, 1);
    // 10 points apart with no weekly noise: the favourite always wins, unless the final is still weeks away and teams drift.
    const lopsided = fixed({ ...scores, 3: 110, 6: 120 });
    expect(simulateBracket({ matches: final, teams: lopsided, seeds, sims: 2000 }).get(6)!.pTitle).toBe(1);
    const drifting = simulateBracket({ matches: final, teams: lopsided.map((t) => ({ ...t, drift: 6 })), futureWeeks: [0, 0, 2], seeds, sims: 2000 });
    expect(drifting.get(6)!.pTitle).toBeLessThan(0.95);
    expect(drifting.get(6)!.pTitle).toBeGreaterThan(0.6);
  });
});
