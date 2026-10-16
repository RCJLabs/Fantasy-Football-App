// Future-week availability, the "injury hazard" (docs/hazard.md): how often a fantasy-relevant player is active
// k weeks after a week in which he was healthy, Questionable, Doubtful or Out. Fitted on nflverse game-day
// rosters by scripts/calibrate/hazard.ts; the app's rest-of-season values use the result (app/src/analysis/ros.ts).

/** Final injury-report status in the anchor week; 'healthy' = no game status (on the report or not). */
export type AnchorState = 'healthy' | 'Questionable' | 'Doubtful' | 'Out';

/** One anchor player-week followed k weeks ahead. */
export interface HazardObs {
  season: number;
  /** Anchor week. */
  week: number;
  /** gsis id. */
  player: string;
  pos: string;
  /** Age on September 1 of the season, when the roster has a birth date. */
  age?: number;
  state: AnchorState;
  /** Weeks ahead (1 = the next week). */
  k: number;
  active: boolean;
  /** Game-day roster status in the target week ('none' = on no roster). */
  outcome: string;
}

/** nflverse weekly roster row, trimmed. */
export interface RosterRow {
  week: number;
  team: string;
  gsis: string;
  pos: string;
  /** ACT, INA, RES, CUT, DEV, … */
  status: string;
  /** `status_description_abbr`, e.g. R01 (Reserve/Injured), R59 (Reserve/COVID-19). */
  code: string;
  birthDate?: string;
}

export interface SeasonInput {
  season: number;
  rosters: readonly RosterRow[];
  /** Final report by `${week}:${gsis}`: game status ('' when listed without one) and position. */
  reports: ReadonlyMap<string, { status: string; pos: string }>;
  /** PPR points by gsis, one entry per game with a stat row. */
  ppr: ReadonlyMap<string, ReadonlyArray<{ week: number; ppr: number }>>;
  /** Team-weeks that were played, `${week}:${team}`. */
  played: ReadonlySet<string>;
  /** First week whose game-day statuses are usable (2019 had no inactives in weeks 1–4). */
  firstWeek?: number;
}

/** Positions followed and the average PPR (earlier games this season) that makes a player relevant. */
export const RELEVANT_PPR: Readonly<Record<string, number>> = { QB: 12, RB: 8, WR: 8, TE: 8, K: 0 };
/** Seasons whose rosters carry game-day inactives (INA) from the given week; earlier ones count inactives as ACT. */
export const FIRST_USABLE_WEEK: Readonly<Record<number, number>> = { 2019: 5 };
/** Reserve/COVID-19 and COVID opt-out (2020–21): absences unlike any a 2026 player faces, so they're left out. */
export const CENSORED_CODES = new Set(['R59', 'R62']);

const ageOn = (birthDate: string | undefined, season: number): number | undefined => {
  const t = birthDate ? Date.parse(birthDate.slice(0, 10)) : NaN;
  return Number.isFinite(t) ? (Date.UTC(season, 8, 1) - t) / (365.25 * 864e5) : undefined;
};

/**
 * Every relevant player on a game-day 53 (active or inactive) with a usable report state, followed through the
 * rest of the regular season. A target week counts when the player's team played; a player on no roster that
 * week counts as not active unless his anchor team had a bye. The final week (rested starters) is left out.
 */
