// Calibrate next season's projections for the draft helper (docs/draft.md): Marcel-style rates by position, the age
// curve, contract status, games played, team changes, rookies by the order their position is taken, and kickers.
// Target seasons 2015–2025; the season before each is cut at several week counts to match how far a season has
// gone when the projection is made. Held out by leaving each target season out.
//
// Data in <dir>, from github.com/nflverse/nflverse-data releases: stats_player_week_YYYY.csv (tag stats_player,
// 2012–2025), players.csv (tag players: birth dates), historical_contracts.parquet (tag contracts; the CSV copy is
// stale) and draft_picks.csv (tag draft_picks). Prints markdown tables: aggregates only.
//
// Usage: tsx scripts/calibrate/next-season.ts <dir> [--json pipeline/next-season-fit.json]
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { asyncBufferFromFile, parquetReadObjects } from 'hyparquet';
import type { StatLine } from '../../app/src/domain/types';
import { csvRecords } from '../../pipeline/lib';
import {
  type AgeParams,
  ageBand,
  ageFactor,
  ageOn,
  availBand,
  type ContractRow,
  contractThrough,
  fantasyPos,
  type GamesParams,
  gamesShare,
  K_STATS,
  K_TOP,
  marcelLine,
  type NextSeasonFit,
  type PlayerSeasons,
  type PositionFit,
  pprPoints,
  type RookieLine,
  score,
  seasonGames,
  type SeasonSum,
  seasonSums,
  SKILL_POS,
  SKILL_STATS,
  SLEEPER_K,
  teamGames,
  TOP_RANK,
} from '../../pipeline/next-season';

const FIRST_DATA = 2012;
const TARGETS = Array.from({ length: 11 }, (_, i) => 2015 + i);
const WEEKS = [3, 6, 9, 12, 15, 18];
const EVAL_WEEKS = [6, 18];
/** Projected-rank bands for the calibration table. */
const TIER_BANDS: ReadonlyArray<readonly [number, number]> = [[0, 6], [6, 12], [12, 24], [24, 48]];
/** Rookie lines kept per position, by the order taken. [design] about one class's draftable rookies */
const ROOKIE_ORDERS: Record<string, number> = { QB: 3, RB: 4, WR: 6, TE: 2 };

const args = process.argv.slice(2);
const dir = args[0];
const jsonAt = args.indexOf('--json');
const jsonFile = jsonAt >= 0 ? args[jsonAt + 1] : undefined;
if (!dir) throw new Error('usage: next-season.ts <dir> [--json <file>]');

// ---- Load ----------------------------------------------------------------------------------------------------
interface SeasonData {
  full: Map<string, SeasonSum>;
  byW: Map<number, Map<string, SeasonSum>>;
  teamGames: Map<number, Map<string, number>>;
}
const seasons = new Map<number, SeasonData>();
for (let y = FIRST_DATA; y <= TARGETS.at(-1)!; y++) {
  const recs = csvRecords(readFileSync(join(dir, `stats_player_week_${y}.csv`), 'utf8'));
  const byW = new Map<number, Map<string, SeasonSum>>();
  const tg = new Map<number, Map<string, number>>();
  for (const w of WEEKS) {
    byW.set(w, seasonSums(recs, w));
    tg.set(w, teamGames(recs, w));
  }
  seasons.set(y, { full: byW.get(18)!, byW, teamGames: tg });
}
const birth = new Map<string, string>();
for (const r of csvRecords(readFileSync(join(dir, 'players.csv'), 'utf8'))) if (r.gsis_id && r.birth_date && r.birth_date !== 'NA') birth.set(r.gsis_id, r.birth_date);
const contracts = await parquetReadObjects({ file: await asyncBufferFromFile(join(dir, 'historical_contracts.parquet')), columns: ['gsis_id', 'year_signed', 'years', 'is_active'] });
const through = new Map<number, Map<string, number>>();
for (const T of TARGETS) through.set(T - 1, contractThrough(contracts as ContractRow[], T - 1));
const picks = csvRecords(readFileSync(join(dir, 'draft_picks.csv'), 'utf8'));

