import { canFill } from '../engine/lineup';
import type { LineupAnalysis, PlayerRow } from './analyze';

// Before lock (docs/before-lock.md): the lineup set in Sleeper, kickoff by kickoff. Without a server the app can't wake
// you when a starter is ruled out, so it says what to change before each lock and when to look again.

/** NFL teams announce their inactive players 90 minutes before kickoff. [reported] */
export const INACTIVES_LEAD = 90 * 60_000;

/** Chance to play below which a starter is worth watching for the inactives list. [design] */
const WATCH_BELOW = 0.95;

export type LockItem =
  /**
   * One of the app's recommended changes: start `in` over `out`, start `in` in an empty spot, bench `out`, or move `in`
   * to `slot`. `why` says what's wrong with the lineup as set.
   */
  | { kind: 'change'; slot: string; in: PlayerRow | null; out: PlayerRow | null; why: 'out' | 'no-game' | 'empty' | 'better' | 'move' }
  /** A starter who can't play, or an empty spot, that nobody on the bench can fill. */
  | { kind: 'stranded'; slot: string; out: PlayerRow | null; why: 'out' | 'no-game' | 'empty' }
  /**
   * A starter who may not play: look again when inactives come out. `backup` is the best fill-in still open then;
   * `earlier` is a better one that locks before the news.
   */
  | { kind: 'watch'; slot: string; player: PlayerRow; inactivesAt: number; backup?: FillIn; earlier?: FillIn };

/** A bench player who'd replace a starter: straight into his spot, or into a flex spot whose starter `via` moves over. */
export interface FillIn {
  player: PlayerRow;
  via?: { player: PlayerRow; slot: string };
}

export interface LockWindow {
  /** When these starters lock (epoch ms). */
  kickoff: number;
  /** Starters set in Sleeper whose games start then. */
  starters: PlayerRow[];
  items: LockItem[];
}

export interface BeforeLock {
  /** Things to fix now: empty spots and starters without a game. */
  now: LockItem[];
  /** Kickoffs still ahead, earliest first. */
  windows: LockWindow[];
  /** Starters whose games have started. */
  locked: number;
}

const SIDELINED = (p: PlayerRow) => p.p === 0;

/** What to check before each kickoff for the lineup set in Sleeper, with the app's recommended changes placed where they're due. */
export function beforeLock(a: LineupAnalysis): BeforeLock {
  const out: BeforeLock = { now: [], windows: [], locked: 0 };
  const windows = new Map<number, LockWindow>();
  const windowAt = (kickoff: number) => windows.get(kickoff) ?? windows.set(kickoff, { kickoff, starters: [], items: [] }).get(kickoff)!;
  // A change is due before the earlier of the two players' kickoffs: after that one of them is locked.
  const due = (...players: Array<PlayerRow | null | undefined>) => {
    const times = players.flatMap((p) => (p && p.kickoff !== null ? [p.kickoff] : []));
    return times.length ? Math.min(...times) : null;
  };
  const place = (item: LockItem, at: number | null) => (at === null ? out.now.push(item) : windowAt(at).items.push(item));

  const state = (p: PlayerRow) => (p.kickoff === null ? 'no-game' : SIDELINED(p) ? 'out' : 'better');
  const emptySlots = new Set(a.current.flatMap((p, s) => (p ? [] : [a.slots[s]!])));
  const changed = new Set<string>();
  for (const c of a.changes) {
    const why = c.kind === 'move' ? 'move' : c.out ? state(c.out) : emptySlots.has(c.slot) ? 'empty' : 'better';
    place({ kind: 'change', slot: c.slot, in: c.in, out: c.out, why }, why === 'empty' || why === 'no-game' ? null : due(c.out, c.in));
    if (c.out) changed.add(c.out.id);
  }

  a.current.forEach((p, s) => {
    const slot = a.slots[s]!;
    if (!p) {
      if (!a.changes.some((c) => c.kind === 'start' && c.slot === slot)) out.now.push({ kind: 'stranded', slot, out: null, why: 'empty' });
      return;
    }
    if (p.locked) {
      out.locked++;
      return;
    }
    if (p.kickoff === null) {
      if (!changed.has(p.id)) out.now.push({ kind: 'stranded', slot, out: p, why: 'no-game' });
      return;
    }
    const w = windowAt(p.kickoff);
    w.starters.push(p);
    if (changed.has(p.id)) return;
    if (SIDELINED(p)) {
      w.items.push({ kind: 'stranded', slot, out: p, why: 'out' });
      return;
    }
    if (p.p >= WATCH_BELOW) return;
    const inactivesAt = p.kickoff - INACTIVES_LEAD;
    const usable = (b: PlayerRow) => !b.locked && b.kickoff !== null && b.p > 0;
    // Straight into his spot, or one move: a starter who can play his spot moves over, and the bench player takes theirs.
    const options: FillIn[] = a.bench.filter((b) => usable(b) && canFill(slot, b.fpos)).map((b) => ({ player: b }));
    a.current.forEach((q, s2) => {
      if (!q || q === p || q.locked || q.kickoff === null || !canFill(slot, q.fpos)) return;
      const other = a.slots[s2]!;
      for (const b of a.bench) if (usable(b) && !canFill(slot, b.fpos) && canFill(other, b.fpos)) options.push({ player: b, via: { player: q, slot: other } });
    });
    options.sort((x, y) => y.player.ev - x.player.ev);
    // Still possible after the news: the fill-in's game, and the moved starter's, start after it.
    const open = (o: FillIn) => o.player.kickoff! > inactivesAt && (!o.via || o.via.player.kickoff! > inactivesAt);
    const backup = options.find(open);
    const earlier = options[0] && options[0] !== backup ? options[0] : undefined;
    w.items.push({ kind: 'watch', slot, player: p, inactivesAt, ...(backup ? { backup } : {}), ...(earlier ? { earlier } : {}) });
  });

  out.windows = [...windows.values()].sort((x, y) => x.kickoff - y.kickoff);
  return out;
}
