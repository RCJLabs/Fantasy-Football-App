import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RawProjection } from '../sleeper/raw';

// loadWeekStats with Sleeper and the device's cache stood in for: `held` is the copy kept, `served` Sleeper's answer.
let held: { asOf: number; lines: Record<string, Record<string, number>> } | undefined;
let served: RawProjection[] = [];
const asked: string[] = [];
vi.mock('./cache', () => ({
  cached: async <T,>(key: string, _ttl: number, load: (h: T | undefined) => Promise<T>) => {
    asked.push(key);
    return { value: await load(held as T | undefined), savedAt: 1, stale: false };
  },
}));
vi.mock('../sleeper/api', () => ({ sleeperApi: { stats: async () => served }, SleeperError: Error }));

const { loadWeekStats, newerStats, statsAsOf } = await import('./repo');

const row = (player_id: string, stats: Record<string, number>, updated_at?: number): RawProjection => ({ player_id, stats, ...(updated_at !== undefined ? { updated_at } : {}) });

beforeEach(() => {
  held = undefined;
  served = [];
  asked.length = 0;
});

describe('week stats: the newest copy', () => {
  it("dates a copy by its newest row (Sleeper's updated_at), 0 when none says", () => {
    expect(statsAsOf([row('a', {}, 1_000), row('b', {}, 3_000), row('c', {}, 2_000)])).toBe(3_000);
    expect(statsAsOf([row('a', {}), { player_id: 'b', stats: null, updated_at: null }])).toBe(0);
    expect(statsAsOf([])).toBe(0);
  });

  it('keeps the copy held when Sleeper answers with an older one (a CDN edge that has not caught up)', async () => {
    held = { asOf: 5_000, lines: { w1: { rec: 6, rec_yd: 123, rec_td: 1 } } };
    served = [row('w1', { rec: 5, rec_yd: 89 }, 4_000)];
    const st = await loadWeekStats('2026', 6, ['QB', 'WR']);
    expect(st.asOf).toBe(5_000);
    expect(st.stats.get('w1')).toEqual({ rec: 6, rec_yd: 123, rec_td: 1 });
  });

  it('takes a newer or equally new copy, and one with no dates', async () => {
    held = { asOf: 5_000, lines: { w1: { rec: 5 } } };
    served = [row('w1', { rec: 6 }, 6_000)];
    expect((await loadWeekStats('2026', 6, ['WR'])).stats.get('w1')).toEqual({ rec: 6 });
    served = [row('w1', { rec: 7 }, 5_000)];
    expect((await loadWeekStats('2026', 6, ['WR'])).stats.get('w1')).toEqual({ rec: 7 });
    held = { asOf: 0, lines: { w1: { rec: 5 } } };
    served = [row('w1', { rec: 8 })];
    expect((await loadWeekStats('2026', 6, ['WR'])).stats.get('w1')).toEqual({ rec: 8 });
  });

  it("keeps each league's positions apart (Sleeper answers them separately)", async () => {
    await loadWeekStats('2026', 6, ['QB', 'WR']);
    await loadWeekStats('2026', 6, ['QB', 'WR', 'DL']);
    expect(new Set(asked).size).toBe(2);
  });

  it('newerStats: the later copy unless the one held has newer rows', () => {
    const copy = (asOf: number) => ({ stats: new Map(), asOf, savedAt: 0, stale: false });
    const a = copy(5_000);
    const b = copy(4_000);
    expect(newerStats(a, b)).toBe(a);
    expect(newerStats(b, a)).toBe(a);
    const c = copy(5_000);
    expect(newerStats(a, c)).toBe(c);
    expect(newerStats(null, b)).toBe(b);
  });
});
