// Buy low / sell high gate (docs/luck.md): does a player's recent luck (points above what his usage was worth, per
// ffopportunity) predict how he does against Sleeper's (RotoWire's) projection this week and over the next four?
// Fits the slope on the fit seasons and scores the adjusted projection on the test seasons, against the projection
// alone. Prints markdown with bootstrap intervals over players: aggregates only.
//
// Usage: tsx scripts/backtest/luck.ts <history dir> <data dir> --fit 2022,2023 --test 2024,2025
//   history dir: the decrypted bundle from scripts/history/pull.sh (<season>/proj_wNN.json, stats_wNN.json)
//   data dir:    ep_weekly_<season>.csv (ffverse/ffopportunity) and roster_weekly_<season>.csv (nflverse-data weekly_rosters)
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scoreStats } from '../../app/src/engine/scoring';
import { ffoppStats, played, SKILL, type SleeperRow } from '../../pipeline/baseline';
import { mulberry32 } from '../../pipeline/baseline-backtest';
import { csvRecords, SLEEPER_PPR } from '../../pipeline/lib';
import { correlation, type LuckRow, luckRows, type PlayerWeek, slope } from '../../pipeline/luck';

const args = process.argv.slice(2);
const list = (flag: string) => (args.includes(flag) ? args[args.indexOf(flag) + 1]!.split(',').map(Number) : []);
const fit = list('--fit');
const test = list('--test');
const [historyDir, dataDir] = args.filter((a) => !a.startsWith('--') && !/^[\d,]+$/.test(a));
if (!historyDir || !dataDir || !fit.length) throw new Error('usage: luck.ts <history dir> <data dir> --fit 2022,2023 [--test 2024,2025]');

const readJson = <T>(f: string, fallback: T): T => (existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as T) : fallback);
const weeks: PlayerWeek[] = [];
for (const season of [...fit, ...test]) {
  const gsis = new Map<string, string>();
  for (const r of csvRecords(readFileSync(join(dataDir, `roster_weekly_${season}.csv`), 'utf8'))) {
    if (r.sleeper_id && r.sleeper_id !== 'NA' && r.gsis_id && r.gsis_id !== 'NA') gsis.set(r.sleeper_id, r.gsis_id);
  }
  const expected = new Map<string, number>();
  for (const r of csvRecords(readFileSync(join(dataDir, `ep_weekly_${season}.csv`), 'utf8'))) {
    if (Number(r.week) <= 18) expected.set(`${r.player_id}|${Number(r.week)}`, scoreStats(ffoppStats(r), SLEEPER_PPR));
  }
  for (let week = 1; week <= 18; week++) {
    const ww = String(week).padStart(2, '0');
    const proj = readJson<SleeperRow[]>(join(historyDir, String(season), `proj_w${ww}.json`), []);
    const stats = readJson<SleeperRow[]>(join(historyDir, String(season), `stats_w${ww}.json`), []);
    const rows = new Map<string, PlayerWeek>();
    for (const s of stats) {
      if (!SKILL.includes(s.position ?? '')) continue;
      const g = gsis.get(s.player_id);
      const xfp = g ? expected.get(`${g}|${week}`) : undefined;
      rows.set(s.player_id, {
        season,
        week,
        player: s.player_id,
        pos: s.position!,
        played: played(s.stats),
        actual: scoreStats(s.stats ?? {}, SLEEPER_PPR),
        ...(xfp !== undefined && played(s.stats) ? { xfp } : {}),
      });
    }
    for (const p of proj) {
      if (!SKILL.includes(p.position ?? '')) continue;
      const row = rows.get(p.player_id) ?? { season, week, player: p.player_id, pos: p.position!, played: false, actual: 0 };
      row.proj = scoreStats(p.stats ?? {}, SLEEPER_PPR);
      rows.set(p.player_id, row);
    }
    weeks.push(...rows.values());
  }
}

const all = luckRows(weeks);
const inFit = all.filter((r) => fit.includes(r.season));
const inTest = all.filter((r) => test.includes(r.season));
const f2 = (x: number) => x.toFixed(2);
const f3 = (x: number) => x.toFixed(3);

/** Bootstrap over players: 95% interval of `stat`. */
function interval(rows: readonly LuckRow[], stat: (rs: readonly LuckRow[]) => number, reps = 1000): [number, number] {
  const by = new Map<string, LuckRow[]>();
  for (const r of rows) by.set(r.player, [...(by.get(r.player) ?? []), r]);
  const keys = [...by.keys()];
  const rand = mulberry32(20261016);
  const stats: number[] = [];
  for (let k = 0; k < reps; k++) {
    const sample: LuckRow[] = [];
    for (let i = 0; i < keys.length; i++) sample.push(...by.get(keys[Math.floor(rand() * keys.length)]!)!);
    stats.push(stat(sample));
  }
  stats.sort((a, b) => a - b);
  return [stats[Math.floor(reps * 0.025)]!, stats[Math.floor(reps * 0.975)]!];
}

