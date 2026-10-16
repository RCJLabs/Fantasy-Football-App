import { describe, expect, it } from 'vitest';
import type { StatLine } from '../domain/types';
import { indexProjections } from '../sleeper/parse';
import type { PlayersFile } from './contracts';
import { baselineProjectionRows, hasOffenseProjections, playersFromFile } from './repo';

const file = (injuryReportWeek: number | undefined): PlayersFile => ({
  schemaVersion: 1,
  generatedAt: '2026-10-15T10:00:00Z',
  season: '2026',
  week: 6,
  ...(injuryReportWeek !== undefined ? { injuryReportWeek } : {}),
  players: [
    { id: 'a', n: 'Final Q', pos: 'WR', t: 'AAA', inj: 'Questionable', prac: 'Limited', rpt: 'Questionable' },
    { id: 'b', n: 'Midweek', pos: 'RB', t: 'BBB', inj: 'Questionable', prac: 'DNP' },
    { id: 'c', n: 'Healthy', pos: 'TE', t: 'CCC', ml: 1 },
  ],
});

describe('playersFromFile', () => {
  it("marks practice final only when the player has a game status on this week's report", () => {
    const players = playersFromFile(file(6), 6);
    expect(players.get('a')).toMatchObject({ practice: 'Limited', practiceFinal: true });
    expect(players.get('b')?.practice).toBe('DNP');
    expect(players.get('b')?.practiceFinal).toBeUndefined();
    expect(players.get('c')?.practice).toBeUndefined();
    expect(players.get('c')?.missedLast).toBe(true);
    expect(players.get('a')?.missedLast).toBeUndefined();
  });
  it("drops last week's practice statuses", () => {
    for (const reportWeek of [5, undefined]) {
      const players = playersFromFile(file(reportWeek), 6);
      expect(players.get('a')?.practice).toBeUndefined();
      expect(players.get('a')?.practiceFinal).toBeUndefined();
      expect(players.get('a')?.injury).toBe('Questionable');
    }
  });
});

describe('baseline fallback', () => {
  it('notices a week without QB/RB/WR/TE projections', () => {
    expect(hasOffenseProjections(indexProjections([], 6))).toBe(false);
    expect(hasOffenseProjections(indexProjections([{ player_id: 'k', stats: { xpm: 2, fgm: 1.5 } }, { player_id: 'w', stats: {} }], 6))).toBe(false);
    expect(hasOffenseProjections(indexProjections([{ player_id: 'w', stats: { rec: 3 } }], 6))).toBe(true);
  });
  it("turns baseline lines into projection rows with the player's team", () => {
    const players = new Map<string, StatLine>([['c', { rec: 4 }], ['x', { rush_yd: 30 }]]);
    const rows = baselineProjectionRows({ throughWeek: 5, players }, playersFromFile(file(6), 6));
    expect(rows).toEqual([
      { player_id: 'c', stats: { rec: 4 }, team: 'CCC' },
      { player_id: 'x', stats: { rush_yd: 30 }, team: null },
    ]);
  });
});
