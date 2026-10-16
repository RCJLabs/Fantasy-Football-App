import type { Player } from '../domain/types';
import { regularStarters, type LeagueOutlook } from './outlook';
import { teamIds } from './ros';

/**
 * Share of a starter's points per game his backup gains in the games the starter sits. Measured on the 2019–2025
 * regular seasons (nflverse game-day rosters and stats; scripts/calibrate/handcuff.ts, docs/handcuffs.md): QBs 0.76
 * (95% 0.69–0.84), RBs 0.40 (0.31–0.49). Fitted on 2019–22, both predicted the backup's points on 2023–25 better than
 * his own average. TE (0.28) and WR (0.12) backups didn't pass that test, so they aren't valued as handcuffs. [measured]
 */
export const INHERIT: Readonly<Record<string, number>> = { QB: 0.76, RB: 0.4 };

/** Out now: the next man up is in the role already. */
const SIDELINED = new Set(['IR', 'PUP', 'NA', 'Sus', 'DNR', 'COV', 'Out', 'Doubtful']);

/** Sleeper's depth charts are complete for these; receivers' are split by alignment (LWR, RWR, SWR) and patchy. */
const CHARTED = new Set(['QB', 'RB', 'TE']);

export interface Handcuff {
  starter: string;
  backup: string;
  /** Who has the backup: you, nobody (a free agent), or another team (its roster id). */
  owner: 'mine' | 'free' | number;
  share: number;
  /** Averages over the weeks ahead the starter is projected: his chance to miss a week, and the backup's points if active now and in a week the starter misses. */
  missChance: number;
  normal: number;
  elevated: number;
  /**
   * Insurance: weighted rest-of-season points the backup adds to your best lineups in the weeks the starter misses, in
   * his bigger role, beyond your bench and the best free agent at the position (whom you could add instead).
   */
  bonus: number;
}

/** Depth charts by team and chart position, lowest order first. */
export function depthIndex(players: Iterable<Player>): Map<string, Player[]> {
  const out = new Map<string, Player[]>();
  for (const p of players) {
    if (!p.team || !p.depthPos || p.depthOrder === undefined) continue;
    const key = `${p.team}:${p.depthPos}`;
    out.set(key, [...(out.get(key) ?? []), p]);
  }
  for (const list of out.values()) list.sort((a, b) => a.depthOrder! - b.depthOrder!);
  return out;
}

/** The next man up behind a QB, RB or TE who heads his team's depth chart. */
export function nextManUp(index: ReadonlyMap<string, readonly Player[]>, starter: Player): Player | undefined {
  if (!CHARTED.has(starter.pos) || !starter.team || !starter.depthPos || starter.depthOrder !== 1) return undefined;
  return index.get(`${starter.team}:${starter.depthPos}`)?.find((p) => p.id !== starter.id && p.depthOrder! > 1);
}

/** Backups whose team's starter at their position is out now: backup id → the starter. */
export function nextUpForOut(players: ReadonlyMap<string, Player>): Map<string, Player> {
  const index = depthIndex(players.values());
  const out = new Map<string, Player>();
  for (const p of players.values()) {
    if (!p.injury || !SIDELINED.has(p.injury)) continue;
    const backup = nextManUp(index, p);
    if (backup) out.set(backup.id, p);
  }
  return out;
}

/**
 * The next man up behind each of your regular QB and RB starters, and what he's worth as insurance: in each week ahead,
 * the chance the starter misses it times what the backup adds to that week's best lineup when he takes INHERIT of the
 * starter's points on top of his own projection. He's measured against your bench plus the best free agent at the
 * position, since you could add that player instead when the starter goes down. Weeks are weighted like the
 * rest-of-season values.
 */
export function handcuffs(o: LeagueOutlook, rosterId: number, players: ReadonlyMap<string, Player>): Handcuff[] {
  const me = o.teams.get(rosterId);
  if (!me) return [];
  const { model } = o;
  const ids = teamIds(me.roster);
  const owners = new Map<string, number>();
  for (const t of o.teams.values()) for (const id of t.roster.players) owners.set(id, t.rosterId);
  const index = depthIndex(players.values());
  const out: Handcuff[] = [];
  for (const id of regularStarters(model, ids)) {
    const starter = players.get(id) ?? model.player(id);
    const share = starter ? INHERIT[starter.pos] : undefined;
    const backup = starter && share !== undefined ? nextManUp(index, starter) : undefined;
    if (!starter || share === undefined || !backup) continue;
    const held = owners.get(backup.id);
    const owner: Handcuff['owner'] = held === rosterId ? 'mine' : held === undefined ? 'free' : held;
    const rest = ids.filter((x) => x !== id && x !== backup.id);
    let bonus = 0;
    let miss = 0;
    let normal = 0;
    let elevated = 0;
    let weeks = 0;
    for (let i = 0; i < o.weeks.length; i++) {
      const play = model.play(id, i);
      const ev = model.ev(id)[i]!;
      // Not projected (a bye, or out already): the backup's own projection carries those weeks.
      if (ev <= 0 || play <= 0) continue;
      const backupPlay = model.play(backup.id, i);
      const own = backupPlay > 0 ? model.ev(backup.id)[i]! / backupPlay : 0;
      const bigger = own + share * (ev / play);
      const free = bestFree(o, owners, starter.pos, backup.id, i);
      const base = free ? [...rest, free] : rest;
      const gain = model.lineupWeek([...base, backup.id], i, new Map([[backup.id, backupPlay * bigger]])).mean - model.lineupWeek(base, i).mean;
      bonus += (me.weights[i] ?? 1) * (1 - play) * Math.max(0, gain);
      miss += 1 - play;
      normal += own;
      elevated += bigger;
      weeks++;
    }
    if (weeks) out.push({ starter: id, backup: backup.id, owner, share, missChance: miss / weeks, normal: normal / weeks, elevated: elevated / weeks, bonus });
  }
  return out.sort((a, b) => b.bonus - a.bonus);
}

/** The free agent at `pos` with the most expected points in week index `i`, other than `except`. */
function bestFree(o: LeagueOutlook, rostered: ReadonlyMap<string, number>, pos: string, except: string, i: number): string | undefined {
  let best: string | undefined;
  let top = 0;
  for (const id of o.model.projected(i)) {
    if (id === except || rostered.has(id) || !o.model.fpos(id).includes(pos)) continue;
    const ev = o.model.ev(id)[i]!;
    if (ev > top) [best, top] = [id, ev];
  }
  return best;
}
