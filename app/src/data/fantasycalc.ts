// FantasyCalc trade-market values, fetched by the browser (CORS-open, verified 2026-10-15) and cached on
// the device; never republished from this site. Free API for non-commercial use with attribution and a
// link to fantasycalc.com [reported: their terms]. Values cover QB/RB/WR/TE (no K or DEF); dynasty adds picks.
import type { League } from '../domain/types';
import { startingSlots } from '../engine/lineup';
import { getJson } from '../sleeper/api';
import { cached } from './cache';

export const FANTASYCALC_URL = 'https://www.fantasycalc.com';

export interface MarketParams {
  dynasty: boolean;
  qbs: 1 | 2;
  teams: 8 | 10 | 12 | 14;
  ppr: 0 | 0.5 | 1;
}

export interface MarketValue {
  value: number;
  /** 30-day change in value. */
  trend?: number;
  posRank?: number;
  age?: number;
}

interface RawValue {
  value?: number;
  trend30Day?: number;
  positionRank?: number;
  player?: { sleeperId?: string | null; maybeAge?: number | null } | null;
}

/** 'season' = this season's market (redraft values); 'long' = beyond it (dynasty values). */
export type Horizon = 'season' | 'long';

/** Keeper and dynasty leagues care about value beyond this season too. */
export function horizons(league: League): Horizon[] {
  return league.rules.type === 'redraft' ? ['season'] : ['season', 'long'];
}

const nearest = <T extends number>(x: number, options: readonly T[]): T =>
  options.reduce((best, o) => (Math.abs(o - x) < Math.abs(best - x) ? o : best), options[0]!);

/**
 * The FantasyCalc market closest to a league for a horizon: redraft or dynasty values (by default
 * dynasty leagues use dynasty values and keeper leagues redraft), superflex/2QB, team count and
 * reception points.
 */
export function marketParams(league: League, horizon: Horizon = league.rules.type === 'dynasty' ? 'long' : 'season'): MarketParams {
  const slots = startingSlots(league.rosterPositions);
  const qbSlots = slots.filter((s) => s === 'QB' || s === 'SUPER_FLEX').length;
  return {
    dynasty: horizon === 'long',
    qbs: qbSlots >= 2 ? 2 : 1,
    teams: nearest(league.rules.numTeams, [8, 10, 12, 14] as const),
    ppr: nearest(league.scoring.rec ?? 0, [0, 0.5, 1] as const),
  };
}

export function parseMarketValues(rows: readonly RawValue[]): Map<string, MarketValue> {
  const out = new Map<string, MarketValue>();
  for (const r of rows) {
    const id = r.player?.sleeperId;
    if (!id || typeof r.value !== 'number') continue;
    const v: MarketValue = { value: r.value };
    if (typeof r.trend30Day === 'number') v.trend = r.trend30Day;
    if (typeof r.positionRank === 'number') v.posRank = r.positionRank;
    if (typeof r.player?.maybeAge === 'number') v.age = r.player.maybeAge;
    out.set(id, v);
  }
  return out;
}

/** Market values for a league's format, cached for an hour. Null when FantasyCalc can't be reached. */
export async function loadMarketValues(p: MarketParams, force = false): Promise<Map<string, MarketValue> | null> {
  const url = `https://api.fantasycalc.com/values/current?isDynasty=${p.dynasty}&numQbs=${p.qbs}&numTeams=${p.teams}&ppr=${p.ppr}`;
  try {
    const res = await cached(`fc:${p.dynasty}:${p.qbs}:${p.teams}:${p.ppr}`, 60 * 60_000, async () => (await getJson<RawValue[]>(url)) ?? [], { force });
    return parseMarketValues(res.value);
  } catch {
    return null;
  }
}

/** Market value of each side of a trade (simple sums: FantasyCalc's consolidation premium isn't applied). */
export function marketTotals(values: ReadonlyMap<string, MarketValue>, give: readonly string[], get: readonly string[]) {
  const sum = (ids: readonly string[]) => ids.reduce((a, id) => a + (values.get(id)?.value ?? 0), 0);
  const unvalued = [...give, ...get].filter((id) => !values.has(id));
  return { give: sum(give), get: sum(get), unvalued };
}
