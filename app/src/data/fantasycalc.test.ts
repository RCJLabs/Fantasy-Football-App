import { describe, expect, it } from 'vitest';
import { parseLeague } from '../sleeper/parse';
import type { RawLeague } from '../sleeper/raw';
import { marketParams, marketTotals, parseMarketValues, parsePickValues } from './fantasycalc';

const base: RawLeague = {
  league_id: 'L',
  name: 'L',
  season: '2026',
  status: 'in_season',
  total_rosters: 10,
  roster_positions: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF', 'BN'],
  scoring_settings: { rec: 1 },
  settings: { type: 0, num_teams: 10 },
};

describe('FantasyCalc market', () => {
  it('maps a league to the closest market', () => {
    expect(marketParams(parseLeague(base))).toEqual({ dynasty: false, qbs: 1, teams: 10, ppr: 1 });
    const sf = parseLeague({ ...base, roster_positions: ['QB', 'SUPER_FLEX', 'RB', 'BN'], scoring_settings: { rec: 0.5 }, settings: { type: 2, num_teams: 11 } });
    expect(marketParams(sf)).toMatchObject({ dynasty: true, qbs: 2, ppr: 0.5 });
    expect([10, 12]).toContain(marketParams(sf).teams); // 11 sits between the offered sizes
    const keeper = parseLeague({ ...base, scoring_settings: {}, settings: { type: 1, num_teams: 16 } });
    expect(marketParams(keeper)).toEqual({ dynasty: false, qbs: 1, teams: 14, ppr: 0 }); // keepers price as redraft
  });

  it('keys values by Sleeper id and sums each side of a trade', () => {
    const values = parseMarketValues([
      { value: 6000, trend30Day: 250, positionRank: 3, player: { sleeperId: 'a' } },
      { value: 2500, player: { sleeperId: 'b' } },
      { value: 900, player: { sleeperId: null } },
      { player: { sleeperId: 'c' } },
    ]);
    expect([...values.keys()]).toEqual(['a', 'b']);
    expect(values.get('a')).toEqual({ value: 6000, trend: 250, posRank: 3 });
    expect(marketTotals(values, ['a'], ['b', 'k1'])).toEqual({ give: 6000, get: 2500, unvalued: ['k1'] });
  });

  it('reads rookie picks by season, round and third of the round, apart from players', () => {
    const rows = [
      { value: 4593, player: { sleeperId: 'FP_2027_early_0', name: '2027 1st (Early)', position: 'PICK' } },
      { value: 2768, player: { sleeperId: 'FP_2027_0', name: '2027 1st', position: 'PICK' } },
      { value: 1285, player: { sleeperId: 'FP_2028_1', name: '2028 2nd', position: 'PICK' } },
      { value: 742, player: { sleeperId: 'FP_2027_late_3', name: '2027 4th (Late)', position: 'PICK' } },
      { value: 9000, player: { sleeperId: 'p1', name: 'Some Player', position: 'WR' } },
    ];
    expect([...parsePickValues(rows)]).toEqual([
      ['2027:1:Early', 4593],
      ['2027:1', 2768],
      ['2028:2', 1285],
      ['2027:4:Late', 742],
    ]);
    expect([...parseMarketValues(rows).keys()]).toEqual(['p1']);
  });
});
