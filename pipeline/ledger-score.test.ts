import { describe, expect, it } from 'vitest';
import type { PlayerPrediction, PredictionFile } from './ledger';
import { lastBeforeKickoff, nflverseOutcomes, scoreLedger } from './ledger-score';

const KICK = '2026-10-18T17:00:00.000Z';
const LATE = '2026-10-18T20:25:00.000Z';
const player = (id: string, over: Partial<PlayerPrediction> = {}): PlayerPrediction => ({ id, gsis: `g-${id}`, pos: 'WR', team: 'AAA', game: 'G1', p: 0.99, mu: 10, sd: 6, ...over });
const file = (createdAt: string, players: PlayerPrediction[], games = [{ id: 'G1', kickoff: KICK }, { id: 'G2', kickoff: LATE }]): PredictionFile => ({
  schemaVersion: 1,
  createdAt,
  season: '2026',
  week: 6,
  scoring: 'ppr',
  games,
  players,
});

describe('ledger scoring', () => {
  it('keeps the last prediction made before each kickoff', () => {
    const preds = lastBeforeKickoff([
      file('2026-10-18T16:47:00.000Z', [player('a', { p: 0.72, inj: 'Questionable' }), player('b', { game: 'G2', mu: 12 })]),
      file('2026-10-18T12:00:00.000Z', [player('a', { p: 0.5 })]), // older: superseded
      file('2026-10-18T17:30:00.000Z', [player('a', { p: 0.01 }), player('b', { game: 'G2', mu: 14 })]), // after G1's kickoff: ignored for G1
    ]);
    expect(preds.get('G1:a')).toMatchObject({ p: 0.72, createdAt: '2026-10-18T16:47:00.000Z', kickoff: KICK });
    expect(preds.get('G2:b')).toMatchObject({ mu: 14 }); // G2 hadn't started at 17:30
  });

  it('takes outcomes only from games already played', () => {
    const rosters = [
      { week: '6', game_type: 'REG', gsis_id: 'g-a', team: 'AAA', status: 'ACT' },
      { week: '6', game_type: 'REG', gsis_id: 'g-q', team: 'AAA', status: 'INA' },
      { week: '6', game_type: 'REG', gsis_id: 'g-b', team: 'CCC', status: 'ACT' }, // CCC hasn't played yet
      { week: '5', game_type: 'REG', gsis_id: 'g-a', team: 'AAA', status: 'INA' },
    ];
    const stats = [{ week: '6', season_type: 'REG', player_id: 'g-a', team: 'AAA', game_id: 'G1', fantasy_points_ppr: '17.5' }];
    const { played, byGsis } = nflverseOutcomes(rosters, stats, 6);
    expect([...played]).toEqual(['G1']);
    expect(byGsis.get('g-a')).toEqual({ active: true, ppr: 17.5 });
    expect(byGsis.get('g-q')).toEqual({ active: false, ppr: 0 });
    expect(byGsis.has('g-b')).toBe(false);
  });

  it('scores chance to play on tagged players and points on active ones', () => {
    const preds = lastBeforeKickoff([
      file('2026-10-18T16:47:00.000Z', [
        player('a', { mu: 10, sd: 6 }), // active, 17.5: off by 7.5 (outside ±1 SD, inside ±2)
        player('q', { inj: 'Questionable', prac: 'Limited', final: true, p: 0.71 }), // inactive
        player('d', { inj: 'Doubtful', p: 0.02, mu: 0 }), // inactive
        player('c', { mu: 8, sd: 5 }), // active, 10: within ±1 SD
        player('x', { gsis: undefined }), // no gsis: can't be matched
        player('late', { game: 'G2' }), // G2 not played yet
      ]),
    ]);
    const outcomes = {
      played: new Set(['G1']),
      byGsis: new Map([
        ['g-a', { active: true, ppr: 17.5 }],
        ['g-q', { active: false, ppr: 0 }],
        ['g-d', { active: false, ppr: 0 }],
        ['g-c', { active: true, ppr: 10 }],
        ['g-late', { active: true, ppr: 30 }],
      ]),
    };
    const s = scoreLedger('2026', 6, preds, outcomes);
    expect(s).toMatchObject({ games: 1, scored: 4 });
    expect(s.tagged.n).toBe(2);
    expect(s.tagged.brier).toBeCloseTo((0.71 ** 2 + 0.02 ** 2) / 2, 3);
    expect(s.tagged.calibration).toEqual(
      expect.arrayContaining([
        { group: 'Questionable, Limited (final report)', n: 1, predicted: 0.71, observed: 0 },
        { group: 'Doubtful', n: 1, predicted: 0.02, observed: 0 },
      ]),
    );
    expect(s.points).toEqual({ minProjected: 5, n: 2, mae: (7.5 + 2) / 2, bias: (7.5 + 2) / 2, within1: 0.5, within2: 1 });
  });
});
