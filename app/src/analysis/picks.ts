// Draft picks in dynasty trades: who owns each future pick (Sleeper lists only picks that changed
// hands) and what it's worth on FantasyCalc's dynasty market. Next year's picks are priced from the
// original team's projected finish; later years at the round's flat price.
import type { League, Roster } from '../domain/types';
import type { RawTradedPick } from '../sleeper/raw';
import type { TeamOdds } from './season';

export type PickTier = 'Early' | 'Mid' | 'Late';
const TIERS: readonly PickTier[] = ['Early', 'Mid', 'Late'];

/** Seasons of tradeable picks. FantasyCalc prices three (2027–29, verified 2026-10-15); Sleeper's limit is [unverified]. */
const FUTURE_SEASONS = 3;
/** Rounds when the league doesn't say. [design] */
const DEFAULT_ROUNDS = 4;

export interface DraftPick {
  /** `season:round:original roster id` */
  key: string;
  season: string;
  round: number;
  /** The team whose finish sets the draft slot. */
  originalRosterId: number;
  ownerRosterId: number;
}

export interface PickAsset extends DraftPick {
  /** Long-term market value; 0 when FantasyCalc doesn't price the pick. */
  value: number;
  valued: boolean;
  /** Next year's draft: the likeliest third of the round, from the projected finish, and its probability. */
  tier?: PickTier;
  tierProb?: number;
}

export const ordinal = (n: number): string => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')}`;
export const pickLabel = (p: { season: string; round: number }): string => `${p.season} ${ordinal(p.round)}`;

const drafting = (league: League) => league.status === 'pre_draft' || league.status === 'drafting';

/** Seasons whose picks can be traded: next year's draft on, or this year's while the league hasn't drafted. */
export function pickSeasons(league: League): string[] {
  const first = Number(league.season) + (drafting(league) ? 0 : 1);
  return Array.from({ length: FUTURE_SEASONS }, (_, i) => String(first + i));
}

/** Every team's future picks: its own unless Sleeper lists the pick as traded. */
export function draftPicks(league: League, rosterIds: readonly number[], traded: readonly RawTradedPick[]): DraftPick[] {
  const owner = new Map(traded.map((t) => [`${t.season}:${t.round}:${t.roster_id}`, t.owner_id]));
  const out: DraftPick[] = [];
  for (const season of pickSeasons(league)) {
    // Traded picks can sit beyond draft_rounds (seen in a real keeper league), so they extend the rounds.
    const rounds = Math.max(league.rules.draftRounds || DEFAULT_ROUNDS, ...traded.filter((t) => t.season === season).map((t) => t.round));
    for (let round = 1; round <= rounds; round++) {
      for (const rid of rosterIds) {
        const key = `${season}:${round}:${rid}`;
        out.push({ key, season, round, originalRosterId: rid, ownerRosterId: owner.get(key) ?? rid });
      }
    }
  }
  return out;
}

/**
 * P(each draft slot) for each team's next-year picks, index 0 = 1st pick: the reverse of the
 * regular-season finish, worst record first [design: a common default; leagues can set their own
 * order]. Simulated while the regular season is open; the final standings after.
 */
export function draftSlotProbs(rosters: readonly Roster[], odds?: ReadonlyMap<number, TeamOdds>): Map<number, number[]> {
  const n = rosters.length;
  const out = new Map<number, number[]>();
  if (odds && rosters.every((r) => odds.get(r.rosterId)?.rankProbs.length === n)) {
    for (const r of rosters) out.set(r.rosterId, [...odds.get(r.rosterId)!.rankProbs].reverse());
    return out;
  }
  const standings = [...rosters].sort((a, b) => b.wins + b.ties / 2 - (a.wins + a.ties / 2) || b.pointsFor - a.pointsFor);
  standings.forEach((r, place) => out.set(r.rosterId, Array.from({ length: n }, (_, slot) => (slot === n - 1 - place ? 1 : 0))));
  return out;
}

/** Thirds of a round (n = 10: slots 1–4, 5–7, 8–10). FantasyCalc's own cut-offs are [unverified]. */
export const slotTier = (slot: number, n: number): PickTier => TIERS[Math.min(2, Math.floor(((slot - 1) * 3) / n))]!;

/**
 * A pick's long-term value: next year's blends FantasyCalc's Early/Mid/Late prices by the chance of
 * each third (`slots`); otherwise the round's flat price. Unpriced picks (e.g. 5th round) are worth 0.
 */
export function valuePick(pick: DraftPick, prices: ReadonlyMap<string, number>, slots?: readonly number[]): Omit<PickAsset, keyof DraftPick> {
  const base = `${pick.season}:${pick.round}`;
  const tiered = TIERS.map((t) => prices.get(`${base}:${t}`));
  if (slots?.length && tiered.every((v) => v !== undefined)) {
    const p: Record<PickTier, number> = { Early: 0, Mid: 0, Late: 0 };
    slots.forEach((q, i) => (p[slotTier(i + 1, slots.length)] += q));
    const likeliest = TIERS.reduce((a, t) => (p[t] > p[a] ? t : a));
    return { value: TIERS.reduce((sum, t, i) => sum + p[t] * tiered[i]!, 0), valued: true, tier: likeliest, tierProb: p[likeliest] };
  }
  const flat = prices.get(base);
  return flat === undefined ? { value: 0, valued: false } : { value: flat, valued: true };
}

/** Every future pick in a league with its owner and long-term value. */
export function pickAssets(
  league: League,
  rosters: readonly Roster[],
  traded: readonly RawTradedPick[],
  prices: ReadonlyMap<string, number>,
  odds?: ReadonlyMap<number, TeamOdds>,
): PickAsset[] {
  // Before a league's draft its order is already set, not a matter of standings.
  const next = drafting(league) ? undefined : pickSeasons(league)[0];
  const slots = draftSlotProbs(rosters, odds);
  return draftPicks(
    league,
    rosters.map((r) => r.rosterId),
    traded,
  ).map((p) => ({ ...p, ...valuePick(p, prices, p.season === next ? slots.get(p.originalRosterId) : undefined) }));
}

/** Value of the picks each team owns. */
export function pickTotals(picks: readonly PickAsset[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const p of picks) out.set(p.ownerRosterId, (out.get(p.ownerRosterId) ?? 0) + p.value);
  return out;
}
