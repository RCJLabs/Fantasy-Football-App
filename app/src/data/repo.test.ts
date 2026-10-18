import { describe, expect, it } from 'vitest';
import type { StatLine } from '../domain/types';
import { indexProjections } from '../sleeper/parse';
import type { RawProjection } from '../sleeper/raw';
import type { PlayersFile } from './contracts';
import { baselineProjectionRows, compactStats, hasOffenseProjections, playersFromFile, staleDataNote } from './repo';

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

describe('staleDataNote', () => {
  const built = '2026-10-16T16:10:00Z';
  const at = (hours: number) => Date.parse(built) + hours * 3_600_000;
  it('stays quiet through a late daily update and the app cache', () => {
    expect(staleDataNote(built, at(1))).toBeUndefined();
    expect(staleDataNote(built, at(36))).toBeUndefined();
  });
  it('says how old the data is once a day was missed', () => {
    expect(staleDataNote(built, at(37))).toMatch(/overdue: .* 37 hours old/);
    expect(staleDataNote(built, at(50))).toMatch(/ 2 days old/);
    expect(staleDataNote(built, at(24 * 5 + 3))).toMatch(/ 5 days old/);
  });
  it("blames the refresh, not the site, for an old saved copy", () => {
    expect(staleDataNote(built, at(50), true)).toMatch(/^The app couldn't refresh its daily data: .* 2 days old/);
    expect(staleDataNote(built, at(5), true)).toBeUndefined();
  });
  it('ignores a missing or broken date', () => {
    expect(staleDataNote('', at(100))).toBeUndefined();
    expect(staleDataNote('not a date', at(100))).toBeUndefined();
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

describe('week stats', () => {
  it('keeps only the stats that stat lines show, and only players who have some', () => {
    const rows: RawProjection[] = [
      { player_id: 'w1', stats: { rec: 5, rec_tgt: 7, rec_yd: 89, pts_ppr: 13.9, off_snp: 51, rec_td: 0 } },
      { player_id: 'k1', stats: { pts_ppr: 0, gp: 1 } },
      { player_id: 'x', stats: null },
    ];
    expect(compactStats(rows)).toEqual({ w1: { rec: 5, rec_tgt: 7, rec_yd: 89 } });
  });
});