// ---- Rows ----------------------------------------------------------------------------------------------------
interface Row {
  id: string;
  T: number;
  pos: string;
  p: PlayerSeasons;
  age: number;
  first: boolean;
  avail: number;
  pending: boolean;
  /** Games next season, and its length. */
  gT: number;
  L: number;
  /** Next season's per-game rates (absent when he didn't play). */
  y?: StatLine;
  /** Played for another team at the start of next season than at the end of this one. */
  changed?: boolean;
}

function rowsFor(W: number): Row[] {
  const out: Row[] = [];
  for (const T of TARGETS) {
    const C = seasons.get(T - 1)!;
    const cur = C.byW.get(W)!;
    const P1 = seasons.get(T - 2)!.full;
    const P2 = seasons.get(T - 3)!.full;
    const tgt = seasons.get(T)!.full;
    const thru = through.get(T - 1)!;
    for (const id of new Set([...cur.keys(), ...P1.keys()])) {
      const c = cur.get(id);
      const p1 = P1.get(id);
      const pos = (c ?? p1)!.pos;
      if (!(SKILL_POS as readonly string[]).includes(pos) && pos !== 'K') continue;
      if ((c?.g ?? 0) + (p1?.g ?? 0) < 4) continue;
      const p: PlayerSeasons = {};
      if (c) p.cur = c;
      if (p1) p.prev1 = p1;
      const p2 = P2.get(id);
      if (p2) p.prev2 = p2;
      const t = tgt.get(id);
      const games = c ? (C.teamGames.get(W)!.get(c.team) ?? W) : 0;
      const endTeam = C.full.get(id)?.team ?? p1?.team;
      const row: Row = {
        id,
        T,
        pos,
        p,
        age: ageOn(birth.get(id), T) ?? NaN,
        first: !p1?.g && !p2?.g,
        avail: c && games ? Math.min(1, c.g / games) : 0,
        pending: (thru.get(id) ?? -Infinity) <= T - 1,
        gT: t?.g ?? 0,
        L: seasonGames(T),
      };
      if (t?.g) {
        const y: StatLine = {};
        for (const k in t.s) y[k] = t.s[k]! / t.g;
        row.y = y;
        if (endTeam) row.changed = t.team0 !== endTeam;
      }
      out.push(row);
    }
  }
  // Unknown birth dates: the position's median age.
  for (const pos of [...SKILL_POS, 'K']) {
    const ages = out.filter((r) => r.pos === pos && Number.isFinite(r.age)).map((r) => r.age).sort((a, b) => a - b);
    const med = ages[Math.floor(ages.length / 2)] ?? 27;
    for (const r of out) if (r.pos === pos && !Number.isFinite(r.age)) r.age = med;
  }
  return out;
}

// ---- Fitting -------------------------------------------------------------------------------------------------
const range = (a: number, b: number, step: number) => Array.from({ length: Math.round((b - a) / step) + 1 }, (_, i) => Math.round((a + i * step) * 1000) / 1000);
const A2 = range(0, 2, 0.1);
const A3 = range(0, 1, 0.1);
const KS = [0, 1, 2, 3, 4, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50];
const PEAKS = [24, 25, 26, 27, 28, 29];
const YOUNG = range(-0.2, 0, 0.02);
const OLD = range(-0.12, 0, 0.01);
const FIRST_BUMP = range(0, 0.4, 0.05);

type Points = (line: Readonly<StatLine>) => number;
const kickPts: Points = (l) => score(l, SLEEPER_K);

