import { expectNormal, normCdf } from './math';

export interface Dist {
  mean: number;
  variance: number;
}

/**
 * Weekly points spread given position and projected mean. [design] values, checked by the accuracy
 * ledger: on 2026 weeks 1–5, 66% of outcomes fell within ±1 SD and 95% within ±2 SD (ideal 68/95).
 * Kickers came out too narrow (z-score SD 1.14), so their spread is ~13% wider than first set.
 */
const CV: Record<string, number> = { QB: 0.42, RB: 0.6, WR: 0.66, TE: 0.7, K: 0.62, DEF: 0.8 };
const MIN_SD: Record<string, number> = { QB: 6, RB: 4, WR: 4, TE: 3.5, K: 3.4, DEF: 4 };

export function pointSd(pos: string, mu: number): number {
  const cv = CV[pos] ?? 0.5; // IDP and others
  const floor = MIN_SD[pos] ?? 3;
  return Math.max(floor, cv * Math.max(0, mu));
}

/** Points distribution of one player: inactive (0) with prob 1−p, else mean mu with spread sd. */
export function playerDist(mu: number, p: number, sd: number): Dist {
  const mean = p * mu;
  return { mean, variance: p * (sd * sd + mu * mu) - mean * mean };
}

export function sumDists(ds: readonly Dist[]): Dist {
  return ds.reduce((acc, d) => ({ mean: acc.mean + d.mean, variance: acc.variance + d.variance }), { mean: 0, variance: 0 });
}

/** P(a > b) for normals with covariance `cov` (players in the same NFL games move together). */
export function winProbability(a: Dist, b: Dist, cov = 0): number {
  const sd = Math.sqrt(Math.max(1e-9, a.variance + b.variance - 2 * cov));
  return normCdf((a.mean - b.mean) / sd);
}

/**
 * Probability of outscoring at least `need` of the other teams (e.g. a median game: beat at least
 * half the league). Conditions on my score, then counts wins with a Poisson-binomial DP.
 */
export function probBeatAtLeast(me: Dist, others: readonly Dist[], need: number): number {
  if (need <= 0) return 1;
  if (need > others.length) return 0;
  const sd = Math.sqrt(Math.max(1e-9, me.variance));
  return expectNormal(me.mean, sd, (score) => {
    let dist = [1];
    for (const o of others) {
      const q = normCdf((score - o.mean) / Math.sqrt(Math.max(1e-9, o.variance)));
      const next = new Array<number>(dist.length + 1).fill(0);
      for (let w = 0; w < dist.length; w++) {
        next[w] = next[w]! + dist[w]! * (1 - q);
        next[w + 1] = next[w + 1]! + dist[w]! * q;
      }
      dist = next;
    }
    let tail = 0;
    for (let w = need; w < dist.length; w++) tail += dist[w]!;
    return tail;
  });
}
