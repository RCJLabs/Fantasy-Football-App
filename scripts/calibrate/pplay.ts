// Calibrate P(active) by final injury-report game status and final practice status.
//
// Joins nflverse injury reports (one row per player-week, overwritten through the week: for played
// games it is the final report) to weekly rosters, whose status is the game-day designation (ACT =
// active; INA = inactive; RES, CUT, DEV = off the active roster), on season, week and gsis_id.
// Regular-season games already played, QB/RB/WR/TE/K.
// "Relevant" players averaged at least 8 PPR points (QB 12; any kicker) in their earlier games
// that season: roughly the players fantasy lineups are built from. Week 1 has no such history.
// With --test, also scores the app's current playProbability() on a held-out season.
// Prints markdown tables (counts, Wilson 95% intervals): aggregates only.
//
// Usage: tsx scripts/calibrate/pplay.ts <dir> <season>... [--test <season>]
// <dir> holds injuries_YYYY.csv, roster_weekly_YYYY.csv and stats_player_week_YYYY.csv from the
// github.com/nflverse/nflverse-data releases (tags injuries, weekly_rosters, stats_player).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { InjuryStatus, PracticeStatus } from '../../app/src/domain/types';
import { playProbability } from '../../app/src/engine/availability';
import { csvRecords, practiceStatus } from '../../pipeline/lib';

const RELEVANT_PPR: Record<string, number> = { QB: 12, RB: 8, WR: 8, TE: 8, K: 0 };
const PRACTICES: PracticeStatus[] = ['Full', 'Limited', 'DNP'];
const POSITIONS = Object.keys(RELEVANT_PPR);

interface Obs {
  season: string;
  week: number;
  pos: string;
  /** Final game status: Questionable, Doubtful or Out; '' = listed without one; undefined = not on the report. */
  game?: string;
  practice?: PracticeStatus;
  relevant: boolean;
  active: boolean;
}

function loadSeason(dir: string, season: string): Obs[] {
  const read = (name: string) => csvRecords(readFileSync(join(dir, `${name}_${season}.csv`), 'utf8'));

  // PPR points in each regular-season game with a recorded stat; team-weeks with stats are the games
  // already played (the current week's rows hold mid-week reports and pre-game rosters).
  const games = new Map<string, Array<{ week: number; ppr: number }>>();
  const played = new Set<string>();
  for (const r of read('stats_player_week')) {
    if (r.season_type !== 'REG' || !r.player_id) continue;
    const list = games.get(r.player_id) ?? [];
    list.push({ week: Number(r.week), ppr: Number(r.fantasy_points_ppr) || 0 });
    games.set(r.player_id, list);
    played.add(`${r.week}:${r.team}`);
  }
  const isRelevant = (gsis: string, pos: string, week: number) => {
    const prior = (games.get(gsis) ?? []).filter((g) => g.week < week);
    return prior.length > 0 && prior.reduce((s, g) => s + g.ppr, 0) / prior.length >= (RELEVANT_PPR[pos] ?? Infinity);
  };

  // Final report row per player-week (nflverse keeps one; on duplicates take the latest).
  const reports = new Map<string, Record<string, string>>();
  for (const r of read('injuries')) {
    if (r.game_type !== 'REG' || !r.gsis_id) continue;
    const key = `${r.week}:${r.gsis_id}`;
    const prev = reports.get(key);
    if (!prev || (r.date_modified ?? '') >= (prev.date_modified ?? '')) reports.set(key, r);
  }

  // Game-day roster rows; teams on bye have none that week.
  const out: Obs[] = [];
  for (const r of read('roster_weekly')) {
    if (r.game_type !== 'REG' || !r.gsis_id || !played.has(`${r.week}:${r.team}`)) continue;
    const week = Number(r.week);
    const report = reports.get(`${week}:${r.gsis_id}`);
    const pos = report?.position || r.position || '';
    if (!(pos in RELEVANT_PPR)) continue;
    const game = report ? (report.report_status ?? '').trim().replace(/^NA$/, '') : undefined;
    if (game === 'Note') continue;
    // Off the report, only players on the game-day 53 are candidates (not IR, practice squad or cut).
    if (!report && r.status !== 'ACT' && r.status !== 'INA') continue;
    out.push({
      season,
      week,
      pos,
      ...(game !== undefined ? { game } : {}),
      ...(report && practiceStatus(report.practice_status) ? { practice: practiceStatus(report.practice_status)! } : {}),
      relevant: isRelevant(r.gsis_id, pos, week),
      active: r.status === 'ACT',
    });
  }
  return out;
}

