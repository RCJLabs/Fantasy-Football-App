import { describe, expect, it } from 'vitest';
import {
  ageFactor,
  buildNextSeasonFile,
  contractThrough,
  fitFor,
  gamesShare,
  marcelLine,
  type NextSeasonFit,
  type PositionFit,
  pprPoints,
  projectDefenses,
  projectSkill,
  type SeasonSum,
  seasonSums,
  teamGames,
} from './next-season';

const row = (over: Record<string, string>) => ({ season_type: 'REG', season: '2026', ...over });

describe('next season: inputs', () => {
  it('sums each player over the weeks asked, kickers on kicking stats, fullbacks as running backs', () => {
    const recs = [
      row({ player_id: 'wr', position: 'WR', week: '1', team: 'NYJ', receptions: '5', receiving_yards: '60', targets: '8' }),
      row({ player_id: 'wr', position: 'WR', week: '2', team: 'NYJ', receptions: '3', receiving_yards: '40', receiving_tds: '1', targets: '6' }),
      row({ player_id: 'wr', position: 'WR', week: '7', team: 'KC', receptions: '9', receiving_yards: '150', targets: '12' }),
      row({ player_id: 'fb', position: 'FB', week: '1', team: 'SF', carries: '2', rushing_yards: '7' }),
      row({ player_id: 'k', position: 'K', week: '1', team: 'BAL', fg_att: '3', fg_made: '2', fg_missed: '1', fg_made_50_59: '1', fg_made_60_: '1', pat_made: '2', pat_att: '2' }),
      row({ player_id: 'lb', position: 'LB', week: '1', team: 'BAL' }),
      row({ player_id: 'wr', position: 'WR', week: '19', team: 'KC', receptions: '9', season_type: 'POST' }),
    ];
    const upTo6 = seasonSums(recs, 6);
    expect(upTo6.get('wr')).toEqual({ pos: 'WR', team0: 'NYJ', team: 'NYJ', g: 2, s: { rec: 8, rec_yd: 100, rec_td: 1, rec_tgt: 14 } });
    expect(seasonSums(recs).get('wr')).toMatchObject({ team0: 'NYJ', team: 'KC', g: 3 });
    expect(upTo6.get('fb')).toMatchObject({ pos: 'RB', s: { rush_att: 2, rush_yd: 7 } });
    expect(upTo6.get('k')?.s).toEqual({ fga: 3, fgm: 2, fgmiss: 1, fgm_50p: 2, xpa: 2, xpm: 2 });
    expect(upTo6.has('lb')).toBe(false);
    expect(teamGames(recs, 6)).toEqual(new Map([['NYJ', 2], ['SF', 1], ['BAL', 1]]));
  });

  it("reads a contract's last year, counting an exercised fifth-year option on a first-round rookie deal", () => {
    const rows = [
      { gsis_id: 'a', year_signed: 2023, years: 4, is_active: true, draft_round: 1, draft_year: 2023, season_history: [{ year: '2026' }, { year: '2027' }, { year: 'Total' }] },
      { gsis_id: 'b', year_signed: 2023, years: 4, is_active: true, draft_round: 1, draft_year: 2023, season_history: [{ year: '2026' }, { year: 'Total' }] },
      // A veteran's cap history runs on through void years: not an option.
      { gsis_id: 'c', year_signed: 2026, years: 1, is_active: true, draft_round: 1, draft_year: 2009, season_history: [{ year: '2027' }, { year: '2038' }] },
      // An extension supersedes the rookie deal; an old inactive deal doesn't count once an active one exists.
      { gsis_id: 'd', year_signed: 2023, years: 4, is_active: false, draft_round: 1, draft_year: 2023 },
      { gsis_id: 'd', year_signed: 2026, years: 3, is_active: true },
      { gsis_id: 'e', year_signed: 2019, years: 6, is_active: false },
      { gsis_id: 'e', year_signed: 2025, years: 1, is_active: true },
    ];
    expect(contractThrough(rows)).toEqual(new Map([['a', 2027], ['b', 2026], ['c', 2026], ['d', 2028], ['e', 2025]]));
    // As of an earlier season: contracts signed by then, every one of them, no options.
    expect(contractThrough(rows, 2024)).toEqual(new Map([['a', 2026], ['b', 2026], ['d', 2026], ['e', 2024]]));
  });
});

