import type { RawTransaction } from '../sleeper/raw';

/** What this league has paid for waiver adds this season. */
export interface FaabMarket {
  budget: number;
  /** Winning bids as a share of the budget, ascending, by position of the player added. */
  byPos: Map<string, number[]>;
  all: number[];
  claims: number;
}

/**
 * Quantile of the league's winning bids at a position that each tier pays: the best free agent at his
 * position goes near the top of the range, the 2nd–3rd near the middle, the rest near the bottom. [design]
 */
const TIER_QUANTILE = [0.85, 0.55, 0.25] as const;
export const TIER_LABELS = ['the best available', 'a top-3 option', 'a depth option'] as const;
/** Positions need this many winning claims before their own prices are used (else all claims). */
const MIN_POS_CLAIMS = 4;

/** Below this rest-of-season gain (weighted points), a player isn't worth a real bid. [design] */
export const MIN_BID_GAIN = 2;
/** At or above this gain, bid above the going rate to make sure. [design] */
const BIG_GAIN = 15;

function quantile(sorted: readonly number[], q: number): number {
  if (!sorted.length) return 0;
  const x = q * (sorted.length - 1);
  const lo = Math.floor(x);
  const hi = Math.min(sorted.length - 1, lo + 1);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (x - lo);
}

export function faabMarket(claims: readonly RawTransaction[], budget: number, positionOf: (playerId: string) => string | undefined): FaabMarket | null {
  const won = claims.filter((t) => t.type === 'waiver' && t.status === 'complete' && typeof t.settings?.waiver_bid === 'number');
  if (!budget || won.length < 5) return null;
  const byPos = new Map<string, number[]>();
  const all: number[] = [];
  for (const t of won) {
    const share = t.settings!.waiver_bid! / budget;
    const added = Object.keys(t.adds ?? {})[0];
    const pos = (added && positionOf(added)) || '?';
    (byPos.get(pos) ?? byPos.set(pos, []).get(pos)!).push(share);
    all.push(share);
  }
  for (const xs of byPos.values()) xs.sort((a, b) => a - b);
  all.sort((a, b) => a - b);
  return { budget, byPos, all, claims: won.length };
}

/** Market tier of a free agent from his rank among available players at his position (0 = best). */
export const tierOf = (rank: number): 0 | 1 | 2 => (rank === 0 ? 0 : rank <= 2 ? 1 : 2);

/** Going rate in dollars for a player of `pos` in `tier`. */
export function marketPrice(m: FaabMarket, pos: string, tier: 0 | 1 | 2): number {
  const own = m.byPos.get(pos);
  const xs = own && own.length >= MIN_POS_CLAIMS ? own : m.all;
  return Math.round(quantile(xs, TIER_QUANTILE[tier]) * m.budget);
}

export interface BidAdvice {
  bid: number;
  /** Going rate in this league for a player like him. */
  market: number;
  reason: string;
}

/**
 * Suggested bid: the league's going rate for the player's position and tier, scaled by how your remaining
 * budget compares with the league's, and only when he actually helps your roster.
 */
export function suggestBid(market: FaabMarket, pos: string, tier: 0 | 1 | 2, rosGain: number, remaining: number, avgRemaining: number, minBid = 0): BidAdvice {
  const going = marketPrice(market, pos, tier);
  if (rosGain < MIN_BID_GAIN) return { bid: Math.min(minBid, remaining), market: going, reason: 'adds little to your roster' };
  const scale = Math.min(1.4, Math.max(0.6, avgRemaining > 0 ? remaining / avgRemaining : 1));
  const need = rosGain >= BIG_GAIN ? 1.25 : 1;
  const bid = Math.max(minBid, Math.min(remaining, Math.round(going * scale * need)));
  return { bid, market: going, reason: `${pos}s as ${TIER_LABELS[tier]} have gone for ~$${going} here` };
}
