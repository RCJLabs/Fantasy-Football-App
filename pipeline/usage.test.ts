import { describe, expect, it } from 'vitest';
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
