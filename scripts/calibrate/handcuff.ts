// Measure the next man up (docs/handcuffs.md): in games a starting QB, RB, WR or TE sat, how many more points his
// backup scored than usual, as a share of the starter's points per game; against control games the starter played.
// Prints markdown tables (counts, bootstrap 95% intervals over team-seasons): aggregates only. With --test, fits on
// the other seasons and scores predictors of the backup's points on the test seasons.
//
// Usage: tsx scripts/calibrate/handcuff.ts <dir> <season>... [--test <season>...]
// <dir> holds roster_weekly_YYYY.csv and stats_player_week_YYYY.csv from the github.com/nflverse/nflverse-data
// releases (tags weekly_rosters, stats_player).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mulberry32 } from '../../pipeline/baseline-backtest';
import { absences, type Absence, inheritance, MIN_STARTER, playerGame, type PlayerGame, WINDOW } from '../../pipeline/handcuff';
import { csvRecords } from '../../pipeline/lib';

const REPS = 1000;
const POSITIONS = ['QB', 'RB', 'TE', 'WR'];

function loadSeason(dir: string, season: number): Absence[] {
  const read = (name: string) => csvRecords(readFileSync(join(dir, `${name}_${season}.csv`), 'utf8'));
  const games: PlayerGame[] = [];
  for (const r of read('stats_player_week')) {
    const g = playerGame(r);
    if (g) games.push(g);
  }
  const status = new Map<string, { team: string; status: string }>();
  for (const r of read('roster_weekly')) {
    if (r.game_type !== 'REG' || !r.gsis_id) continue;
    status.set(`${r.week}:${r.gsis_id}`, { team: r.team ?? '', status: r.status ?? '' });
  }
  // 2019's rosters mark inactives from week 4; its first full week is 5.
  return absences({ season, games, status, ...(season === 2019 ? { fromWeek: 5 } : {}) });
}

const f2 = (x: number) => x.toFixed(2);
const f1 = (x: number) => x.toFixed(1);
const clusterKey = (a: Absence) => `${a.season}:${a.team}`;

/** The backup's gain as a share of the starter's points in the games the starter sat, less the same in games he played. */
function shares(rows: readonly Absence[]) {
  const out = rows.filter((a) => a.out);
  const played = rows.filter((a) => !a.out);
  const raw = inheritance(out);
  const drift = played.length ? inheritance(played) : 0;
  const group = inheritance(out, (a) => a.groupPoints - a.baseGroup);
  const groupDrift = played.length ? inheritance(played, (a) => a.groupPoints - a.baseGroup) : 0;
  return { raw, drift, net: raw - drift, group, groupNet: group - groupDrift };
}

/** Bootstrap over team-seasons: 95% interval of `stat`. */
function interval(rows: readonly Absence[], stat: (rs: readonly Absence[]) => number): [number, number] {
  const clusters = new Map<string, Absence[]>();
  for (const a of rows) clusters.set(clusterKey(a), [...(clusters.get(clusterKey(a)) ?? []), a]);
  const keys = [...clusters.keys()];
  const rand = mulberry32(20261016);
  const stats: number[] = [];
  for (let r = 0; r < REPS; r++) {
    const sample: Absence[] = [];
    for (let i = 0; i < keys.length; i++) sample.push(...clusters.get(keys[Math.floor(rand() * keys.length)]!)!);
    stats.push(stat(sample));
  }
  stats.sort((a, b) => a - b);
  return [stats[Math.floor(REPS * 0.025)]!, stats[Math.floor(REPS * 0.975)]!];
}

