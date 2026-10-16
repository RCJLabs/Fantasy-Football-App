import { describe, expect, it } from 'vitest';
import {
  bandShapes,
  dueEvents,
  impliedProb,
  matchPlayer,
  meanFromLine,
  noVig,
  normalizeName,
  type OddsEvent,
  poissonMeanFromLine,
  type PropPlayer,
  propsStatLines,
  quantileSorted,
  shapeQuantile,
  ANYTIME_MARGIN,
} from './props';
import { PROP_SHAPES } from './prop-shapes';

describe('odds', () => {
  it('turns American prices into implied chances and removes the vig', () => {
    expect(impliedProb(-110)).toBeCloseTo(110 / 210, 12);
    expect(impliedProb(150)).toBeCloseTo(0.4, 12);
    expect(noVig(-110, -110)).toBeCloseTo(0.5, 12);
    expect(noVig(-120, 100)).toBeCloseTo(120 / 220 / (120 / 220 + 0.5), 12);
  });

  it('inverts Poisson touchdown lines', () => {
    // 0.5 line: P(X ≥ 1) = 1 − e^−λ.
    expect(poissonMeanFromLine(0.5, 0.6)).toBeCloseTo(-Math.log(0.4), 6);
    // 1.5 line at even money: P(X ≥ 2) = 1 − e^−λ(1 + λ) = 0.5.
    const l = poissonMeanFromLine(1.5, 0.5);
    expect(1 - Math.exp(-l) * (1 + l)).toBeCloseTo(0.5, 6);
  });
});

describe('outcome shapes', () => {
  it('reads quantiles between bands and between levels', () => {
    const bands = [
      { center: 10, n: 1, q: [0.5, 1, 1.5] },
      { center: 20, n: 1, q: [0.7, 1, 1.3] },
    ];
    const levels = [0.1, 0.5, 0.9];
    expect(shapeQuantile(bands, levels, 5, 0.1)).toBe(0.5); // below the first band
    expect(shapeQuantile(bands, levels, 15, 0.1)).toBeCloseTo(0.6, 12); // halfway between bands
    expect(shapeQuantile(bands, levels, 30, 0.3)).toBeCloseTo(0.85, 12); // above the last band, halfway between levels
  });

  it('puts the mean above a skewed stat’s even-money line, and near it for passing yards', () => {
    const wr = meanFromLine('rec_yd:WR', 45.5, 0.5)!;
    expect(wr).toBeGreaterThan(48);
    expect(wr).toBeLessThan(56);
    // The line sits at the outcome's median under that mean.
    expect(wr * shapeQuantile(PROP_SHAPES.shapes['rec_yd:WR']!, PROP_SHAPES.levels, wr, 0.5)).toBeCloseTo(45.5, 6);
    expect(Math.abs(meanFromLine('pass_yd:QB', 245.5, 0.5)! - 245.5)).toBeLessThan(5);
    // A pricier over means a higher mean; no shape, no answer.
    expect(meanFromLine('rec_yd:WR', 45.5, 0.6)!).toBeGreaterThan(wr);
    expect(meanFromLine('kick_yd:K', 45.5, 0.5)).toBeUndefined();
  });

  it('builds equal-count bands of outcome ÷ projection rescaled to mean 1', () => {
    const pairs: Array<[number, number]> = [
      [10, 5], [10, 15], [10, 10], [10, 10], // ratios 0.5, 1.5, 1, 1: mean 1
      [20, 40], [20, 0], [20, 20], [20, 20],
    ];
    const bands = bandShapes(pairs, 4, 6);
    expect(bands.map((b) => [b.center, b.n])).toEqual([[10, 4], [20, 4]]);
    expect(bands[0]!.q[10]).toBe(1); // the median level (0.5)
    expect(quantileSorted([0, 1, 2, 3], 0.5)).toBe(1.5);
  });
});

