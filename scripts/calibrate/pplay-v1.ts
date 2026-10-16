// P(play) v1: does anything beyond the final practice status tell whether a Questionable player will be active?
// (docs/calibration.md, "v1: the Questionable model"). Prints the coefficients that app/src/engine/availability.ts holds.
//
// Same join as pplay.ts: nflverse injury reports (the final report for games already played) × weekly rosters
// (game-day status), regular season, fantasy-relevant QB/RB/WR/TE/K listed Questionable. Candidate features beyond
// the v0 table (final practice): the injury (grouped), whether the player missed his previous game, position, and
// the weekday of the game (short weeks). Prints aggregates only.
//
// Usage: tsx scripts/calibrate/pplay-v1.ts <dir> <first season> <last season> [<games.csv>]
// <dir> holds injuries_YYYY.csv, roster_weekly_YYYY.csv and stats_player_week_YYYY.csv (nflverse-data releases).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PracticeStatus } from '../../app/src/domain/types';
import { injuryGroup, INJURY_TERMS, POSITION_TERMS, questionableTerms } from '../../app/src/engine/availability';
import { csvRecords, practiceStatus } from '../../pipeline/lib';

const RELEVANT_PPR: Record<string, number> = { QB: 12, RB: 8, WR: 8, TE: 8, K: 0 };

export interface QObs {
  season: number;
  week: number;
  gsis: string;
  pos: string;
  practice?: PracticeStatus;
  /** The report's primary injury, as written. */
  body: string;
  injury: string;
  /** Not active in his previous game (the last earlier week his team played and he was on its roster). */
  missedLast: boolean;
  weekday: string;
  active: boolean;
}

export function loadQuestionable(dir: string, season: number, weekdays: ReadonlyMap<string, string>): QObs[] {
  const read = (name: string) => csvRecords(readFileSync(join(dir, `${name}_${season}.csv`), 'utf8'));
  const games = new Map<string, Array<{ week: number; ppr: number }>>();
  const played = new Set<string>();
  for (const r of read('stats_player_week')) {
    if (r.season_type !== 'REG' || !r.player_id) continue;
    (games.get(r.player_id) ?? games.set(r.player_id, []).get(r.player_id)!).push({ week: Number(r.week), ppr: Number(r.fantasy_points_ppr) || 0 });
    played.add(`${r.week}:${r.team}`);
  }
  const relevant = (gsis: string, pos: string, week: number) => {
    const prior = (games.get(gsis) ?? []).filter((g) => g.week < week);
    return prior.length > 0 && prior.reduce((s, g) => s + g.ppr, 0) / prior.length >= (RELEVANT_PPR[pos] ?? Infinity);
  };
  const reports = new Map<string, Record<string, string>>();
  for (const r of read('injuries')) {
    if (r.game_type !== 'REG' || !r.gsis_id) continue;
    const key = `${r.week}:${r.gsis_id}`;
    const prev = reports.get(key);
    if (!prev || (r.date_modified ?? '') >= (prev.date_modified ?? '')) reports.set(key, r);
  }
  // Each player's game-day rows in games his team played, in week order.
  const rows = read('roster_weekly').filter((r) => r.game_type === 'REG' && r.gsis_id && played.has(`${r.week}:${r.team}`));
  const byPlayer = new Map<string, Array<Record<string, string>>>();
  for (const r of rows) (byPlayer.get(r.gsis_id!) ?? byPlayer.set(r.gsis_id!, []).get(r.gsis_id!)!).push(r);
  for (const list of byPlayer.values()) list.sort((a, b) => Number(a.week) - Number(b.week));

  const out: QObs[] = [];
  for (const [gsis, list] of byPlayer) {
    list.forEach((r, i) => {
      const week = Number(r.week);
      const report = reports.get(`${week}:${gsis}`);
      if ((report?.report_status ?? '').trim() !== 'Questionable') return;
      const pos = report!.position || r.position || '';
      if (!(pos in RELEVANT_PPR) || !relevant(gsis, pos, week)) return;
      const prev = i > 0 ? list[i - 1] : undefined;
      const practice = practiceStatus(report!.practice_status);
      out.push({
        season,
        week,
        gsis,
        pos,
        ...(practice ? { practice } : {}),
        body: report!.report_primary_injury ?? '',
        injury: injuryGroup(report!.report_primary_injury) || 'unknown',
        missedLast: prev !== undefined && prev.status !== 'ACT',
        weekday: weekdays.get(`${season}:${week}:${r.team}`) ?? '?',
        active: r.status === 'ACT',
      });
    });
  }
  return out;
}