export function hazardObservations(input: SeasonInput): HazardObs[] {
  const { season, played, reports, ppr } = input;
  const firstWeek = input.firstWeek ?? FIRST_USABLE_WEEK[season] ?? 1;
  let lastWeek = 0;
  for (const tw of played) lastWeek = Math.max(lastWeek, Number(tw.split(':')[0]));

  const byPlayer = new Map<string, Map<number, RosterRow>>();
  for (const r of input.rosters) {
    let weeks = byPlayer.get(r.gsis);
    if (!weeks) byPlayer.set(r.gsis, (weeks = new Map()));
    weeks.set(r.week, r);
  }

  const out: HazardObs[] = [];
  for (const [gsis, weeks] of byPlayer) {
    for (const [t, r] of weeks) {
      if (!played.has(`${t}:${r.team}`) || (r.status !== 'ACT' && r.status !== 'INA')) continue;
      const report = reports.get(`${t}:${gsis}`);
      const pos = report?.pos || r.pos;
      const bar = RELEVANT_PPR[pos];
      if (bar === undefined) continue;
      const prior = (ppr.get(gsis) ?? []).filter((g) => g.week < t);
      // The tolerance keeps an average of exactly the bar in, whatever the float rounding of the sum.
      if (!prior.length || prior.reduce((a, g) => a + g.ppr, 0) / prior.length < bar - 1e-9) continue;
      const game = report?.status ?? '';
      const state: AnchorState | undefined = game === '' ? 'healthy' : game === 'Questionable' || game === 'Doubtful' || game === 'Out' ? game : undefined;
      if (!state) continue;
      const age = ageOn(r.birthDate, season);
      for (let u = t + 1; u < lastWeek; u++) {
        if (u < firstWeek) continue;
        const later = weeks.get(u);
        let outcome: string;
        if (later) {
          if (!played.has(`${u}:${later.team}`) || CENSORED_CODES.has(later.code)) continue;
          outcome = later.status;
        } else {
          if (!played.has(`${u}:${r.team}`)) continue;
          outcome = 'none';
        }
        out.push({ season, week: t, player: gsis, pos, ...(age !== undefined ? { age } : {}), state, k: u - t, active: outcome === 'ACT', outcome });
      }
    }
  }
  return out;
}

/** Weighted pool-adjacent-violators fit of a non-increasing sequence. */
export function nonIncreasing(values: readonly number[], weights: readonly number[]): number[] {
  const blocks: Array<{ v: number; w: number; n: number }> = [];
  values.forEach((v, i) => {
    blocks.push({ v, w: weights[i] ?? 0, n: 1 });
    while (blocks.length > 1 && blocks.at(-2)!.v < blocks.at(-1)!.v) {
      const b = blocks.pop()!;
      const a = blocks.pop()!;
      const w = a.w + b.w;
      blocks.push({ v: w > 0 ? (a.v * a.w + b.v * b.w) / w : (a.v + b.v) / 2, w, n: a.n + b.n });
    }
  });
  return blocks.flatMap((b) => Array<number>(b.n).fill(b.v));
}

/** Active and total counts by weeks ahead (index k − 1). */
export function countsByK(obs: readonly HazardObs[], maxK: number): Array<[active: number, n: number]> {
  const c = Array.from({ length: maxK }, (): [number, number] => [0, 0]);
  for (const o of obs) {
    const cell = c[o.k - 1];
    if (!cell) continue;
    cell[0] += o.active ? 1 : 0;
    cell[1]++;
  }
  return c;
}

/**
 * P(active) by weeks ahead (index k − 1), forced non-increasing: availability can't recover with distance from a
 * healthy week. Horizons without data take the last value before them.
 */
export function curveFromCounts(counts: ReadonlyArray<readonly [number, number]>): number[] {
  const values: number[] = [];
  const weights: number[] = [];
  for (const [a, n] of counts) {
    values.push(n > 0 ? a / n : (values.at(-1) ?? 1));
    weights.push(n);
  }
  return nonIncreasing(values, weights);
}

export const availabilityCurve = (obs: readonly HazardObs[], maxK: number): number[] => curveFromCounts(countsByK(obs, maxK));

/** Mean log loss and Brier score of predictions `p(o)`, plus expected and observed actives. */
export function score(obs: readonly HazardObs[], p: (o: HazardObs) => number): { n: number; logLoss: number; brier: number; expected: number; active: number } {
  let ll = 0;
  let brier = 0;
  let expected = 0;
  let active = 0;
  for (const o of obs) {
    const q = Math.min(1 - 1e-6, Math.max(1e-6, p(o)));
    const y = o.active ? 1 : 0;
    ll -= y * Math.log(q) + (1 - y) * Math.log(1 - q);
    brier += (q - y) ** 2;
    expected += q;
    active += y;
  }
  const n = obs.length || 1;
  return { n: obs.length, logLoss: ll / n, brier: brier / n, expected, active };
}
