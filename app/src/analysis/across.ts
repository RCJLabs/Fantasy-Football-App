import type { PlayerRow } from './analyze';
import type { WaiverAdvice } from './outlook';

/** One league's recommended starters this week. */
export interface LeagueStarters {
  leagueId: string;
  name: string;
  starters: readonly PlayerRow[];
}

/** A player in your lineups in two or more leagues: one injury or bad game hits all of them. */
export interface Exposure {
  player: PlayerRow;
  /** League names. */
  leagues: string[];
}

/** Players in two or more of your recommended lineups: most leagues first, then the likeliest to miss. */
export function exposure(lineups: readonly LeagueStarters[]): Exposure[] {
  const by = new Map<string, Exposure>();
  for (const l of lineups) {
    for (const p of l.starters) {
      const e = by.get(p.id) ?? { player: p, leagues: [] };
      if (!e.leagues.includes(l.name)) e.leagues.push(l.name);
      by.set(p.id, e);
    }
  }
  return [...by.values()]
    .filter((e) => e.leagues.length >= 2)
    .sort((a, b) => b.leagues.length - a.leagues.length || a.player.p - b.player.p || a.player.name.localeCompare(b.player.name));
}

/** An NFL game holding several of your starters across leagues: their weeks rise and fall together. */
export interface GameStack {
  /** "AWY@HOM". */
  game: string;
  kickoff: number | null;
  /** Starter slots across your leagues (a player starting in two leagues counts twice). */
  slots: number;
  /** Distinct players, most leagues first. */
  players: Array<{ player: PlayerRow; leagues: number }>;
}

/** Games where `min`+ of your starter slots across leagues play, most first. Players without a game this week are left out. */
export function gameStacks(lineups: readonly LeagueStarters[], min = 3): GameStack[] {
  const games = new Map<string, { kickoff: number | null; players: Map<string, { player: PlayerRow; leagues: number }> }>();
  for (const l of lineups) {
    for (const p of l.starters) {
      if (!p.team || !p.opponent) continue;
      const game = p.home ? `${p.opponent}@${p.team}` : `${p.team}@${p.opponent}`;
      const g = games.get(game) ?? { kickoff: p.kickoff, players: new Map() };
      const e = g.players.get(p.id) ?? { player: p, leagues: 0 };
      e.leagues++;
      g.players.set(p.id, e);
      games.set(game, g);
    }
  }
  return [...games]
    .map(([game, g]) => {
      const players = [...g.players.values()].sort((a, b) => b.leagues - a.leagues || a.player.name.localeCompare(b.player.name));
      return { game, kickoff: g.kickoff, slots: players.reduce((s, x) => s + x.leagues, 0), players };
    })
    .filter((g) => g.slots >= min)
    .sort((a, b) => b.slots - a.slots || (a.kickoff ?? Infinity) - (b.kickoff ?? Infinity));
}

/** One league's waiver board. */
export interface LeagueBoard {
  leagueId: string;
  name: string;
  rows: readonly WaiverAdvice[];
}

/** A free agent who's a top waiver target in two or more of your leagues. */
export interface SharedTarget {
  player: PlayerRow;
  /** His value in each league where he's a top target, most first. */
  leagues: Array<{ leagueId: string; name: string; gain: number; rosGain: number; gainThisWeek: number; bid?: number }>;
}

/** Points (this week plus the weighted rest of the season) a free agent must add to count as a target: the claim plan's minimum. [design] */
const MIN_TARGET = 2;

/**
 * Free agents among the top `top` of two or more leagues' waiver boards (adding 2+ points in each), where he adds most
 * first. Claiming him where he adds more is the point: waiver priority and FAAB are per league.
 */
export function sharedTargets(boards: readonly LeagueBoard[], top = 10): SharedTarget[] {
  const by = new Map<string, SharedTarget>();
  for (const b of boards) {
    for (const r of b.rows.slice(0, top)) {
      const gain = r.gainThisWeek + r.rosGain;
      if (gain < MIN_TARGET) continue;
      const t = by.get(r.player.id) ?? { player: r.player, leagues: [] };
      t.leagues.push({ leagueId: b.leagueId, name: b.name, gain, rosGain: r.rosGain, gainThisWeek: r.gainThisWeek, ...(r.bid ? { bid: r.bid.bid } : {}) });
      by.set(r.player.id, t);
    }
  }
  const out = [...by.values()].filter((t) => t.leagues.length >= 2);
  for (const t of out) t.leagues.sort((a, b) => b.gain - a.gain);
  return out.sort((a, b) => b.leagues[0]!.gain - a.leagues[0]!.gain);
}
