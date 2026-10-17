import { describe, expect, it } from 'vitest';
import { scoreLedger } from './ledger-score';
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

const nextSeason = (n: number, over: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  generatedAt: '2026-10-15T16:07:00Z',
  season: '2026',
  target: '2027',
  basis: { season: '2026', weeks: 6 },
  players: Object.fromEntries(Array.from({ length: n }, (_, i) => [`p${i}`, { s: { rec: 4, rec_yd: 50 }, g: 13.2 }])),
  rookies: [{ pos: 'RB', order: 1, s: { rush_yd: 60 }, g: 14.3 }],
  range: { RB: [0.06, 1.93] },
  ...over,
});

describe('data shards', () => {
  it('passes healthy shards and names what is wrong with others', () => {
    expect(validateShard('usage.json', usage(300))).toEqual([]);
    expect(validateShard('usage.json', usage(40))).toEqual(['40 rows (expected 100+)']);
    expect(validateShard('usage.json', { ...usage(300), schemaVersion: 2 })).toContain('schemaVersion 2');
    const misaligned = usage(300);
    misaligned.players.p0!.snap = [50];
    expect(validateShard('usage.json', misaligned)).toEqual(['1 players not aligned with weeks']);
    const luck = usage(300) as { players: Record<string, Record<string, unknown>> };
    luck.players.p0!.luck = { g: 3, pts: [-0.4, 1.2], td: [0, 0.1] }; // a fumble and little else
    expect(validateShard('usage.json', luck)).toEqual([]);
    luck.players.p1!.luck = { g: 3, pts: [10, 8] };
    luck.players.p2!.luck = { g: 3, pts: [10, 8], td: [-1, 0.5] };
    expect(validateShard('usage.json', luck)).toEqual(['2 players with a bad luck entry']);
    expect(validateShard('baseline.json', baseline(6, 5))).toEqual([]);
    expect(validateShard('baseline.json', baseline(6, 6))).toEqual(['averages include this week']);
    const negative = baseline(6, 5);
    negative.players.p0 = { rec: -1, rec_yd: 50 };
    expect(validateShard('baseline.json', negative)).toEqual(['1 lines with non-finite or negative stats']);
    expect(validateShard('matchups.json', null)).toEqual(['not an object']);
    expect(rowCount('matchups.json', { defense: { KC: {}, BUF: {} } })).toBe(2);
  });

  it("checks next season's projections", () => {
    expect(validateShard('nextseason.json', nextSeason(400))).toEqual([]);
    expect(validateShard('nextseason.json', nextSeason(100))).toEqual(['100 rows (expected 300+)']);
    expect(validateShard('nextseason.json', nextSeason(400, { target: '2025' }))).toEqual(['bad target']);
    const bad = nextSeason(400);
    const players = bad.players as Record<string, unknown>;
    players.p0 = { s: { rec: -1 }, g: 12 };
    players.p1 = { s: { rec: 3 }, g: 40 };
    expect(validateShard('nextseason.json', bad)).toEqual(['2 players with a bad line']);
    expect(validateShard('nextseason.json', nextSeason(400, { rookies: [{ pos: 'WR', order: 1, s: {}, g: Number.NaN }] }))).toEqual(['rookies with a bad line']);
    // Kept while Sleeper's season is the same: the projection stays useful between daily builds.
    expect(decideShard('nextseason.json', null, nextSeason(400), '2026', 9)).toMatchObject({ use: 'kept' });
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

describe('ledger shard', () => {
  const week = (w: number) => scoreLedger('2026', w, new Map(), { played: new Set(), byGsis: new Map() });
  const ledger = (weeks: unknown[]) => ({ schemaVersion: 1, generatedAt: '2026-10-22T04:17:00Z', season: '2026', weeks });

  it('publishes scored weeks and keeps the deployed copy when the release is unreachable', () => {
    expect(validateShard('ledger.json', ledger([week(6), week(7)]))).toEqual([]);
    expect(rowCount('ledger.json', ledger([week(6), week(7)]))).toBe(2);
    expect(validateShard('ledger.json', ledger([]))).toEqual(['0 rows (expected 1+)']);
    expect(validateShard('ledger.json', ledger([week(6), { ...week(7), season: '2025' }]))).toEqual(["1 weeks that don't validate"]);
    expect(decideShard('ledger.json', null, ledger([week(6)]), '2026', 8)).toMatchObject({ use: 'kept', reason: 'not built' });
    expect(decideShard('ledger.json', null, undefined, '2026', 8)).toEqual({ use: 'none', reason: 'not built' });
  });
});