function main() {
  const args = process.argv.slice(2);
  const dir = args[0]!;
  const t = args.indexOf('--test');
  const seasons = (t < 0 ? args.slice(1) : args.slice(1, t)).map(Number);
  const test = t < 0 ? [] : args.slice(t + 1).map(Number);
  const all = [...seasons, ...test].flatMap((s) => loadSeason(dir, s));
  const train = all.filter((a) => seasons.includes(a.season));

  console.log(`# Next man up: ${seasons.join(', ')}${test.length ? ` (test ${test.join(', ')})` : ''}`);
  console.log(`Starter: most usage at his position over the team's previous ${WINDOW} games, active in 2+, ${MIN_STARTER}+ half-PPR a game.\n`);
  console.log("| Pos | Sat | Played | Starter's base | Backup's base | Backup when he sat | Raw share | Control drift | Net share (95%) | Whole group, net |");
  console.log('|---|---|---|---|---|---|---|---|---|---|');
  for (const pos of POSITIONS) {
    const rows = train.filter((a) => a.pos === pos);
    const out = rows.filter((a) => a.out);
    if (!out.length) continue;
    const s = shares(rows);
    const [lo, hi] = interval(rows, (rs) => shares(rs).net);
    const m = (k: keyof Absence, rs: readonly Absence[]) => f1(rs.reduce((x, a) => x + (a[k] as number), 0) / rs.length);
    console.log(
      `| ${pos} | ${out.length} | ${rows.length - out.length} | ${m('baseStarter', out)} | ${m('baseBackup', out)} | ${m('backupPoints', out)} | ${f2(s.raw)} | ${f2(s.drift)} | ${f2(s.net)} (${f2(lo)} to ${f2(hi)}) | ${f2(s.groupNet)} |`,
    );
  }

  console.log('\n## Net share by season\n');
  console.log(`| Season | ${POSITIONS.join(' | ')} |`);
  console.log(`|---|${POSITIONS.map(() => '---').join('|')}|`);
  for (const season of [...seasons, ...test]) {
    const cells = POSITIONS.map((pos) => {
      const rows = all.filter((a) => a.season === season && a.pos === pos);
      const n = rows.filter((a) => a.out).length;
      return n ? `${f2(shares(rows).net)} (${n})` : '–';
    });
    console.log(`| ${season} | ${cells.join(' | ')} |`);
  }

  if (!test.length) return;
  console.log(`\n## Held out: fitted on ${seasons.join(', ')}, scored on ${test.join(', ')}\n`);
  console.log('Predicting the backup\'s points in games the starter sat. "His base" ignores the absence; "drift only" adds the control games\' regression; "fitted" adds the training share of the starter\'s points; "all of it" gives him the starter\'s points.\n');
  console.log('| Pos | Games | MAE his base | MAE drift only | MAE fitted | MAE all of it | RMSE drift only | RMSE fitted | ΔMSE fitted − drift only (95%) |');
  console.log('|---|---|---|---|---|---|---|---|---|');
  for (const pos of POSITIONS) {
    const fit = shares(train.filter((a) => a.pos === pos));
    const rows = all.filter((a) => test.includes(a.season) && a.pos === pos);
    const out = rows.filter((a) => a.out);
    if (!out.length) continue;
    const preds = {
      base: (a: Absence) => a.baseBackup,
      drift: (a: Absence) => a.baseBackup + fit.drift * a.baseStarter,
      fitted: (a: Absence) => a.baseBackup + fit.raw * a.baseStarter,
      all: (a: Absence) => a.baseStarter,
    };
    const mae = (p: (a: Absence) => number, rs: readonly Absence[]) => rs.reduce((s, a) => s + Math.abs(a.backupPoints - p(a)), 0) / rs.length;
    const mse = (p: (a: Absence) => number, rs: readonly Absence[]) => rs.reduce((s, a) => s + (a.backupPoints - p(a)) ** 2, 0) / rs.length;
    const [lo, hi] = interval(out, (rs) => mse(preds.fitted, rs) - mse(preds.drift, rs));
    console.log(
      `| ${pos} | ${out.length} | ${f2(mae(preds.base, out))} | ${f2(mae(preds.drift, out))} | ${f2(mae(preds.fitted, out))} | ${f2(mae(preds.all, out))} | ${f2(Math.sqrt(mse(preds.drift, out)))} | ${f2(Math.sqrt(mse(preds.fitted, out)))} | ${f1(mse(preds.fitted, out) - mse(preds.drift, out))} (${f1(lo)} to ${f1(hi)}) |`,
    );
  }
}

main();
