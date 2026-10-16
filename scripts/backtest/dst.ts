// Walk-forward backtest of the in-house team defense v0 against RotoWire's DEF projections (docs/dst.md).
//
// Usage: tsx scripts/backtest/dst.ts <history dir> <data dir> [--tune] [--json <out file>]
//   history dir: the decrypted bundle from scripts/history/pull.sh (<season>/proj_wNN.json, stats_wNN.json)
//   data dir:    games.csv (nflverse/nfldata)
// The first season only warms up the rates; later seasons are scored. Prints markdown; inputs stay private.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ScoringSettings } from '../../app/src/domain/types';
import { projectedPoints, scoreStats } from '../../app/src/engine/scoring';
import type { SleeperRow } from '../../pipeline/baseline';
import { accuracy, type BacktestRow, blend, bootstrapByPlayer, fitBlendWeight, mae } from '../../pipeline/baseline-backtest';
import { type DefGame, defGames, DST_V0, type DstParams, dstWeek } from '../../pipeline/dst';
import { LEDGER_SCORING } from '../../pipeline/ledger';
import { csvRecords, gamesFromCsv } from '../../pipeline/lib';

const args = process.argv.slice(2);
const jsonAt = args.indexOf('--json');
const jsonOut = jsonAt >= 0 ? args[jsonAt + 1] : undefined;
const [historyDir, dataDir] = args.filter((a, i) => !a.startsWith('--') && (jsonAt < 0 || i !== jsonAt + 1));
if (!historyDir || !dataDir) throw new Error('usage: dst.ts <history dir> <data dir> [--tune] [--json out]');

/** Sleeper-style defense scoring: the ledger's DEF keys (points-allowed tiers included). */
const DEF_SCORING: ScoringSettings = Object.fromEntries(Object.entries(LEDGER_SCORING).filter(([k]) => /^(sack|int|fum_rec|ff|def_td|def_st_td|safe|blk_kick|pts_allow_)/.test(k)));

const seasons = readdirSync(historyDir).filter((d) => /^\d{4}$/.test(d)).map(Number).sort((a, b) => a - b);
const scoredSeasons = seasons.slice(1);
const games = csvRecords(readFileSync(join(dataDir, 'games.csv'), 'utf8'));
const context = new Map<string, { home: boolean; oppImplied?: number }>();
for (const season of seasons) {
  for (const g of gamesFromCsv(games, String(season))) {
    context.set(`${season}|${g.week}|${g.home}`, { home: true, ...(g.awayImplied !== undefined ? { oppImplied: g.awayImplied } : {}) });
    context.set(`${season}|${g.week}|${g.away}`, { home: false, ...(g.homeImplied !== undefined ? { oppImplied: g.homeImplied } : {}) });
  }
}
type Week = { season: number; week: number; proj: Map<string, SleeperRow>; stats: SleeperRow[] };
const read = (f: string): SleeperRow[] => (existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as SleeperRow[]) : []);
const weeks: Week[] = [];
for (const season of seasons) {
  for (let week = 1; week <= 18; week++) {
    const ww = String(week).padStart(2, '0');
    const def = (rows: SleeperRow[]) => rows.filter((r) => r.position === 'DEF');
    weeks.push({
      season,
      week,
      proj: new Map(def(read(join(historyDir, String(season), `proj_w${ww}.json`))).map((r) => [r.player_id, r])),
      stats: def(read(join(historyDir, String(season), `stats_w${ww}.json`))).filter((r) => r.stats?.pts_allow !== undefined),
    });
  }
}

/** The same code path the pipeline runs (pipeline/dst.ts dstWeek), week by week. */
function run(params: DstParams, only: readonly number[] = scoredSeasons): BacktestRow[] {
  const history: DefGame[] = [];
  const out: BacktestRow[] = [];
  for (const wk of weeks) {
    const games = defGames(wk.season, wk.week, wk.stats, context);
    if (only.includes(wk.season) && history.length) {
      const lines = dstWeek(wk.season, wk.week, history, new Map(games.map((g) => [g.team, g.opp])), context, params);
      for (const g of games) {
        const p = wk.proj.get(g.team);
        const line = lines[g.team];
        if (!p || !line) continue;
        out.push({
          season: wk.season,
          week: wk.week,
          id: g.team,
          pos: 'DEF',
          rotowire: projectedPoints(p.stats ?? {}, DEF_SCORING, 'DEF'),
          baseline: projectedPoints(line, DEF_SCORING, 'DEF'),
          actual: scoreStats(g.stats, DEF_SCORING),
        });
      }
    }
    history.push(...games);
  }
  return out;
}

