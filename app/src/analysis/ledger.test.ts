import { describe, expect, it } from 'vitest';
import type { LedgerFile, LedgerWeek } from '../data/contracts';
import { groupLabel, LEDGER_MIN_WEEKS, poolLedger } from './ledger';

const week = (w: number, over: Partial<LedgerWeek> = {}): LedgerWeek => ({
  season: '2026',
  week: w,
  games: 14,
  scored: 400,
  tagged: {
    n: 20,
    brier: 0.1,
    logLoss: 0.3,
    calibration: [
      { group: 'Out', n: 12, predicted: 0, observed: 0 },
      { group: 'Questionable, Limited (final report)', n: 8, predicted: 0.7, observed: 0.75 },
    ],
  },
  points: { minProjected: 5, n: 100, mae: 4, bias: 0, within1: 0.7, within2: 0.95 },
  baseline: { n: 0, appMae: 0, baselineMae: 0, ratio: 0 },
  props: { n: 0, appMae: 0, propsMae: 0, blendMae: 0, ratio: 0 },
  ...over,
});
const file = (weeks: LedgerWeek[]): LedgerFile => ({ schemaVersion: 1, generatedAt: '2026-11-05T04:17:00Z', season: '2026', weeks });

describe('ledger on the About page', () => {
  it(`waits for ${LEDGER_MIN_WEEKS} scored weeks`, () => {
    expect(poolLedger(null)).toBeNull();
    expect(poolLedger(file([week(6), week(7)]))).toBeNull();
    expect(poolLedger(file([week(6), week(7), week(8)]))).not.toBeNull();
  });

  it('pools weeks by their counts', () => {
    const q = (n: number, predicted: number, observed: number) => ({ group: 'Questionable, Limited (final report)', n, predicted, observed });
    const pooled = poolLedger(
      file([
        week(6, { points: { minProjected: 5, n: 100, mae: 4, bias: 1, within1: 0.6, within2: 0.9 } }),
        week(7, { tagged: { n: 30, brier: 0.1, logLoss: 0.3, calibration: [q(30, 0.7, 0.6), { group: 'Doubtful', n: 2, predicted: 0.05, observed: 0 }] } }),
        week(8, { points: { minProjected: 5, n: 300, mae: 5, bias: -1, within1: 0.7, within2: 0.95 } }),
      ]),
    )!;
    expect(pooled.weeks).toEqual([6, 7, 8]);
    expect(pooled.games).toBe(42);
    // Questionable first, then Doubtful and Out; limited-practice players pooled over 8 + 30 + 8.
    expect(pooled.calibration.map((r) => [r.group, r.n])).toEqual([
      ['Questionable, Limited (final report)', 46],
      ['Doubtful', 2],
      ['Out', 24],
    ]);
    expect(pooled.calibration[0]!.observed).toBeCloseTo((8 * 0.75 + 30 * 0.6 + 8 * 0.75) / 46, 12);
    expect(pooled.points.n).toBe(500);
    expect(pooled.points.mae).toBeCloseTo((100 * 4 + 100 * 4 + 300 * 5) / 500, 12);
    expect(pooled.points.bias).toBeCloseTo((100 * 1 + 0 + 300 * -1) / 500, 12);
  });

  it('labels groups the way players read them', () => {
    expect(groupLabel('Questionable, DNP (final report)')).toBe('Questionable, missed practice');
    expect(groupLabel('Questionable, Full (final report)')).toBe('Questionable, full practice');
    expect(groupLabel('Questionable (before final report)')).toBe('Questionable, before the final report');
    expect(groupLabel('Out')).toBe('Out');
  });
});
