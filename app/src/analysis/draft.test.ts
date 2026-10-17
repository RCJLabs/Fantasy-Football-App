import { describe, expect, it } from 'vitest';
import type { NextSeasonFile } from '../data/contracts';
import type { League, Player, Roster } from '../domain/types';
import {
  allowedPick,
  BENCH_SHARE,
  buildBoard,
  compareSlots,
  type DraftSetup,
  fillLineup,
  lineupValue,
  livePicks,
  nextPick,
  pickOrder,
  pickOwners,
  placeKeepers,
  positionCaps,
  predictKeepers,
  replacementLevels,
  roundValues,
  simulateRest,
  sleeperDraftOrder,
  suggest,
  suggestAhead,
  withSlot,
} from './draft';

const SLOTS = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF', 'BN', 'BN', 'BN'];
const league = (over: Partial<League> = {}): League => ({
  id: 'L',
  name: 'Invented League',
  season: '2026',
  status: 'in_season',
  rosterPositions: SLOTS,
  scoring: { rec: 1, rec_yd: 0.1, rush_yd: 0.1, pass_yd: 0.04, pass_td: 4, fgm_40_49: 4, xpm: 1, sack: 1 },
  rules: { type: 'redraft', bestBall: false, medianGame: false, numTeams: 4, reserveSlots: 0, taxiSlots: 0, reserveAllow: {}, pickTrading: false },
  ...over,
});

/** An invented pool: n players at a position, the first best. */
const pool = (pos: string, n: number, line: (i: number) => Record<string, number>) =>
  Object.fromEntries(Array.from({ length: n }, (_, i) => [`${pos}${i + 1}`, { n: `${pos} Player ${i + 1}`, pos, s: line(i), g: 15 }]));
const next = (over: Partial<NextSeasonFile> = {}): NextSeasonFile => ({
  schemaVersion: 1,
  generatedAt: '2026-10-17T00:00:00Z',
  season: '2026',
  target: '2027',
  basis: { season: '2026', weeks: 6 },
  players: {
    ...pool('QB', 8, (i) => ({ pass_yd: 280 - 10 * i, pass_td: 2 })),
    ...pool('RB', 16, (i) => ({ rush_yd: 100 - 5 * i, rec: 3 })),
    ...pool('WR', 20, (i) => ({ rec: 8 - 0.3 * i, rec_yd: 90 - 4 * i })),
    ...pool('TE', 8, (i) => ({ rec: 6 - 0.5 * i, rec_yd: 60 - 5 * i })),
    ...pool('K', 6, (i) => ({ fgm_40_49: 1.2 - 0.1 * i, xpm: 2 })),
    ...pool('DEF', 6, (i) => ({ sack: 3 - 0.2 * i })),
  },
  rookies: [{ pos: 'RB', order: 1, s: { rush_yd: 90, rec: 2 }, g: 14 }],
  range: { RB: [0.1, 1.9] },
  ...over,
});
const noPlayers = new Map<string, Player>();

