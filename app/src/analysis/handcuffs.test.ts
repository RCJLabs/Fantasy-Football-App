import { describe, expect, it } from 'vitest';
import type { Player, StatLine } from '../domain/types';
import { parseLeague, parseMatchup, parseRoster, type ProjectionIndex } from '../sleeper/parse';
import { gamesByTeam, type WeekContext } from './analyze';
import { depthIndex, handcuffs, INHERIT, nextManUp, nextUpForOut } from './handcuffs';
import { buildOutlook } from './outlook';
import { futurePlay } from './ros';

// No playoffs: weeks 7–18 all count fully. One QB and one RB slot, so a starter's backup fills in alone.
const league = parseLeague({
  league_id: 'H',
  name: 'Handcuffs',
  season: '2026',
  status: 'in_season',
  total_rosters: 4,
  roster_positions: ['QB', 'RB', 'BN', 'BN', 'BN'],
  scoring_settings: { pass_yd: 0.04, pass_td: 4, rush_yd: 0.1, rush_td: 6, rec: 0.5, rec_yd: 0.1 },
  settings: { type: 0, num_teams: 4, last_scored_leg: 6 },
});

type Spec = [id: string, pos: string, team: string, depth: number, stats: StatLine, injury?: Player['injury']];
const SPECS: Spec[] = [
  ['q1', 'QB', 'AAA', 1, { pass_yd: 250, pass_td: 2 }], // 18
  ['q2', 'QB', 'AAA', 2, { pass_yd: 10 }], // 0.4
  ['s1', 'RB', 'BBB', 1, { rush_yd: 80, rush_td: 0.5 }], // 11
  ['b1', 'RB', 'BBB', 2, { rush_yd: 30 }], // 3
  ['w1', 'WR', 'CCC', 1, { rec: 5, rec_yd: 60 }],
  // A strong RB elsewhere: rostered by team 3 unless a test frees him.
  ['fr', 'RB', 'DDD', 1, { rush_yd: 200 }], // 20
];
const players = new Map(
  SPECS.map(([id, pos, team, depth, , injury]) => [id, { id, name: id, pos, fpos: [pos], team, injury: injury ?? null, depthPos: pos, depthOrder: depth } as Player]),
);
/** Every player projected every week, unless `skip` says otherwise. */
const index = (week: number, skip?: (id: string, week: number) => boolean): ProjectionIndex => ({
  byPlayer: new Map(SPECS.filter(([id]) => !skip?.(id, week)).map(([id, , team, , stats]) => [id, { playerId: id, week, stats, team }])),
  players: new Map(),
  statKeys: new Set(),
});

function outlook(
  mine: string[],
  other: string[] = [],
  opts: { players?: Map<string, Player>; skip?: (id: string, week: number) => boolean; third?: string[] } = {},
) {
  const rosters = [
    parseRoster({ roster_id: 1, owner_id: 'u1', players: mine, starters: [] }),
    parseRoster({ roster_id: 2, owner_id: 'u2', players: other, starters: [] }),
    parseRoster({ roster_id: 3, owner_id: 'u3', players: opts.third ?? ['fr'], starters: [] }),
    parseRoster({ roster_id: 4, owner_id: 'u4', players: [], starters: [] }),
  ];
  const now = Date.UTC(2026, 9, 15, 12);
  const ctx: WeekContext = { season: '2026', week: 6, now, players: opts.players ?? players, projections: index(6, opts.skip), gamesByTeam: gamesByTeam([], 6) };
  const byWeek = new Map(Array.from({ length: 12 }, (_, i) => [7 + i, index(7 + i, opts.skip)]));
  const pair = parseMatchup;
  const matchups = [1, 2, 3, 4].map((r) => pair({ roster_id: r, matchup_id: r <= 2 ? 1 : 2, starters: [], players: [], points: 0 }));
  return buildOutlook({ league, rosters, users: [], matchups, ctx, byWeek, schedule: new Map(), sims: 200 });
}

/** Σ over weeks 7–18 of the starter's chance to miss × the backup's chance to play × his points in the bigger role. */
const expectedBonus = (pos: string, points: number) =>
  Array.from({ length: 12 }, (_, i) => (1 - futurePlay(pos, null, i + 1)) * futurePlay(pos, null, i + 1) * points).reduce((a, b) => a + b, 0);