/** Grid search for the rate weights on one points scale; the mean is solved exactly for each grid point. */
function fitMarcel(rows: readonly Row[], pts: Points): { a2: number; a3: number; k: number } {
  const r = rows.filter((x) => x.y && x.gT >= 1);
  const S0 = r.map((x) => (x.p.cur ? pts(x.p.cur.s) : 0));
  const S1 = r.map((x) => (x.p.prev1 ? pts(x.p.prev1.s) : 0));
  const S2 = r.map((x) => (x.p.prev2 ? pts(x.p.prev2.s) : 0));
  const g0 = r.map((x) => x.p.cur?.g ?? 0);
  const g1 = r.map((x) => x.p.prev1?.g ?? 0);
  const g2 = r.map((x) => x.p.prev2?.g ?? 0);
  const y = r.map((x) => pts(x.y!));
  const w = r.map((x) => x.gT);
  let best = { e: Infinity, a2: 0, a3: 0, k: 0 };
  const c = new Float64Array(r.length);
  const b = new Float64Array(r.length);
  for (const a2 of A2) {
    for (const a3 of A3) {
      for (const k of KS) {
        let num = 0;
        let den = 0;
        for (let i = 0; i < r.length; i++) {
          const G = g0[i]! + a2 * g1[i]! + a3 * g2[i]! + k;
          c[i] = G > 0 ? (S0[i]! + a2 * S1[i]! + a3 * S2[i]!) / G : 0;
          b[i] = G > 0 ? k / G : 1;
          num += w[i]! * b[i]! * (y[i]! - c[i]!);
          den += w[i]! * b[i]! * b[i]!;
        }
        const mu = k > 0 && den > 0 ? num / den : 0;
        let e = 0;
        for (let i = 0; i < r.length; i++) e += w[i]! * (y[i]! - c[i]! - b[i]! * mu) ** 2;
        if (e < best.e) best = { e, a2, a3, k };
      }
    }
  }
  return { a2: best.a2, a3: best.a3, k: best.k };
}

/** Each stat's mean, exact least squares given the weights (so the points of the means are the points' mean). */
function statMeans(rows: readonly Row[], f: { a2: number; a3: number; k: number }, stats: readonly string[]): StatLine {
  const mu: StatLine = {};
  if (!f.k) {
    for (const s of stats) mu[s] = 0;
    return mu;
  }
  const r = rows.filter((x) => x.y && x.gT >= 1);
  for (const s of stats) {
    let num = 0;
    let den = 0;
    for (const x of r) {
      const G = (x.p.cur?.g ?? 0) + f.a2 * (x.p.prev1?.g ?? 0) + f.a3 * (x.p.prev2?.g ?? 0) + f.k;
      const S = (x.p.cur?.s[s] ?? 0) + f.a2 * (x.p.prev1?.s[s] ?? 0) + f.a3 * (x.p.prev2?.s[s] ?? 0);
      const cc = S / G;
      const bb = f.k / G;
      num += x.gT * bb * ((x.y![s] ?? 0) - cc);
      den += x.gT * bb * bb;
    }
    mu[s] = den > 0 ? num / den : 0;
  }
  return mu;
}

function fitAge(rows: readonly Row[], proj: ReadonlyMap<Row, number>): AgeParams {
  const r = rows.filter((x) => x.y && x.gT >= 1);
  const y = r.map((x) => pprPoints(x.y!));
  const w = r.map((x) => x.gT);
  const p = r.map((x) => proj.get(x)!);
  let best = { e: Infinity, peak: 27, young: 0, old: 0, first: 0 };
  for (const peak of PEAKS) {
    const lo = r.map((x) => Math.min(x.age - peak, 0));
    const hi = r.map((x) => Math.max(x.age - peak, 0));
    for (const young of YOUNG) {
      for (const old of OLD) {
        for (const first of FIRST_BUMP) {
          let e = 0;
          for (let i = 0; i < r.length; i++) {
            const f = Math.exp(young * lo[i]! + old * hi[i]! + (r[i]!.first ? first : 0));
            e += w[i]! * (y[i]! - p[i]! * f) ** 2;
          }
          if (e < best.e) best = { e, peak, young, old, first };
        }
      }
    }
  }
  return { peak: best.peak, young: best.young, old: best.old, first: best.first };
}

