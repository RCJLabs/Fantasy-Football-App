import { describe, expect, it } from 'vitest';
import type { LineupAnalysis, PlayerRow } from './analyze';
import { beforeLock, INACTIVES_LEAD } from './beforeLock';

const HOUR = 3_600_000;
const SUN_1PM = Date.UTC(2026, 9, 18, 17);
const SUN_425PM = SUN_1PM + 3.42 * HOUR;
const SUN_820PM = SUN_1PM + 7.33 * HOUR;
const THU = SUN_1PM - 3 * 24 * HOUR;

const row = (id: string, pos: string, kickoff: number | null, p = 0.97, mu = 10, extra: Partial<PlayerRow> = {}): PlayerRow => ({
  id,
  name: id,
  pos,
  fpos: [pos],
  team: 'AAA',
  kickoff,
  injury: p === 0 ? 'Out' : p < 0.95 ? 'Questionable' : null,
  p,
  mu,
  ev: p * mu,
  sd: 5,
  locked: false,
  hasProjection: true,
  breakdown: [],
  ...extra,
});

const k = row('k', 'K', THU, 1, 8, { locked: true });
const qb = row('qb', 'QB', SUN_1PM);
const rb = row('rb', 'RB', SUN_1PM, 0); // Out
const wr = row('wr', 'WR', SUN_425PM, 0.74, 14); // Questionable, late game
const rb2 = row('rb2', 'RB', SUN_1PM);
const wr2 = row('wr2', 'WR', SUN_1PM, 0.97, 12); // the better backup, but he plays before the inactives news
const wr3 = row('wr3', 'WR', SUN_820PM, 0.97, 9); // plays after it
const te = row('te', 'TE', SUN_820PM);

const lineup = (over: Partial<LineupAnalysis> = {}) =>
  ({
    slots: ['K', 'QB', 'RB', 'WR', 'FLEX'],
    current: [k, qb, rb, wr, null],
    bench: [rb2, wr2, wr3, te],
    changes: [
      { kind: 'swap', slot: 'RB', in: rb2, out: rb },
      { kind: 'start', slot: 'FLEX', in: te, out: null },
    ],
    ...over,
  }) as unknown as LineupAnalysis;

describe('before lock', () => {
  it('lays out the lineup set in Sleeper kickoff by kickoff', () => {
    const check = beforeLock(lineup());
    expect(check.locked).toBe(1);
    // The empty spot is for now; the swap for the Out RB is due before his game.
    expect(check.now).toEqual([{ kind: 'change', slot: 'FLEX', in: te, out: null, why: 'empty' }]);
    expect(check.windows.map((w) => [w.kickoff, w.starters.map((p) => p.id)])).toEqual([
      [SUN_1PM, ['qb', 'rb']],
      [SUN_425PM, ['wr']],
    ]);
    expect(check.windows[0]!.items).toEqual([{ kind: 'change', slot: 'RB', in: rb2, out: rb, why: 'out' }]);
    // The Questionable WR: look again when inactives come out. The best fill-in plays before then; the one after it is named.
    expect(check.windows[1]!.items).toEqual([
      { kind: 'watch', slot: 'WR', player: wr, inactivesAt: SUN_425PM - INACTIVES_LEAD, backup: { player: wr3 }, earlier: { player: wr2 } },
    ]);
  });

  it("names what nobody on the bench can fix", () => {
    const gone = row('gone', 'QB', null); // no game this week
    const check = beforeLock(lineup({ current: [k, gone, rb, wr, null], bench: [], changes: [] }));
    expect(check.now).toEqual([
      { kind: 'stranded', slot: 'QB', out: gone, why: 'no-game' },
      { kind: 'stranded', slot: 'FLEX', out: null, why: 'empty' },
    ]);
    expect(check.windows[0]!.items).toEqual([{ kind: 'stranded', slot: 'RB', out: rb, why: 'out' }]);
    // No backup for the WR at all.
    expect(check.windows[1]!.items).toEqual([{ kind: 'watch', slot: 'WR', player: wr, inactivesAt: SUN_425PM - INACTIVES_LEAD }]);
  });

  it('fills a spot with one move: the flex starter moves over and a bench player takes the flex', () => {
    const flexWr = row('flexWr', 'WR', SUN_820PM);
    const rbLate = row('rbLate', 'RB', SUN_820PM, 0.97, 8);
    const check = beforeLock(lineup({ current: [k, qb, rb2, wr, flexWr], bench: [rbLate], changes: [] }));
    expect(check.windows.find((w) => w.kickoff === SUN_425PM)!.items).toEqual([
      { kind: 'watch', slot: 'WR', player: wr, inactivesAt: SUN_425PM - INACTIVES_LEAD, backup: { player: rbLate, via: { player: flexWr, slot: 'FLEX' } } },
    ]);
    // When the flex starter's own game starts before the news, the move has to be decided earlier.
    const flexEarly = row('flexEarly', 'WR', SUN_1PM);
    const early = beforeLock(lineup({ current: [k, qb, rb2, wr, flexEarly], bench: [rbLate], changes: [] }));
    expect(early.windows.find((w) => w.kickoff === SUN_425PM)!.items).toEqual([
      { kind: 'watch', slot: 'WR', player: wr, inactivesAt: SUN_425PM - INACTIVES_LEAD, earlier: { player: rbLate, via: { player: flexEarly, slot: 'FLEX' } } },
    ]);
  });

  it('puts an upgrade before the earlier of the two kickoffs', () => {
    const check = beforeLock(lineup({ current: [k, qb, rb2, wr3, te], bench: [wr2], changes: [{ kind: 'swap', slot: 'WR', in: wr2, out: wr3 }] }));
    expect(check.now).toEqual([]);
    expect(check.windows.map((w) => [w.kickoff, w.items.map((i) => i.kind)])).toEqual([
      [SUN_1PM, ['change']],
      [SUN_820PM, []],
    ]);
  });
});
