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
  /** Score distribution in each playoff round (a two-week round adds its weeks), aligned with the bracket's rounds. */
  playoff?: readonly Dist[];
  /**
   * Weekly SD of the team's persistent drift: projection error that carries over from week to week (roles and form
   * change), so it accumulates like a random walk from now on instead of averaging out (docs/ros-uncertainty.md).
   */
  drift?: number;
  /**
   * SD of a fixed shift in the team's weekly mean for the rest of the season (drawn once per simulated season,
   * applied from the first week that isn't fresh): projection error that persists without growing. Only the
   * backtest uses it, to compare shapes; standings predicted better with `drift` (docs/ros-uncertainty.md).
   */
  offset?: number;
}

export interface SeasonInput {
  teams: readonly SeasonTeam[];
  /** Remaining regular-season weeks, ascending. */
  weeks: readonly number[];
  /** Week → roster id → matchup id (null = no game). */
  pairings: ReadonlyMap<number, ReadonlyMap<number, number | null>>;
  medianGame: boolean;
  playoffTeams: number;
  /** Rounds of the winners' bracket to play out after the regular season (0 or absent: stop at the standings). */
  playoffRounds?: number;
  /** Re-seed every round (the best remaining seed plays the worst) instead of Sleeper's fixed bracket. */
  reseed?: boolean;
  /** Weeks in each playoff round (1 or 2), for the drift; default 1. */
  playoffRoundWeeks?: readonly number[];
  /** Leading weeks of `weeks` projected this week (the current week while it's unscored): no drift yet. */
  freshWeeks?: number;
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
  /** P(finishing the regular season in each place): index 0 = 1st. */
  rankProbs: number[];
  /** P(winning the title), when the bracket is played out. */
  pTitle?: number;
  /** P(playing a game in each playoff round), when the bracket is played out. A bye isn't a game. */
  pRound?: number[];
}

/** Seeds in bracket order for `size` slots (a power of two): 1 plays `size`, and 1 and 2 can meet only in the final. */
export function bracketOrder(size: number): number[] {
  let order = [1];
  while (order.length < size) {
    const n = order.length * 2;
    order = order.flatMap((s) => [s, n + 1 - s]);
  }
  return order;
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
 *
 * With `playoffRounds`, each simulated season goes on through the winners' bracket: top seeds take the
 * byes, each round's game is decided by that round's score (two-week rounds add up), and a tie goes to
 * the better seed.
 *
 * A team's `drift` adds projection error that persists: a level that random-walks from this week on and
 * shifts every later week's mean, so a team that's really better (or worse) than projected stays so.
 */
export function simulateSeason(input: SeasonInput): Map<number, TeamOdds> {
  const { teams, weeks, pairings, medianGame, playoffTeams } = input;
  const sims = input.sims ?? 4000;
  const rand = mulberry32(input.seed ?? 20261015);
  const gauss = normalSampler(rand);
  const n = teams.length;
  const byes = playoffByes(playoffTeams);
  const index = new Map(teams.map((t, i) => [t.rosterId, i]));
  const rounds = playoffTeams >= 2 ? Math.max(0, input.playoffRounds ?? 0) : 0;
  const bracket = rounds ? bracketOrder(2 ** rounds) : [];
  const playoffSds = teams.map((t) => (t.playoff ?? []).map((d) => Math.sqrt(Math.max(0, d.variance))));
  const drift = teams.map((t) => Math.max(0, t.drift ?? 0));
  const offset = teams.map((t) => Math.max(0, t.offset ?? 0));
  const shift = new Float64Array(n);
  const fresh = input.freshWeeks ?? 0;
  /** Each team's accumulated drift in this simulated season, and the part of it carried into each playoff round. */
  const level = new Float64Array(n);
  const roundShift = new Float64Array(n * Math.max(1, rounds));
  const playoffScore = (i: number, r: number) => {
    const d = teams[i]!.playoff?.[r];
    return d ? d.mean + roundShift[i * rounds + r]! + playoffSds[i]![r]! * gauss() : 0;
  };

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
  const rankCount = new Float64Array(n * n);
  const wins = new Float64Array(n);
  const losses = new Float64Array(n);
  const pf = new Float64Array(n);
  const scores = new Float64Array(n);
  const sorted = new Float64Array(n);
  const order = teams.map((_, i) => i);
  const titles = new Float64Array(n);
  const roundGames = new Float64Array(n * Math.max(1, rounds));
  const seedOf = new Int32Array(n);

  for (let s = 0; s < sims; s++) {
    teams.forEach((t, i) => {
      wins[i] = t.wins + t.ties / 2;
      losses[i] = t.losses + t.ties / 2;
      pf[i] = t.pointsFor;
    });
    level.fill(0);
    for (let i = 0; i < n; i++) shift[i] = offset[i] ? offset[i]! * gauss() : 0;
    for (let k = 0; k < weeks.length; k++) {
      for (let i = 0; i < n; i++) {
        if (drift[i] && k >= fresh) add(level, i, drift[i]! * gauss());
        const d = teams[i]!.weeks[k];
        const score = d ? d.mean + level[i]! + (k >= fresh ? shift[i]! : 0) + sds[i]![k]! * gauss() : 0;
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
      add(rankCount, i * n + rank, 1);
      add(winSum, i, wins[i]!);
      add(lossSum, i, losses[i]!);
      seedOf[i] = rank + 1;
    });
    if (rounds) {
      // The drift goes on through the playoff weeks and the offset holds; a two-week round adds both weeks'.
      for (let i = 0; i < n; i++) {
        if (!drift[i] && !offset[i]) continue;
        for (let r = 0; r < rounds; r++) {
          let total = 0;
          for (let w = 0; w < (input.playoffRoundWeeks?.[r] ?? 1); w++) {
            if (drift[i]) add(level, i, drift[i]! * gauss());
            total += level[i]! + shift[i]!;
          }
          roundShift[i * rounds + r] = total;
        }
      }
      // Bracket slots hold team indices; -1 is a bye (a seed beyond the playoff field).
      let slots = bracket.map((seed) => (seed <= Math.min(playoffTeams, n) ? order[seed - 1]! : -1));
      for (let r = 0; r < rounds; r++) {
        if (input.reseed && r > 0) {
          const alive = slots.filter((i) => i >= 0).sort((a, b) => seedOf[a]! - seedOf[b]!);
          slots = [];
          for (let k = 0; k < alive.length / 2; k++) slots.push(alive[k]!, alive[alive.length - 1 - k]!);
        }
        const next: number[] = [];
        for (let k = 0; k < slots.length; k += 2) {
          const a = slots[k]!;
          const b = slots[k + 1] ?? -1;
          if (a < 0 || b < 0) {
            next.push(a < 0 ? b : a);
            continue;
          }
          add(roundGames, a * rounds + r, 1);
          add(roundGames, b * rounds + r, 1);
          const sa = playoffScore(a, r);
          const sb = playoffScore(b, r);
          next.push(sa > sb || (sa === sb && seedOf[a]! < seedOf[b]!) ? a : b);
        }
        slots = next;
      }
      if (slots[0] !== undefined && slots[0] >= 0) add(titles, slots[0], 1);
    }
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
        rankProbs: Array.from(rankCount.subarray(i * n, (i + 1) * n), (c) => c / sims),
        ...(rounds
          ? { pTitle: titles[i]! / sims, pRound: Array.from(roundGames.subarray(i * rounds, (i + 1) * rounds), (c) => c / sims) }
          : {}),
      },
    ]),
  );
}
