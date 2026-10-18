// The Matchup tab's live feed (docs/gameday.md): what changed between two checks of Sleeper's scores, starter by starter
// on both sides, with the win chance before and after. Points come from Sleeper's matchups; stat lines can lag them, so
// an entry's stats (what happened) fill in when the stat line catches up.
import type { StatLine } from '../domain/types';
import type { LineupAnalysis, PlayerRow } from './analyze';

/** Entries kept per league and week. [design] */
const MAX_GROUPS = 200;
/** Checks kept for a graph of the day (roadmap): a long Sunday of checks a minute apart. */
const MAX_TIMELINE = 1500;
/** With no score moving, the graph keeps a check about a minute apart (checks come every 20 seconds). [design] */
const TIMELINE_EVERY = 50_000;
/** A stat line's change goes to his latest entry this recent that has no stats yet. [design] */
const DESCRIBE_WINDOW = 15 * 60_000;
/** Smaller point changes are rounding. */
const MIN_POINTS = 0.05;
/** A stat line this far behind its points is no longer waited for: some points never show in one (a 2-pt try, say). [design] */
const CATCH_UP = 3 * 60_000;
/** Positions whose stat lines show what scores their points (IDP lines leave much of it out). */
const LINED = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DEF']);
/** Lineups and stat lines load at least this often while games are on; scores load with every check. [design] */
export const FULL_EVERY = 60_000;
/** Timers drift: a check this close to a full one's time counts as one. */
const SLACK = 5_000;

export interface FeedSnapshot {
  at: number;
  /** Win chance with the lineup as set. */
  win?: number;
  me: number;
  opp?: number;
  /** Points so far and stat line of each starter on either side, by Sleeper id. */
  players: Record<string, { pts: number; stats?: StatLine }>;
}

export interface FeedEvent {
  id: string;
  name: string;
  pos: string;
  team: string | null;
  side: 'me' | 'opp';
  /** Points since the check before (negative: lost, or a stat correction). */
  pts: number;
  /** His points so far, after it. */
  total: number;
  /** What his stat line added, once it catches up (empty: covered by a later entry). */
  stats?: StatLine;
  /** His ESPN athlete id, to find him in ESPN's scoring plays. */
  espn?: string;
}

export interface FeedGroup {
  at: number;
  /** Time of the check before: the entries cover what happened in between. */
  since: number;
  /** Win chance before and after. */
  win?: [number, number];
  events: FeedEvent[];
}

export interface LiveFeed {
  snapshot?: FeedSnapshot;
  /** Each player's stat line when last matched to an entry: the next change is measured from it. */
  described: Record<string, StatLine>;
  /** Newest first. */
  groups: FeedGroup[];
  /** [time, win chance, your points, theirs] at each check, kept for a graph of the day (roadmap). */
  timeline: Array<[number, number | null, number, number | null]>;
}

export interface FeedPlayer {
  row: PlayerRow;
  side: 'me' | 'opp';
}

export const emptyFeed = (): LiveFeed => ({ described: {}, groups: [], timeline: [] });

/** The starters who score: your lineup as set, and the opponent's real starters (no assumed fill-ins). */
export function feedPlayers(a: LineupAnalysis): Map<string, FeedPlayer> {
  const out = new Map<string, FeedPlayer>();
  for (const r of a.current) if (r) out.set(r.id, { row: r, side: 'me' });
  const assumed = new Set(a.opponent?.assumed ?? []);
  for (const r of a.opponent?.bySlot ?? []) if (r && !assumed.has(r.id)) out.set(r.id, { row: r, side: 'opp' });
  return out;
}

export function feedSnapshot(a: LineupAnalysis, players: ReadonlyMap<string, FeedPlayer>, stats: ReadonlyMap<string, StatLine> | undefined, at: number): FeedSnapshot {
  const snap: FeedSnapshot = { at, me: a.me.points, players: {} };
  if (a.winProbCurrent !== undefined) snap.win = a.winProbCurrent;
  if (a.opponent) snap.opp = a.opponent.points;
  for (const [id, { row }] of players) {
    const s = stats?.get(id);
    snap.players[id] = s ? { pts: row.actual ?? 0, stats: s } : { pts: row.actual ?? 0 };
  }
  return snap;
}

const round2 = (x: number) => Math.round(x * 100) / 100;