describe('draft board', () => {
  it("scores next season by the league's settings and ranks by value over replacement", () => {
    const b = buildBoard(league(), next(), noPlayers);
    const rb1 = b.players.find((p) => p.id === 'RB1')!;
    expect(rb1.ppg).toBeCloseTo(10 + 3, 9);
    expect(rb1.points).toBeCloseTo(13 * 15, 9);
    expect(rb1.range).toEqual([rb1.points * 0.1, rb1.points * 1.9]);
    // The rookie placeholder is on the board under a plain name.
    expect(b.players.find((p) => p.id === 'rookie:RB:1')).toMatchObject({ name: 'Rookie RB: the first taken', rookie: { order: 1, named: false } });
    // Ranks follow value over replacement.
    expect(b.players.map((p) => p.rank)).toEqual(b.players.map((_, i) => i + 1));
    expect(b.players.every((p, i) => i === 0 || b.players[i - 1]!.vor >= p.vor)).toBe(true);
    // The 4 teams start 4 QBs: the replacement is the 5th QB.
    expect(b.replacement.QB).toBeCloseTo((280 - 40) * 0.04 + 8, 9);
    // In PPR a reception is worth more: WR1's value rises against a no-PPR league.
    const std = buildBoard(league({ scoring: { ...league().scoring, rec: 0 } }), next(), noPlayers);
    expect(b.players.find((p) => p.id === 'WR1')!.ppg - std.players.find((p) => p.id === 'WR1')!.ppg).toBeCloseTo(8, 9);
  });

  it("leaves out positions the league can't start, and takes names and slots from the player file", () => {
    const noK = buildBoard(league({ rosterPositions: SLOTS.filter((s) => s !== 'K') }), next(), noPlayers);
    expect(noK.players.some((p) => p.pos === 'K')).toBe(false);
    const players = new Map<string, Player>([['TE1', { id: 'TE1', name: 'Invented Tight End', pos: 'TE', fpos: ['TE', 'WR'], team: 'NYJ', injury: null }]]);
    expect(buildBoard(league(), next(), players).players.find((p) => p.id === 'TE1')).toMatchObject({ name: 'Invented Tight End', fpos: ['TE', 'WR'], team: 'NYJ' });
  });

  it('fills dedicated slots first, then each flex with the best left', () => {
    const rows = [
      { pos: 'RB', fpos: ['RB'], ppg: 20, points: 300 },
      { pos: 'RB', fpos: ['RB'], ppg: 15, points: 250 },
      { pos: 'RB', fpos: ['RB'], ppg: 12, points: 200 },
      { pos: 'WR', fpos: ['WR'], ppg: 11, points: 180 },
      { pos: 'WR', fpos: ['WR'], ppg: 10, points: 150 },
    ];
    // One team, RB + WR + FLEX: RB1, WR1, then the flex goes to RB2 (250 points beats WR2's 150).
    expect(replacementLevels(rows, ['RB', 'WR', 'FLEX'], 1)).toEqual({ RB: 12, WR: 10 });
  });
});

describe('lineups', () => {
  const b = buildBoard(league(), next(), noPlayers);
  const get = (id: string) => b.players.find((p) => p.id === id)!;

  it('values a roster as its starters plus a share of its bench', () => {
    const team = [get('QB1'), get('QB2'), get('RB1')];
    const { starters, bench } = fillLineup(team, b.slots);
    expect(starters.filter(Boolean).map((p) => p!.id).sort()).toEqual(['QB1', 'RB1']);
    expect(bench.map((p) => p.id)).toEqual(['QB2']);
    expect(lineupValue(team, b.slots)).toBeCloseTo(get('QB1').vor + get('RB1').vor + BENCH_SHARE * Math.max(0, get('QB2').vor), 9);
  });

  it("drafts like a manager: position limits, kickers and defenses last, and starters filled before the end", () => {
    const caps = positionCaps(b.slots);
    expect(caps).toEqual({ QB: 2, RB: 7, WR: 7, TE: 2, K: 1, DEF: 1 });
    expect(allowedPick([get('QB1'), get('QB2')], get('QB3'), 10, b.slots, caps)).toBe(false);
    expect(allowedPick([], get('K1'), 10, b.slots, caps)).toBe(false);
    expect(allowedPick([], get('K1'), 3, b.slots, caps)).toBe(true);
    // Two picks left, two open slots (K and DEF): a third RB has to wait.
    const nearlyDone = ['QB1', 'RB1', 'RB2', 'WR1', 'WR2', 'TE1', 'RB3'].map(get);
    expect(allowedPick(nearlyDone, get('RB4'), 2, b.slots, caps)).toBe(false);
    expect(allowedPick(nearlyDone, get('DEF1'), 2, b.slots, caps)).toBe(true);
  });
});

