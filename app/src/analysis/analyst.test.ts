import { describe, expect, it } from 'vitest';
import type { League, Roster } from '../domain/types';
import { parseLeague, parseRoster } from '../sleeper/parse';
import { answerCost, buildFacts, checkAnswer, sheetText, type FactSheet } from './analyst';
import type { LineupAnalysis, PlayerRow } from './analyze';

const league: League = parseLeague({
  league_id: 'A',
  name: 'Analyst League',
  season: '2026',
  status: 'in_season',
  total_rosters: 12,
  roster_positions: ['QB', 'WR', 'FLEX', 'BN'],
  scoring_settings: { rec: 0.5 },
  settings: { type: 0, num_teams: 12 },
});
const mine: Roster = { ...parseRoster({ roster_id: 1, owner_id: 'u1', players: ['qb', 'wr', 'wr2', 'rb'], starters: [] }), wins: 4, losses: 2 };

const row = (id: string, name: string, pos: string, p: number, mu: number, extra: Partial<PlayerRow> = {}): PlayerRow => ({
  id,
  name,
  pos,
  fpos: [pos],
  team: 'KC',
  opponent: 'BUF',
  home: true,
  kickoff: 0,
  injury: null,
  p,
  mu,
  ev: p * mu,
  sd: 5,
  locked: false,
  hasProjection: true,
  breakdown: [],
  ...extra,
});
const qb = row('qb', 'Casey Passer', 'QB', 0.97, 21.4);
const wr = row('wr', 'Drew Flanker', 'WR', 0.74, 14.2, { injury: 'Questionable', injuryBody: 'Hamstring', practice: 'Limited', practiceFinal: true });
const wr2 = row('wr2', 'Sam Slot', 'WR', 0.97, 11.8);
const rb = row('rb', 'Riley Runner', 'RB', 0, 13, { injury: 'Out' });
const lineup = {
  slots: ['QB', 'WR', 'FLEX'],
  recommended: [qb, wr, wr2],
  bench: [rb],
  changes: [{ kind: 'swap', slot: 'FLEX', in: wr2, out: rb }],
  expectedRecommended: 41.6,
  expectedCurrent: 38.2,
  gain: 3.4,
  opponent: { rosterId: 2, name: 'Rival Raiders', rows: [], dist: { mean: 39.1, variance: 90 } },
  winProbRecommended: 0.58,
  winProbCurrent: 0.49,
  medianProb: 0.62,
  objective: 'points',
} as unknown as LineupAnalysis;

const input = { league, week: 6, myRoster: mine, rosters: [mine], teamName: () => 'Test Titans 2', lineup };

describe('the analyst', () => {
  it('builds a fact sheet with every number behind an id, the same each time', () => {
    const sheet = buildFacts(input);
    expect(buildFacts(input)).toEqual(sheet);
    expect(sheet.facts.map((f) => f.id)).toEqual(sheet.facts.map((_, i) => `F${i + 1}`));
    const fact = (label: string) => sheet.facts.find((f) => f.label === label);
    expect(fact('Teams in the league')).toMatchObject({ value: '12', num: 12 });
    expect(fact('Points per reception in this league')).toMatchObject({ value: '0.5', num: 0.5 });
    expect(fact('This week: chance Test Titans 2 wins with the recommended lineup')).toMatchObject({ value: '58%', num: 58 });
    expect(fact('Drew Flanker (WR, KC), recommended starter at WR: chance to play this week')).toMatchObject({ value: '74%' });
    expect(fact('Riley Runner (RB, KC), bench: expected points this week (chance to play × points if he plays)')).toMatchObject({ value: '0.0' });
    // The rest of the season and free agents only come in when they loaded.
    expect(sheet.facts.some((f) => f.label.includes('playoffs'))).toBe(false);
    expect(sheet.notes).toContain('Recommended: start Sam Slot over Riley Runner.');
    expect(sheet.notes).toContain('Drew Flanker: listed Questionable (Hamstring); limited practice on the final injury report; plays at home against BUF.');
    expect(sheet.names).toEqual(expect.arrayContaining(['Test Titans 2', 'Rival Raiders', 'Drew Flanker', 'Analyst League']));
    // Notes carry no numbers of their own, apart from names: numbers live in facts.
    for (const n of sheet.notes) expect(sheet.names.reduce((t, name) => t.split(name).join(''), n)).not.toMatch(/\d/);
    expect(sheetText(sheet, 'Oct 16, 9:00 PM')).toContain('{F1} Teams in the league: 12\n');
  });

  it("puts the facts' values into an answer and marks numbers that don't come from one", () => {
    const sheet: FactSheet = {
      facts: [
        { id: 'F1', label: 'chance to play', value: '74%', num: 74 },
        { id: 'F2', label: 'points if he plays', value: '12.3', num: 12.3 },
      ],
      notes: [],
      names: ['Team 12'],
    };
    const a = checkAnswer('He plays {F1} of the time and scores {F2}; Team 12 would add 12.3 or 8.1 points. {F7}', sheet);
    expect(a.pieces).toEqual([
      { kind: 'text', text: 'He plays ' },
      { kind: 'fact', text: '74%', fact: sheet.facts[0] },
      { kind: 'text', text: ' of the time and scores ' },
      { kind: 'fact', text: '12.3', fact: sheet.facts[1] },
      { kind: 'text', text: '; Team 12 would add 12.3 or ' },
      { kind: 'unchecked', text: '8.1' },
      { kind: 'text', text: ' points. ' },
      { kind: 'unknown', text: '{F7}' },
    ]);
    // 12.3 typed by the model matches a fact; the digits in "Team 12" are a name, not a number.
    expect([a.quoted, a.matched, a.unchecked]).toEqual([2, 1, 2]);
    expect(checkAnswer('No numbers here.', sheet)).toEqual({ pieces: [{ kind: 'text', text: 'No numbers here.' }], quoted: 0, matched: 0, unchecked: 0 });
  });

  it("prices an answer at Claude Opus 5.5's list prices", () => {
    expect(answerCost({ input_tokens: 1000, output_tokens: 500, cache_creation_input_tokens: 4000, cache_read_input_tokens: null })).toBeCloseTo(0.034, 9);
    expect(answerCost({ input_tokens: 200, output_tokens: 300, cache_read_input_tokens: 5000 })).toBeCloseTo(0.0078, 9);
  });
});
