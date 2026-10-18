import { describe, expect, it } from 'vitest';
import { needsLoad, parseSummary, playsFor, playsVersion, type RawSummary } from './plays';

// ESPN's game summary shape (spike 2026-10-18); names and plays invented.
const summary: RawSummary = {
  scoringPlays: [
    { id: 11, text: 'Taylor Wideout 34 Yd pass from Alex Thrower (Sam Boot Kick)', period: { number: 1 }, clock: { displayValue: '9:12' }, scoringType: { abbreviation: 'TD' }, awayScore: 7, homeScore: 0 },
    { id: 12, text: 'Sam Boot 47 Yd Field Goal', period: { number: 2 }, clock: { displayValue: '0:03' }, scoringType: { abbreviation: 'FG' }, awayScore: 7, homeScore: 3 },
    { id: 13, text: 'DJ Smith-Jones 2 Yd Run (Sam Boot Kick)', period: { number: 4 }, clock: { displayValue: '5:40' }, scoringType: { abbreviation: 'TD' }, awayScore: 7, homeScore: 10 },
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

  it("versions a copy by the score its scoring plays reach, so a copy behind the scoreboard's score isn't kept as current", () => {
    // The scoreboard already shows the 2-yard run, the summary loaded with it doesn't have the play yet.
    expect(parseSummary({ ...summary, scoringPlays: summary.scoringPlays!.slice(0, 2) }, '501', 'in:7-10').version).toBe('in:7-3');
    // No scoring plays yet: 0-0, which trails a scoreboard that has the first field goal.
    expect(parseSummary({}, '501', 'in:0-0').version).toBe('in:0-0');
    expect(parseSummary({}, '501', 'in:0-3').version).toBe('in:0-0');
    // Plays that don't carry the score (a shape this doesn't know): taken as the scoreboard's.
    expect(parseSummary({ scoringPlays: [{ id: 1, text: 'A Field Goal' }] }, '501', 'post:3-0').version).toBe('post:3-0');
  });

  it('loads a copy behind the scoreboard again after a pause, a few times at most; at once for a new score', () => {
    const copy = { event: '501', version: 'in:7-3', plays: [], names: {}, asked: 'in:7-10', tries: 1, at: 1_000 };
    expect(needsLoad({ ...copy, version: 'in:7-10' }, 'in:7-10', 1_000)).toBe(false); // caught up
    expect(needsLoad(copy, 'in:7-10', 11_000)).toBe(false); // just loaded
    expect(needsLoad(copy, 'in:7-10', 31_000)).toBe(true); // again after the pause
    expect(needsLoad({ ...copy, tries: 4 }, 'in:7-10', 61_000)).toBe(false); // given up until the score changes
    expect(needsLoad(copy, 'in:14-10', 1_000)).toBe(true); // a new score
    // A copy saved by the app before it recorded what it was loaded for, at another score: at once.
    expect(needsLoad({ event: '501', version: 'in:7-3', plays: [], names: {} }, 'in:7-10', 0)).toBe(true);
  });
});
