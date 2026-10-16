// Calibrate future-week availability (docs/hazard.md): P(active k weeks later) for fantasy-relevant players by
// their injury status now. Feeds the app's rest-of-season values (app/src/analysis/ros.ts).
//
// Data: nflverse game-day rosters (ACT = active; INA, reserve lists, cut, practice squad = not active), final
// injury reports and weekly stats (relevance), joined on gsis_id. Regular season; 2019 counts from week 5, the
// first week its rosters mark inactives. Prints markdown tables (counts, bootstrap 95% intervals over players):
// aggregates only. With --test, fits on the other seasons and scores the candidates on the test seasons.
//
// Usage: tsx scripts/calibrate/hazard.ts <dir> <season>... [--test <season>...] [--json <file>]
// <dir> holds injuries_YYYY.csv, roster_weekly_YYYY.csv and stats_player_week_YYYY.csv from the
// github.com/nflverse/nflverse-data releases (tags injuries, weekly_rosters, stats_player).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { mulberry32 } from '../../pipeline/baseline-backtest';
import {
  availabilityCurve,
  countsByK,
  curveFromCounts,
  type HazardObs,
  hazardObservations,
  type RosterRow,
  score,
} from '../../pipeline/hazard';
import { csvRecords } from '../../pipeline/lib';

/** The app's flat constants before this calibration (2026-10-16), kept as the baseline to beat. */
const PREVIOUS: Readonly<Record<string, number>> = { QB: 0.95, RB: 0.91, WR: 0.93, TE: 0.93, K: 0.98 };
const SKILL = new Set(['QB', 'RB', 'WR', 'TE']);
const MAX_K = 16;
const REPS = 1000;

function loadSeason(dir: string, season: number): HazardObs[] {
  const read = (name: string) => csvRecords(readFileSync(join(dir, `${name}_${season}.csv`), 'utf8'));
  const ppr = new Map<string, Array<{ week: number; ppr: number }>>();
  const played = new Set<string>();
  for (const r of read('stats_player_week')) {
    if (r.season_type !== 'REG' || !r.player_id) continue;
    const list = ppr.get(r.player_id) ?? [];
    list.push({ week: Number(r.week), ppr: Number(r.fantasy_points_ppr) || 0 });
    ppr.set(r.player_id, list);
    played.add(`${r.week}:${r.team}`);
  }
  const latest = new Map<string, Record<string, string>>();
  for (const r of read('injuries')) {
    if (r.game_type !== 'REG' || !r.gsis_id) continue;
    const key = `${r.week}:${r.gsis_id}`;
    const prev = latest.get(key);
    if (!prev || (r.date_modified ?? '') >= (prev.date_modified ?? '')) latest.set(key, r);
  }
  const reports = new Map<string, { status: string; pos: string }>();
  for (const [key, r] of latest) reports.set(key, { status: (r.report_status ?? '').trim().replace(/^NA$/, ''), pos: r.position ?? '' });
  const rosters: RosterRow[] = [];
  for (const r of read('roster_weekly')) {
    if (r.game_type !== 'REG' || !r.gsis_id) continue;
    rosters.push({ week: Number(r.week), team: r.team ?? '', gsis: r.gsis_id, pos: r.position ?? '', status: r.status ?? '', code: r.status_description_abbr ?? '', ...(r.birth_date ? { birthDate: r.birth_date } : {}) });
  }
  return hazardObservations({ season, rosters, reports, ppr, played });
}

