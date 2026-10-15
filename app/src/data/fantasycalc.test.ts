import { describe, expect, it } from 'vitest';
import { parseLeague } from '../sleeper/parse';
import type { RawLeague } from '../sleeper/raw';
import { marketParams, marketTotals, parseMarketValues } from './fantasycalc';

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
});
