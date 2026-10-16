import { describe, expect, it } from 'vitest';
import { curveFromCounts, type HazardObs, hazardObservations, nonIncreasing, type RosterRow, score } from './hazard';

const row = (gsis: string, week: number, team: string, status: string, pos: string, code = ''): RosterRow => ({ gsis, week, team, status, pos, code });

describe('future-week availability', () => {
  // AAA has a week-4 bye; week 6 is the season's last week (left out as a target).
  const played = new Set(['1:AAA', '2:AAA', '3:AAA', '5:AAA', '6:AAA', ...[1, 2, 3, 4, 5, 6].map((w) => `${w}:BBB`)]);
  const wr = (week: number, status: string): RosterRow => ({ ...row('wr', week, 'AAA', status, 'WR'), birthDate: '2000-09-01' });
  const rosters: RosterRow[] = [
    ...[1, 2, 5, 6].map((w) => wr(w, 'ACT')),
    wr(3, 'INA'),
    row('rb', 1, 'BBB', 'ACT', 'RB'),
    row('rb', 2, 'BBB', 'ACT', 'RB'),
    row('qb', 1, 'BBB', 'ACT', 'QB'),
    row('qb', 2, 'BBB', 'ACT', 'QB'),
    row('qb', 3, 'BBB', 'RES', 'QB', 'R59'), // Reserve/COVID-19: censored
    // qb has no week-4 row although BBB played: on no roster.
    row('qb', 5, 'BBB', 'ACT', 'QB'),
  ];
  const ppr = new Map([
    ['wr', [{ week: 1, ppr: 10 }, { week: 2, ppr: 10 }]],
    ['rb', [{ week: 1, ppr: 5 }]], // under 8 PPR: not relevant
    ['qb', [{ week: 1, ppr: 20 }]],
  ]);
  const reports = new Map([
    ['3:wr', { status: 'Out', pos: 'WR' }],
    ['2:qb', { status: 'Questionable', pos: 'QB' }],
  ]);
  const pick = (obs: HazardObs[], id: string, week: number) => obs.filter((o) => o.player === id && o.week === week).map(({ k, state, active, outcome }) => ({ k, state, active, outcome }));

  it('follows relevant players on a game-day 53 through later weeks, skipping byes and the final week', () => {
    const obs = hazardObservations({ season: 2023, rosters, reports, ppr, played });
    expect(pick(obs, 'wr', 2)).toEqual([
      { k: 1, state: 'healthy', active: false, outcome: 'INA' },
      { k: 3, state: 'healthy', active: true, outcome: 'ACT' }, // week 4 is AAA's bye
    ]);
    expect(pick(obs, 'wr', 3)).toEqual([{ k: 2, state: 'Out', active: true, outcome: 'ACT' }]);
    expect(pick(obs, 'wr', 5)).toEqual([]); // only the final week is left
    expect(obs.some((o) => o.player === 'rb')).toBe(false);
    expect(obs.find((o) => o.player === 'wr')!.age).toBeCloseTo(23, 2);
  });

  it('counts a player on no roster as not active and leaves out COVID-list weeks', () => {
    const obs = hazardObservations({ season: 2023, rosters, reports, ppr, played });
    expect(pick(obs, 'qb', 2)).toEqual([
      { k: 2, state: 'Questionable', active: false, outcome: 'none' },
      { k: 3, state: 'Questionable', active: true, outcome: 'ACT' },
    ]);
  });

  it('counts an average of exactly the bar as relevant, despite float rounding', () => {
    // 13.7 + 5.1 + 4 + 12.9 + 4.3 sums to 39.99999999999999 left to right: an 8.0 average.
    const games = [13.7, 5.1, 4, 12.9, 4.3].map((p, i) => ({ week: i + 1, ppr: p }));
    const weeks = [1, 2, 3, 4, 5, 6, 7, 8];
    const obs = hazardObservations({
      season: 2023,
      rosters: weeks.map((w) => row('edge', w, 'BBB', 'ACT', 'WR')),
      reports: new Map(),
      ppr: new Map([['edge', games]]),
      played: new Set(weeks.map((w) => `${w}:BBB`)),
    });
    expect(obs.filter((o) => o.week === 6).map((o) => o.k)).toEqual([1]);
  });

  it('uses target weeks only from the first week with game-day inactives', () => {
    const obs = hazardObservations({ season: 2023, rosters, reports, ppr, played, firstWeek: 4 });
    expect(pick(obs, 'wr', 2).map((o) => o.k)).toEqual([3]);
  });

  it('fits a non-increasing curve, carrying the last value over horizons without data', () => {
    expect(nonIncreasing([0.9, 0.95, 0.8], [1, 1, 2])).toEqual([0.925, 0.925, 0.8]);
    expect(nonIncreasing([0.9, 0.95], [3, 1])[0]).toBeCloseTo(0.9125, 12);
    expect(curveFromCounts([[9, 10], [0, 0], [8, 10]])).toEqual([0.9, 0.9, 0.8]);
  });

  it('scores predictions by log loss and Brier score', () => {
    const o = (active: boolean): HazardObs => ({ season: 2023, week: 2, player: 'x', pos: 'WR', state: 'healthy', k: 1, active, outcome: active ? 'ACT' : 'INA' });
    const s = score([o(true), o(false)], () => 0.5);
    expect(s.logLoss).toBeCloseTo(Math.LN2, 12);
    expect(s).toMatchObject({ n: 2, brier: 0.25, expected: 1, active: 1 });
  });
});