const pct = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`;
const table = (head: string[], rows: string[][]) =>
  [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');
const frac = (rows: readonly HazardObs[]) => {
  const n = rows.length;
  const a = rows.filter((o) => o.active).length;
  return n ? `${pct(a / n)} (${n})` : '–';
};
const healthy = (obs: readonly HazardObs[], skill: boolean) => obs.filter((o) => o.state === 'healthy' && SKILL.has(o.pos) === skill);

/** Curve plus 95% intervals at each horizon, resampling players (a player's weeks stay together). */
function curveWithIntervals(obs: readonly HazardObs[]): { curve: number[]; lo: number[]; hi: number[] } {
  const byPlayer = new Map<string, Array<[number, number]>>();
  for (const o of obs) {
    let c = byPlayer.get(o.player);
    if (!c) byPlayer.set(o.player, (c = Array.from({ length: MAX_K }, (): [number, number] => [0, 0])));
    const cell = c[o.k - 1];
    if (!cell) continue;
    cell[0] += o.active ? 1 : 0;
    cell[1]++;
  }
  const groups = [...byPlayer.values()];
  const rand = mulberry32(1);
  const reps: number[][] = [];
  for (let i = 0; i < REPS; i++) {
    const sum = Array.from({ length: MAX_K }, (): [number, number] => [0, 0]);
    for (let j = 0; j < groups.length; j++) {
      const g = groups[Math.floor(rand() * groups.length)]!;
      g.forEach(([a, n], k) => {
        sum[k]![0] += a;
        sum[k]![1] += n;
      });
    }
    reps.push(curveFromCounts(sum));
  }
  const q = (k: number, p: number) => {
    const xs = reps.map((r) => r[k]!).sort((a, b) => a - b);
    return xs[Math.round(p * (REPS - 1))]!;
  };
  return {
    curve: curveFromCounts(countsByK(obs, MAX_K)),
    lo: Array.from({ length: MAX_K }, (_, k) => q(k, 0.025)),
    hi: Array.from({ length: MAX_K }, (_, k) => q(k, 0.975)),
  };
}

const at = (curve: readonly number[], k: number) => curve[Math.min(curve.length, Math.max(1, k)) - 1]!;
const logit = (p: number) => Math.log(p / (1 - p));
const expit = (x: number) => 1 / (1 + Math.exp(-x));
const ageBand = (age: number | undefined) => (age === undefined ? 'unknown' : age < 25 ? 'under 25' : age < 28 ? '25–27' : age < 31 ? '28–30' : '31+');

/** The chosen model: one curve for QB/RB/WR/TE, one for kickers; Questionable players get a flat rate capped by it. */
interface Fit {
  skill: number[];
  kicker: number[];
  questionable: number;
}
function fit(obs: readonly HazardObs[]): Fit {
  const q = obs.filter((o) => o.state === 'Questionable');
  return {
    skill: availabilityCurve(healthy(obs, true), MAX_K),
    kicker: availabilityCurve(healthy(obs, false), MAX_K),
    questionable: q.filter((o) => o.active).length / (q.length || 1),
  };
}
const healthyP = (f: Fit, o: HazardObs) => at(o.pos === 'K' ? f.kicker : f.skill, o.k);

const args = process.argv.slice(2);
let dir: string | undefined;
let jsonFile: string | undefined;
const seasons: number[] = [];
const testSeasons: number[] = [];
let target = seasons;
for (let i = 0; i < args.length; i++) {
  const a = args[i]!;
  if (a === '--json') jsonFile = args[++i];
  else if (a === '--test') target = testSeasons;
  else if (dir === undefined) dir = a;
  else target.push(Number(a));
}
if (!dir || !seasons.length) throw new Error('usage: hazard.ts <dir> <season>... [--test <season>...] [--json <file>]');

const all = [...seasons, ...testSeasons].sort((a, b) => a - b);
const obs = all.flatMap((s) => loadSeason(dir, s));
const anchors = new Set(obs.map((o) => `${o.season}:${o.week}:${o.player}`));
console.log(`## Future-week availability, regular seasons ${all[0]}–${all.at(-1)}\n`);
console.log(`${anchors.size} relevant anchor player-weeks, ${obs.length} follow-ups (anchor week + k, final week left out).\n`);

