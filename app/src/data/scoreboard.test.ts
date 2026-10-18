import { describe, expect, it } from 'vitest';
import { gameProgress, parseScoreboard, type RawScoreboard } from './scoreboard';

// ESPN's scoreboard shape (spike 2026-10-18); teams and numbers invented.
const team = (id: string, abbreviation: string, homeAway: string, score: string) => ({ homeAway, score, team: { id, abbreviation } });
const board: RawScoreboard = {
  week: { number: 6 },
  season: { type: 2, year: 2026 },
  events: [
    {
      status: { clock: 523, displayClock: '8:43', period: 2, type: { name: 'STATUS_IN_PROGRESS', state: 'in' } },
      competitions: [
        {
          competitors: [team('10', 'KC', 'home', '7'), team('28', 'WSH', 'away', '10')],
          situation: { possession: '28', downDistanceText: '1st & Goal at KC 4', isRedZone: true },
        },
      ],
    },
    {
      status: { clock: 0, displayClock: '0:00', period: 2, type: { name: 'STATUS_HALFTIME', state: 'in' } },
      competitions: [{ competitors: [team('1', 'ATL', 'home', '14'), team('2', 'BUF', 'away', '3')], situation: { possession: '' } }],
    },
    {
      status: { clock: 0, displayClock: '0:00', period: 5, type: { name: 'STATUS_FINAL', state: 'post' } },
      competitions: [{ competitors: [team('3', 'DEN', 'home', '23'), team('4', 'SEA', 'away', '20')] }],
    },
    {
      status: { clock: 900, displayClock: '15:00', period: 0, type: { name: 'STATUS_SCHEDULED', state: 'pre' } },
      competitions: [{ competitors: [team('5', 'LAR', 'home', '0'), team('6', 'SF', 'away', '0')] }],
    },
  ],
};

describe('ESPN scoreboard', () => {
  it('reads each game by Sleeper team code, with clock, score, possession and red zone', () => {
    const games = parseScoreboard(board, 6);
    const kc = games.get('KC')!;
    expect(games.get('WAS')).toBe(kc); // ESPN's WSH is Sleeper's WAS
    expect(kc).toMatchObject({ state: 'in', period: 2, clock: 523, label: 'Q2 8:43', home: 'KC', away: 'WAS', homeScore: 7, awayScore: 10 });
    expect(kc).toMatchObject({ possession: 'WAS', down: '1st & Goal at KC 4', redZone: true });
    expect(kc.progress).toBeCloseTo((900 + (900 - 523)) / 3600, 9);
    expect(games.get('BUF')).toMatchObject({ label: 'Half', progress: 0.5 });
    expect(games.get('BUF')!.possession).toBeUndefined();
    expect(games.get('SEA')).toMatchObject({ state: 'post', label: 'Final/OT', progress: 1, homeScore: 23 });
    expect(games.get('SF')).toMatchObject({ state: 'pre', label: '', progress: 0 });
    expect(games.size).toBe(8);
  });

  it("ignores a scoreboard for another week (the app falls back to time since kickoff)", () => {
    expect(parseScoreboard(board, 7).size).toBe(0);
    expect(parseScoreboard({ events: board.events }, 7).size).toBe(8); // no week on it: taken as is
  });

  it('counts the hour played: quarters of 15 minutes, overtime against the same hour', () => {
    expect(gameProgress('in', 1, 900)).toBe(0);
    expect(gameProgress('in', 3, 450)).toBeCloseTo(0.625, 9);
    expect(gameProgress('in', 4, 0)).toBe(1);
    expect(gameProgress('in', 5, 600)).toBeCloseTo(1 - 600 / 3600, 9); // 10 minutes of overtime left
    expect(gameProgress('in', 2, 0, true)).toBe(0.5);
    expect(gameProgress('pre', 0, 900)).toBe(0);
    expect(gameProgress('post', 4, 0)).toBe(1);
  });
});
