import { describe, expect, it } from 'vitest';
import { buildMatchups, PRIOR_GAMES } from './matchups';

const stat = (week: number, player: string, position: string, opponent: string, ppr: number, seasonType = 'REG') => ({
  week: String(week),
  player_id: player,
  position,
  team: 'AAA',
  opponent_team: opponent,
  fantasy_points_ppr: String(ppr),
  season_type: seasonType,
});
const cb = (week: number, pfr: string, team: string, pct: number) => ({ week: String(week), pfr_player_id: pfr, position: 'CB', team, defense_pct: String(pct), game_type: 'REG' });

const rosters = ['cb1', 'cb2', 'cb3', 'cb4', 'cb5', 'cb6'].map((id) => ({ pfr_id: `P${id}`, gsis_id: `G${id}` }));
const sleeperByGsis = new Map(rosters.map((r) => [r.gsis_id, r.pfr_id.slice(1)]));

describe('matchups', () => {
  const m = buildMatchups({
    season: '2026',
    now: '2026-10-16T00:00:00Z',
    rosters,
    sleeperByGsis,
    stats: [
      // A WR who usually scores 15: 10 vs BBB (−7.5 vs his other games), 20 vs CCC (+7.5), 15 vs DDD (0).
      stat(1, 'w', 'WR', 'BBB', 10),
      stat(2, 'w', 'WR', 'CCC', 20),
      stat(3, 'w', 'WR', 'DDD', 15),
      stat(19, 'w', 'WR', 'BBB', 40, 'POST'), // playoffs don't count
      // Two games aren't enough to know a player's usual.
      stat(1, 'x', 'WR', 'BBB', 30),
      stat(2, 'x', 'WR', 'CCC', 0),
      // nflverse's LA is Sleeper's LAR: a TE with 5 and 7 against them, 9 elsewhere.
      stat(1, 't', 'TE', 'LA', 5),
      stat(2, 't', 'TE', 'LA', 7),
      stat(3, 't', 'TE', 'BBB', 9),
    ],
    snaps: [
      cb(4, 'Pcb1', 'BBB', 0.9),
      cb(5, 'Pcb1', 'BBB', 0.95),
      cb(5, 'Pcb2', 'BBB', 0.4), // not a regular
      cb(5, 'Pcb3', 'BBB', 0.7),
      cb(5, 'Pcb4', 'BBB', 0.6),
      cb(5, 'Pcb5', 'BBB', 0.55), // fourth regular: only three kept
      cb(4, 'Pcb6', 'BBB', 1),
      cb(5, 'Pcb6', 'LA', 1), // traded: counts for his new team
      cb(1, 'Pcb3', 'BBB', 0.1), // outside the last four weeks
    ],
  })!;

  it('measures each defense against players’ usual, shrunk toward zero', () => {
    expect(m.priorGames).toBe(PRIOR_GAMES);
    expect(m.weeks).toEqual([1, 2, 3]);
    expect(m.defense.BBB!.WR).toEqual({ pg: Math.round((-7.5 / (1 + PRIOR_GAMES)) * 10) / 10, n: 1 });
    expect(m.defense.CCC!.WR).toEqual({ pg: Math.round((7.5 / (1 + PRIOR_GAMES)) * 10) / 10, n: 1 });
    expect(m.defense.DDD!.WR).toEqual({ pg: 0, n: 1 });
    expect(m.defense.LAR!.TE).toEqual({ pg: Math.round((-3 / (2 + PRIOR_GAMES)) * 10) / 10, n: 2 });
    expect(m.defense.LA).toBeUndefined();
  });

  it("keeps each defense's three regular cornerbacks by recent snap share", () => {
    expect(m.secondary.BBB).toEqual([
      { id: 'cb1', snap: 93 },
      { id: 'cb3', snap: 70 },
      { id: 'cb4', snap: 60 },
    ]);
    expect(m.secondary.LAR).toEqual([{ id: 'cb6', snap: 100 }]);
  });

  it('returns nothing without stats', () => {
    expect(buildMatchups({ season: '2026', now: '', rosters, sleeperByGsis, stats: [], snaps: [] })).toBeNull();
  });
});