// 1. The fitted curves, on every season given.
const skill = curveWithIntervals(healthy(obs, true));
const kick = curveWithIntervals(healthy(obs, false));
const skillCounts = countsByK(healthy(obs, true), MAX_K);
const kickCounts = countsByK(healthy(obs, false), MAX_K);
console.log('### Healthy now (no game status): P(active) k weeks later\n');
console.log(
  table(
    ['weeks ahead', 'QB/RB/WR/TE active/n', 'observed', 'fitted', '95% CI', 'K active/n', 'observed', 'fitted', '95% CI'],
    skill.curve.map((v, i) => {
      const [a, n] = skillCounts[i]!;
      const [ka, kn] = kickCounts[i]!;
      return [
        String(i + 1),
        `${a}/${n}`,
        n ? pct(a / n) : '–',
        pct(v),
        `${pct(skill.lo[i]!)}–${pct(skill.hi[i]!)}`,
        `${ka}/${kn}`,
        kn ? pct(ka / kn) : '–',
        pct(kick.curve[i]!),
        `${pct(kick.lo[i]!)}–${pct(kick.hi[i]!)}`,
      ];
    }),
  ),
);

const KS = [1, 2, 4, 8, 12];
console.log('\n### Healthy now, by position (reference: the app pools QB/RB/WR/TE)\n');
console.log(table(['position', ...KS.map((k) => `${k} ahead`)], ['QB', 'RB', 'WR', 'TE', 'K'].map((pos) => [pos, ...KS.map((k) => frac(obs.filter((o) => o.state === 'healthy' && o.pos === pos && o.k === k)))])));

console.log('\n### Why not active, healthy QB/RB/WR/TE\n');
const kinds: Array<[string, (s: string) => boolean]> = [
  ['inactive on game day', (s) => s === 'INA'],
  ['reserve lists (IR, PUP, NFI…)', (s) => s === 'RES' || s === 'PUP'],
  ['cut, practice squad or no roster', (s) => s === 'CUT' || s === 'DEV' || s === 'none'],
  ['other', (s) => !['ACT', 'INA', 'RES', 'PUP', 'CUT', 'DEV', 'none'].includes(s)],
];
console.log(
  table(
    ['weeks ahead', 'n', 'active', ...kinds.map(([label]) => label)],
    [1, 2, 4, 8, 12].map((k) => {
      const rows = healthy(obs, true).filter((o) => o.k === k);
      const share = (f: (s: string) => boolean) => pct(rows.filter((o) => f(o.outcome)).length / (rows.length || 1));
      return [String(k), String(rows.length), share((s) => s === 'ACT'), ...kinds.map(([, f]) => share(f))];
    }),
  ),
);

console.log('\n### Questionable, Doubtful or Out now (all five positions)\n');
console.log(
  table(
    ['status now', ...[1, 2, 3, 4, 6, 8].map((k) => `${k} ahead`)],
    (['Questionable', 'Doubtful', 'Out'] as const).map((st) => [st, ...[1, 2, 3, 4, 6, 8].map((k) => frac(obs.filter((o) => o.state === st && o.k === k)))]),
  ),
);

console.log('\n### Healthy QB/RB/WR/TE by season\n');
const bands: Array<[string, number, number]> = [['1–3 ahead', 1, 3], ['4–8 ahead', 4, 8], ['9+ ahead', 9, MAX_K]];
console.log(table(['season', ...bands.map(([l]) => l)], all.map((s) => [String(s), ...bands.map(([, lo, hi]) => frac(healthy(obs, true).filter((o) => o.season === s && o.k >= lo && o.k <= hi)))])));

console.log('\n### Healthy QB/RB/WR/TE by age on September 1\n');
console.log(table(['age', ...bands.map(([l]) => l)], ['under 25', '25–27', '28–30', '31+', 'unknown'].map((b) => [b, ...bands.map(([, lo, hi]) => frac(healthy(obs, true).filter((o) => ageBand(o.age) === b && o.k >= lo && o.k <= hi)))])));

