import { describe, expect, it } from 'vitest';
import { decideShard, isCurrent, rowCount, validateShard } from './shards';

const usage = (n: number, weeks = [2, 3, 4, 5], season = '2026') => ({
  schemaVersion: 1,
  generatedAt: '2026-10-15T16:07:00Z',
  season,
  weeks,
  players: Object.fromEntries(Array.from({ length: n }, (_, i) => [`p${i}`, { snap: weeks.map(() => 50), tgt: weeks.map(() => 3), car: weeks.map(() => 0), tshare: weeks.map(() => 10), cshare: weeks.map(() => 0) }])),
});
const baseline = (week: number, throughWeek: number, n = 200) => ({
  schemaVersion: 1,
  generatedAt: '2026-10-15T16:07:00Z',
  season: '2026',
  week,
  throughWeek,
  players: Object.fromEntries(Array.from({ length: n }, (_, i) => [`p${i}`, { rec: 4, rec_yd: 50 }])),
});

describe('data shards', () => {
  it('passes healthy shards and names what is wrong with others', () => {
    expect(validateShard('usage.json', usage(300))).toEqual([]);
    expect(validateShard('usage.json', usage(40))).toEqual(['40 rows (expected 100+)']);
    expect(validateShard('usage.json', { ...usage(300), schemaVersion: 2 })).toContain('schemaVersion 2');
    const misaligned = usage(300);
    misaligned.players.p0!.snap = [50];
    expect(validateShard('usage.json', misaligned)).toEqual(['1 players not aligned with weeks']);
    expect(validateShard('baseline.json', baseline(6, 5))).toEqual([]);
    expect(validateShard('baseline.json', baseline(6, 6))).toEqual(['averages include this week']);
    const negative = baseline(6, 5);
    negative.players.p0 = { rec: -1, rec_yd: 50 };
    expect(validateShard('baseline.json', negative)).toEqual(['1 lines with non-finite or negative stats']);
    expect(validateShard('matchups.json', null)).toEqual(['not an object']);
    expect(rowCount('matchups.json', { defense: { KC: {}, BUF: {} } })).toBe(2);
  });

  it('keeps the deployed copy when the fresh build fails, while it still describes this week', () => {
    expect(decideShard('usage.json', usage(500), usage(510), '2026', 6)).toMatchObject({ use: 'fresh', rows: 500 });
    expect(decideShard('usage.json', null, usage(510), '2026', 6)).toMatchObject({ use: 'kept', rows: 510, reason: 'not built' });
    expect(decideShard('usage.json', usage(12), usage(510), '2026', 6)).toMatchObject({ use: 'kept', reason: '12 rows (expected 100+)' });
    // Last season's copy, or last week's baseline, isn't worth keeping.
    expect(decideShard('usage.json', null, usage(510, [15, 16, 17, 18], '2025'), '2026', 1)).toEqual({ use: 'none', reason: 'not built' });
    expect(decideShard('baseline.json', null, baseline(5, 4), '2026', 6)).toEqual({ use: 'none', reason: 'not built' });
    expect(decideShard('baseline.json', null, baseline(6, 5), '2026', 6)).toMatchObject({ use: 'kept' });
    // An invalid deployed copy is never kept.
    expect(decideShard('baseline.json', null, baseline(6, 6), '2026', 6)).toMatchObject({ use: 'none' });
  });

  it('publishes a much smaller fresh build, with a warning', () => {
    expect(decideShard('usage.json', usage(200), usage(510), '2026', 6)).toEqual(expect.objectContaining({ use: 'fresh', rows: 200, warning: 'rows fell from 510 to 200' }));
    expect(decideShard('usage.json', usage(300), usage(510), '2026', 6)).not.toHaveProperty('warning');
  });

  it('treats only same-season shards (same-week baselines) as current', () => {
    expect(isCurrent('matchups.json', { season: '2026' }, '2026', 9)).toBe(true);
    expect(isCurrent('baseline.json', { season: '2026', week: 8 }, '2026', 9)).toBe(false);
  });
});