/** Weekday of each team's game: `${season}:${week}:${team}` → Sunday, Thursday, Monday, … */
export function loadWeekdays(gamesCsv: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (!gamesCsv) return out;
  for (const g of csvRecords(readFileSync(gamesCsv, 'utf8'))) {
    if (g.game_type !== 'REG') continue;
    for (const team of [g.home_team, g.away_team]) out.set(`${g.season}:${g.week}:${team}`, g.weekday ?? '?');
  }
  return out;
}

// ---- Logistic model ------------------------------------------------------------------------------

/** The app's terms (availability.ts), optionally keeping only some: the ablations of the gate. */
const terms = (o: QObs, withPractice: boolean) => questionableTerms(withPractice ? o.practice : undefined, { body: o.body, missedLast: o.missedLast, pos: o.pos });
/** Column groups of the terms with practice: intercept + Full + DNP, missed last game, injury, position. */
const FINAL_GROUPS = { base: [0, 1, 2], missed: [3], injury: INJURY_TERMS.map((_, i) => 4 + i), position: POSITION_TERMS.map((_, i) => 4 + INJURY_TERMS.length + i) };
const EARLY_GROUPS = { base: [0], missed: [1], injury: INJURY_TERMS.map((_, i) => 2 + i), position: POSITION_TERMS.map((_, i) => 2 + INJURY_TERMS.length + i) };

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

/** Solve A x = b (Gaussian elimination, partial pivoting). */
function solve(a: number[][], b: number[]): number[] {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r]![c]!) > Math.abs(m[piv]![c]!)) piv = r;
    [m[c], m[piv]] = [m[piv]!, m[c]!];
    for (let r = c + 1; r < n; r++) {
      const f = m[r]![c]! / m[c]![c]!;
      for (let k = c; k <= n; k++) m[r]![k] = m[r]![k]! - f * m[c]![k]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = m[r]![n]!;
    for (let k = r + 1; k < n; k++) s -= m[r]![k]! * x[k]!;
    x[r] = s / m[r]![r]!;
  }
  return x;
}

/** Ridge-penalized logistic regression by Newton's method; the intercept isn't penalized. */
export function fitLogistic(xs: readonly number[][], ys: readonly number[], lambda: number): number[] {
  const k = xs[0]?.length ?? 0;
  const mean = ys.reduce((a, b) => a + b, 0) / (ys.length || 1);
  const beta = new Array<number>(k).fill(0);
  beta[0] = Math.log(Math.max(1e-6, mean) / Math.max(1e-6, 1 - mean));
  for (let it = 0; it < 100; it++) {
    const h = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => (i === j && i > 0 ? lambda : 0)));
    const g = beta.map((b, i) => (i > 0 ? -lambda * b : 0));
    xs.forEach((x, n) => {
      const p = sigmoid(x.reduce((s, v, i) => s + v * beta[i]!, 0));
      const w = p * (1 - p);
      for (let i = 0; i < k; i++) {
        if (!x[i]) continue;
        g[i] = g[i]! + (ys[n]! - p) * x[i]!;
        for (let j = 0; j < k; j++) if (x[j]) h[i]![j] = h[i]![j]! + w * x[i]! * x[j]!;
      }
    });
    const step = solve(h, g);
    for (let i = 0; i < k; i++) beta[i] = beta[i]! + step[i]!;
    if (Math.max(...step.map(Math.abs)) < 1e-9) break;
  }
  return beta;
}

export const predict = (beta: readonly number[], x: readonly number[]) => sigmoid(x.reduce((s, v, i) => s + v * beta[i]!, 0));

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const rate = (rows: readonly QObs[]) => (rows.length ? `${rows.filter((o) => o.active).length}/${rows.length} (${pct(rows.filter((o) => o.active).length / rows.length)})` : '–');