/** Least squares by the normal equations, with a tiny ridge so an empty band can't break the solve. */
function lstsq(X: readonly number[][], y: readonly number[]): number[] {
  const n = X[0]!.length;
  const A = Array.from({ length: n }, () => new Array<number>(n + 1).fill(0));
  X.forEach((row, i) => {
    for (let a = 0; a < n; a++) {
      for (let b = 0; b < n; b++) A[a]![b]! += row[a]! * row[b]!;
      A[a]![n]! += row[a]! * y[i]!;
    }
  });
  for (let a = 0; a < n; a++) A[a]![a]! += 1e-6;
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(A[r]![col]!) > Math.abs(A[piv]![col]!)) piv = r;
    [A[col], A[piv]] = [A[piv]!, A[col]!];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = A[r]![col]! / A[col]![col]!;
      for (let c = col; c <= n; c++) A[r]![c]! -= f * A[col]![c]!;
    }
  }
  return A.map((row, i) => row[n]! / row[i]!);
}

const gamesRow = (x: Row, top: boolean): number[] => {
  const a = ageBand(x.age);
  const v = availBand(x.avail);
  return [1, a === 1 ? 1 : 0, a === 2 ? 1 : 0, a === 3 ? 1 : 0, a === 4 ? 1 : 0, v === 1 ? 1 : 0, v === 2 ? 1 : 0, top ? 1 : 0, x.pending ? 1 : 0];
};

function fitGames(rows: readonly Row[], top: ReadonlyMap<Row, boolean>): GamesParams {
  const b = lstsq(rows.map((x) => gamesRow(x, top.get(x)!)), rows.map((x) => x.gT / x.L));
  return { base: b[0]!, age: [b[1]!, b[2]!, b[3]!, b[4]!], avail: [b[5]!, b[6]!], top: b[7]!, pending: b[8]! };
}

const share = (xs: readonly boolean[]) => (xs.length ? xs.filter(Boolean).length / xs.length : 0);
const quantile = (xs: readonly number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))]! : NaN;
};

interface Fitted {
  fit: PositionFit;
  /** Per-game PPR at each stage, and the final per-game line, by row. */
  marcel: Map<Row, number>;
  aged: Map<Row, number>;
  rate: Map<Row, number>;
  top: Map<Row, boolean>;
  games: Map<Row, number>;
}

/** Everything for one skill position, fit on `train` and applied to `apply`. */
function fitPosition(train: readonly Row[], apply: readonly Row[]): Fitted {
  const w = fitMarcel(train, pprPoints);
  const mu = statMeans(train, w, SKILL_STATS);
  const base = { ...w, mu };
  const all = [...new Set([...train, ...apply])];
  const marcel = new Map(all.map((x) => [x, pprPoints(marcelLine(x.p, base, SKILL_STATS))] as const));
  const age = fitAge(train, marcel);
  const aged = new Map(all.map((x) => [x, marcel.get(x)! * ageFactor(x.age, x.first, age)] as const));
  const ratio = (pending: boolean) => {
    const r = train.filter((x) => x.y && x.gT >= 1 && x.pending === pending);
    const a = r.reduce((s, x) => s + x.gT * pprPoints(x.y!), 0);
    const p = r.reduce((s, x) => s + x.gT * aged.get(x)!, 0);
    return p > 0 ? a / p : 1;
  };
  const status = { pending: ratio(true), signed: ratio(false) };
  const rate = new Map(all.map((x) => [x, aged.get(x)! * (x.pending ? status.pending : status.signed)] as const));
  // Draftable tier: rank by projected PPR a game within each season.
  const top = new Map<Row, boolean>();
  for (const T of new Set(all.map((x) => x.T))) {
    all
      .filter((x) => x.T === T)
      .sort((a, b) => rate.get(b)! - rate.get(a)!)
      .forEach((x, i) => top.set(x, i < TOP_RANK[x.pos as keyof typeof TOP_RANK]));
  }
  const games = fitGames(train, top);
  const gamesBy = new Map(all.map((x) => [x, gamesShare(games, x.age, x.avail, top.get(x)!, x.pending)] as const));
  const moved = (pending: boolean, tier: boolean) => share(train.filter((x) => x.changed !== undefined && x.pending === pending && top.get(x) === tier).map((x) => x.changed!));
  const change = { pending: [moved(true, true), moved(true, false)] as [number, number], signed: [moved(false, true), moved(false, false)] as [number, number] };
  const ratios = train.filter((x) => top.get(x) && rate.get(x)! > 0).map((x) => (x.y ? pprPoints(x.y) * x.gT : 0) / (rate.get(x)! * gamesBy.get(x)! * x.L));
  const fit: PositionFit = { ...base, age, games, status, change, range: [quantile(ratios, 0.1), quantile(ratios, 0.9)] };
  return { fit, marcel, aged, rate, top, games: gamesBy };
}