describe('keepers', () => {
  const b = buildBoard(league({ rules: { ...league().rules, type: 'keeper', maxKeepers: 2 } }), next(), noPlayers);
  const rosters: Roster[] = [1, 2].map((rosterId) => ({
    rosterId,
    ownerId: `u${rosterId}`,
    coOwners: [],
    players: rosterId === 1 ? ['RB1', 'WR1', 'QB8', 'K1'] : ['WR2', 'TE1'],
    starters: [],
    reserve: rosterId === 1 ? ['RB2'] : [],
    taxi: [],
    wins: 0,
    losses: 0,
    ties: 0,
    pointsFor: 0,
    waiverBudgetUsed: 0,
  }));

  it("keeps each team's best value over the pick a keeper costs, up to the count", () => {
    const values = roundValues(b, 12);
    expect(values[0]).toBeGreaterThan(values[11]!);
    const kept = predictKeepers(b, rosters, { count: 2, cost: 'last' }, 12);
    const team1 = kept.filter((k) => k.rosterId === 1).map((k) => k.id);
    expect(team1).toHaveLength(2);
    expect(team1).toEqual([...team1].sort((x, y) => b.players.find((p) => p.id === y)!.vor - b.players.find((p) => p.id === x)!.vor));
    expect(team1).not.toContain('QB8');
    // Drafted in round 1 last year: keeping RB1 costs a 1st, so he's worth less as a keeper than a late pick.
    const drafted = predictKeepers(b, rosters, { count: 2, cost: 'drafted' }, 12, new Map([['RB1', 1], ['WR1', 11]]));
    const rb1 = drafted.find((k) => k.id === 'RB1');
    const wr1 = drafted.find((k) => k.id === 'WR1')!;
    expect(wr1.round).toBe(11);
    expect(rb1 === undefined || rb1.surplus < wr1.surplus).toBe(true);
  });

  it('places keepers at their teams\' picks, moving a clash to the nearest free round', () => {
    const picks = pickOrder([1, 2, 3, 4], 3, 'snake');
    const fixed = placeKeepers(picks, 4, [
      { rosterId: 2, id: 'A', round: 3, surplus: 9 },
      { rosterId: 2, id: 'B', round: 3, surplus: 5 },
    ]);
    // Team 2 picks 2nd in rounds 1 and 3 (index 1 and 9) and 3rd in round 2 (index 6).
    expect([...fixed]).toEqual([
      [9, 'A'],
      [6, 'B'],
    ]);
  });
});

describe('pick order', () => {
  it('snakes, runs straight, or reverses in round 3', () => {
    expect(pickOrder([1, 2, 3], 4, 'snake')).toEqual([1, 2, 3, 3, 2, 1, 1, 2, 3, 3, 2, 1]);
    expect(pickOrder([1, 2, 3], 2, 'linear')).toEqual([1, 2, 3, 1, 2, 3]);
    expect(pickOrder([1, 2, 3], 4, '3rr')).toEqual([1, 2, 3, 3, 2, 1, 3, 2, 1, 1, 2, 3]);
    expect(withSlot([1, 2, 3, 4], 3, 1)).toEqual([3, 1, 2, 4]);
    expect(withSlot([1, 2, 3, 4], 1, 4)).toEqual([2, 3, 4, 1]);
  });
});

describe('mock draft', () => {
  const b = buildBoard(league(), next(), noPlayers);
  const picks = pickOrder([1, 2, 3, 4], 12, 'snake');
  const setup: DraftSetup = { board: b, picks, numTeams: 4, taken: [] };

  it("fills every pick the way managers do: everyone's lineup filled, one kicker and one defense each", () => {
    const taken = simulateRest(setup, 1, { seed: 3 });
    expect(taken.every((t) => t !== undefined)).toBe(true);
    expect(new Set(taken).size).toBe(picks.length);
    for (const team of [1, 2, 3, 4]) {
      const mine = taken.filter((_, i) => picks[i] === team).map((id) => b.players.find((p) => p.id === id)!);
      expect(mine.filter((p) => p.pos === 'K')).toHaveLength(1);
      expect(mine.filter((p) => p.pos === 'DEF')).toHaveLength(1);
      expect(fillLineup(mine, b.slots).starters.every(Boolean)).toBe(true);
    }
    // Seeded: the same draft every time.
    expect(simulateRest(setup, 1, { seed: 3 })).toEqual(taken);
  });

  it("suggests what adds most to your lineup and how likely each is to come back", () => {
    const s = suggest(setup, 0, { sims: 100 });
    expect(s.length).toBeGreaterThan(3);
    expect(s.every((x, i) => i === 0 || s[i - 1]!.gain >= x.gain)).toBe(true);
    expect(s.every((x) => x.nextAvailable! >= 0 && x.nextAvailable! <= 1)).toBe(true);
    // Six picks go before team 1's next: the best player is very unlikely to last, a lesser one likelier.
    expect(s[0]!.nextAvailable!).toBeLessThan(s.at(-1)!.nextAvailable! + 1e-9);
    expect(nextPick(setup, 1, 0)).toBe(7);
  });

  it('compares first-round slots for an order not yet set', () => {
    const slots = compareSlots({ board: b, order: [1, 2, 3, 4], rounds: 12, style: 'snake', me: 1 }, { sims: 10 });
    expect(slots.map((s) => s.slot)).toEqual([1, 2, 3, 4]);
    expect(slots.every((s) => Number.isFinite(s.value) && s.value > 0)).toBe(true);
  });
});

