import { describe, expect, it } from 'vitest';
import type { StatLine } from '../app/src/domain/types';
import { buildUsage, invert } from './usage';

const rosters = [
  { pfr_id: 'WideWr00', gsis_id: '00-0000001' },
  { pfr_id: 'BackRb00', gsis_id: '00-0000002' },
];
const sleeperByGsis = new Map([
  ['00-0000001', 'wr1'],
  ['00-0000002', 'rb1'],
  ['00-0000003', 'qb1'],
]);
const snap = (week: number, pfr: string, position: string, pct: string, gameType = 'REG') => ({ week: String(week), pfr_player_id: pfr, position, offense_pct: pct, game_type: gameType });
const stat = (week: number, gsis: string, position: string, targets: number, share: number, carries: number) => ({
  week: String(week),
  player_id: gsis,
  position,
  team: 'AAA',
  season_type: 'REG',
  targets: String(targets),
  target_share: String(share),
  carries: String(carries),
});

describe('usage', () => {
  const file = buildUsage({
    season: '2026',
    now: '2026-10-15T12:00:00Z',
    rosters,
    sleeperByGsis,
    snaps: [
      snap(1, 'WideWr00', 'WR', '0.5'),
      snap(2, 'WideWr00', 'WR', '0.61'),
      // week 3: injured, no row
      snap(4, 'WideWr00', 'WR', '0.8'),
      snap(5, 'WideWr00', 'WR', '0.9'),
      snap(5, 'BackRb00', 'RB', '0.55'),
      snap(5, 'GuardG00', 'G', '1'), // linemen aren't kept
      snap(19, 'WideWr00', 'WR', '1', 'WC'), // playoffs aren't either
    ],
    stats: [
      stat(5, '00-0000001', 'WR', 9, 0.3, 0),
      stat(5, '00-0000002', 'RB', 2, 0.07, 15),
      stat(5, '00-0000003', 'QB', 0, 0, 5), // a QB's carries count toward the team's
      stat(4, '00-0000009', 'WR', 4, 0.1, 0), // no Sleeper id
    ],
  })!;

  it('keeps the last four weeks, aligned, with nulls for games missed', () => {
    expect(file.weeks).toEqual([2, 3, 4, 5]);
    expect(file.players.wr1!.snap).toEqual([61, null, 80, 90]);
    expect(file.players.wr1!.tgt).toEqual([null, null, null, 9]);
    expect(file.players.wr1!.tshare).toEqual([null, null, null, 30]);
    expect(Object.keys(file.players).sort()).toEqual(['qb1', 'rb1', 'wr1']);
  });

  it("measures carries against the team's, quarterback runs included", () => {
    expect(file.players.rb1).toMatchObject({ snap: [null, null, null, 55], car: [null, null, null, 15], cshare: [null, null, null, 75] });
    expect(file.players.qb1!.cshare).toEqual([null, null, null, 25]);
  });

  it('returns nothing without data, and inverts id maps keeping the first', () => {
    expect(buildUsage({ season: '2026', now: '', rosters: [], sleeperByGsis, snaps: [], stats: [] })).toBeNull();
    expect(invert(new Map([['a', 'g1'], ['b', 'g1'], ['c', 'g2']]))).toEqual(new Map([['g1', 'a'], ['g2', 'c']]));
  });
});

describe('points against usage', () => {
  const catches = (week: number, receptions: number, yards: number, tds: number) => ({
    ...stat(week, '00-0000001', 'WR', receptions + 2, 0.2, 0),
    receptions: String(receptions),
    receiving_yards: String(yards),
    receiving_tds: String(tds),
  });
  const runs = (week: number) => ({ ...stat(week, '00-0000002', 'RB', 0, 0, 15), rushing_yards: '80' });
  const expected = new Map<string, StatLine>([
    ['00-0000001|1', { rec: 9, rec_yd: 120, rec_td: 1 }], // before the window
    ['00-0000001|2', { rec: 5, rec_yd: 60, rec_td: 0.4 }],
    ['00-0000001|3', { rec: 5, rec_yd: 55, rec_td: 0.4 }],
    ['00-0000001|4', { rec: 5, rec_yd: 60, rec_td: 0.5 }],
    // week 5 isn't processed yet
    ['00-0000002|4', { rush_att: 15, rush_yd: 60 }],
    ['00-0000002|5', { rush_att: 15, rush_yd: 60 }],
  ]);
  const file = buildUsage({
    season: '2026',
    now: '2026-10-15T12:00:00Z',
    rosters,
    sleeperByGsis,
    snaps: [],
    stats: [catches(1, 9, 120, 1), catches(2, 5, 60, 1), catches(3, 4, 50, 1), catches(4, 6, 70, 0), catches(5, 3, 30, 0), runs(4), runs(5)],
    expected,
  })!;

  it('compares PPR points and touchdowns with what the usage was worth, over the games ffopportunity has', () => {
    // Points 17, 15, 13 against 13.4, 12.9, 14; week 5 has no expected line yet and week 1 is outside the window.
    expect(file.players.wr1!.luck).toEqual({ g: 3, pts: [15, 13.4], td: [2, 1.3] });
  });

  it('needs three games', () => {
    expect(file.players.rb1!.car).toEqual([null, null, 15, 15]);
    expect(file.players.rb1!.luck).toBeUndefined();
  });
});