function fitKicker(train: readonly Row[]): Pick<PositionFit, 'a2' | 'a3' | 'k' | 'mu'> {
  const w = fitMarcel(train, kickPts);
  return { ...w, mu: statMeans(train, w, K_STATS) };
}

// ---- Report --------------------------------------------------------------------------------------------------
const table = (head: string[], rows: string[][]) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');
const f2 = (x: number) => x.toFixed(2);
const f3 = (x: number) => x.toFixed(3);
const pct = (x: number) => `${Math.round(x * 100)}%`;

function ranks(xs: readonly number[]): number[] {
  const idx = xs.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(xs.length);
  for (let i = 0; i < idx.length; ) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1]![0] === idx[i]![0]) j++;
    for (let k = i; k <= j; k++) out[idx[k]![1]] = (i + j) / 2;
    i = j + 1;
  }
  return out;
}
function spearman(a: readonly number[], b: readonly number[]): number {
  const ra = ranks(a);
  const rb = ranks(b);
  const n = a.length;
  const ma = ra.reduce((s, x) => s + x, 0) / n;
  const mb = rb.reduce((s, x) => s + x, 0) / n;
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let i = 0; i < n; i++) {
    sab += (ra[i]! - ma) * (rb[i]! - mb);
    saa += (ra[i]! - ma) ** 2;
    sbb += (rb[i]! - mb) ** 2;
  }
  return saa && sbb ? sab / Math.sqrt(saa * sbb) : 0;
}

/** This season's PPR a game, or last season's if he hasn't played: the "same as this year" baseline. */
const naiveRate = (x: Row) => (x.p.cur?.g ? pprPoints(x.p.cur.s) / x.p.cur.g : x.p.prev1?.g ? pprPoints(x.p.prev1.s) / x.p.prev1.g : 0);

/** Kickers held out: per-game points against "same as this year", and the spread between kickers. */
function evaluateKickers(rows: readonly Row[]): string {
  const kr = rows.filter((x) => x.pos === 'K');
  let se = [0, 0];
  let w = 0;
  const ys: number[] = [];
  for (const T of TARGETS) {
    const f = fitKicker(kr.filter((x) => x.T !== T));
    for (const x of kr.filter((x) => x.T === T && x.y && x.gT >= 4)) {
      const y = kickPts(x.y!);
      const same = x.p.cur?.g ? kickPts(x.p.cur.s) / x.p.cur.g : x.p.prev1?.g ? kickPts(x.p.prev1.s) / x.p.prev1.g : 0;
      se = [se[0]! + x.gT * (y - same) ** 2, se[1]! + x.gT * (y - kickPts(marcelLine(x.p, f, K_STATS))) ** 2];
      w += x.gT;
      ys.push(y);
    }
  }
  const mean = ys.reduce((a, b) => a + b, 0) / ys.length;
  const sd = Math.sqrt(ys.reduce((a, b) => a + (b - mean) ** 2, 0) / ys.length);
  return `Kickers (default scoring, a game): RMSE same as this year ${f2(Math.sqrt(se[0]! / w))}, model ${f2(Math.sqrt(se[1]! / w))}; SD between kickers ${f2(sd)}.`;
}

