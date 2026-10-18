import { describe, expect, it } from 'vitest';
import { normCdf } from '../engine/math';
import type { LineupAnalysis, PlayerRow } from './analyze';
import { swingPlayers } from './swing';

const H = 3_600_000;
const NOW = Date.parse('2026-10-18T19:00:00Z');
const row = (id: string, extra: Partial<PlayerRow> = {}): PlayerRow => ({
  id,
  name: id,
  pos: 'WR',
  fpos: ['WR'],
  team: id.toUpperCase(),
  opponent: 'ZZZ',
  kickoff: NOW + H,
  injury: null,
  p: 1,
  mu: 10,
  ev: 10,
  sd: 6,
  locked: false,
  hasProjection: true,
  breakdown: [],
  ...extra,
});
const analysis = (mine: PlayerRow[], theirs: PlayerRow[], margin: { mean: number; variance: number }) =>
  ({
    current: mine,
    marginCurrent: margin,
    opponent: { rosterId: 2, name: 'Theirs', rows: theirs, bySlot: theirs, points: 0, dist: { mean: 0, variance: 0 } },
  }) as unknown as LineupAnalysis;

describe('swing players', () => {
  it("ranks starters left to play by how much they move the win chance, yours and theirs", () => {
    const wide = row('aaa', { sd: 9 });
    const narrow = row('bbb', { sd: 4 });
    const done = row('ccc', { kickoff: NOW - 4 * H, locked: true, actual: 20 });
    const theirs = row('ddd', { sd: 6 });
    const a = analysis([wide, narrow, done], [theirs], { mean: 0, variance: 81 + 16 + 36 });
    const s = swingPlayers(a, NOW);
    expect(s.map((x) => x.row.id)).toEqual(['aaa', 'ddd', 'bbb']); // the finished game can't swing anything
    const [w, t] = [s[0]!, s[1]!];
    expect(w.side).toBe('me');
    expect(w.boom).toBeGreaterThan(0.5);
    expect(w.bust).toBeLessThan(0.5);
    // Theirs: your chance is better when he busts.
    expect(t.side).toBe('opp');
    expect(t.bust).toBeGreaterThan(t.boom);
    expect(t.swing).toBeCloseTo(t.bust - t.boom, 12);
    // An even game stays even when he scores what he's expected to.
    expect(w.winIf(w.mean)).toBeCloseTo(0.5, 8);
    // Conditioning on him: his points move the margin one for one, and his SD leaves the rest.
    expect(w.winIf(w.mean + 9)).toBeCloseTo(normCdf(9 / Math.sqrt(16 + 36)), 9);
  });

  it('counts teammates who move with him (a QB lifts his receivers)', () => {
    const qb = row('qb', { pos: 'QB', team: 'KC', sd: 8 });
    const wr = row('wr', { pos: 'WR', team: 'KC', sd: 6 });
    const alone = row('qb2', { pos: 'QB', team: 'NYJ', sd: 8 });
    const other = row('wr2', { pos: 'WR', team: 'SEA', sd: 6 });
    const margin = { mean: 0, variance: 64 + 36 + 2 * 0.3 * 8 * 6 };
    const stacked = swingPlayers(analysis([qb, wr], [], margin), NOW).find((x) => x.row.id === 'qb')!;
    const lone = swingPlayers(analysis([alone, other], [], margin), NOW).find((x) => x.row.id === 'qb2')!;
    expect(stacked.swing).toBeGreaterThan(lone.swing);
  });

  it("starts from his points so far once his game is on, and needs an opponent", () => {
    const live = row('aaa', { kickoff: NOW - H, locked: true, actual: 12 });
    const s = swingPlayers(analysis([live], [], { mean: 5, variance: 30 }), NOW)[0]!;
    expect(s.floor).toBe(12);
    expect(s.mean).toBeGreaterThan(12);
    expect(swingPlayers({ ...analysis([live], [], { mean: 5, variance: 30 }), opponent: undefined } as LineupAnalysis, NOW)).toEqual([]);
  });
});