// 2. Held-out comparison: everything fit on the non-test seasons.
if (testSeasons.length) {
  const train = obs.filter((o) => !testSeasons.includes(o.season));
  const test = obs.filter((o) => testSeasons.includes(o.season));
  const f = fit(train);
  const trainHealthy = train.filter((o) => o.state === 'healthy');
  const flat = new Map<string, number>();
  const byPos = new Map<string, number[]>();
  for (const pos of Object.keys(PREVIOUS)) {
    const rows = trainHealthy.filter((o) => o.pos === pos);
    flat.set(pos, rows.filter((o) => o.active).length / (rows.length || 1));
    byPos.set(pos, availabilityCurve(rows, MAX_K));
  }
  // Age bands as a logit offset on the chosen curve.
  const ageOffset = new Map<string, number>();
  for (const b of ['under 25', '25–27', '28–30', '31+', 'unknown']) {
    const rows = trainHealthy.filter((o) => ageBand(o.age) === b);
    if (!rows.length) continue;
    const predicted = rows.reduce((a, o) => a + healthyP(f, o), 0) / rows.length;
    const observed = rows.filter((o) => o.active).length / rows.length;
    ageOffset.set(b, logit(observed) - logit(predicted));
  }
  const row = (label: string, rows: readonly HazardObs[], p: (o: HazardObs) => number) => {
    const s = score(rows, p);
    return [label, String(s.n), s.logLoss.toFixed(4), s.brier.toFixed(4), s.expected.toFixed(0), String(s.active)];
  };
  const head = ['model', 'n', 'log loss', 'Brier', 'expected active', 'active'];
  const testHealthy = test.filter((o) => o.state === 'healthy');
  const testQ = test.filter((o) => o.state === 'Questionable');
  const trainSeasons = [...new Set(train.map((o) => o.season))];
  console.log(`\n### Held out: fit on ${trainSeasons.join(', ')}, scored on ${testSeasons.join(', ')}\n`);
  console.log('Healthy now (all five positions):\n');
  console.log(
    table(head, [
      row('previous app constants (flat by position)', testHealthy, (o) => PREVIOUS[o.pos]!),
      row('fitted flat rate by position', testHealthy, (o) => flat.get(o.pos)!),
      row('curve by position', testHealthy, (o) => at(byPos.get(o.pos)!, o.k)),
      row('**one curve for QB/RB/WR/TE, one for K**', testHealthy, (o) => healthyP(f, o)),
      row('same, plus an age-band offset', testHealthy, (o) => expit(logit(healthyP(f, o)) + (ageOffset.get(ageBand(o.age)) ?? 0))),
    ]),
  );
  console.log(`\nAge-band offsets (logit, fit on ${trainSeasons.join(', ')}): ${[...ageOffset].map(([b, v]) => `${b} ${v.toFixed(2)}`).join(', ')}.\n`);
  console.log('Does the age pattern repeat? Healthy players, 4–8 weeks ahead, fit seasons | test seasons:\n');
  const mid = (rows: readonly HazardObs[], pos: string, b: string) => frac(rows.filter((o) => o.state === 'healthy' && o.pos === pos && ageBand(o.age) === b && o.k >= 4 && o.k <= 8));
  console.log(
    table(
      ['age', ...['QB', 'RB', 'WR', 'TE'].flatMap((pos) => [`${pos} fit`, `${pos} test`])],
      ['under 25', '25–27', '28–30', '31+'].map((b) => [b, ...['QB', 'RB', 'WR', 'TE'].flatMap((pos) => [mid(train, pos, b), mid(test, pos, b)])]),
    ),
  );
  console.log('');
  console.log('Questionable now:\n');
  console.log(
    table(head, [
      row('previous app constants (as healthy)', testQ, (o) => PREVIOUS[o.pos]!),
      row('healthy curve', testQ, (o) => healthyP(f, o)),
      row(`**flat ${pct(f.questionable)}, capped by the healthy curve**`, testQ, (o) => Math.min(f.questionable, healthyP(f, o))),
    ]),
  );
}

const final = fit(obs);
console.log(`\n### Fit on ${all.join(', ')} (what the app uses)\n`);
console.log(`- QB/RB/WR/TE, healthy: ${final.skill.map((v) => v.toFixed(3)).join(', ')}`);
console.log(`- K, healthy: ${final.kicker.map((v) => v.toFixed(3)).join(', ')}`);
console.log(`- Questionable: ${final.questionable.toFixed(3)} (${obs.filter((o) => o.state === 'Questionable').length} follow-ups)`);
if (jsonFile) {
  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  writeFileSync(jsonFile, JSON.stringify({ seasons: all, skill: final.skill.map(r3), kicker: final.kicker.map(r3), questionable: r3(final.questionable) }, null, 1));
}