function evaluate(W: number, rows: readonly Row[]) {
  console.log(`\n## Held out, ${W === 18 ? 'after a complete season' : `${W} weeks into the season`} (each target season 2015–2025 left out in turn)\n`);
  const rateRows: string[][] = [];
  const seasonRows: string[][] = [];
  const tierRows: string[][] = [];
  const all = { n: 0, err: [0, 0, 0, 0] };
  for (const pos of SKILL_POS) {
    const pr = rows.filter((x) => x.pos === pos);
    const acc = { w: 0, se: [0, 0, 0, 0], ae: [0, 0, 0, 0] };
    const season = { n: 0, mae: [0, 0], rho: [0, 0], folds: 0 };
    const tiers = TIER_BANDS.map(() => ({ proj: 0, actual: 0 }));
    for (const T of TARGETS) {
      const train = pr.filter((x) => x.T !== T);
      const test = pr.filter((x) => x.T === T);
      const f = fitPosition(train, test);
      for (const x of test.filter((x) => x.y && x.gT >= 4)) {
        const y = pprPoints(x.y!);
        const preds = [naiveRate(x), f.marcel.get(x)!, f.aged.get(x)!, f.rate.get(x)!];
        acc.w += x.gT;
        preds.forEach((p, i) => {
          acc.se[i]! += x.gT * (y - p) ** 2;
          acc.ae[i]! += x.gT * Math.abs(y - p);
        });
      }
      // Season points for the draftable: the top by the model, by last season's total, or by what happened.
      const actual = new Map(test.map((x) => [x, x.y ? pprPoints(x.y) * x.gT : 0] as const));
      const model = new Map(test.map((x) => [x, f.rate.get(x)! * f.games.get(x)! * x.L] as const));
      const meanShare = train.filter((x) => f.top.get(x)).reduce((s, x) => s + x.gT / x.L, 0) / Math.max(1, train.filter((x) => f.top.get(x)).length);
      const naive = new Map(test.map((x) => [x, naiveRate(x) * meanShare * x.L] as const));
      const n = TOP_RANK[pos];
      const topBy = (m: ReadonlyMap<Row, number>) => new Set([...m].sort((a, b) => b[1] - a[1]).slice(0, n).map(([x]) => x));
      const pool = [...new Set([...topBy(model), ...topBy(naive), ...topBy(actual)])];
      const a = pool.map((x) => actual.get(x)!);
      [naive, model].forEach((m, i) => {
        const p = pool.map((x) => m.get(x)!);
        season.mae[i]! += p.reduce((s, v, j) => s + Math.abs(v - a[j]!), 0);
        season.rho[i]! += spearman(p, a);
      });
      season.n += pool.length;
      season.folds++;
      // Calibration: the model's own top players, banded by projected rank.
      const ranked = [...model].sort((x, y) => y[1] - x[1]);
      TIER_BANDS.forEach(([lo, hi], j) => {
        for (const [x, p] of ranked.slice(lo, hi)) {
          tiers[j]!.proj += p;
          tiers[j]!.actual += actual.get(x)!;
        }
      });
    }
    tierRows.push([pos, ...tiers.map((t) => f2(t.actual / t.proj))]);
    const rmse = acc.se.map((s) => Math.sqrt(s / acc.w));
    rateRows.push([pos, ...rmse.map(f2), ...acc.ae.map((s) => f2(s / acc.w))]);
    seasonRows.push([pos, String(season.n), ...season.mae.map((s) => f2(s / season.n)), ...season.rho.map((s) => f3(s / season.folds))]);
    all.n += acc.w;
    acc.se.forEach((s, i) => (all.err[i]! += s));
  }
  console.log('Per-game PPR when he plays (players with 4+ games the next season, weighted by games):\n');
  console.log(table(['pos', 'RMSE same as this year', 'Marcel', '+ age', '+ contract', 'MAE same as this year', 'Marcel', '+ age', '+ contract'], rateRows));
  console.log(`\nAll positions, RMSE: ${all.err.map((s) => f3(Math.sqrt(s / all.n))).join(' → ')}.\n`);
  console.log('Season PPR points, games included (the draftable tier by either method or by the outcome):\n');
  console.log(table(['pos', 'player-seasons', 'MAE same rate × average games', 'MAE model', 'Spearman same rate', 'Spearman model'], seasonRows));
  console.log('\nActual ÷ projected season points, by projected rank at the position (1.00 = unbiased):\n');
  console.log(table(['pos', ...TIER_BANDS.map(([lo, hi]) => `${lo + 1}–${hi}`)], tierRows));
  console.log(`\n${evaluateKickers(rows)}`);
}