const wilson = (k: number, n: number): [number, number] => {
  const z = 1.96;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
};
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const rate = (rows: Obs[]) => {
  const n = rows.length;
  const k = rows.filter((o) => o.active).length;
  if (!n) return ['0/0', '–', '–'];
  const [lo, hi] = wilson(k, n);
  return [`${k}/${n}`, pct(k / n), `${pct(lo)}–${pct(hi)}`];
};
const table = (head: string[], rows: string[][]) =>
  [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');

/** Rows for one game status: overall, then by final practice. */
function statusRows(obs: Obs[], label: string, game: string | undefined): string[][] {
  const g = obs.filter((o) => o.game === game);
  const both = (rows: Obs[], prac: string) => [label, prac, ...rate(rows), ...rate(rows.filter((o) => o.relevant))];
  if (game === undefined) return [both(g, '–')];
  return [both(g, 'any'), ...PRACTICES.map((p) => both(g.filter((o) => o.practice === p), p))];
}

const args = process.argv.slice(2);
const testAt = args.indexOf('--test');
const test = testAt >= 0 ? args[testAt + 1] : undefined;
const [dir, ...seasons] = testAt >= 0 ? args.slice(0, testAt) : args;
if (!dir || !seasons.length) throw new Error('usage: pplay.ts <dir> <season>... [--test <season>]');

const obs = seasons.flatMap((s) => loadSeason(dir, s));
const relevant = obs.filter((o) => o.relevant);
console.log(`## P(active), regular seasons ${seasons.join(', ')}, ${POSITIONS.join('/')}\n`);
console.log(`${obs.length} player-weeks (${relevant.length} relevant); ${obs.filter((o) => o.game !== undefined).length} on a final injury report.\n`);

console.log('### By final game status and final practice\n');
console.log(
  table(
    ['game status', 'practice', 'active/n', 'P(active)', '95% CI', 'relevant: active/n', 'P(active)', '95% CI'],
    [
      ...statusRows(obs, 'not on report', undefined),
      ...statusRows(obs, 'listed, no status', ''),
      ...statusRows(obs, 'Questionable', 'Questionable'),
      ...statusRows(obs, 'Doubtful', 'Doubtful'),
      ...statusRows(obs, 'Out', 'Out').slice(0, 1),
    ],
  ),
);

const q = obs.filter((o) => o.game === 'Questionable');
console.log('\n### Questionable by position (relevant players)\n');
console.log(
  table(
    ['position', 'active/n', 'P(active)', '95% CI', ...PRACTICES.flatMap((p) => [p, 'P'])],
    POSITIONS.map((pos) => {
      const rows = q.filter((o) => o.relevant && o.pos === pos);
      return [pos, ...rate(rows), ...PRACTICES.flatMap((p) => rate(rows.filter((o) => o.practice === p)).slice(0, 2))];
    }),
  ),
);

console.log('\n### Questionable by season (relevant players)\n');
console.log(
  table(
    ['season', 'active/n', 'P(active)', '95% CI', ...PRACTICES.flatMap((p) => [p, 'P'])],
    seasons.map((s) => {
      const rows = q.filter((o) => o.relevant && o.season === s);
      return [s, ...rate(rows), ...PRACTICES.flatMap((p) => rate(rows.filter((o) => o.practice === p)).slice(0, 2))];
    }),
  ),
);

if (test) {
  // Score the app's table on a held-out season: expected actives (sum of p) vs observed, and Brier.
  const held = loadSeason(dir, test);
  const p = (o: Obs) => playProbability((o.game || null) as InjuryStatus | null, o.practice);
  const score = (label: string, rows: Obs[]) => {
    const exp = rows.reduce((s, o) => s + p(o), 0);
    const brier = rows.reduce((s, o) => s + (p(o) - (o.active ? 1 : 0)) ** 2, 0) / (rows.length || 1);
    return [label, String(rows.length), exp.toFixed(1), String(rows.filter((o) => o.active).length), brier.toFixed(3)];
  };
  const listed = held.filter((o) => o.relevant && o.game !== undefined && o.game !== '');
  const weeks = [...new Set(held.map((o) => o.week))].sort((a, b) => a - b);
  console.log(`\n### Held out: ${test} weeks ${weeks[0]}–${weeks.at(-1)}, relevant players, app's playProbability()\n`);
  console.log(
    table(
      ['group', 'n', 'expected active', 'active', 'Brier'],
      [
        score('not on report', held.filter((o) => o.relevant && o.game === undefined)),
        ...PRACTICES.map((pr) => score(`Questionable, ${pr}`, listed.filter((o) => o.game === 'Questionable' && o.practice === pr))),
        score('Questionable, any', listed.filter((o) => o.game === 'Questionable')),
        score('Doubtful', listed.filter((o) => o.game === 'Doubtful')),
        score('Out', listed.filter((o) => o.game === 'Out')),
        score('Questionable + Doubtful', listed.filter((o) => o.game === 'Questionable' || o.game === 'Doubtful')),
      ],
    ),
  );
}
