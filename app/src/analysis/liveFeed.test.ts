import { describe, expect, it } from 'vitest';
import type { StatLine } from '../domain/types';
import type { LineupAnalysis, PlayerRow } from './analyze';
import { awaitingStats, checkPlan, emptyFeed, FULL_EVERY, feedPlayers, feedSnapshot, statDelta, stepFeed, type LiveFeed } from './liveFeed';

const MIN = 60_000;
const T0 = Date.parse('2026-10-18T17:30:00Z');
const row = (id: string, actual: number | undefined, extra: Partial<PlayerRow> = {}): PlayerRow =>
  ({ id, name: `${id} Name`, pos: 'WR', fpos: ['WR'], team: 'KC', kickoff: T0 - 30 * MIN, locked: true, p: 1, mu: 10, ev: 10, sd: 6, injury: null, hasProjection: true, breakdown: [], ...(actual === undefined ? {} : { actual }), ...extra }) as PlayerRow;

/** One check: my WR and their QB at these points, win chance `win`. */
function check(feed: LiveFeed, at: number, wr: number, qb: number, win: number, stats?: Record<string, StatLine>) {
  const mine = row('wr', wr);
  const theirs = row('qb', qb, { pos: 'QB', team: 'BUF' });
  const fill = row('fill', undefined, { locked: false });
  const a = {
    current: [mine, null],
    me: { points: wr },
    opponent: { points: qb, bySlot: [theirs, fill], rows: [theirs, fill], assumed: ['fill'] },
    winProbCurrent: win,
  } as unknown as LineupAnalysis;
  const players = feedPlayers(a);
  return stepFeed(feed, feedSnapshot(a, players, stats ? new Map(Object.entries(stats)) : undefined, at), players);
}

