// Score one week of the prediction ledger: the last committed prediction before each kickoff against
// nflverse game-day actives and PPR points (games already played only). Prints aggregates.
//
// Usage: tsx scripts/ledger/score.ts <dir of predictions files> <roster_weekly_YYYY.csv> <stats_player_week_YYYY.csv> <week> [--json <out file>]
// The predictions come from scripts/ledger/fetch.sh; the CSVs from the nflverse-data releases
// (tags weekly_rosters and stats_player).
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { csvRecords } from '../../pipeline/lib';
import type { PredictionFile } from '../../pipeline/ledger';
import { lastBeforeKickoff, nflverseOutcomes, scoreLedger } from '../../pipeline/ledger-score';

const args = process.argv.slice(2);
const jsonAt = args.indexOf('--json');
const jsonOut = jsonAt >= 0 ? args[jsonAt + 1] : undefined;
const [dir, rostersCsv, statsCsv, weekArg] = jsonAt >= 0 ? args.slice(0, jsonAt) : args;
if (!dir || !rostersCsv || !statsCsv || !weekArg) throw new Error('usage: score.ts <predictions dir> <roster csv> <stats csv> <week> [--json out]');
const week = Number(weekArg);

const files = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as PredictionFile)
  .filter((f) => f.week === week);
if (!files.length) throw new Error(`no week ${week} predictions in ${dir}`);
const season = files[0]!.season;
const predictions = lastBeforeKickoff(files);
const outcomes = nflverseOutcomes(csvRecords(readFileSync(rostersCsv, 'utf8')), csvRecords(readFileSync(statsCsv, 'utf8')), week);
const score = scoreLedger(season, week, predictions, outcomes);

const pct = (x: number) => `${Math.round(x * 100)}%`;
console.log(`## Prediction ledger, ${season} week ${week}\n`);
console.log(`${files.length} committed snapshots; ${predictions.size} player-games predicted; ${score.games} games played so far; ${score.scored} scored.\n`);
if (score.tagged.n) {
  console.log(`**Chance to play** (tagged players, n = ${score.tagged.n}): Brier ${score.tagged.brier}, log loss ${score.tagged.logLoss}\n`);
  console.log('| group | n | predicted | active |\n|---|---|---|---|');
  for (const r of score.tagged.calibration) console.log(`| ${r.group} | ${r.n} | ${pct(r.predicted)} | ${pct(r.observed)} |`);
} else console.log('**Chance to play:** no tagged players in played games yet.');
const p = score.points;
console.log(
  p.n
    ? `\n**Points if active** (QB/RB/WR/TE projected ≥ ${p.minProjected}, n = ${p.n}): MAE ${p.mae}, bias ${p.bias >= 0 ? '+' : ''}${p.bias}, within ±1 SD ${pct(p.within1)}, ±2 SD ${pct(p.within2)}`
    : '\n**Points if active:** no played games yet.',
);
const b = score.baseline;
console.log(
  b.n
    ? `\n**Shadow baseline** (QB/RB/WR/TE either projected ≥ ${p.minProjected}, n = ${b.n}): app MAE ${b.appMae}, baseline MAE ${b.baselineMae} (${b.ratio}× the app's)`
    : '\n**Shadow baseline:** no baseline predictions in played games yet.',
);
if (jsonOut) writeFileSync(jsonOut, `${JSON.stringify(score, null, 2)}\n`);
