// Walk-forward backtest of the in-house baseline v0 against RotoWire: the blend gate (docs/baseline.md).
//
// Usage: tsx scripts/backtest/baseline.ts <history dir> <data dir> [--tune] [--min <points>] [--json <out file>]
//   history dir: the decrypted bundle from scripts/history/pull.sh (<season>/proj_wNN.json, stats_wNN.json)
//   data dir:    ep_weekly_<season>.csv (ffverse/ffopportunity release `latest-data`),
//                roster_weekly_<season>.csv (nflverse-data release `weekly_rosters`), games.csv (nflverse/nfldata)
// The first history season only warms up the trailing means; later seasons are scored. --tune grid-searches
// the baseline's parameters on the first scored season only. Prints markdown; inputs stay private.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { StatLine } from '../../app/src/domain/types';
import { scoreStats } from '../../app/src/engine/scoring';
import { BASELINE_V0, type BaselineParams, ffoppStats } from '../../pipeline/baseline';
import {
  accuracy,
  type BacktestRow,
  blend,
  bootstrapByPlayer,
  comparable,
  earlyExitCheck,
  fitBlendWeight,
  gateTable,
  type GateRow,
  mae,
  played,
  SKILL,
  walkForward,
  type WeekData,
} from '../../pipeline/baseline-backtest';
import { csvRecords, gamesFromCsv, SLEEPER_PPR } from '../../pipeline/lib';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const valueOf = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const jsonOut = valueOf('--json');
// Relevance threshold: a player-week counts when either source projects at least this many points.
const minProjected = Number(valueOf('--min') ?? 5);
const valueAt = new Set(['--json', '--min'].filter((f) => args.includes(f)).map((f) => args.indexOf(f) + 1));
const [historyDir, dataDir] = args.filter((a, i) => !a.startsWith('--') && !valueAt.has(i));
if (!historyDir || !dataDir) throw new Error('usage: baseline.ts <history dir> <data dir> [--tune] [--min points] [--json out]');

const seasons = readdirSync(historyDir).filter((d) => /^\d{4}$/.test(d)).map(Number).sort((a, b) => a - b);
const scoredSeasons = seasons.slice(1);
const readJson = <T>(f: string, fallback: T): T => (existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as T) : fallback);
const weeks: WeekData[] = [];
for (const season of seasons) {
  for (let week = 1; week <= 18; week++) {
    const ww = String(week).padStart(2, '0');
    weeks.push({ season, week, proj: readJson(join(historyDir, String(season), `proj_w${ww}.json`), []), stats: readJson(join(historyDir, String(season), `stats_w${ww}.json`), []) });
  }
}

const gsisBySleeper = new Map<string, string>();
const expected = new Map<string, StatLine>();
const implied = new Map<string, number>();
const present = (s: string | undefined): s is string => !!s && s !== 'NA';
const games = csvRecords(readFileSync(join(dataDir, 'games.csv'), 'utf8'));
for (const season of seasons) {
  for (const r of csvRecords(readFileSync(join(dataDir, `roster_weekly_${season}.csv`), 'utf8'))) {
    if (present(r.sleeper_id) && present(r.gsis_id)) gsisBySleeper.set(r.sleeper_id, r.gsis_id);
  }
  for (const r of csvRecords(readFileSync(join(dataDir, `ep_weekly_${season}.csv`), 'utf8'))) {
    if (Number(r.week) <= 18) expected.set(`${r.player_id}|${Number(r.season)}|${Number(r.week)}`, ffoppStats(r));
  }
  for (const g of gamesFromCsv(games, String(season))) {
    if (g.homeImplied !== undefined) implied.set(`${season}|${g.week}|${g.home}`, g.homeImplied);
    if (g.awayImplied !== undefined) implied.set(`${season}|${g.week}|${g.away}`, g.awayImplied);
  }
}