const fit: NextSeasonFit = { seasons: [TARGETS[0]!, TARGETS.at(-1)!], byWeeks: {}, rookies: {}, kickerShare: 0 };
for (const W of WEEKS) {
  const rows = rowsFor(W);
  if (EVAL_WEEKS.includes(W)) evaluate(W, rows);
  const fits: Record<string, PositionFit> = {};
  for (const pos of SKILL_POS) {
    const pr = rows.filter((x) => x.pos === pos);
    fits[pos] = fitPosition(pr, pr).fit;
  }
  const kr = rows.filter((x) => x.pos === 'K');
  const k = fitKicker(kr);
  // Games share of the kickers worth drafting: the top K_TOP each season by projected points a game.
  const topK = TARGETS.flatMap((T) =>
    kr
      .filter((x) => x.T === T)
      .sort((a, b) => kickPts(marcelLine(b.p, k, K_STATS)) - kickPts(marcelLine(a.p, k, K_STATS)))
      .slice(0, K_TOP),
  );
  const kShare = topK.reduce((s, x) => s + x.gT / x.L, 0) / topK.length;
  fits.K = { ...k, games: { base: kShare, age: [0, 0, 0, 0], avail: [0, 0], top: 0, pending: 0 }, status: { pending: 1, signed: 1 }, change: { pending: [0, 0], signed: [0, 0] }, range: [0, 0] };
  fit.byWeeks[String(W)] = fits;
  if (W === 18) fit.kickerShare = kShare;
  console.log(`\n### Fit on all target seasons, ${W} weeks\n`);
  console.log(
    table(
      ['pos', 'a2', 'a3', 'k', 'PPR mean', 'peak', 'young/yr', 'old/yr', 'after 1st season', 'pending ×', 'signed ×', 'range p10–p90'],
      SKILL_POS.map((pos) => {
        const f = fits[pos]!;
        return [pos, f2(f.a2), f2(f.a3), String(f.k), f2(pprPoints(f.mu)), String(f.age!.peak), f2(f.age!.young), f2(f.age!.old), f2(f.age!.first), f3(f.status.pending), f3(f.status.signed), `${f2(f.range[0])}–${f2(f.range[1])}`];
      }),
    ),
  );
  console.log(`\nKickers: a2 ${f2(k.a2)}, a3 ${f2(k.a3)}, k ${k.k}, mean ${f2(kickPts(k.mu))} points a game; games share of the top ${K_TOP} a season ${f3(kShare)}.\n`);
  console.log(
    table(
      ['pos', 'base', 'under 25', '28–30', '31–33', '34+', 'played ≤50% so far', '51–84%', 'draftable tier', 'no contract next year'],
      SKILL_POS.map((pos) => {
        const g = fits[pos]!.games;
        return [pos, f3(g.base), ...g.age.map(f3), ...g.avail.map(f3), f3(g.top), f3(g.pending)];
      }),
    ),
  );
  console.log('\nPlayed for a different team the next season (players who played it):\n');
  console.log(
    table(
      ['pos', 'no contract, draftable', 'no contract, rest', 'signed, draftable', 'signed, rest'],
      SKILL_POS.map((pos) => {
        const c = fits[pos]!.change;
        return [pos, pct(c.pending[0]), pct(c.pending[1]), pct(c.signed[0]), pct(c.signed[1])];
      }),
    ),
  );
}