/** What moved between two stat lines (keys that changed only). */
export function statDelta(before: StatLine, after: StatLine): StatLine {
  const out: StatLine = {};
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const d = round2((after[k] ?? 0) - (before[k] ?? 0));
    if (d) out[k] = d;
  }
  return out;
}

/**
 * The feed after one more check: a new entry when any starter's points moved, then stat line changes matched to the
 * entries they explain. When a player scores twice before his stat line catches up, the later entry gets both plays; when
 * his stat line moves first, the change waits for his next entry.
 */
export function stepFeed(feed: LiveFeed, next: FeedSnapshot, players: ReadonlyMap<string, FeedPlayer>): { feed: LiveFeed; group?: FeedGroup } {
  const prev = feed.snapshot;
  if (prev && next.at < prev.at) return { feed };
  let groups = feed.groups;
  let fresh: FeedGroup | undefined;
  if (prev) {
    const events: FeedEvent[] = [];
    for (const [id, p] of Object.entries(next.players)) {
      const who = players.get(id);
      const d = round2(p.pts - (prev.players[id]?.pts ?? 0));
      if (!who || Math.abs(d) < MIN_POINTS) continue;
      const e: FeedEvent = { id, name: who.row.name, pos: who.row.pos, team: who.row.team, side: who.side, pts: d, total: round2(p.pts) };
      if (who.row.espnId) e.espn = who.row.espnId;
      events.push(e);
    }
    if (events.length) {
      fresh = { at: next.at, since: prev.at, events: events.sort((x, y) => Math.abs(y.pts) - Math.abs(x.pts)) };
      if (prev.win !== undefined && next.win !== undefined) fresh.win = [prev.win, next.win];
      groups = [fresh, ...groups].slice(0, MAX_GROUPS);
    }
  }
  const described = { ...feed.described };
  for (const [id, p] of Object.entries(next.players)) {
    if (!p.stats) continue;
    const base = described[id];
    const delta = base ? statDelta(base, p.stats) : {};
    const waiting = (g: FeedGroup) => g.at >= next.at - DESCRIBE_WINDOW && g.events.some((e) => e.id === id && !e.stats);
    // A change with no entry waiting for it (his stat line moved before his points) is kept for his next entry.
    if (Object.keys(delta).length && !groups.some(waiting)) continue;
    described[id] = p.stats;
    if (!Object.keys(delta).length) continue;
    // His entries still waiting for stats: the latest gets the change, earlier ones are covered by it.
    let latest = true;
    groups = groups.map((g) => {
      if (!waiting(g)) return g;
      const stats = latest ? delta : {};
      latest = false;
      return { ...g, events: g.events.map((e) => (e.id === id && !e.stats ? { ...e, stats } : e)) };
    });
  }
  // The graph's points: each check that moved a score, else one about a minute apart.
  const last = feed.timeline.at(-1);
  const keep = last && (last[0] === next.at || (last[2] === next.me && last[3] === (next.opp ?? null) && next.at - last[0] < TIMELINE_EVERY));
  const timeline = keep ? feed.timeline : [...feed.timeline, [next.at, next.win ?? null, next.me, next.opp ?? null] as LiveFeed['timeline'][number]].slice(-MAX_TIMELINE);
  const out: { feed: LiveFeed; group?: FeedGroup } = { feed: { snapshot: next, described, groups, timeline } };
  // The new entry as it stands now (its stats may have just been matched).
  if (fresh) out.group = groups.find((g) => g.at === fresh.at) ?? fresh;
  return out;
}

/** Starters whose points moved in the last few minutes while their stat line hasn't shown it yet (the "updating" tag). */
export function awaitingStats(feed: LiveFeed, now: number): Set<string> {
  const out = new Set<string>();
  for (const g of feed.groups) {
    if (g.at < now - CATCH_UP) break; // newest first
    for (const e of g.events) if (!e.stats && LINED.has(e.pos)) out.add(e.id);
  }
  return out;
}

/**
 * What a check loads besides scores: lineups and stat lines once a minute (or when `full` asks), and stat lines at every
 * check while a starter's line trails his points.
 */
export function checkPlan(at: number, lastFull: number, trailing: boolean, full = false): { full: boolean; stats: boolean } {
  const isFull = full || at - lastFull >= FULL_EVERY - SLACK;
  return { full: isFull, stats: isFull || trailing };
}
