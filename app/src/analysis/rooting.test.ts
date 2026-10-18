import { describe, expect, it } from 'vitest';
import { normCdf } from '../engine/math';
import type { LineupAnalysis, PlayerRow } from './analyze';
import { rootingGuide } from './rooting';

const H = 3_600_000;
const NOW = Date.parse('2026-10-18T19:00:00Z');
const row = (id: string, pos: string, team: string, opponent: string, home: boolean, mu: number, sd: number, extra: Partial<PlayerRow> = {}): PlayerRow => ({
  id,
  name: id,
  pos,
  fpos: [pos],
  team,
  opponent,
  home,
  kickoff: NOW + H,
  injury: null,
  p: 1,
  mu,
  ev: mu,
  sd,
  locked: false,
  hasProjection: true,
  breakdown: [],
  ...extra,
});
const analysis = (mine: PlayerRow[], theirs: PlayerRow[], margin: { mean: number; variance: number }, win: number) =>
  ({
    current: mine,
    marginCurrent: margin,
    winProbCurrent: win,
    opponent: { rosterId: 2, name: 'Theirs', rows: theirs, bySlot: theirs, points: 0, dist: { mean: 0, variance: 0 } },
  }) as unknown as LineupAnalysis;

describe('rooting guide', () => {
  const qb = row('qb', 'QB', 'KC', 'BUF', true, 20, 8);
  const wr = row('wr', 'WR', 'KC', 'BUF', true, 12, 7);
  const theirQb = row('oqb', 'QB', 'BUF', 'KC', false, 18, 7);
  const theirRb = row('orb', 'RB', 'DAL', 'NYG', true, 10, 6);
  const done = row('old', 'WR', 'SEA', 'DEN', false, 9, 5, { kickoff: NOW - 4 * H, locked: true, actual: 14 });
  const close = analysis([qb, wr, done], [theirQb, theirRb], { mean: 3, variance: 400 }, 0.56);
  const lopsided = analysis([qb], [], { mean: -40, variance: 200 }, 0.002);

  it('says whom to root for in each game across leagues, and how much each league can move', () => {
    const guide = rootingGuide(
      [
        { leagueId: 'A', name: 'League A', a: close },
        { leagueId: 'B', name: 'League B', a: lopsided },
      ],
      NOW,
    );
    // The finished game is gone; the game with the most at stake comes first.
    expect(guide.map((g) => g.game)).toEqual(['BUF@KC', 'NYG@DAL']);
    const g = guide[0]!;
    expect(g.sides.map((s) => [s.team, s.unit, s.net])).toEqual([
      ['KC', 'offense', 20 + 12 + 20],
      ['BUF', 'offense', -18],
    ]);
    expect(g.sides[0]!.yours.map((p) => [p.row.id, p.leagues])).toEqual([['qb', 2], ['wr', 1]]);
    expect(g.sides[1]!.theirs.map((p) => p.row.id)).toEqual(['oqb']);
    // League A: the game's net (my QB and WR minus their QB, teammates and the QB duel correlated) moves the margin one for one.
    const v = 64 + 49 + 49 + 2 * 0.3 * 8 * 7 - 2 * 0.1 * 8 * 7;
    const a = g.stakes.find((s) => s.leagueId === 'A')!;
    expect(a.good).toBeCloseTo(normCdf((3 + Math.sqrt(v)) / Math.sqrt(400 - v)), 9);
    expect(a.bad).toBeCloseTo(normCdf((3 - Math.sqrt(v)) / Math.sqrt(400 - v)), 9);
    expect(a.now).toBe(0.56);
    // League B is all but lost: little to gain there, so it comes after A.
    expect(g.stakes.map((s) => s.leagueId)).toEqual(['A', 'B']);
    expect(g.swing).toBeCloseTo(g.stakes.reduce((x, s) => x + s.good - s.bad, 0), 12);
    // Their RB's game: root against his side.
    expect(guide[1]!.sides).toEqual([expect.objectContaining({ team: 'DAL', unit: 'offense', net: -10 })]);
  });

  it("leaves out players with nothing left to score, and orders games nothing can swing by kickoff", () => {
    const out = row('out', 'RB', 'KC', 'BUF', true, 0, 4, { p: 0, ev: 0, injury: 'Out' });
    const early = row('early', 'WR', 'NYJ', 'MIA', true, 10, 6, { kickoff: NOW + H });
    const late = row('late', 'WR', 'SF', 'LAR', true, 10, 6, { kickoff: NOW + 4 * H });
    const decided = analysis([late, early, out], [], { mean: 90, variance: 100 }, 1);
    const guide = rootingGuide([{ leagueId: 'A', name: 'A', a: decided }], NOW);
    expect(guide.map((g) => g.game)).toEqual(['MIA@NYJ', 'LAR@SF']);
  });

  it("counts only what's left of a game under way, and a defense on its own side", () => {
    const live = row('wr2', 'WR', 'KC', 'BUF', true, 12, 7, { kickoff: NOW - 1.625 * H, locked: true, actual: 9 });
    const def = row('def', 'DEF', 'BUF', 'KC', false, 8, 5);
    const g = rootingGuide([{ leagueId: 'A', name: 'A', a: analysis([live, def], [], { mean: 5, variance: 100 }, 0.7) }], NOW)[0]!;
    expect(g.live).toBe(true);
    // Half the game left: 6 of his 12 expected points.
    expect(g.sides.find((s) => s.team === 'KC')!.net).toBeCloseTo(6, 9);
    expect(g.sides.find((s) => s.team === 'BUF')).toMatchObject({ unit: 'defense', net: 8 });
  });
});