const oneWeek = (r: LuckRow) => r.actual - r.proj;
const fourWeeks = (r: LuckRow) => r.ahead.actual - r.ahead.proj;
const slopeOf = (rows: readonly LuckRow[], err: (r: LuckRow) => number) => slope(rows.map((r) => r.luck), rows.map(err)).b;

console.log(`# Buy low / sell high: luck vs RotoWire, fit ${fit.join(', ')}${test.length ? `, test ${test.join(', ')}` : ''}\n`);
console.log('Luck: points per game over the player\'s last 4 games (3+ with usage data) above what his usage was worth (ffopportunity expected points), full PPR. Player-weeks projected 5+ points.\n');

console.log('## How big luck is\n');
console.log('| Pos | Player-weeks | Luck SD | Corr. with this week vs projection | Corr. with next 4 weeks vs projection |');
console.log('|---|---|---|---|---|');
for (const pos of [...SKILL, 'all']) {
  const rows = inFit.filter((r) => pos === 'all' || r.pos === pos);
  if (!rows.length) continue;
  const sd = Math.sqrt(rows.reduce((s, r) => s + r.luck ** 2, 0) / rows.length - (rows.reduce((s, r) => s + r.luck, 0) / rows.length) ** 2);
  console.log(`| ${pos} | ${rows.length} | ${f2(sd)} | ${f3(correlation(rows.map((r) => r.luck), rows.map(oneWeek)))} | ${f3(correlation(rows.map((r) => r.luck), rows.map(fourWeeks)))} |`);
}

console.log('\n## Slope: projection error per point of luck (fit seasons)\n');
console.log('Negative: players running hot score less than projected afterwards (the projection hasn\'t priced the luck out).\n');
console.log('| Pos | This week (95%) | Next 4 weeks (95%) |');
console.log('|---|---|---|');
for (const pos of [...SKILL, 'all']) {
  const rows = inFit.filter((r) => pos === 'all' || r.pos === pos);
  if (!rows.length) continue;
  const [a, b] = interval(rows, (rs) => slopeOf(rs, oneWeek));
  const [c, d] = interval(rows, (rs) => slopeOf(rs, fourWeeks));
  console.log(`| ${pos} | ${f3(slopeOf(rows, oneWeek))} (${f3(a)} to ${f3(b)}) | ${f3(slopeOf(rows, fourWeeks))} (${f3(c)} to ${f3(d)}) |`);
}

console.log('\n## What predicts the next 4 weeks (fit seasons)\n');
console.log('Correlation of the points a game a player scores over this week and the next three with: his recent points, what his recent usage was worth, and the projection.\n');
console.log('| Pos | Recent points | Usage-expected | Projection |');
console.log('|---|---|---|---|');
for (const pos of [...SKILL, 'all']) {
  const rows = inFit.filter((r) => pos === 'all' || r.pos === pos);
  if (!rows.length) continue;
  const y = rows.map((r) => r.ahead.actual);
  console.log(`| ${pos} | ${f3(correlation(rows.map((r) => r.recent), y))} | ${f3(correlation(rows.map((r) => r.usage), y))} | ${f3(correlation(rows.map((r) => r.ahead.proj), y))} |`);
}

if (test.length) {
  console.log(`\n## Held out: slope fitted on ${fit.join(', ')}, scored on ${test.join(', ')}\n`);
  console.log('| Pos | Player-weeks | MAE projection | MAE adjusted | ΔMAE (95%) | 4-week MAE projection | 4-week MAE adjusted | Δ (95%) |');
  console.log('|---|---|---|---|---|---|---|---|');
  for (const pos of [...SKILL, 'all']) {
    const rows = inTest.filter((r) => pos === 'all' || r.pos === pos);
    const fitRows = inFit.filter((r) => pos === 'all' || r.pos === pos);
    if (!rows.length || !fitRows.length) continue;
    const b1 = slopeOf(fitRows, oneWeek);
    const b4 = slopeOf(fitRows, fourWeeks);
    const mae = (rs: readonly LuckRow[], f: (r: LuckRow) => number) => rs.reduce((s, r) => s + Math.abs(f(r)), 0) / rs.length;
    const d1 = (rs: readonly LuckRow[]) => mae(rs, (r) => r.actual - (r.proj + b1 * r.luck)) - mae(rs, oneWeek);
    const d4 = (rs: readonly LuckRow[]) => mae(rs, (r) => r.ahead.actual - (r.ahead.proj + b4 * r.luck)) - mae(rs, fourWeeks);
    const [a, b] = interval(rows, d1);
    const [c, d] = interval(rows, d4);
    console.log(
      `| ${pos} | ${rows.length} | ${f3(mae(rows, oneWeek))} | ${f3(mae(rows, (r) => r.actual - (r.proj + b1 * r.luck)))} | ${f3(d1(rows))} (${f3(a)} to ${f3(b)}) | ${f3(mae(rows, fourWeeks))} | ${f3(mae(rows, (r) => r.ahead.actual - (r.ahead.proj + b4 * r.luck)))} | ${f3(d4(rows))} (${f3(c)} to ${f3(d)}) |`,
    );
  }
}