// ---- Join coverage ---------------------------------------------------------------------------------
let playedRows = 0;
let mapped = 0;
let withTouches = 0;
let matched = 0;
for (const wk of weeks) {
  if (!scoredSeasons.includes(wk.season)) continue;
  for (const s of wk.stats) {
    if (!SKILL.includes(s.position ?? '') || !played(s.stats)) continue;
    playedRows++;
    const gsis = gsisBySleeper.get(s.player_id);
    if (!gsis) continue;
    mapped++;
    const st = s.stats ?? {};
    if ((st.rec_tgt ?? 0) + (st.rush_att ?? 0) + (st.pass_att ?? 0) > 0) {
      withTouches++;
      if (expected.has(`${gsis}|${wk.season}|${wk.week}`)) matched++;
    }
  }
}
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
console.log(`# Baseline v0 vs RotoWire, seasons ${scoredSeasons.join(', ')} (warm-up ${seasons[0]}; either source ≥ ${minProjected} points)\n`);
console.log(`Joins: ${mapped}/${playedRows} played skill player-weeks have a GSIS ID (${pct(mapped / playedRows)}); ${matched}/${withTouches} of those with a target, carry or pass have an ffopportunity row (${pct(matched / withTouches)}).\n`);

// ---- Data checks -------------------------------------------------------------------------------------
const exits = earlyExitCheck(weeks, SLEEPER_PPR);
console.log('## Data checks\n');
console.log(
  `Early exits (snap share < 35% of the previous three games, n = ${exits.earlyExit.n}): projection ${exits.earlyExit.ratio}× the previous three weeks' (median), ` +
    `${exits.earlyExit.projected} projected vs ${exits.earlyExit.actual} scored on average. Normal games (n = ${exits.normal.n}): ${exits.normal.ratio}×.`,
);
// Sleeper's own pts_ppr on QB projection rows vs the same stat line rescored, by season.
const quirk = new Map<number, { n: number; diff: number; xy: number; xx: number }>();
for (const wk of weeks) {
  for (const r of wk.proj) {
    const st = r.stats ?? {};
    if (r.position !== 'QB' || !((st.pts_ppr ?? 0) > 5)) continue;
    const diff = st.pts_ppr! - scoreStats(st, SLEEPER_PPR);
    const q = quirk.get(wk.season) ?? quirk.set(wk.season, { n: 0, diff: 0, xy: 0, xx: 0 }).get(wk.season)!;
    q.n++;
    q.diff += diff;
    q.xy += (st.pass_int ?? 0) * diff;
    q.xx += (st.pass_int ?? 0) ** 2;
  }
}
const quirkText = [...quirk].map(([s, q]) => `${s} ${(q.diff / q.n).toFixed(2)} (${q.xx ? (q.xy / q.xx).toFixed(2) : '–'} per INT)`).join(', ');
console.log(`Sleeper's projected pts_ppr minus the rescored stat line, QB rows projected over 5: ${quirkText}.\n`);

const run = (params: BaselineParams, only?: number[]): BacktestRow[] =>
  walkForward({ weeks, seasons: only ?? scoredSeasons, gsisBySleeper, expected, implied, scoring: SLEEPER_PPR, params });

// ---- Tuning (first scored season only) -----------------------------------------------------------------
type Tuned = { params: BaselineParams; mae: number };
let tuning: Tuned[] = [];
if (flag('--tune')) {
  const season = scoredSeasons[0]!;
  for (const halfLife of [2, 4, 8]) {
    for (const priorSeasonWeight of [0.25, 0.5, 1]) {
      for (const shrinkGames of [0, 1, 3]) {
        for (const elasticity of [0, 0.5, 1]) {
          const params = { ...BASELINE_V0, halfLife, priorSeasonWeight, shrinkGames, elasticity };
          // A fixed population for every candidate: RotoWire ≥ minProjected and a baseline exists.
          const rows = run(params, [season]).filter((r) => r.rotowire >= minProjected && r.baseline !== undefined);
          tuning.push({ params, mae: accuracy(rows, (r) => r.baseline!).mae });
        }
      }
    }
  }
  tuning = tuning.sort((a, b) => a.mae - b.mae);
  console.log(`## Tuning on ${season} (pooled baseline MAE, RotoWire ≥ ${minProjected} population)\n`);
  console.log('| half-life | prior-season weight | shrink games | elasticity | MAE |\n|---|---|---|---|---|');
  for (const t of tuning.slice(0, 8)) console.log(`| ${t.params.halfLife} | ${t.params.priorSeasonWeight} | ${t.params.shrinkGames} | ${t.params.elasticity} | ${t.mae} |`);
  const v0 = tuning.find((t) => (['halfLife', 'priorSeasonWeight', 'shrinkGames', 'elasticity'] as const).every((k) => t.params[k] === BASELINE_V0[k]));
  console.log(`\nBASELINE_V0 ranks ${v0 ? tuning.indexOf(v0) + 1 : '?'} of ${tuning.length} (MAE ${v0?.mae}).\n`);
}

