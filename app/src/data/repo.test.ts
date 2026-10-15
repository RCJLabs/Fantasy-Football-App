import { describe, expect, it } from 'vitest';
import type { PlayersFile } from './contracts';
import { playersFromFile } from './repo';

const file = (injuryReportWeek: number | undefined): PlayersFile => ({
  schemaVersion: 1,
  generatedAt: '2026-10-15T10:00:00Z',
  season: '2026',
  week: 6,
  ...(injuryReportWeek !== undefined ? { injuryReportWeek } : {}),
  players: [
    { id: 'a', n: 'Final Q', pos: 'WR', t: 'AAA', inj: 'Questionable', prac: 'Limited', rpt: 'Questionable' },
    { id: 'b', n: 'Midweek', pos: 'RB', t: 'BBB', inj: 'Questionable', prac: 'DNP' },
    { id: 'c', n: 'Healthy', pos: 'TE', t: 'CCC' },
  ],
});

describe('playersFromFile', () => {
  it("marks practice final only when the player has a game status on this week's report", () => {
    const players = playersFromFile(file(6), 6);
    expect(players.get('a')).toMatchObject({ practice: 'Limited', practiceFinal: true });
    expect(players.get('b')?.practice).toBe('DNP');
    expect(players.get('b')?.practiceFinal).toBeUndefined();
    expect(players.get('c')?.practice).toBeUndefined();
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
