import { describe, expect, it } from 'vitest';
import { parseSummary, playsFor, playsVersion, type RawSummary } from './plays';

// ESPN's game summary shape (spike 2026-10-18); names and plays invented.
const summary: RawSummary = {
  scoringPlays: [
    { id: 11, text: 'Taylor Wideout 34 Yd pass from Alex Thrower (Sam Boot Kick)', period: { number: 1 }, clock: { displayValue: '9:12' }, scoringType: { abbreviation: 'TD' } },
    { id: 12, text: 'Sam Boot 47 Yd Field Goal', period: { number: 2 }, clock: { displayValue: '0:03' }, scoringType: { abbreviation: 'FG' } },
    { id: 13, text: 'DJ Smith-Jones 2 Yd Run (Sam Boot Kick)', period: { number: 4 }, clock: { displayValue: '5:40' }, scoringType: { abbreviation: 'TD' } },
  ],
  drives: {
    previous: [{ plays: [{ id: 10, text: 'T.Wideout pass short', wallclock: '2026-10-18T17:20:00Z' }, { id: 11, scoringPlay: true, wallclock: '2026-10-18T17:21:30Z' }] }],
    current: { plays: [{ id: 12, scoringPlay: true, wallclock: '2026-10-18T18:01:00Z' }] },
  },
  boxscore: {
    players: [
      { statistics: [{ athletes: [{ athlete: { id: '31', displayName: 'Taylor Wideout' } }, { athlete: { id: '32', displayName: 'Alex Thrower' } }] }] },
      { statistics: [{ athletes: [{ athlete: { id: 33, displayName: 'Sam Boot' } }] }] },
    ],
  },
};

describe('scoring plays', () => {
  const g = parseSummary(summary, '501', 'in:7-10');

  it('reads the scoring plays in order with their times, and the box score names', () => {
    expect(g.plays.map((p) => [p.id, p.period, p.clock, p.type])).toEqual([
      ['11', 1, '9:12', 'TD'],
      ['12', 2, '0:03', 'FG'],
      ['13', 4, '5:40', 'TD'],
    ]);
    expect(g.plays[0]!.at).toBe(Date.parse('2026-10-18T17:21:30Z'));
    expect(g.plays[2]!.at).toBeUndefined(); // not in the play-by-play
    expect(g.names).toEqual({ '31': 'Taylor Wideout', '32': 'Alex Thrower', '33': 'Sam Boot' });
    expect(g).toMatchObject({ event: '501', version: 'in:7-10' });
  });

  it("finds a player's plays by ESPN's spelling of his name, else the app's", () => {
    expect(playsFor(g, { name: 'T. Wideout', espnId: '31' }).map((p) => p.id)).toEqual(['11']);
    // The passer and the kicker are named too: the kicker's extra points and his field goal.
    expect(playsFor(g, { name: 'Alex Thrower', espnId: '32' }).map((p) => p.id)).toEqual(['11']);
    expect(playsFor(g, { name: 'Sam Boot', espnId: '33' }).map((p) => p.id)).toEqual(['11', '12', '13']);
    // No ESPN id, or none in the box score: the app's name, punctuation and suffixes aside.
    expect(playsFor(g, { name: 'D.J. Smith-Jones Jr.' }).map((p) => p.id)).toEqual(['13']);
    expect(playsFor(g, { name: 'Taylor Wideout', espnId: '999' }).map((p) => p.id)).toEqual(['11']);
    // A single word could be anyone's name: no match.
    expect(playsFor(g, { name: 'Boot' })).toEqual([]);
  });

  it('reloads a game only when its score or state changes', () => {
    expect(playsVersion({ state: 'in', awayScore: 10, homeScore: 7 })).toBe('in:10-7');
    expect(playsVersion({ state: 'post', awayScore: 10, homeScore: 7 })).toBe('post:10-7');
  });
});