if (process.argv[1]?.endsWith('pplay-v1.ts')) {
  const [dir, first, last, gamesCsv] = process.argv.slice(2);
  if (!dir || !first || !last) throw new Error('usage: pplay-v1.ts <dir> <first season> <last season> [<games.csv>]');
  const weekdays = loadWeekdays(gamesCsv);
  const seasons = Array.from({ length: Number(last) - Number(first) + 1 }, (_, i) => Number(first) + i);
  const obs = seasons.flatMap((s) => loadQuestionable(dir, s, weekdays));
  console.log(`## Relevant Questionable players, ${first}–${last}: ${rate(obs)} active\n`);
  const PR: Array<PracticeStatus | undefined> = ['Full', 'Limited', 'DNP', undefined];
  const by = (label: string, key: (o: QObs) => string) => {
    const groups = [...new Set(obs.map(key))].sort((a, b) => obs.filter((o) => key(o) === b).length - obs.filter((o) => key(o) === a).length);
    console.log(`| ${label} | all | Full | Limited | DNP | none |`);
    console.log('|---|---|---|---|---|---|');
    for (const g of groups) {
      const rows = obs.filter((o) => key(o) === g);
      console.log(`| ${g} | ${rate(rows)} | ${PR.map((p) => rate(rows.filter((o) => o.practice === p))).join(' | ')} |`);
    }
    console.log();
  };
  by('injury', (o) => o.injury);
  by('missed last game', (o) => (o.missedLast ? 'yes' : 'no'));
  by('position', (o) => o.pos);
  by('weekday', (o) => o.weekday);
  by('season', (o) => String(o.season));

  // ---- Gate: out-of-sample Brier and log loss against v0, fitted on the same seasons. ----
  // With the final practice status (players who had one) against the practice-only table; and before the final
  // report (everyone) against the overall Questionable rate.
  type Groups = typeof FINAL_GROUPS;
  const ablations = (g: Groups): Array<[string, number[]]> => [
    ['v0', g.base],
    ['+ missed last game', [...g.base, ...g.missed]],
    ['+ missed last game, injury', [...g.base, ...g.missed, ...g.injury]],
    ['+ missed last game, injury, position (v1)', [...g.base, ...g.missed, ...g.injury, ...g.position]],
  ];
  const LAMBDAS = [0.5, 1, 2, 4, 8];
  const y = (o: QObs) => (o.active ? 1 : 0);
  const brier = (ps: readonly number[], rows: readonly QObs[]) => rows.reduce((s, o, i) => s + (ps[i]! - y(o)) ** 2, 0) / rows.length;
  const logLoss = (ps: readonly number[], rows: readonly QObs[]) =>
    -rows.reduce((s, o, i) => s + Math.log(Math.min(1 - 1e-6, Math.max(1e-6, o.active ? ps[i]! : 1 - ps[i]!))), 0) / rows.length;
  const pick = (x: readonly number[], cols: readonly number[]) => cols.map((c) => x[c]!);
  const fitPredict = (train: readonly QObs[], test: readonly QObs[], withPractice: boolean, cols: readonly number[], lambda: number) => {
    // v0 (no extra terms) is the plain cell rates: no penalty.
    const l = cols.length <= (withPractice ? 3 : 1) ? 1e-6 : lambda;
    const beta = fitLogistic(train.map((o) => pick(terms(o, withPractice), cols)), train.map(y), l);
    return test.map((o) => predict(beta, pick(terms(o, withPractice), cols)));
  };
  /** Ridge strength by leave-one-season-out within the training seasons (log loss). */
  const tuneLambda = (train: readonly QObs[], withPractice: boolean, cols: readonly number[]) => {
    const ss = [...new Set(train.map((o) => o.season))];
    let best = LAMBDAS[0]!;
    let bestLoss = Infinity;
    for (const l of LAMBDAS) {
      const loss = ss.reduce((acc, s) => {
        const te = train.filter((o) => o.season === s);
        return acc + logLoss(fitPredict(train.filter((o) => o.season !== s), te, withPractice, cols, l), te) * te.length;
      }, 0);
      if (loss < bestLoss) [best, bestLoss] = [l, loss];
    }
    return best;
  };
  // Player-clustered bootstrap of a difference in Brier score.
  let seed = 20261016;
  const rand = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const diffInterval = (a: readonly number[], b: readonly number[], rows: readonly QObs[]) => {
    const byPlayer = new Map<string, number[]>();
    rows.forEach((o, i) => (byPlayer.get(o.gsis) ?? byPlayer.set(o.gsis, []).get(o.gsis)!).push(i));
    const players = [...byPlayer.values()];
    const ds: number[] = [];
    for (let r = 0; r < 1000; r++) {
      let d = 0;
      let n = 0;
      for (let k = 0; k < players.length; k++)
        for (const i of players[Math.floor(rand() * players.length)]!) {
          d += (a[i]! - y(rows[i]!)) ** 2 - (b[i]! - y(rows[i]!)) ** 2;
          n++;
        }
      ds.push(d / n);
    }
    ds.sort((p, q) => p - q);
    return [ds[25]!, ds[974]!] as const;
  };
  const report = (title: string, folds: Array<{ train: QObs[]; test: QObs[] }>, withPractice: boolean) => {
    const test = folds.flatMap((f) => f.test);
    const sets = ablations(withPractice ? FINAL_GROUPS : EARLY_GROUPS);
    const preds = sets.map(([, cols]) => folds.flatMap((f) => fitPredict(f.train, f.test, withPractice, cols, tuneLambda(f.train, withPractice, cols))));
    console.log(`### ${title}: ${test.length} player-games, ${pct(test.filter((o) => o.active).length / test.length)} active\n`);
    console.log('| model | Brier | log loss | Brier vs v0 (95% interval) |');
    console.log('|---|---|---|---|');
    sets.forEach(([name], k) => {
      const [lo, hi] = k ? diffInterval(preds[k]!, preds[0]!, test) : [0, 0];
      const d = brier(preds[k]!, test) - brier(preds[0]!, test);
      console.log(`| ${k ? name : withPractice ? 'v0: final practice only' : 'v0: one Questionable rate'} | ${brier(preds[k]!, test).toFixed(4)} | ${logLoss(preds[k]!, test).toFixed(4)} | ${k ? `${d.toFixed(4)} (${lo.toFixed(4)} to ${hi.toFixed(4)})` : '–'} |`);
    });
    const full = preds.at(-1)!;
    console.log('\n| v1 predicted | n | mean predicted | active |');
    console.log('|---|---|---|---|');
    for (const [lo, hi] of [[0, 0.5], [0.5, 0.65], [0.65, 0.8], [0.8, 0.9], [0.9, 1.01]] as const) {
      const idx = test.map((_, i) => i).filter((i) => full[i]! >= lo && full[i]! < hi);
      if (!idx.length) continue;
      console.log(`| ${pct(lo)}–${pct(Math.min(1, hi))} | ${idx.length} | ${pct(idx.reduce((s, i) => s + full[i]!, 0) / idx.length)} | ${pct(idx.filter((i) => test[i]!.active).length / idx.length)} |`);
    }
    console.log();
  };
  const withPractice = obs.filter((o) => o.practice !== undefined);
  const forward = (rows: QObs[]) => [{ train: rows.filter((o) => o.season <= 2022), test: rows.filter((o) => o.season >= 2023) }];
  const loso = (rows: QObs[]) => seasons.map((s) => ({ train: rows.filter((o) => o.season !== s), test: rows.filter((o) => o.season === s) }));
  console.log('## With the final practice status\n');
  report('Fitted on 2019–22, scored on 2023–25', forward(withPractice), true);
  report('Each season held out in turn', loso(withPractice), true);
  console.log('## Before the final report (practice unknown)\n');
  report('Fitted on 2019–22, scored on 2023–25', forward(obs), false);
  report('Each season held out in turn', loso(obs), false);

  // Coefficients on all seasons, for availability.ts.
  const coefficients = (rows: QObs[], practice: boolean) => {
    const cols = (practice ? ablations(FINAL_GROUPS) : ablations(EARLY_GROUPS)).at(-1)![1];
    const lambda = tuneLambda(rows, practice, cols);
    const beta = fitLogistic(rows.map((o) => terms(o, practice)), rows.map(y), lambda);
    return { lambda, beta: beta.map((b) => Number(b.toFixed(3))) };
  };
  const fin = coefficients(withPractice, true);
  const early = coefficients(obs, false);
  console.log('### Coefficients, all seasons (paste into availability.ts)\n');
  console.log('Terms: intercept, [Full, DNP,] missed last game, ' + [...INJURY_TERMS, ...POSITION_TERMS].join(', '));
  console.log(`Q_FINAL (ridge ${fin.lambda}): [${fin.beta.join(', ')}]`);
  console.log(`Q_EARLY (ridge ${early.lambda}): [${early.beta.join(', ')}]`);
}
