// Walk-forward backtest of the in-house baseline against RotoWire (Sleeper's projections): the blend
// gate in docs/PLAN.md §2 and §6. Pure; scripts/backtest/baseline.ts does the I/O. Results and the
// decision live in docs/baseline.md.
import type { ScoringSettings } from '../app/src/domain/types';
import { scoreStats } from '../app/src/engine/scoring';
import { type BaselineGame, type BaselineParams, type BaselineSources, baselineWeek, played, recordWeek, SKILL, type SleeperRow } from './baseline';

export interface WeekData {
  season: number;
  week: number;
  proj: readonly SleeperRow[];
  stats: readonly SleeperRow[];
}

export interface BacktestInput extends BaselineSources {
  /** Every season-week in order, from the warm-up season on. */
  weeks: readonly WeekData[];
  /** Seasons whose weeks are scored. */
  seasons: readonly number[];
  scoring: ScoringSettings;
  params: BaselineParams;
}

/** One player-week that was played and projected by RotoWire. */
export interface BacktestRow {
  season: number;
  week: number;
  id: string;
  pos: string;
  rotowire: number;
  /** Absent without a previous game to average (rookies' first games, unmapped IDs). */
  baseline?: number;
  actual: number;
}

/** Score every played, RotoWire-projected skill player-week of `seasons`, using only earlier games. */
export function walkForward(input: BacktestInput): BacktestRow[] {
  const { scoring, params } = input;
  const scored = new Set(input.seasons);
  const history = new Map<string, BaselineGame[]>();
  const out: BacktestRow[] = [];
  for (const wk of input.weeks) {
    if (scored.has(wk.season)) {
      // Everyone RotoWire projects is in the position averages; his team is the one he played for.
      const actualById = new Map(wk.stats.map((r) => [r.player_id, r]));
      const population = wk.proj.map((p) => ({ id: p.player_id, pos: p.position ?? '', team: actualById.get(p.player_id)?.team ?? p.team ?? null }));
      const lines = baselineWeek(population, history, wk.season, (team) => input.implied.get(`${wk.season}|${wk.week}|${team}`), params);
      for (const p of wk.proj) {
        const pos = p.position ?? '';
        const s = actualById.get(p.player_id);
        if (!SKILL.includes(pos) || !s || !played(s.stats)) continue;
        const row: BacktestRow = { season: wk.season, week: wk.week, id: p.player_id, pos, rotowire: scoreStats(p.stats ?? {}, scoring), actual: scoreStats(s.stats ?? {}, scoring) };
        const line = lines.get(p.player_id);
        if (line) row.baseline = scoreStats(line, scoring);
        out.push(row);
      }
    }
    // Only now does this week join the history: no game informs its own projection.
    recordWeek(history, wk.season, wk.week, wk.stats, input);
  }
  return out;
}

export interface EarlyExitCheck {
  /** Player-weeks with a snap share under 35% of the player's previous three games (in-game injuries, mostly). */
  earlyExit: { n: number; ratio: number; projected: number; actual: number };
  /** Player-weeks within ±15% of that share. */
  normal: { n: number; ratio: number; projected: number; actual: number };
}

/**
 * Leakage check on stored projections: an in-game injury can't be known before kickoff, so an honest
 * projection for an early exit looks like the player's recent projections (median ratio near 1). A
 * projection revised after the game would collapse toward the actual points.
 */
export function earlyExitCheck(weeks: readonly WeekData[], scoring: ScoringSettings): EarlyExitCheck {
  type Game = { proj: number; share: number; actual: number };
  // Each player's played, projected games in a season, in week order.
  const byPlayer = new Map<string, Game[]>();
  for (const wk of weeks) {
    const projById = new Map(wk.proj.map((r) => [r.player_id, r]));
    for (const s of wk.stats) {
      const st = s.stats ?? {};
      const p = projById.get(s.player_id);
      if (!SKILL.includes(s.position ?? '') || !played(st) || !p || !st.tm_off_snp) continue;
      const key = `${wk.season}|${s.player_id}`;
      const games = byPlayer.get(key) ?? byPlayer.set(key, []).get(key)!;
      games.push({ proj: scoreStats(p.stats ?? {}, scoring), share: (st.off_snp ?? 0) / st.tm_off_snp, actual: scoreStats(st, scoring) });
    }
  }
  const groups = { earlyExit: [] as Game[], normal: [] as Game[] };
  const ratios = { earlyExit: [] as number[], normal: [] as number[] };
  for (const games of byPlayer.values()) {
    for (let i = 3; i < games.length; i++) {
      const g = games[i]!;
      const prev = games.slice(i - 3, i);
      const share = prev.reduce((t, x) => t + x.share, 0) / 3;
      const proj = prev.reduce((t, x) => t + x.proj, 0) / 3;
      if (share < 0.6 || proj < 5) continue;
      const kind = g.share < 0.35 * share ? 'earlyExit' : Math.abs(g.share / share - 1) < 0.15 ? 'normal' : undefined;
      if (!kind) continue;
      groups[kind].push(g);
      ratios[kind].push(g.proj / proj);
    }
  }
  const summary = (k: 'earlyExit' | 'normal') => {
    const xs = groups[k];
    const sorted = [...ratios[k]].sort((a, b) => a - b);
    const mean = (f: (g: Game) => number) => (xs.length ? round(xs.reduce((t, g) => t + f(g), 0) / xs.length) : 0);
    return { n: xs.length, ratio: round(sorted[Math.floor(sorted.length / 2)] ?? 0, 3), projected: mean((g) => g.proj), actual: mean((g) => g.actual) };
  };
  return { earlyExit: summary('earlyExit'), normal: summary('normal') };
}

