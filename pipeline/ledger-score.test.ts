import { describe, expect, it } from 'vitest';
import type { PlayerPrediction, PredictionFile } from './ledger';
import { combineLedger, dueWeeks, GIVE_UP_DAYS, lastBeforeKickoff, nflverseOutcomes, playedGames, scoreLedger, SETTLE_DAYS, validateLedgerWeek } from './ledger-score';

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
    // Scored from the stat line with the ledger's scoring (7 + 45 × 0.1 + 6), not nflverse's own fantasy points.
    const stats = [{ week: '6', season_type: 'REG', player_id: 'g-a', position: 'WR', team: 'AAA', game_id: 'G1', receptions: '7', receiving_yards: '45', receiving_tds: '1', fantasy_points_ppr: '99' }];
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
    expect(s.baseline).toEqual({ n: 0, appMae: 0, baselineMae: 0, ratio: 0 });
  });

  it("scores the shadow baseline against the app's numbers on the same players", () => {
    const preds = lastBeforeKickoff([
      file('2026-10-18T16:47:00.000Z', [
        player('a', { mu: 10, bl: 12 }), // scored 17.5: app off 7.5, baseline 5.5
        player('b', { mu: 4, bl: 6 }), // only the baseline calls him relevant; scored 3
        player('c', { mu: 3, bl: 2 }), // neither does: left out
        player('d', { mu: 9 }), // no baseline: left out
        player('e', { mu: 9, bl: 9, inj: 'Out', p: 0 }), // inactive: left out
      ]),
    ]);
    const byGsis = new Map([
      ['g-a', { active: true, ppr: 17.5 }],
      ['g-b', { active: true, ppr: 3 }],
      ['g-c', { active: true, ppr: 1 }],
      ['g-d', { active: true, ppr: 9 }],
      ['g-e', { active: false, ppr: 0 }],
    ]);
    const s = scoreLedger('2026', 6, preds, { played: new Set(['G1']), byGsis });
    expect(s.baseline).toEqual({ n: 2, appMae: (7.5 + 1) / 2, baselineMae: (5.5 + 3) / 2, ratio: 1 });
  });

  it('scores the props shadow from the snapshot that carried props, against the app in that same snapshot', () => {
    const files = [
      file('2026-10-18T12:17:00.000Z', [player('a', { mu: 10, pr: 14 }), player('b', { mu: 8, pr: 6 })]),
      file('2026-10-18T16:47:00.000Z', [player('a', { mu: 11 }), player('b', { mu: 8 })]), // later, no props
    ];
    const byGsis = new Map([
      ['g-a', { active: true, ppr: 15 }],
      ['g-b', { active: true, ppr: 4 }],
    ]);
    const s = scoreLedger('2026', 6, lastBeforeKickoff(files), { played: new Set(['G1']), byGsis }, 5, lastBeforeKickoff(files, (p) => p.pr !== undefined));
    // a: app 10 off 5, props off 1, blend 12 off 3. b: app off 4, props off 2, blend 7 off 3.
    expect(s.props).toEqual({ n: 2, appMae: 4.5, propsMae: 1.5, blendMae: 3, ratio: 0.333 });
    expect(s.points.mae).toBe(4); // the app's own score still uses its last prediction (a: 11)
  });
});

describe('ledger automation', () => {
  const schedule = [
    { id: '2026_06_SEA_DEN', week: 6, kickoff: '2026-10-16T00:15:00.000Z' },
    { id: '2026_06_HOU_JAX', week: 6, kickoff: '2026-10-18T13:30:00.000Z' },
    { id: '2026_06_TB_DET', week: 6, kickoff: '2026-10-20T00:15:00.000Z' }, // Monday night
    { id: '2026_07_DEN_KC', week: 7, kickoff: '2026-10-23T00:15:00.000Z' },
  ];
  const at = (iso: string) => Date.parse(iso);
  const all = new Set(['2026_06_SEA_DEN', '2026_06_HOU_JAX', '2026_06_TB_DET']);

  it('scores a week once every game has stats and the last one has settled', () => {
    expect(SETTLE_DAYS).toBe(2);
    expect(dueWeeks([6, 7], schedule, all, at('2026-10-21T12:00:00Z'))).toEqual([]); // 1.5 days after MNF
    expect(dueWeeks([7, 6], schedule, all, at('2026-10-22T01:00:00Z'))).toEqual([6]);
    // Monday's game not in the stats yet: wait, then give up after a week and score what was played.
    const noMnf = new Set(['2026_06_SEA_DEN', '2026_06_HOU_JAX']);
    expect(dueWeeks([6], schedule, noMnf, at('2026-10-24T00:00:00Z'))).toEqual([]);
    expect(dueWeeks([6], schedule, noMnf, at('2026-10-20T00:15:00Z') + GIVE_UP_DAYS * 86_400_000)).toEqual([6]);
    // Weeks without a schedule, and postseason weeks, are never due.
    expect(dueWeeks([5, 19], schedule, all, at('2026-12-01T00:00:00Z'))).toEqual([]);
  });

  it('knows played games from regular-season stat rows', () => {
    const played = playedGames([
      { game_id: 'G1', season_type: 'REG' },
      { game_id: 'G1', season_type: 'REG' },
      { game_id: 'P1', season_type: 'POST' },
      { game_id: '', season_type: 'REG' },
    ]);
    expect([...played]).toEqual(['G1']);
  });

  it('publishes only weeks that validate, one per week, in order', () => {
    const week = (w: number, over: object = {}) => ({
      ...scoreLedger('2026', w, new Map(), { played: new Set(), byGsis: new Map() }),
      ...over,
    });
    expect(validateLedgerWeek(week(6), '2026')).toEqual([]);
    expect(validateLedgerWeek(week(6), '2027')).toEqual(['season 2026']);
    expect(validateLedgerWeek(week(19), '2026')).toEqual(['week 19']);
    expect(validateLedgerWeek(week(6, { points: { n: 3 } }), '2026')).toEqual(['bad points']);
    expect(validateLedgerWeek(null, '2026')).toEqual(['not an object']);
    const file = combineLedger([week(8), week(6), week(6, { scored: 7 }), { ...week(5), season: '2025' }], '2026', '2026-10-28T00:00:00.000Z');
    expect(file.weeks.map((w) => [w.week, w.scored])).toEqual([
      [6, 7],
      [8, 0],
    ]);
    expect(file).toMatchObject({ schemaVersion: 1, season: '2026', generatedAt: '2026-10-28T00:00:00.000Z' });
  });
});
