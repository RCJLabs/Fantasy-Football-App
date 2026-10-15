import type { Dist } from '../engine/winprob';
import { playoffByes } from './ros';

export interface SeasonTeam {
  rosterId: number;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  /** Score distribution for each simulated week (aligned with `SeasonInput.weeks`). */
  weeks: readonly Dist[];
}

export interface SeasonInput {
  teams: readonly SeasonTeam[];
  /** Remaining regular-season weeks, ascending. */
  weeks: readonly number[];
  /** Week → roster id → matchup id (null = no game). */
  pairings: ReadonlyMap<number, ReadonlyMap<number, number | null>>;
  medianGame: boolean;
  playoffTeams: number;
  sims?: number;
  seed?: number;
}

export interface TeamOdds {
  rosterId: number;
  pPlayoffs: number;
  pBye: number;
  pFirst: number;
  expWins: number;
  expLosses: number;
  avgSeed: number;
}

/** Small fast PRNG: seeded runs give the same odds every time (no flicker between refreshes). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const add = (a: Float64Array, i: number, by: number) => {
  a[i] = a[i]! + by;
};

function normalSampler(rand: () => number): () => number {
  let spare: number | null = null;
  return () => {
    if (spare !== null) {
      const s = spare;
      spare = null;
      return s;
    }
    let u = 0;
    while (u === 0) u = rand();
    const r = Math.sqrt(-2 * Math.log(u));
    const th = 2 * Math.PI * rand();
    spare = r * Math.sin(th);
    return r * Math.cos(th);
  };
}

/**
 * Monte Carlo of the rest of the regular season: each week every team scores Normal(mean, sd), wins
 * its head-to-head game and, in median leagues, a second game against the league median. Seeds are
 * ordered by wins (ties count half), then points for (Sleeper's default tiebreak).
 */
export function simulateSeason(input: SeasonInput): Map<number, TeamOdds> {
  const { teams, weeks, pairings, medianGame, playoffTeams } = input;
  const sims = input.sims ?? 4000;
  const rand = mulberry32(input.seed ?? 20261015);
  const gauss = normalSampler(rand);
  const n = teams.length;
  const byes = playoffByes(playoffTeams);
  const index = new Map(teams.map((t, i) => [t.rosterId, i]));

  const opponents = weeks.map((w) => {
    const opp = new Int32Array(n).fill(-1);
    const games = new Map<number, number[]>();
    for (const [rid, mid] of pairings.get(w) ?? []) {
      const i = index.get(rid);
      if (mid == null || i === undefined) continue;
      (games.get(mid) ?? games.set(mid, []).get(mid)!).push(i);
    }
    for (const g of games.values()) {
      if (g.length !== 2) continue;
      opp[g[0]!] = g[1]!;
      opp[g[1]!] = g[0]!;
    }
    return opp;
  });
  const sds = teams.map((t) => t.weeks.map((d) => Math.sqrt(Math.max(0, d.variance))));

  const playoffs = new Float64Array(n);
  const bye = new Float64Array(n);
  const first = new Float64Array(n);
  const winSum = new Float64Array(n);
  const lossSum = new Float64Array(n);
  const seedSum = new Float64Array(n);
  const wins = new Float64Array(n);
  const losses = new Float64Array(n);
  const pf = new Float64Array(n);
  const scores = new Float64Array(n);
  const sorted = new Float64Array(n);
  const order = teams.map((_, i) => i);

  for (let s = 0; s < sims; s++) {
    teams.forEach((t, i) => {
      wins[i] = t.wins + t.ties / 2;
      losses[i] = t.losses + t.ties / 2;
      pf[i] = t.pointsFor;
    });
    for (let k = 0; k < weeks.length; k++) {
      for (let i = 0; i < n; i++) {
        const d = teams[i]!.weeks[k];
        const score = d ? d.mean + sds[i]![k]! * gauss() : 0;
        scores[i] = score;
        add(pf, i, score);
      }
      const opp = opponents[k]!;
      for (let i = 0; i < n; i++) {
        const j = opp[i]!;
        if (j < 0) continue;
        add(scores[i]! > scores[j]! ? wins : losses, i, 1);
      }
      if (medianGame && n > 1) {
        sorted.set(scores);
        sorted.sort();
        const median = (sorted[Math.floor((n - 1) / 2)]! + sorted[Math.floor(n / 2)]!) / 2;
        for (let i = 0; i < n; i++) add(scores[i]! > median ? wins : losses, i, 1);
      }
    }
    order.sort((a, b) => wins[b]! - wins[a]! || pf[b]! - pf[a]!);
    order.forEach((i, rank) => {
      if (rank < playoffTeams) add(playoffs, i, 1);
      if (rank < byes) add(bye, i, 1);
      if (rank === 0) add(first, i, 1);
      add(seedSum, i, rank + 1);
      add(winSum, i, wins[i]!);
      add(lossSum, i, losses[i]!);
    });
  }

  return new Map(
    teams.map((t, i) => [
      t.rosterId,
      {
        rosterId: t.rosterId,
        pPlayoffs: playoffs[i]! / sims,
        pBye: bye[i]! / sims,
        pFirst: first[i]! / sims,
        expWins: winSum[i]! / sims,
        expLosses: lossSum[i]! / sims,
        avgSeed: seedSum[i]! / sims,
      },
    ]),
  );
}