const sum = (g: number, s: Record<string, number>, pos = 'WR', team = 'NYJ'): SeasonSum => ({ pos, team0: team, team, g, s });
const fit = (over: Partial<PositionFit> = {}): PositionFit => ({
  a2: 0.5,
  a3: 0,
  k: 4,
  mu: { rec: 3, rec_yd: 30 },
  age: { peak: 27, young: -0.04, old: -0.04, first: 0.05 },
  games: { base: 0.6, age: [0, -0.07, -0.11, -0.19], avail: [-0.35, -0.1], top: 0.24, pending: -0.04 },
  status: { pending: 0.93, signed: 1.02 },
  change: { pending: [0.54, 0.54], signed: [0.11, 0.21] },
  range: [0.2, 1.8],
  ...over,
});

describe('next season: the model', () => {
  it('weights this season, last season and the one before, and pulls the rate toward the mean', () => {
    const p = { cur: sum(6, { rec: 36, rec_yd: 480 }), prev1: sum(16, { rec: 64, rec_yd: 800 }) };
    // (36 + 0.5·64 + 4·3) / (6 + 0.5·16 + 4) = 80 / 18
    expect(marcelLine(p, fit(), ['rec', 'rec_yd']).rec).toBeCloseTo(80 / 18, 9);
    expect(marcelLine(p, fit(), ['rec', 'rec_yd']).rec_yd).toBeCloseTo((480 + 400 + 120) / 18, 9);
    // Nothing to go on: the mean.
    expect(marcelLine({}, fit(), ['rec'])).toEqual({ rec: 3 });
  });

  it('ages and limits games', () => {
    const a = fit().age!;
    expect(ageFactor(27, false, a)).toBe(1);
    expect(ageFactor(23, true, a)).toBeCloseTo(Math.exp(0.16 + 0.05), 9);
    expect(ageFactor(31, false, a)).toBeCloseTo(Math.exp(-0.16), 9);
    const g = fit().games;
    expect(gamesShare(g, 26, 1, true, false)).toBeCloseTo(0.84, 9);
    expect(gamesShare(g, 35, 0.3, false, true)).toBeCloseTo(0.05, 9); // floored
    expect(gamesShare({ ...g, base: 0.9 }, 23, 1, true, false)).toBe(1); // capped
  });

  it('ranks the draftable tier by projected points a game, which sets games and the chance of a new team', () => {
    const fits = { WR: fit() };
    const players = new Map(
      Array.from({ length: 62 }, (_, i) => [
        `w${i}`,
        { cur: sum(6, { rec: 6 * (10 - i / 10), rec_yd: 60 * (10 - i / 10) }), pos: 'WR', age: 27, avail: 1, pending: i === 0 || i === 61 },
      ]),
    );
    const out = projectSkill(players, fits, 17);
    const best = out.get('w0')!;
    const worst = out.get('w61')!;
    expect(best.top).toBe(true);
    expect(worst.top).toBe(false);
    expect(best.chg).toBe(0.54);
    expect(out.get('w1')!.chg).toBe(0.11);
    expect(worst.chg).toBe(0.54);
    expect(best.g).toBeCloseTo((0.6 + 0.24 - 0.04) * 17, 9);
    // The contract factor: pending ×0.93 against signed ×1.02, on otherwise near-equal lines.
    expect(best.s.rec! / out.get('w1')!.s.rec!).toBeCloseTo((0.93 / 1.02) * (marcelLine(players.get('w0')!, fit(), ['rec']).rec! / marcelLine(players.get('w1')!, fit(), ['rec']).rec!), 9);
    // Under 4 games this season and last: not projected.
    expect(projectSkill(new Map([['x', { cur: sum(3, { rec: 9 }), pos: 'WR', age: 27, avail: 1, pending: false }]]), fits, 17).size).toBe(0);
  });

  it('pulls defenses toward the league', () => {
    const cur = new Map([
      ['A', { g: 6, s: { sack: 24 } }],
      ['B', { g: 6, s: { sack: 6 } }],
    ]);
    const out = projectDefenses(cur, new Map(), { a2: 0.5, k: 6 });
    // League: 30 sacks in 12 games = 2.5 a game. A: (24 + 6·2.5) / 12.
    expect(out.get('A')!.sack).toBeCloseTo(39 / 12, 9);
    expect(out.get('B')!.sack).toBeCloseTo(21 / 12, 9);
  });

  it('uses the fit for the closest number of weeks played', () => {
    const f = { byWeeks: { '3': { tag: 3 }, '6': { tag: 6 }, '18': { tag: 18 } } } as unknown as NextSeasonFit;
    expect(fitFor(f, 1)).toEqual({ tag: 3 });
    expect(fitFor(f, 5)).toEqual({ tag: 6 });
    expect(fitFor(f, 12)).toEqual({ tag: 18 });
  });
});

