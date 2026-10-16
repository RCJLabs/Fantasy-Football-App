import type { Player } from '../domain/types';
import { irEligible, rosteredIds, startable } from './analyze';
import type { LeagueOutlook } from './outlook';
import { teamIds } from './ros';

export interface StashRow {
  id: string;
  /** The first week ahead Sleeper projects him: his expected return. */
  back: number;
  /** His points if active, averaged over the weeks he's projected. */
  perWeek: number;
  /** Weighted rest-of-season points he adds to your best lineups once back. He waits on IR, so no drop until then. */
  gain: number;
  /** The part of `gain` from playoff weeks. */
  playoffGain: number;
}

export interface IrStash {
  /** IR slots you have free (0: the card stays hidden). */
  openSlots: number;
  rows: StashRow[];
}

/**
 * Injured free agents who could go straight into an open IR slot: players whose status this league allows on IR and
 * whom Sleeper projects again later in the season. Ranked by what each adds to your best lineups over the rest of the
 * season, weighted like the other rest-of-season values (playoff weeks by your playoff odds).
 */
export function irStash(o: LeagueOutlook, rosterId: number, players: ReadonlyMap<string, Player>, limit = 8): IrStash {
  const me = o.teams.get(rosterId);
  const openSlots = me ? Math.max(0, o.league.rules.reserveSlots - me.roster.reserve.length) : 0;
  if (!me || !openSlots || !o.weeks.length) return { openSlots, rows: [] };
  const { model, league } = o;
  const ids = teamIds(me.roster);
  const rostered = rosteredIds([...o.teams.values()].map((t) => t.roster));
  const start = league.rules.playoffWeekStart;
  const base = o.weeks.map((_, i) => model.lineupWeek(ids, i).mean);
  const rows: StashRow[] = [];
  for (const p of players.values()) {
    if (rostered.has(p.id) || !irEligible(league, p.injury) || !startable(league, model.fpos(p.id))) continue;
    const ev = model.ev(p.id);
    const first = ev.findIndex((x) => x > 0);
    if (first < 0) continue;
    let gain = 0;
    let playoffGain = 0;
    let points = 0;
    let weeks = 0;
    for (let i = first; i < o.weeks.length; i++) {
      if (!(ev[i]! > 0)) continue;
      const add = (me.weights[i] ?? 1) * Math.max(0, model.lineupWeek([...ids, p.id], i).mean - base[i]!);
      gain += add;
      if (start && o.weeks[i]! >= start) playoffGain += add;
      points += ev[i]! / Math.max(model.play(p.id, i), 1e-9);
      weeks++;
    }
    if (gain > 0) rows.push({ id: p.id, back: o.weeks[first]!, perWeek: points / weeks, gain, playoffGain });
  }
  rows.sort((a, b) => b.gain - a.gain);
  return { openSlots, rows: rows.slice(0, limit) };
}
