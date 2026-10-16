// Does an nflverse weekly line, mapped to Sleeper stat keys (pipeline/nflverse-stats.ts), score the same as
// Sleeper's own line for that player-week? The plan's test (PLAN Phase 2 item 8): within 0.1 points, QB/RB/
// WR/TE only. Results in docs/stat-mapping.md.
//
// Usage: tsx scripts/check/stat-mapping.ts <history dir> <data dir> [--json <out file>]
//   history dir: the decrypted bundle from scripts/history/pull.sh (<season>/stats_wNN.json)
//   data dir:    stats_player_week_<season>.csv and roster_weekly_<season>.csv (nflverse-data releases)
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ScoringSettings, StatLine } from '../../app/src/domain/types';
import { scoreStats } from '../../app/src/engine/scoring';
import { played, SKILL, type SleeperRow } from '../../pipeline/baseline';
import { LEDGER_SCORING } from '../../pipeline/ledger';
import { csvRecords, SLEEPER_PPR } from '../../pipeline/lib';
import { nflverseStatLine } from '../../pipeline/nflverse-stats';

const args = process.argv.slice(2);
const jsonAt = args.indexOf('--json');
const jsonOut = jsonAt >= 0 ? args[jsonAt + 1] : undefined;
const [historyDir, dataDir] = args.filter((a, i) => !a.startsWith('--') && (jsonAt < 0 || i !== jsonAt + 1));
if (!historyDir || !dataDir) throw new Error('usage: stat-mapping.ts <history dir> <data dir> [--json out]');

/** Scorings to compare under; the last one exercises bonuses, first downs, TE premium and sacks. */
const SCORINGS: Record<string, ScoringSettings> = {
  'Sleeper default PPR (+ return and fumble-recovery TDs)': { ...SLEEPER_PPR, st_td: 6, fum_rec_td: 6 },
  'Ledger PPR (INT −2)': Object.fromEntries(Object.entries(LEDGER_SCORING).filter(([k]) => !/^(fg|xp|pts_allow|sack$|int$|fum_rec$|ff$|def_|safe|blk_)/.test(k))),
  'Half PPR, TE premium, first downs, bonuses, sacks': {
    ...SLEEPER_PPR, rec: 0.5, bonus_rec_te: 0.5, bonus_fd_qb: 0.5, bonus_fd_rb: 0.5, bonus_fd_wr: 0.5, bonus_fd_te: 0.5,
    bonus_pass_yd_300: 3, bonus_pass_yd_400: 3, bonus_rush_yd_100: 3, bonus_rush_yd_200: 3, bonus_rec_yd_100: 3, bonus_rec_yd_200: 3,
    bonus_rush_rec_yd_100: 1, bonus_rush_rec_yd_200: 1, bonus_pass_cmp_25: 1, bonus_rush_att_20: 1, pass_sack: -0.5, st_td: 6, fum_rec_td: 6,
  },
};
const TOLERANCE = 0.1;

const seasons = readdirSync(historyDir).filter((d) => /^\d{4}$/.test(d)).map(Number).sort((a, b) => a - b);
const gsisBySleeper = new Map<string, string>();
const nflverse = new Map<string, Record<string, string>>();
for (const season of seasons) {
  const rosters = join(dataDir, `roster_weekly_${season}.csv`);
  const stats = join(dataDir, `stats_player_week_${season}.csv`);
  if (!existsSync(rosters) || !existsSync(stats)) continue;
  for (const r of csvRecords(readFileSync(rosters, 'utf8'))) {
    if (r.sleeper_id && r.sleeper_id !== 'NA' && r.gsis_id && r.gsis_id !== 'NA') gsisBySleeper.set(r.sleeper_id, r.gsis_id);
  }
  for (const r of csvRecords(readFileSync(stats, 'utf8'))) {
    if ((r.season_type ?? 'REG') === 'REG') nflverse.set(`${r.player_id}|${Number(r.season)}|${Number(r.week)}`, r);
  }
}

type Diff = { n: number; within: number; keys: Map<string, number>; worst: number };
const results = new Map<string, Diff>(Object.keys(SCORINGS).map((name) => [name, { n: 0, within: 0, keys: new Map(), worst: 0 }]));
const ownPoints = { n: 0, within: 0 };
let sleeperRows = 0;
let matched = 0;
for (const season of seasons) {
  for (let week = 1; week <= 18; week++) {
    const file = join(historyDir, String(season), `stats_w${String(week).padStart(2, '0')}.json`);
    if (!existsSync(file)) continue;
    for (const s of JSON.parse(readFileSync(file, 'utf8')) as SleeperRow[]) {
      const pos = s.position ?? '';
      if (!SKILL.includes(pos) || !played(s.stats)) continue;
      sleeperRows++;
      const gsis = gsisBySleeper.get(s.player_id);
      const row = gsis ? nflverse.get(`${gsis}|${season}|${week}`) : undefined;
      if (!row) continue;
      matched++;
      const sleeper: StatLine = s.stats ?? {};
      const mapped = nflverseStatLine(row, pos);
      for (const [name, scoring] of Object.entries(SCORINGS)) {
        const d = results.get(name)!;
        const gap = Math.abs(scoreStats(mapped, scoring) - scoreStats(sleeper, scoring));
        d.n++;
        d.worst = Math.max(d.worst, gap);
        if (gap <= TOLERANCE) d.within++;
        else {
          // Which scored keys disagree on this player-week.
          for (const k of Object.keys(scoring)) if (scoring[k] && (mapped[k] ?? 0) !== (sleeper[k] ?? 0)) d.keys.set(k, (d.keys.get(k) ?? 0) + 1);
        }
      }
      if (sleeper.pts_ppr !== undefined) {
        ownPoints.n++;
        if (Math.abs(scoreStats(mapped, SCORINGS['Sleeper default PPR (+ return and fumble-recovery TDs)']!) - sleeper.pts_ppr) <= TOLERANCE) ownPoints.within++;
      }
    }
  }
}

const pct = (a: number, b: number) => `${((a / (b || 1)) * 100).toFixed(2)}%`;
console.log(`# nflverse → Sleeper stat mapping, seasons ${seasons.join(', ')}\n`);
console.log(`Played QB/RB/WR/TE player-weeks in Sleeper's stats: ${sleeperRows}; with an nflverse row: ${matched} (${pct(matched, sleeperRows)}).\n`);
console.log(`| scoring | player-weeks | within ±${TOLERANCE} | worst gap | stats behind the misses (player-weeks) |\n|---|---|---|---|---|`);
for (const [name, d] of results) {
  const keys = [...d.keys].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => `${k} ${n}`).join(', ');
  console.log(`| ${name} | ${d.n} | ${pct(d.within, d.n)} | ${d.worst.toFixed(2)} | ${keys || '–'} |`);
}
console.log(`\nAgainst Sleeper's own pts_ppr (its default PPR): ${pct(ownPoints.within, ownPoints.n)} of ${ownPoints.n} within ±${TOLERANCE}.`);
if (jsonOut) {
  const out = { seasons, sleeperRows, matched, tolerance: TOLERANCE, scorings: Object.fromEntries([...results].map(([k, d]) => [k, { n: d.n, within: d.within, worst: d.worst, keys: Object.fromEntries(d.keys) }])), ownPoints };
  writeFileSync(jsonOut, `${JSON.stringify(out, null, 2)}\n`);
}