describe('live feed', () => {
  it('starts quietly, then records who scored between checks with the win chance before and after', () => {
    let { feed, group } = check(emptyFeed(), T0, 4, 2, 0.5);
    expect(group).toBeUndefined();
    expect(feed.groups).toEqual([]);
    ({ feed, group } = check(feed, T0 + MIN, 10.4, 2, 0.62));
    expect(group).toMatchObject({ at: T0 + MIN, since: T0, win: [0.5, 0.62] });
    expect(group!.events).toEqual([{ id: 'wr', name: 'wr Name', pos: 'WR', team: 'KC', side: 'me', pts: 6.4, total: 10.4 }]);
    // Their QB throws a pick (−2): theirs, a loss, and the assumed fill-in isn't one of their starters.
    ({ feed, group } = check(feed, T0 + 2 * MIN, 10.4, 0, 0.66));
    expect(group!.events).toEqual([expect.objectContaining({ id: 'qb', side: 'opp', pts: -2, total: 0 })]);
    expect(feed.groups.map((g) => g.at)).toEqual([T0 + 2 * MIN, T0 + MIN]);
    // Nothing moved: no entry, but the check goes on the timeline.
    ({ feed, group } = check(feed, T0 + 3 * MIN, 10.4, 0, 0.66));
    expect(group).toBeUndefined();
    expect(feed.timeline).toEqual([
      [T0, 0.5, 4, 2],
      [T0 + MIN, 0.62, 10.4, 2],
      [T0 + 2 * MIN, 0.66, 10.4, 0],
      [T0 + 3 * MIN, 0.66, 10.4, 0],
    ]);
  });

  it('fills in what happened when the stat line catches up, and ignores older data', () => {
    const before = { wr: { rec: 2, rec_tgt: 3, rec_yd: 20 } };
    let { feed } = check(emptyFeed(), T0, 4, 2, 0.5, before);
    ({ feed } = check(feed, T0 + MIN, 13.4, 2, 0.6, before)); // the TD shows in the score first
    expect(feed.groups[0]!.events[0]!.stats).toBeUndefined();
    const after = { wr: { rec: 3, rec_tgt: 4, rec_yd: 54, rec_td: 1 } };
    let group;
    ({ feed, group } = check(feed, T0 + 2 * MIN, 13.4, 2, 0.6, after));
    expect(group).toBeUndefined();
    expect(feed.groups[0]!.events[0]!.stats).toEqual({ rec: 1, rec_tgt: 1, rec_yd: 34, rec_td: 1 });
    // A check older than the last one (a slow response) changes nothing.
    expect(check(feed, T0, 0, 0, 0.1).feed).toBe(feed);
  });

  it('gives both plays to the later entry when he scores twice before the stat line catches up', () => {
    const s0 = { wr: { rec: 1, rec_yd: 10 } };
    let { feed } = check(emptyFeed(), T0, 2, 0, 0.5, s0);
    ({ feed } = check(feed, T0 + MIN, 8, 0, 0.6, s0));
    ({ feed } = check(feed, T0 + 2 * MIN, 10, 0, 0.62, s0));
    ({ feed } = check(feed, T0 + 3 * MIN, 10, 0, 0.62, { wr: { rec: 3, rec_yd: 40, rec_td: 1 } }));
    expect(feed.groups[0]!.events[0]!.stats).toEqual({ rec: 2, rec_yd: 30, rec_td: 1 });
    expect(feed.groups[1]!.events[0]!.stats).toEqual({});
  });

  it('keeps a stat line that moves before the points for his next entry', () => {
    let { feed } = check(emptyFeed(), T0, 2, 0, 0.5, { wr: { rec: 1, rec_yd: 10 } });
    // Sleeper's stat line has his catch a check before its points do: nothing to describe yet.
    ({ feed } = check(feed, T0 + MIN, 2, 0, 0.5, { wr: { rec: 2, rec_yd: 22 } }));
    expect(feed.groups).toEqual([]);
    ({ feed } = check(feed, T0 + 2 * MIN, 4.2, 0, 0.55, { wr: { rec: 2, rec_yd: 22 } }));
    expect(feed.groups[0]!.events[0]!.stats).toEqual({ rec: 1, rec_yd: 12 });
  });

  it('knows whose stat line trails his points, for a few minutes at most', () => {
    const s0 = { wr: { rec: 1, rec_yd: 10 } };
    let { feed } = check(emptyFeed(), T0, 2, 0, 0.5, s0);
    ({ feed } = check(feed, T0 + MIN, 8, 0, 0.6, s0)); // points first
    expect([...awaitingStats(feed, T0 + MIN)]).toEqual(['wr']);
    expect(awaitingStats(feed, T0 + 4 * MIN + 1).size).toBe(0); // given up on: some points never show in a line
    ({ feed } = check(feed, T0 + 2 * MIN, 8, 0, 0.6, { wr: { rec: 2, rec_yd: 50, rec_td: 1 } }));
    expect(awaitingStats(feed, T0 + 2 * MIN).size).toBe(0); // caught up
    // A defense's or IDP's points can move with nothing its line shows: only some positions are waited for.
    const idp = { ...feed, groups: [{ at: T0 + 3 * MIN, since: T0 + 2 * MIN, events: [{ id: 'lb', name: 'lb', pos: 'LB', team: 'KC', side: 'me' as const, pts: 1, total: 1 }] }] };
    expect(awaitingStats(idp, T0 + 3 * MIN).size).toBe(0);
  });

  it('plans checks: scores every time, lineups and stat lines once a minute, stat lines every time while one trails', () => {
    expect(checkPlan(T0, 0, false)).toEqual({ full: true, stats: true }); // the first check
    expect(checkPlan(T0 + 20_000, T0, false)).toEqual({ full: false, stats: false });
    expect(checkPlan(T0 + 20_000, T0, true)).toEqual({ full: false, stats: true });
    expect(checkPlan(T0 + FULL_EVERY - 1_000, T0, false)).toEqual({ full: true, stats: true }); // timers drift
    expect(checkPlan(T0 + 20_000, T0, false, true)).toEqual({ full: true, stats: true }); // coming back to the page
  });

  it('keeps a point for the graph at each check that moved a score, else about a minute apart', () => {
    let { feed } = check(emptyFeed(), T0, 2, 0, 0.5);
    ({ feed } = check(feed, T0 + 20_000, 2, 0, 0.51));
    ({ feed } = check(feed, T0 + 40_000, 8, 0, 0.6));
    ({ feed } = check(feed, T0 + 60_000, 8, 0, 0.61));
    ({ feed } = check(feed, T0 + 100_000, 8, 0, 0.62));
    expect(feed.timeline.map((p) => p[0])).toEqual([T0, T0 + 40_000, T0 + 100_000]);
  });

  it('measures stat changes key by key', () => {
    expect(statDelta({ rec: 2, rec_yd: 20 }, { rec: 3, rec_yd: 20, rec_td: 1 })).toEqual({ rec: 1, rec_td: 1 });
    expect(statDelta({ rush_yd: 12 }, { rush_yd: 9 })).toEqual({ rush_yd: -3 });
  });
});
