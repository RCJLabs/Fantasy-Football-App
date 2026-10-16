import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Game } from '../domain/types';
import { adviceCutoff, loadAdvice, saveAdvice } from './advice';

const game = (kickoff: string): Game => ({ id: kickoff, week: 7, away: 'A', home: 'B', kickoff });

describe('adviceCutoff', () => {
  it("is the week's main Sunday kickoff, after Thursday and London games", () => {
    // Week 7, 2026 (Eastern daylight time): Thursday night, London at 9:30 ET, the 1 pm slate, Sunday night.
    const games = ['2026-10-23T00:15:00Z', '2026-10-25T13:30:00Z', '2026-10-25T17:00:00Z', '2026-10-25T20:25:00Z', '2026-10-26T00:20:00Z'].map(game);
    expect(adviceCutoff(games)).toBe(Date.parse('2026-10-25T17:00:00Z'));
  });

  it('falls back to the first Sunday game, then the first game', () => {
    expect(adviceCutoff([game('2026-10-25T13:30:00Z'), game('2026-10-23T00:15:00Z')])).toBe(Date.parse('2026-10-25T13:30:00Z'));
    // Saturday only (week 18 can open on a Saturday).
    expect(adviceCutoff([game('2027-01-09T21:30:00Z'), game('2027-01-10T01:00:00Z')])).toBe(Date.parse('2027-01-09T21:30:00Z'));
    expect(adviceCutoff([])).toBeUndefined();
  });
});

describe('saved picks', () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
  });
  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it('keeps the latest pick until the cutoff, then stops', () => {
    const cutoff = Date.parse('2026-10-25T17:00:00Z');
    saveAdvice('L', 7, ['a', 'b'], cutoff - 3_600_000, cutoff);
    saveAdvice('L', 7, ['a', 'c'], cutoff - 60_000, cutoff);
    saveAdvice('L', 7, ['x', 'y'], cutoff + 60_000, cutoff);
    expect(loadAdvice('L', [6, 7])).toEqual(new Map([[7, ['a', 'c']]]));
  });

  it('skips unreadable entries and works without storage', () => {
    store.set('ff:advice:L:5', '{not json');
    store.set('ff:advice:L:6', JSON.stringify({ starters: [1, 2] }));
    expect(loadAdvice('L', [5, 6])).toEqual(new Map());
    delete (globalThis as { localStorage?: unknown }).localStorage;
    expect(() => saveAdvice('L', 7, ['a'], 0, 1)).not.toThrow();
    expect(loadAdvice('L', [7])).toEqual(new Map());
  });
});