describe("Sleeper's draft", () => {
  const roster = (rosterId: number, ownerId: string | null, coOwners: string[] = []): Roster => ({
    rosterId,
    ownerId,
    coOwners,
    players: [],
    starters: [],
    reserve: [],
    taxi: [],
    wins: 0,
    losses: 0,
    ties: 0,
    pointsFor: 0,
    waiverBudgetUsed: 0,
  });
  const rosters = [roster(1, 'u1'), roster(2, 'u2', ['c2']), roster(3, 'u3'), roster(4, null)];

  it('reads the order from draft_order (user → slot), through owners and co-owners', () => {
    // As on real drafts: slot_to_roster_id empty, draft_order set.
    expect(sleeperDraftOrder({ draft_order: { u3: 1, u1: 2, c2: 3, u4: 4 }, slot_to_roster_id: null }, rosters)).toEqual([3, 1, 2, 4]);
    // A team nobody owns takes the slot left over.
    expect(sleeperDraftOrder({ draft_order: { u3: 1, u1: 2, u2: 4 } }, rosters)).toEqual([3, 1, 4, 2]);
    expect(sleeperDraftOrder({ draft_order: null, slot_to_roster_id: { '1': 2, '2': 1, '3': 4, '4': 3 } }, rosters)).toEqual([2, 1, 4, 3]);
    expect(sleeperDraftOrder({ draft_order: null }, rosters)).toBeUndefined();
    expect(sleeperDraftOrder(undefined, rosters)).toBeUndefined();
  });

  it("moves traded picks to their new owners, and places Sleeper's picks by pick number", () => {
    const original = pickOrder([3, 1, 2, 4], 3, 'snake');
    const traded = [
      { season: '2027', round: 2, roster_id: 4, owner_id: 1, previous_owner_id: 4 },
      { season: '2028', round: 1, roster_id: 3, owner_id: 2 },
    ];
    expect(pickOwners(original, 4, traded, '2027')).toEqual([3, 1, 2, 4, 1, 2, 1, 3, 3, 1, 2, 4]);
    const live = livePicks(
      [
        { pick_no: 1, player_id: 'a', roster_id: 3 },
        { pick_no: 2, player_id: 'b', roster_id: 1 },
        { pick_no: 4, player_id: 'c', roster_id: 2 },
        { pick_no: 40, player_id: 'z', roster_id: 1 },
      ],
      12,
    );
    expect(live.taken.slice(0, 5)).toEqual(['a', 'b', undefined, 'c', undefined]);
    expect(live.by[3]).toBe(2);
  });

  it("looks ahead to your pick while another team is on the clock", () => {
    const b = buildBoard(league(), next(), noPlayers);
    const picks = pickOrder([1, 2, 3, 4], 12, 'snake');
    const setup: DraftSetup = { board: b, picks, numTeams: 4, taken: [b.players[0]!.id] };
    // Team 3 picks 3rd: two picks to go before it, so the best players are likely gone.
    const ahead = suggestAhead(setup, 3, 1, { sims: 100 })!;
    expect(ahead.at).toBe(2);
    expect(ahead.suggestions.every((x) => x.nextAvailable! >= 0 && x.nextAvailable! <= 1)).toBe(true);
    expect(ahead.suggestions.some((x) => x.nextAvailable! < 1)).toBe(true);
    // On the clock: the chance is for the pick after.
    expect(suggestAhead(setup, 2, 1, { sims: 50 })!.at).toBe(1);
    expect(suggestAhead({ ...setup, taken: picks.map(() => 'x') }, 2, 0)).toBeUndefined();
  });
});
