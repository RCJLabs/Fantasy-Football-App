import { describe, expect, it } from 'vitest';
import { exposure, gameStacks, sharedTargets, type LeagueStarters } from './across';
import type { PlayerRow } from './analyze';
import type { WaiverAdvice } from './outlook';

const row = (id: string, team: string | null, opponent?: string, home = false, p = 1): PlayerRow => ({
  id,
  name: id,
  pos: 'WR',
  fpos: ['WR'],
  team,
  ...(opponent ? { opponent, home } : {}),
  kickoff: opponent ? Date.UTC(2026, 9, 18, 17) : null,
  injury: p < 1 ? 'Questionable' : null,
  p,
  mu: 10,
  ev: 10 * p,
  sd: 5,
  locked: false,
  hasProjection: true,
  breakdown: [],
});

const qb = row('qb', 'BUF', 'KC', true);
const wr = row('wr', 'KC', 'BUF', false, 0.8);
const rb = row('rb', 'DAL', 'NYG', true);
const te = row('te', 'DAL', 'NYG', true);
const bye = row('bye', 'SF');
const lineups: LeagueStarters[] = [
  { leagueId: 'A', name: 'Alpha', starters: [qb, wr, rb, bye] },
  { leagueId: 'B', name: 'Bravo', starters: [qb, wr, te] },
  { leagueId: 'C', name: 'Charlie', starters: [qb, bye] },
];

describe('across leagues', () => {
  it('lists players you start in two or more leagues, most leagues first, then the likeliest to miss', () => {
    expect(exposure(lineups).map((e) => [e.player.id, e.leagues])).toEqual([
      ['qb', ['Alpha', 'Bravo', 'Charlie']],
      ['wr', ['Alpha', 'Bravo']], // Questionable: before the healthy player starting in as many
      ['bye', ['Alpha', 'Charlie']],
    ]);
    expect(exposure([lineups[0]!])).toEqual([]);
  });

  it('finds the NFL games holding several of your starters across leagues', () => {
    const stacks = gameStacks(lineups);
    // KC@BUF: the QB in three leagues and the WR in two. DAL's two players make two slots, under the minimum.
    expect(stacks.map((g) => [g.game, g.slots, g.players.map((x) => [x.player.id, x.leagues])])).toEqual([
      [
        'KC@BUF',
        5,
        [
          ['qb', 3],
          ['wr', 2],
        ],
      ],
    ]);
    expect(gameStacks(lineups, 2).map((g) => g.game)).toEqual(['KC@BUF', 'NYG@DAL']);
  });

  it('finds free agents who are top waiver targets in two or more leagues, where they add most first', () => {
    const advice = (id: string, rosGain: number, gainThisWeek = 0, bid?: number): WaiverAdvice => ({
      player: row(id, 'NE', 'NYJ'),
      gainThisWeek,
      rosGain,
      ...(bid !== undefined ? { bid: { bid, market: bid, reason: '' } } : {}),
    });
    const boards = [
      { leagueId: 'A', name: 'Alpha', rows: [advice('f1', 4, 0.5, 6), advice('f2', 9), advice('f3', 1), advice('f4', 3)] },
      { leagueId: 'B', name: 'Bravo', rows: [advice('f1', 11, 1, 14), advice('f3', 6), advice('f5', 5), advice('f4', 2)] },
    ];
    const shared = sharedTargets(boards);
    // f3 adds under 2 points in Alpha; f2 and f5 are free agents worth claiming in one league only.
    expect(shared.map((t) => [t.player.id, t.leagues.map((l) => [l.name, l.gain, l.bid])])).toEqual([
      [
        'f1',
        [
          ['Bravo', 12, 14],
          ['Alpha', 4.5, 6],
        ],
      ],
      [
        'f4',
        [
          ['Alpha', 3, undefined],
          ['Bravo', 2, undefined],
        ],
      ],
    ]);
    // Only each board's top rows count.
    expect(sharedTargets(boards, 3).map((t) => t.player.id)).toEqual(['f1']);
  });
});
