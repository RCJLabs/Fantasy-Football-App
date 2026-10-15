import { describe, expect, it } from 'vitest';
import { horizons, marketParams, parseMarketValues } from '../data/fantasycalc';
import { parseLeague, parseRoster } from '../sleeper/parse';
import type { RawLeague } from '../sleeper/raw';
import { carriedForward, longTermCore, longTermRanking } from './longterm';

const raw = (type: number, extra: Record<string, number> = {}): RawLeague => ({
  league_id: 'L',
  name: 'L',
  season: '2026',
  status: 'in_season',
  total_rosters: 2,
  roster_positions: ['QB', 'RB', 'WR', 'BN'],
  scoring_settings: { rec: 1 },
  settings: { type, num_teams: 10, ...extra },
});

const values = parseMarketValues([
  { value: 9000, player: { sleeperId: 'young', maybeAge: 22.4 } },
  { value: 7000, player: { sleeperId: 'prime', maybeAge: 26 } },
  { value: 3000, player: { sleeperId: 'vet', maybeAge: 31 } },
  { value: 2500, player: { sleeperId: 'ir', maybeAge: 24 } },
  { value: 8000, player: { sleeperId: 'star' } },
]);
const mine = parseRoster({ roster_id: 1, owner_id: 'me', players: ['young', 'prime', 'vet', 'k1', 'ir'], starters: [], reserve: ['ir'] });
const theirs = parseRoster({ roster_id: 2, owner_id: 'x', players: ['star', 'vet2'], starters: [] });

describe('long-term view', () => {
  it('shows a long-term horizon only beyond redraft, and maps it to dynasty values', () => {
    expect(horizons(parseLeague(raw(0)))).toEqual(['season']);
    const keeper = parseLeague(raw(1, { max_keepers: 2 }));
    expect(horizons(keeper)).toEqual(['season', 'long']);
    expect(marketParams(keeper).dynasty).toBe(false);
    expect(marketParams(keeper, 'long').dynasty).toBe(true);
    expect(marketParams(parseLeague(raw(2)), 'season').dynasty).toBe(false);
  });

  it('counts keepers, the whole roster in dynasty, nothing in redraft', () => {
    expect(carriedForward(parseLeague(raw(1, { max_keepers: 2 })))).toBe(2);
    expect(carriedForward(parseLeague(raw(1)))).toBe(3); // unknown: default
    expect(carriedForward(parseLeague(raw(2)))).toBeUndefined();
    expect(carriedForward(parseLeague(raw(0)))).toBe(0);
  });

  it('ranks each roster by what it carries forward, IR included', () => {
    expect(values.get('young')?.age).toBe(22.4);
    expect(longTermCore(mine, values, 2).map((p) => p.id)).toEqual(['young', 'prime']);
    expect(longTermCore(mine, values).map((p) => p.id)).toEqual(['young', 'prime', 'vet', 'ir']); // k1 has no value
    const keepers = longTermRanking([mine, theirs], values, 2);
    expect(keepers.map((t) => [t.rosterId, t.total, t.rank])).toEqual([
      [1, 16000, 1],
      [2, 8000, 2],
    ]);
  });

  it('adds the draft picks a team owns (dynasty)', () => {
    const withPicks = longTermRanking([mine, theirs], values, undefined, new Map([[2, 15000]]));
    expect(withPicks.map((t) => [t.rosterId, t.total, t.picks, t.rank])).toEqual([
      [2, 23000, 15000, 1],
      [1, 21500, 0, 2],
    ]);
  });
});