describe("next season's file", () => {
  const fits = { WR: fit(), K: { ...fit(), mu: { fgm_40_49: 0.5, xpm: 2 }, k: 20 } };
  const base = {
    fit: { seasons: [2015, 2025], byWeeks: { '6': fits }, kickerShare: 0.8, rookies: { WR: [{ s: { rec: 3, rec_yd: 40 }, share: 0.8 }, { s: { rec: 2, rec_yd: 30 }, share: 0.7 }] } } as unknown as NextSeasonFit,
    now: '2026-10-17T00:00:00Z',
    season: '2026',
    basisSeason: 2026,
    basisWeeks: 6,
    cur: new Map([
      ['g1', sum(6, { rec: 36, rec_yd: 480 })],
      ['g2', sum(5, { rec: 10, rec_yd: 100 })],
      ['gk', sum(6, { fgm_40_49: 3, xpm: 12 }, 'K', 'BAL')],
      ['gx', sum(6, { rec: 30, rec_yd: 400 })],
    ]),
    prev1: new Map([['g3', sum(16, { rec: 1, rec_yd: 4 })]]),
    prev2: new Map(),
    teamGames: new Map([['NYJ', 6], ['BAL', 6]]),
    birthDates: new Map([['g1', '2001-09-01'], ['g3', '1986-01-01']]),
    through: new Map([['g1', 2028], ['g2', 2026]]),
    sleeperByGsis: new Map([['g1', '1'], ['g2', '2'], ['g3', '3'], ['gk', 'k1'], ['gx', 'x']]),
    names: new Map([['1', 'Wide Receiver One']]),
    inactive: new Set(['x']),
  };

  it('projects players by Sleeper id, flags contracts, and adds placeholder rookies before the NFL draft', () => {
    const file = buildNextSeasonFile(base);
    expect(file).toMatchObject({ season: '2026', target: '2027', basis: { season: '2026', weeks: 6 }, range: {} });
    // g3, 41 and without a game this season, is projected under 10 points; x is retired.
    expect(Object.keys(file.players).sort()).toEqual(['1', '2', 'k1']);
    expect(file.players['1']).toMatchObject({ n: 'Wide Receiver One', pos: 'WR', age: 26 });
    expect(file.players.k1).toMatchObject({ pos: 'K' });
    expect(file.players['1']).not.toHaveProperty('fa');
    expect(file.players['2']).toMatchObject({ fa: 1 });
    expect(file.players['2']).not.toHaveProperty('age'); // no birth date on record
    expect(file.players.k1!.g).toBe(13.6);
    expect(pprPoints(file.players['1']!.s)).toBeGreaterThan(pprPoints(file.players['2']!.s));
    expect(file.rookies).toEqual([
      { pos: 'WR', order: 1, s: { rec: 3, rec_yd: 40 }, g: 13.6 },
      { pos: 'WR', order: 2, s: { rec: 2, rec_yd: 30 }, g: 11.9 },
    ]);
  });

  it('names rookies once the NFL draft has happened, as far as it went', () => {
    const file = buildNextSeasonFile({ ...base, draft: [{ pos: 'WR', gsis: 'g9' }], sleeperByGsis: new Map([...base.sleeperByGsis, ['g9', '99']]) });
    expect(file.rookies).toEqual([{ pos: 'WR', order: 1, s: { rec: 3, rec_yd: 40 }, g: 13.6, id: '99' }]);
  });
});