const pct = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`;
console.log(`# DST v0 vs RotoWire, seasons ${scoredSeasons.join(', ')} (warm-up ${seasons[0]}), Sleeper-style DEF scoring\n`);

let tuning: Array<{ params: DstParams; mae: number }> = [];
if (args.includes('--tune')) {
  const first = scoredSeasons[0]!;
  for (const halfLife of [3, 6, 12]) {
    for (const shrinkGames of [2, 4, 8, 16, 32, 1000]) {
      for (const priorSeasonWeight of [0.5, 1]) {
        const params = { ...DST_V0, halfLife, shrinkGames, priorSeasonWeight };
        tuning.push({ params, mae: Math.round(mae(run(params, [first]), (r) => r.baseline!) * 1000) / 1000 });
      }
    }
  }
  tuning = tuning.sort((a, b) => a.mae - b.mae);
  console.log(`## Tuning on ${first} (DST v0 MAE)\n\n| half-life | shrink games | prior-season weight | MAE |\n|---|---|---|---|`);
  for (const t of tuning.slice(0, 6)) console.log(`| ${t.params.halfLife} | ${t.params.shrinkGames} | ${t.params.priorSeasonWeight} | ${t.mae} |`);
  const v0 = tuning.findIndex((t) => (['halfLife', 'shrinkGames', 'priorSeasonWeight'] as const).every((k) => t.params[k] === DST_V0[k]));
  console.log(`\nDST_V0 ranks ${v0 + 1} of ${tuning.length} (MAE ${tuning[v0]?.mae}).\n`);
}

const rows = run(DST_V0);
const ratioStat = (s: readonly BacktestRow[]) => mae(s, (r) => r.baseline!) / (mae(s, (r) => r.rotowire) || 1);
const table = (label: string, set: BacktestRow[]) => {
  const rw = accuracy(set, (r) => r.rotowire);
  const dst = accuracy(set, (r) => r.baseline!);
  const [lo, hi] = bootstrapByPlayer(set, ratioStat);
  console.log(`| ${label} | ${set.length} | ${rw.mae} | ${dst.mae} | ${(dst.mae / rw.mae).toFixed(3)} (${lo.toFixed(3)}–${hi.toFixed(3)}) | ${rw.bias} | ${dst.bias} | ${rw.corr} | ${dst.corr} |`);
  return { label, n: set.length, rotowire: rw, dst, ratioCi: [lo, hi] };
};
console.log('| seasons | team-games | RotoWire MAE | DST v0 MAE | ratio (95% interval, bootstrap over teams) | RotoWire bias | DST bias | RotoWire r | DST r |\n|---|---|---|---|---|---|---|---|---|');
const bySeason = scoredSeasons.map((s) => table(String(s), rows.filter((r) => r.season === s)));
const oos = table(`${scoredSeasons.slice(1).join('–')} (out of sample)`, rows.filter((r) => r.season !== scoredSeasons[0]));
console.log();

console.log('## Blend: weight fit on earlier seasons, tested on the next\n\n| tested on (fit on) | DST weight | n | RotoWire MAE | blend MAE | change (95% interval) |\n|---|---|---|---|---|---|');
const blends = scoredSeasons.slice(1).map((test) => {
  const fit = rows.filter((r) => r.season < test);
  const w = fitBlendWeight(fit);
  const set = rows.filter((r) => r.season === test);
  const rel = (s: readonly BacktestRow[]) => mae(s, (r) => blend(r, w)) / (mae(s, (r) => r.rotowire) || 1) - 1;
  const [lo, hi] = bootstrapByPlayer(set, rel);
  const change = rel(set);
  console.log(`| ${test} (${scoredSeasons.filter((s) => s < test).join('–')}) | ${w} | ${set.length} | ${accuracy(set, (r) => r.rotowire).mae} | ${accuracy(set, (r) => blend(r, w)).mae} | ${pct(change)} (${pct(lo)} to ${pct(hi)}) |`);
  return { test, weight: w, n: set.length, change, ci: [lo, hi] };
});
const pooled = rows.filter((r) => r.season !== scoredSeasons[0]);
console.log(`\nWeight fit on all scored seasons: ${fitBlendWeight(rows)}. Out-of-sample team-games: ${pooled.length}.`);
if (jsonOut) writeFileSync(jsonOut, `${JSON.stringify({ params: DST_V0, scoring: DEF_SCORING, tuning: tuning.slice(0, 10), bySeason, outOfSample: oos, blends }, null, 2)}\n`);
