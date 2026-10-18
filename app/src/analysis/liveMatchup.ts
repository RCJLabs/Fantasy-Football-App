// The Matchup tab's live view: both lineups slot by slot as they'll score (yours as set in Sleeper, the opponent's with the
// model's fill-ins for starters who can't play), Sleeper's points so far, and each side's expected final.
import { type LineupAnalysis, type PlayerRow, starterDist } from './analyze';

/**
 * Where a starter's game stands: from its live clock (ESPN's scoreboard) when loaded; otherwise a game counts as final
 * 3.5 hours after kickoff, as the app labels it.
 */
export type GameState = 'bye' | 'upcoming' | 'live' | 'final';
const FINAL_MS = 3.5 * 3_600_000;

export function gameState(row: Pick<PlayerRow, 'kickoff' | 'clock'>, now: number): GameState {
  if (row.kickoff === null) return 'bye';
  if (row.clock) return row.clock.state === 'post' ? 'final' : row.clock.state === 'in' ? 'live' : 'upcoming';
  if (row.kickoff > now) return 'upcoming';
  return now - row.kickoff > FINAL_MS ? 'final' : 'live';
}

export interface LiveSide {
  rosterId: number;
  name: string;
  /** Starters by starting slot (null: empty). */
  slots: Array<PlayerRow | null>;
  /** Sleeper's points so far. */
  points: number;
  /** Expected final: points so far plus what's left of each starter's projection (by the game clock, else time since kickoff). */
  projected: number;
  /** Starters by where their games stand. */
  games: Record<GameState, number>;
  /** Bench players the model assumes start for starters who can't play (the opponent's). */
  assumed: ReadonlySet<string>;
}

export interface LiveMatchup {
  slots: string[];
  me: LiveSide;
  opponent?: LiveSide;
  /** A starter on either side is playing now. */
  playing: boolean;
}

function liveSide(rosterId: number, name: string, slots: Array<PlayerRow | null>, points: number, now: number, assumed: readonly string[] = []): LiveSide {
  const games: Record<GameState, number> = { bye: 0, upcoming: 0, live: 0, final: 0 };
  let projected = 0;
  for (const r of slots) {
    if (!r) continue;
    games[gameState(r, now)]++;
    projected += starterDist(r, now).mean;
  }
  return { rosterId, name, slots, points, projected, games, assumed: new Set(assumed) };
}

/** Your lineup as set (not the recommended one: it's what scores) against the opponent's, at `now`. */
export function liveMatchup(a: LineupAnalysis, now: number): LiveMatchup {
  const me = liveSide(a.me.rosterId, a.me.name, a.current, a.me.points, now);
  const o = a.opponent;
  const opponent = o ? liveSide(o.rosterId, o.name, o.bySlot, o.points, now, o.assumed) : undefined;
  return { slots: a.slots, me, ...(opponent ? { opponent } : {}), playing: me.games.live > 0 || (opponent?.games.live ?? 0) > 0 };
}