// ---- The gate ----------------------------------------------------------------------------------------
const rows = run(BASELINE_V0);
const table = (title: string, t: GateRow[]) => {
  console.log(`## ${title}\n`);
  console.log('| pos | n | coverage | RotoWire MAE | baseline MAE | ratio | RotoWire bias | baseline bias | RotoWire r | baseline r |\n|---|---|---|---|---|---|---|---|---|---|');
  for (const g of t) {
    const ci = g.ratioCi ? ` (${g.ratioCi[0]}–${g.ratioCi[1]})` : '';
    console.log(`| ${g.pos} | ${g.n} | ${pct(g.coverage)} | ${g.rotowire.mae} | ${g.baseline.mae} | ${g.ratio}${ci} | ${g.rotowire.bias} | ${g.baseline.bias} | ${g.rotowire.corr} | ${g.baseline.corr} |`);
  }
  console.log();
};
const bySeason = Object.fromEntries(scoredSeasons.map((s) => [s, gateTable(rows.filter((r) => r.season === s), minProjected)]));
for (const s of scoredSeasons) table(`${s}${s === scoredSeasons[0] ? ' (first scored season)' : ''}`, bySeason[s]!);
const outOfSample = scoredSeasons.slice(1);
const oos = gateTable(rows.filter((r) => outOfSample.includes(r.season)), minProjected, true);
table(`Out of sample: ${outOfSample.join('–')} (95% interval of the ratio, bootstrap over players)`, oos);

// Blend weights per position, fit on every earlier scored season and tested on the next (expanding window).
const signed = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`;
const fitWeights = (fitOn: readonly BacktestRow[]) => new Map(SKILL.map((pos) => [pos, fitBlendWeight(comparable(fitOn.filter((r) => r.pos === pos), minProjected))]));
const blends = scoredSeasons.slice(1).map((test) => {
  const fitSeasons = scoredSeasons.filter((s) => s < test);
  const weights = fitWeights(rows.filter((r) => fitSeasons.includes(r.season)));
  const testOn = rows.filter((r) => r.season === test);
  console.log(`## Blend: weights fit on ${fitSeasons.join('–')}, tested on ${test}\n`);
  console.log(`| pos | baseline weight | n | RotoWire MAE | blend MAE | change (95% interval) |\n|---|---|---|---|---|---|`);
  const byPos = [...SKILL, 'ALL'].map((pos) => {
    const set = comparable(pos === 'ALL' ? testOn : testOn.filter((r) => r.pos === pos), minProjected);
    const relChange = (s: readonly BacktestRow[]) => mae(s, (r) => blend(r, weights.get(r.pos)!)) / (mae(s, (r) => r.rotowire) || 1) - 1;
    const change = relChange(set);
    const [lo, hi] = bootstrapByPlayer(set, relChange);
    const weight = pos === 'ALL' ? null : weights.get(pos)!;
    const rw = accuracy(set, (r) => r.rotowire);
    const bl = accuracy(set, (r) => blend(r, weights.get(r.pos)!));
    console.log(`| ${pos} | ${weight ?? 'per position'} | ${set.length} | ${rw.mae} | ${bl.mae} | ${signed(change)} (${signed(lo)} to ${signed(hi)}) |`);
    return { pos, weight, n: set.length, rotowire: rw, blend: bl, change: Math.round(change * 1000) / 1000, changeCi: [Math.round(lo * 1000) / 1000, Math.round(hi * 1000) / 1000] };
  });
  console.log();
  return { fit: fitSeasons, test, byPos };
});
const finalWeights = Object.fromEntries(fitWeights(rows));
console.log(`Weights fit on all scored seasons (${scoredSeasons.join(', ')}): ${SKILL.map((p) => `${p} ${finalWeights[p]}`).join(', ')}.`);

if (jsonOut) writeFileSync(jsonOut, `${JSON.stringify({ seasons: scoredSeasons, params: BASELINE_V0, joins: { playedRows, mapped, withTouches, matched }, tuning: tuning.slice(0, 20), bySeason, outOfSample: oos, blends, finalWeights }, null, 2)}\n`);
