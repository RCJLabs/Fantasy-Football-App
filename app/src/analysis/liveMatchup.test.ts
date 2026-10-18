import { describe, expect, it } from 'vitest';
import type { LineupAnalysis, PlayerRow } from './analyze';
import { gameState, liveMatchup } from './liveMatchup';

const H = 3_600_000;
const NOW = Date.parse('2026-10-18T19:00:00Z');
const row = (id: string, kickoff: number | null, mu: number, extra: Partial<PlayerRow> = {}): PlayerRow => ({
  id,
  name: id,
  pos: 'WR',
  fpos: ['WR'],
  team: 'AAA',
  kickoff,
  injury: null,
  p: 1,
  mu,
  ev: mu,
  sd: 5,
  locked: kickoff !== null && kickoff <= NOW,
  hasProjection: true,
  breakdown: [],
  ...extra,
});

describe('live matchup', () => {
  it('tells games yet to start, under way and over from the kickoff', () => {
    expect(gameState({ kickoff: null }, NOW)).toBe('bye');
    expect(gameState({ kickoff: NOW + 1 }, NOW)).toBe('upcoming');
    expect(gameState({ kickoff: NOW - H }, NOW)).toBe('live');
    expect(gameState({ kickoff: NOW - 4 * H }, NOW)).toBe('final');
  });

  it('shows your lineup as set against the opponent, with points so far and expected finals', () => {
    const done = row('done', NOW - 4 * H, 10, { actual: 17 });
    const half = row('half', NOW - 1.625 * H, 12, { actual: 4 });
    const later = row('later', NOW + 2 * H, 8, { p: 0.5, ev: 4 });
    const theirs = row('theirs', NOW - H, 9, { actual: 2 });
    const fill = row('fill', NOW + 3 * H, 7);
    const a = {
      slots: ['WR', 'WR', 'FLEX', 'K'],
      current: [done, half, later, null],
      recommended: [done, half, fill, null],
      me: { rosterId: 1, name: 'Mine', rows: [], bySlot: [], points: 21, dist: { mean: 0, variance: 0 } },
      opponent: { rosterId: 2, name: 'Theirs', rows: [theirs, fill], bySlot: [theirs, null, fill, null], points: 2, dist: { mean: 0, variance: 0 }, assumed: ['fill'] },
    } as unknown as LineupAnalysis;
    const m = liveMatchup(a, NOW);
    // Yours as set in Sleeper, not the recommended lineup.
    expect(m.me.slots.map((r) => r?.id ?? null)).toEqual(['done', 'half', 'later', null]);
    expect(m.me.points).toBe(21);
    expect(m.me.games).toEqual({ bye: 0, upcoming: 1, live: 1, final: 1 });
    // 17 final; 4 + half of 12 still to come; 0.5 × 8 for the one yet to play.
    expect(m.me.projected).toBeCloseTo(17 + 4 + 6 + 4, 9);
    expect(m.opponent!.slots.map((r) => r?.id ?? null)).toEqual(['theirs', null, 'fill', null]);
    expect([...m.opponent!.assumed]).toEqual(['fill']);
    expect(m.playing).toBe(true);
    // Once every game is over, nobody is playing.
    expect(liveMatchup(a, NOW + 8 * H).playing).toBe(false);
  });
});