describe('players', () => {
  it('normalizes names: accents, punctuation, suffixes, initials', () => {
    expect(normalizeName('A.J. Brown')).toBe('aj brown');
    expect(normalizeName('A. J. Brown')).toBe('aj brown');
    expect(normalizeName('Kenneth Walker III')).toBe('kenneth walker');
    expect(normalizeName("Ja'Marr Chase")).toBe('jamarr chase');
    expect(normalizeName('Amon-Ra St. Brown')).toBe('amon ra st brown');
    expect(normalizeName('J. Michael Sturdivant')).toBe('j michael sturdivant');
    expect(normalizeName('Michael Pittman Jr.')).toBe('michael pittman');
  });

  const roster: PropPlayer[] = [
    { id: '1', name: 'Kenneth Walker', pos: 'RB', team: 'SEA' },
    { id: '2', name: 'Jaxon Smith-Njigba', pos: 'WR', team: 'SEA' },
    { id: '3', name: 'Marquise Brown', pos: 'WR', team: 'KC' },
    { id: '4', name: 'Josh Brown', pos: 'WR', team: 'KC' },
    { id: '5', name: 'Travis Kelce', pos: 'TE', team: 'KC' },
    { id: '6', name: 'Travis Kelce', pos: 'TE', team: 'PHI' }, // a namesake on another team
  ];
  const byTeam = new Map<string, PropPlayer[]>();
  for (const p of roster) byTeam.set(p.team!, [...(byTeam.get(p.team!) ?? []), p]);

  it('matches within the two teams: full name, then initial and last name, then a unique last name', () => {
    expect(matchPlayer('Kenneth Walker III', ['SEA', 'KC'], byTeam)?.id).toBe('1');
    expect(matchPlayer('Travis Kelce', ['SEA', 'KC'], byTeam)?.id).toBe('5');
    expect(matchPlayer('Jax Smith-Njigba', ['SEA', 'KC'], byTeam)?.id).toBe('2'); // initial + last name
    expect(matchPlayer('Hollywood Brown', ['SEA', 'KC'], byTeam)).toBeUndefined(); // two KC Browns, no initial match
    expect(matchPlayer('Ken Walker', ['SEA', 'KC'], byTeam)?.id).toBe('1');
    expect(matchPlayer('Nobody Here', ['SEA', 'KC'], byTeam)).toBeUndefined();
  });

  it('turns a game’s props into stat means: median over books, Poisson touchdowns, unmatched names counted', () => {
    const event: OddsEvent = {
      id: 'e1',
      commence_time: '2026-10-18T17:00:00Z',
      home_team: 'Kansas City Chiefs',
      away_team: 'Seattle Seahawks',
      bookmakers: [
        {
          key: 'a',
          markets: [
            {
              key: 'player_reception_yds',
              outcomes: [
                { name: 'Over', description: 'Travis Kelce', price: -110, point: 55.5 },
                { name: 'Under', description: 'Travis Kelce', price: -110, point: 55.5 },
                { name: 'Over', description: 'Somebody Unknown', price: -110, point: 20.5 },
                { name: 'Under', description: 'Somebody Unknown', price: -110, point: 20.5 },
              ],
            },
            {
              key: 'player_anytime_td',
              outcomes: [
                { name: 'Yes', description: 'Kenneth Walker III', price: 100 },
                { name: 'No', description: 'Kenneth Walker III', price: -130 },
              ],
            },
          ],
        },
        {
          key: 'b',
          markets: [
            {
              key: 'player_reception_yds',
              outcomes: [
                { name: 'Over', description: 'Travis Kelce', price: -110, point: 57.5 },
                { name: 'Under', description: 'Travis Kelce', price: -110, point: 57.5 },
              ],
            },
            { key: 'player_anytime_td', outcomes: [{ name: 'Yes', description: 'Travis Kelce', price: 150 }] },
          ],
        },
      ],
    };
    const base = (id: string) => (id === '1' ? { rush_td: 0.6, rec_td: 0.2 } : undefined);
    const { lines, matched, unmatched } = propsStatLines([event], roster, base);
    expect([matched, unmatched]).toEqual([2, 1]);
    const kelce = lines.get('5')!;
    const a = meanFromLine('rec_yd:TE', 55.5, 0.5)!;
    const b = meanFromLine('rec_yd:TE', 57.5, 0.5)!;
    expect(kelce.stats.rec_yd).toBeCloseTo((a + b) / 2, 9);
    expect(kelce.books).toBe(2);
    // One-sided Yes: the margin comes off, then all of a TE's touchdowns are receiving.
    const kelceTds = -Math.log(1 - 0.4 / (1 + ANYTIME_MARGIN));
    expect(kelce.stats.rec_td).toBeCloseTo(kelceTds, 9);
    expect(kelce.stats.rush_td).toBe(0);
    // Two-sided: no-vig chance; split as his projection splits rushing and receiving TDs (3:1).
    const walkerTds = -Math.log(1 - noVig(100, -130));
    expect(lines.get('1')!.stats.rush_td).toBeCloseTo(walkerTds * 0.75, 9);
    expect(lines.get('1')!.stats.rec_td).toBeCloseTo(walkerTds * 0.25, 9);
  });
});

describe('pull schedule', () => {
  const ev = (id: string, kickoff: string): OddsEvent => ({ id, commence_time: kickoff, home_team: 'H', away_team: 'A' });
  const now = Date.parse('2026-10-18T13:00:00Z');
  const events = [ev('late', '2026-10-18T20:25:00Z'), ev('b', '2026-10-18T17:00:00Z'), ev('a', '2026-10-18T17:00:00Z'), ev('started', '2026-10-18T12:00:00Z'), ev('mon', '2026-10-20T00:15:00Z')];

  it('takes games kicking off within the window, not fetched before, nearest first, within the credits', () => {
    expect(dueEvents(events, now, 5, new Set(), 100, 6).map((e) => e.id)).toEqual(['a', 'b']);
    expect(dueEvents(events, now, 8, new Set(['a']), 100, 6).map((e) => e.id)).toEqual(['b', 'late']);
    expect(dueEvents(events, now, 8, new Set(), 13, 6).map((e) => e.id)).toEqual(['a', 'b']); // two games' worth
    expect(dueEvents(events, now, 8, new Set(), 5, 6)).toEqual([]);
  });
});