describe('depth charts', () => {
  const idx = depthIndex(players.values());
  it('finds the No. 2 behind a QB, RB or TE who heads the chart', () => {
    expect(nextManUp(idx, players.get('s1')!)?.id).toBe('b1');
    expect(nextManUp(idx, players.get('q1')!)?.id).toBe('q2');
    // Not the head of the chart, or a receiver: none.
    expect(nextManUp(idx, players.get('b1')!)).toBeUndefined();
    expect(nextManUp(idx, players.get('w1')!)).toBeUndefined();
  });

  it('tags the backup when the starter is out now', () => {
    const hurt = new Map(players);
    hurt.set('s1', { ...players.get('s1')!, injury: 'IR' });
    expect([...nextUpForOut(hurt)].map(([b, s]) => [b, s.id])).toEqual([['b1', 's1']]);
    expect(nextUpForOut(players).size).toBe(0);
  });
});

describe('handcuffs', () => {
  it('values a free-agent backup by the chance the starter misses each week and the share he inherits', () => {
    const rows = handcuffs(outlook(['q1', 's1']), 1, players);
    const byStarter = new Map(rows.map((h) => [h.starter, h]));
    const rb = byStarter.get('s1')!;
    expect(rb).toMatchObject({ backup: 'b1', owner: 'free', share: INHERIT.RB });
    expect(rb.normal).toBeCloseTo(3, 9);
    expect(rb.elevated).toBeCloseTo(3 + 0.4 * 11, 9);
    // No other RB on the roster or on waivers: in a week the starter misses, the backup fills an empty slot.
    expect(rb.bonus).toBeCloseTo(expectedBonus('RB', 3 + 0.4 * 11), 6);
    expect(rb.missChance).toBeCloseTo(Array.from({ length: 12 }, (_, i) => 1 - futurePlay('RB', null, i + 1)).reduce((a, b) => a + b, 0) / 12, 9);
    const qb = byStarter.get('q1')!;
    expect(qb.backup).toBe('q2');
    expect(qb.bonus).toBeCloseTo(expectedBonus('QB', 0.4 + 0.76 * 18), 6);
    // The QB's handcuff is worth more: he inherits more of a bigger score.
    expect(rows[0]!.starter).toBe('q1');
  });

  it('counts only what the backup adds beyond the best free agent you could add instead', () => {
    // A 20-point RB on waivers would start; the backup only covers that RB's own absences.
    const rb = handcuffs(outlook(['q1', 's1'], [], { third: [] }), 1, players).find((h) => h.starter === 's1')!;
    const expected = Array.from({ length: 12 }, (_, i) => {
      const h = futurePlay('RB', null, i + 1);
      return (1 - h) * (1 - h) * h * (3 + 0.4 * 11);
    }).reduce((a, b) => a + b, 0);
    expect(rb.bonus).toBeCloseTo(expected, 6);
    expect(rb.bonus).toBeLessThan(0.25 * expectedBonus('RB', 3 + 0.4 * 11));
  });

  it("knows when the backup is yours or another team's", () => {
    const yours = handcuffs(outlook(['q1', 's1', 'b1']), 1, players).find((h) => h.starter === 's1')!;
    expect(yours.owner).toBe('mine');
    expect(yours.bonus).toBeCloseTo(expectedBonus('RB', 3 + 0.4 * 11), 6);
    const theirs = handcuffs(outlook(['q1', 's1'], ['b1']), 1, players).find((h) => h.starter === 's1')!;
    expect(theirs.owner).toBe(2);
  });

  it('insures only the weeks Sleeper projects the starter to be back', () => {
    // On IR now, projected again from week 10: weeks 7–9 are the backup's own (his projection carries them).
    const hurt = new Map(players);
    hurt.set('s1', { ...players.get('s1')!, injury: 'IR' });
    const o = outlook(['q1', 's1'], [], { players: hurt, skip: (id, week) => id === 's1' && week < 10 });
    const rb = handcuffs(o, 1, hurt).find((h) => h.starter === 's1')!;
    const expected = Array.from({ length: 9 }, (_, j) => {
      const k = j + 4; // weeks 10–18 are 4–12 weeks ahead
      return (1 - futurePlay('RB', 'IR', k)) * futurePlay('RB', null, k) * (3 + 0.4 * 11);
    }).reduce((a, b) => a + b, 0);
    expect(rb.bonus).toBeCloseTo(expected, 6);
    // Returning from IR, he's likelier to miss a week than a healthy starter.
    expect(rb.missChance).toBeGreaterThan(0.15);
  });
});
