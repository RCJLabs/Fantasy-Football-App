// Build the static data files the app reads from GitHub Pages:
//   data/players.json   Sleeper player DB (trimmed) + official practice status (nflverse injuries)
//   data/schedule.json  kickoff times (UTC), lines and implied team totals (nflverse nfldata)
//   data/manifest.json  timestamps, sources and licences
// Usage: tsx pipeline/build-data.ts [--out dist/data] [--cache .cache]
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DATA_SCHEMA_VERSION, type Manifest, type PlayersFile, type ScheduleFile } from '../app/src/data/contracts';
import type { RawPlayer, RawState } from '../app/src/sleeper/raw';
import { compactPlayers, csvRecords, gamesFromCsv, latestInjuryReport, sleeperToGsis } from './lib';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i]!.replace(/^--/, ''), process.argv[i + 1] ?? '');
const OUT = args.get('out') || 'dist/data';
const CACHE = args.get('cache') || '.cache';
const UA = 'Fantasy-Football-App pipeline (+https://github.com/RCJLabs/Fantasy-Football-App)';

async function fetchText(url: string): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA } });
      if (res.ok) return await res.text();
      if (res.status < 500 && res.status !== 429) throw new Error(`HTTP ${res.status} ${url}`);
      if (attempt >= 3) throw new Error(`HTTP ${res.status} ${url}`);
    } catch (e) {
      if (attempt >= 3) throw e;
    }
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
  }
}

/** Sleeper asks for at most one /players/nfl call per day: cache it by UTC date. */
async function sleeperPlayers(): Promise<Record<string, RawPlayer>> {
  const today = new Date().toISOString().slice(0, 10);
  const file = join(CACHE, `sleeper-players-${today}.json`);
  try {
    return JSON.parse(await readFile(file, 'utf8')) as Record<string, RawPlayer>;
  } catch {
    const text = await fetchText('https://api.sleeper.app/v1/players/nfl');
    await mkdir(CACHE, { recursive: true });
    await writeFile(file, text);
    return JSON.parse(text) as Record<string, RawPlayer>;
  }
}

async function main() {
  const now = new Date().toISOString();
  const state = JSON.parse(await fetchText('https://api.sleeper.app/v1/state/nfl')) as RawState;
  const season = state.season;
  const week = Math.max(1, state.week);

  const optional = (url: string) =>
    fetchText(url).catch((e) => {
      console.warn(`optional source unavailable: ${e}`);
      return '';
    });
  const nflverse = 'https://github.com/nflverse/nflverse-data/releases/download';
  const [dump, injuriesCsv, rostersCsv, gamesCsv] = await Promise.all([
    sleeperPlayers(),
    optional(`${nflverse}/injuries/injuries_${season}.csv`),
    optional(`${nflverse}/weekly_rosters/roster_weekly_${season}.csv`),
    fetchText('https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv'),
  ]);

  const report = injuriesCsv ? latestInjuryReport(csvRecords(injuriesCsv), week) : undefined;
  const gsisBySleeper = sleeperToGsis(dump, rostersCsv ? csvRecords(rostersCsv) : []);
  const playersFile: PlayersFile = {
    schemaVersion: DATA_SCHEMA_VERSION,
    generatedAt: now,
    season,
    week,
    ...(report ? { injuryReportWeek: report.week } : {}),
    players: compactPlayers(dump, report, gsisBySleeper),
  };
  const scheduleFile: ScheduleFile = {
    schemaVersion: DATA_SCHEMA_VERSION,
    generatedAt: now,
    season,
    games: gamesFromCsv(csvRecords(gamesCsv), season),
  };
  const manifest: Manifest = {
    schemaVersion: DATA_SCHEMA_VERSION,
    generatedAt: now,
    files: {
      'players.json': {
        updatedAt: now,
        source: 'Sleeper API /players/nfl; practice status from nflverse injuries, joined via nflverse weekly rosters',
        license: 'Sleeper API terms (non-commercial); nflverse data CC-BY 4.0',
        credits: 'Player data via Sleeper; injury reports via nflverse',
      },
      'schedule.json': {
        updatedAt: now,
        source: 'nflverse/nfldata games.csv (kickoffs, spread, total); implied totals derived',
        license: 'nfldata has no licence file; only kickoff facts and derived implied totals are published',
        credits: 'Schedule via nflverse',
      },
    },
  };

  if (playersFile.players.length < 1500) throw new Error(`players.json looks wrong: ${playersFile.players.length} players`);
  if (scheduleFile.games.length < 250) throw new Error(`schedule.json looks wrong: ${scheduleFile.games.length} games`);

  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, 'players.json'), JSON.stringify(playersFile));
  await writeFile(join(OUT, 'schedule.json'), JSON.stringify(scheduleFile));
  await writeFile(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  const withPractice = playersFile.players.filter((p) => p.prac).length;
  console.log(
    `season ${season} week ${week}: ${playersFile.players.length} players (${withPractice} with practice status, report week ${report?.week ?? '-'}), ${scheduleFile.games.length} games → ${OUT}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
