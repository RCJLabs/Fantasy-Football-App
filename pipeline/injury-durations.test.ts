import { describe, expect, it } from 'vitest';
import { injuryCategory, injuryDuration } from '../app/src/engine/injuries';
import { INJURY_DURATIONS } from '../app/src/engine/injury-durations';
import type { RosterRow } from './hazard';
import { type Absence, absences, kaplanMeier, summarize } from './injury-durations';

describe('injury categories', () => {
  it('groups report and Sleeper labels alike', () => {
    expect(injuryCategory('Right Shoulder')).toBe('Shoulder');
    expect(injuryCategory('Hamstrings')).toBe('Hamstring');
    expect(injuryCategory('Quadricep')).toBe('Quad / thigh');
    expect(injuryCategory('Not injury related - personal matter')).toBe('Not injury');
    expect(injuryCategory('Eye')).toBe('Other');
    expect(injuryCategory('')).toBeUndefined();
    expect(injuryCategory(null)).toBeUndefined();
  });

  it('falls back to all injuries for a category with too few absences', () => {
    expect(injuryDuration('Hamstring')).toMatchObject({ category: 'Hamstring', own: true, duration: INJURY_DURATIONS.Hamstring });
    expect(injuryDuration('Eye')).toMatchObject({ category: 'Other', own: false, duration: INJURY_DURATIONS['All injuries'] });
    expect(injuryDuration('Not injury related - resting player')).toBeUndefined();
    expect(injuryDuration(undefined)).toBeUndefined();
  });
});

describe('injury absences', () => {
  const row = (gsis: string, week: number, team: string, status: string, code = ''): RosterRow => ({ gsis, week, team, status, pos: 'WR', code });
  // AAA plays weeks 1–8 except a week-4 bye; week 8 is the final week (left out).
  const played = new Set([1, 2, 3, 5, 6, 7, 8].map((w) => `${w}:AAA`));
  const report = (status: string, injury: string) => ({ status, pos: 'WR', injury });

  it('counts team games missed in a row, skipping byes, from the first game missed after one played', () => {
    const rosters = [row('a', 1, 'AAA', 'ACT'), row('a', 2, 'AAA', 'INA'), row('a', 3, 'AAA', 'RES'), row('a', 5, 'AAA', 'ACT')];
    const out = absences({ season: 2023, rosters, reports: new Map([['2:a', report('Out', 'Hamstring')]]), played });
    expect(out).toEqual([{ season: 2023, week: 2, player: 'a', pos: 'WR', category: 'Hamstring', status: 'Out', games: 2, returned: true }]);
  });

  it('censors absences still running at the season’s end and skips non-injury and COVID-list absences', () => {
    const rosters = [
      row('b', 5, 'AAA', 'ACT'), row('b', 6, 'AAA', 'RES'), row('b', 7, 'AAA', 'RES'), row('b', 8, 'AAA', 'ACT'), // back only in the final week
      row('c', 1, 'AAA', 'ACT'), row('c', 2, 'AAA', 'INA'), row('c', 3, 'AAA', 'ACT'),
      row('d', 1, 'AAA', 'ACT'), row('d', 2, 'AAA', 'RES', 'R59'), row('d', 3, 'AAA', 'ACT'),
    ];
    const reports = new Map([
      ['6:b', report('Out', 'Knee')],
      ['2:c', report('Out', 'Not injury related - personal matter')],
      ['2:d', report('Out', 'Illness')],
    ]);
    const out = absences({ season: 2023, rosters, reports, played });
    expect(out.map((a) => [a.player, a.games, a.returned])).toEqual([['b', 2, false]]);
  });

  it('estimates shares with censoring (Kaplan–Meier)', () => {
    const a = (games: number, returned: boolean, week = 3): Absence => ({ season: 2023, week, player: 'x', pos: 'WR', category: 'Ankle', status: 'Out', games, returned });
    // Four absences: back after 1, after 2, censored after 1, back after 3.
    const list = [a(1, true), a(2, true), a(1, false, 12), a(3, true)];
    const { s } = kaplanMeier(list, 4);
    // k=1: 1 of 4 ends → 0.75; one censored leaves 2 at risk; k=2: 1 of 2 → 0.375; k=3: 1 of 1 → 0.
    expect(s.slice(0, 5)).toEqual([1, 0.75, 0.375, 0, 0]);
    const sum = summarize(list);
    expect(sum).toMatchObject({ n: 4, oneGame: 0.25, twoOrFewer: 0.625, fourOrFewer: 1, seasonEnding: 0, seasonEndingN: 3 });
  });
});