// Rookies: the season they were drafted, by the order their position was taken.
const rookieRows: string[][] = [];
for (const pos of SKILL_POS) {
  const lines: RookieLine[] = [];
  for (let order = 1; order <= ROOKIE_ORDERS[pos]!; order++) {
    let g = 0;
    let shares = 0;
    let n = 0;
    const sums: StatLine = {};
    const totals: number[] = [];
    for (const season of TARGETS.concat([2012, 2013, 2014]).sort()) {
      const cls = picks
        .filter((r) => Number(r.season) === season && fantasyPos(r.position) === pos)
        .sort((a, b) => Number(a.pick) - Number(b.pick));
      const r = cls[order - 1];
      if (!r) continue;
      const s = seasons.get(season)?.full.get(r.gsis_id ?? '');
      n++;
      shares += (s?.g ?? 0) / seasonGames(season);
      totals.push(s ? (pprPoints(s.s) * 17) / seasonGames(season) : 0);
      if (s) {
        g += s.g;
        for (const k of SKILL_STATS) sums[k] = (sums[k] ?? 0) + (s.s[k] ?? 0);
      }
    }
    const line: StatLine = {};
    for (const k of SKILL_STATS) line[k] = g ? (sums[k] ?? 0) / g : 0;
    lines.push({ s: line, share: shares / n });
    rookieRows.push([pos, String(order), String(n), f2(pprPoints(line)), pct(shares / n), f2(totals.reduce((a, b) => a + b, 0) / totals.length), f2(quantile(totals, 0.9))]);
  }
  fit.rookies[pos] = lines;
}
console.log(`\n## Rookies by the order their position was taken, draft classes ${FIRST_DATA}–${TARGETS.at(-1)}\n`);
console.log(table(['pos', 'taken', 'classes', 'PPR a game', 'games share', 'season PPR (17 games)', '90th percentile'], rookieRows));

if (jsonFile) {
  const round = (x: number) => Math.round(x * 10_000) / 10_000;
  const line = (l: StatLine) => Object.fromEntries(Object.entries(l).filter(([, v]) => v !== 0).map(([k, v]) => [k, round(v)]));
  const out: NextSeasonFit = {
    seasons: fit.seasons,
    kickerShare: round(fit.kickerShare),
    rookies: Object.fromEntries(Object.entries(fit.rookies).map(([pos, ls]) => [pos, ls.map((l) => ({ s: line(l.s), share: round(l.share) }))])),
    byWeeks: Object.fromEntries(
      Object.entries(fit.byWeeks).map(([w, fits]) => [
        w,
        Object.fromEntries(
          Object.entries(fits).map(([pos, f]) => [
            pos,
            {
              ...f,
              mu: line(f.mu),
              ...(f.age ? { age: { ...f.age } } : {}),
              games: {
                base: round(f.games.base),
                age: f.games.age.map(round) as GamesParams['age'],
                avail: f.games.avail.map(round) as GamesParams['avail'],
                top: round(f.games.top),
                pending: round(f.games.pending),
              },
              status: { pending: round(f.status.pending), signed: round(f.status.signed) },
              change: { pending: f.change.pending.map(round) as [number, number], signed: f.change.signed.map(round) as [number, number] },
              range: f.range.map(round) as [number, number],
            },
          ]),
        ),
      ]),
    ),
  };
  writeFileSync(jsonFile, `${JSON.stringify(out, null, 1)}\n`);
  console.log(`\nWrote ${jsonFile}.`);
}