export interface Accuracy {
  n: number;
  mae: number;
  bias: number;
  corr: number;
}

const round = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d;

function correlation(xs: readonly number[], ys: readonly number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i]! - mx) * (ys[i]! - my);
    sxx += (xs[i]! - mx) ** 2;
    syy += (ys[i]! - my) ** 2;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
}

/** MAE, bias (actual − predicted) and correlation of a predictor over rows. */
export function accuracy(rows: readonly BacktestRow[], predict: (r: BacktestRow) => number): Accuracy {
  if (!rows.length) return { n: 0, mae: 0, bias: 0, corr: 0 };
  let abs = 0;
  let err = 0;
  for (const r of rows) {
    const e = r.actual - predict(r);
    abs += Math.abs(e);
    err += e;
  }
  return { n: rows.length, mae: round(abs / rows.length), bias: round(err / rows.length), corr: round(correlation(rows.map(predict), rows.map((r) => r.actual)), 3) };
}

/** Rows both sources project, where either calls the player relevant (≥ minProjected points). */
export const comparable = (rows: readonly BacktestRow[], minProjected = 5): BacktestRow[] =>
  rows.filter((r) => r.baseline !== undefined && Math.max(r.rotowire, r.baseline) >= minProjected);

export interface GateRow {
  pos: string;
  n: number;
  /** Share of played player-weeks RotoWire projected ≥ minProjected that have a baseline. */
  coverage: number;
  rotowire: Accuracy;
  baseline: Accuracy;
  /** Baseline MAE ÷ RotoWire MAE: the plan's bar is ≤ ~1.05–1.10. */
  ratio: number;
  /** 95% interval of the ratio (bootstrap over players), when asked for. */
  ratioCi?: [number, number];
}

export function gateTable(rows: readonly BacktestRow[], minProjected = 5, intervals = false): GateRow[] {
  return [...SKILL, 'ALL'].map((pos) => {
    const mine = pos === 'ALL' ? rows : rows.filter((r) => r.pos === pos);
    const relevant = mine.filter((r) => r.rotowire >= minProjected);
    const both = comparable(mine, minProjected);
    const rotowire = accuracy(both, (r) => r.rotowire);
    const baseline = accuracy(both, (r) => r.baseline!);
    const row: GateRow = {
      pos,
      n: both.length,
      coverage: round(relevant.length ? relevant.filter((r) => r.baseline !== undefined).length / relevant.length : 0, 3),
      rotowire,
      baseline,
      ratio: rotowire.mae > 0 ? round(baseline.mae / rotowire.mae, 3) : 0,
    };
    if (intervals && both.length) {
      const [lo, hi] = bootstrapByPlayer(both, (s) => mae(s, (r) => r.baseline!) / (mae(s, (r) => r.rotowire) || 1));
      row.ratioCi = [round(lo, 3), round(hi, 3)];
    }
    return row;
  });
}

/** (1 − w) × RotoWire + w × baseline; RotoWire alone where the baseline is missing. */
export const blend = (r: BacktestRow, w: number): number => (r.baseline === undefined ? r.rotowire : (1 - w) * r.rotowire + w * r.baseline);

/** Deterministic PRNG (mulberry32) so intervals reproduce run to run. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 95% interval of `stat` from a bootstrap that resamples players (a player's weeks stay together, since
 * they aren't independent).
 */
export function bootstrapByPlayer(rows: readonly BacktestRow[], stat: (rows: readonly BacktestRow[]) => number, reps = 2000, seed = 1): [number, number] {
  const byPlayer = new Map<string, BacktestRow[]>();
  for (const r of rows) (byPlayer.get(r.id) ?? byPlayer.set(r.id, []).get(r.id)!).push(r);
  const groups = [...byPlayer.values()];
  if (!groups.length) return [0, 0];
  const rand = mulberry32(seed);
  const stats: number[] = [];
  for (let i = 0; i < reps; i++) {
    const sample: BacktestRow[] = [];
    for (let j = 0; j < groups.length; j++) sample.push(...groups[Math.floor(rand() * groups.length)]!);
    stats.push(stat(sample));
  }
  stats.sort((a, b) => a - b);
  return [stats[Math.floor(0.025 * (reps - 1))]!, stats[Math.ceil(0.975 * (reps - 1))]!];
}

/** Mean absolute error of a predictor over rows. */
export const mae = (rows: readonly BacktestRow[], predict: (r: BacktestRow) => number): number =>
  rows.length ? rows.reduce((t, r) => t + Math.abs(r.actual - predict(r)), 0) / rows.length : 0;

/** Baseline weight in [0, 1] (steps of 0.05) with the lowest MAE on `rows`. */
export function fitBlendWeight(rows: readonly BacktestRow[]): number {
  let best = 0;
  let bestMae = Infinity;
  for (let i = 0; i <= 20; i++) {
    const w = i / 20;
    const mae = rows.reduce((t, r) => t + Math.abs(r.actual - blend(r, w)), 0);
    if (mae < bestMae - 1e-9) {
      bestMae = mae;
      best = w;
    }
  }
  return best;
}
