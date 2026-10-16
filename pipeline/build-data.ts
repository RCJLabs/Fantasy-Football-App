// Build the static data files the app reads from GitHub Pages:
//   data/players.json   Sleeper player DB (trimmed) + official practice status (nflverse injuries)
//   data/schedule.json  kickoff times (UTC), lines and implied team totals (nflverse nfldata)
//   data/accuracy.json  projection accuracy by position over completed weeks (aggregates only)
//   data/usage.json     recent snap share, targets and carries (nflverse), shown as context only
//   data/matchups.json  defense vs position beyond players' usual, and regular cornerbacks (nflverse), context only
//   data/baseline.json  in-house baseline v0, a second opinion the app shows but doesn't blend (ffopportunity, CC-BY-SA)
//   data/manifest.json  timestamps, sources and licences
// Usage: tsx pipeline/build-data.ts [--out dist/data] [--cache .cache]
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DATA_SCHEMA_VERSION, type AccuracyFile, type BaselineFile, type CompactPlayer, type Manifest, type PlayersFile, type ScheduleFile } from '../app/src/data/contracts';
import type { StatLine } from '../app/src/domain/types';
import type { RawPlayer, RawState } from '../app/src/sleeper/raw';
import { buildBaselineFile, ffoppStats, SKILL, type SleeperRow } from './baseline';
import { compactPlayers, csvRecords, gamesFromCsv, latestInjuryReport, projectionAccuracy, sleeperToGsis, type PointsRow } from './lib';
import { buildMatchups } from './matchups';
import { buildUsage, invert } from './usage';

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

const optional = (url: string) =>
  fetchText(url).catch((e) => {
    console.warn(`optional source unavailable: ${e}`);
    return '';
  });

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

const LEDGER_MIN_PROJECTED = 5;
const ALL_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

/** One week of api.sleeper.com projections or stats (regular season). */
async function sleeperWeek(kind: 'projections' | 'stats', season: string | number, week: number, positions: readonly string[] = ALL_POSITIONS): Promise<PointsRow[]> {
  const qs = positions.map((p) => `position[]=${p}`).join('&');
  return JSON.parse(await fetchText(`https://api.sleeper.com/${kind}/nfl/${season}/${week}?season_type=regular&${qs}`)) as PointsRow[];
}

/** This season's completed weeks of Sleeper stats, shared by the accuracy ledger and the baseline. */
async function seasonStats(season: string, week: number): Promise<Array<{ week: number; rows: PointsRow[] }> | null> {
  try {
    const out = [];
    for (let w = 1; w < week; w++) out.push({ week: w, rows: await sleeperWeek('stats', season, w) });
    return out;
  } catch (e) {
    console.warn(`Sleeper stats unavailable (accuracy and baseline skipped): ${e}`);
    return null;
  }
}

/** Past weeks' projections (frozen around kickoff, see docs/spikes.md (e)) against actual stats. */
async function accuracyLedger(season: string, stats: ReadonlyArray<{ week: number; rows: PointsRow[] }>, now: string): Promise<AccuracyFile | null> {
  if (!stats.length) return null;
  try {
    const data = [];
    for (const s of stats) data.push({ proj: await sleeperWeek('projections', season, s.week), stats: s.rows });
    const rows = projectionAccuracy(data, LEDGER_MIN_PROJECTED);
    const weeks = stats.map((s) => s.week);
    return rows.length ? { schemaVersion: DATA_SCHEMA_VERSION, generatedAt: now, season, weeks, minProjected: LEDGER_MIN_PROJECTED, rows } : null;
  } catch (e) {
    console.warn(`accuracy ledger skipped: ${e}`);
    return null;
  }
}

const toSleeperRow = (r: PointsRow): SleeperRow => ({ player_id: r.player_id, position: r.player?.position ?? null, team: r.team ?? null, stats: r.stats ?? null });

/**
 * In-house baseline v0 for this week (docs/baseline.md): ffopportunity expected stats over each player's
 * recent games (this season's and last season's), times this week's implied-total factor. The app shows
 * it as a second opinion; it isn't blended. No RotoWire values go into it.
 */
async function baselineShard(
  season: string,
  week: number,
  now: string,
  thisSeason: ReadonlyArray<{ week: number; rows: PointsRow[] }>,
  gamesRecords: Array<Record<string, string>>,
  gsisBySleeper: ReadonlyMap<string, string>,
  players: readonly CompactPlayer[],
): Promise<BaselineFile | null> {
  const prev = Number(season) - 1;
  const ffo = 'https://github.com/ffverse/ffopportunity/releases/download/latest-data';
  try {
    const [cur, last] = await Promise.all([optional(`${ffo}/ep_weekly_${season}.csv`), optional(`${ffo}/ep_weekly_${prev}.csv`)]);
    if (!cur && !last) return null;
    const expected = new Map<string, StatLine>();
    for (const text of [cur, last]) {
      for (const r of text ? csvRecords(text) : []) if (Number(r.week) <= 18) expected.set(`${r.player_id}|${Number(r.season)}|${Number(r.week)}`, ffoppStats(r));
    }
    const weeks = thisSeason.map((s) => ({ season: Number(season), week: s.week, stats: s.rows.map(toSleeperRow) }));
    for (let w = 1; w <= 18; w++) weeks.push({ season: prev, week: w, stats: (await sleeperWeek('stats', prev, w, SKILL)).map(toSleeperRow) });
    const implied = new Map<string, number>();
    for (const s of [prev, Number(season)]) {
      for (const g of gamesFromCsv(gamesRecords, String(s))) {
        if (g.homeImplied !== undefined) implied.set(`${s}|${g.week}|${g.home}`, g.homeImplied);
        if (g.awayImplied !== undefined) implied.set(`${s}|${g.week}|${g.away}`, g.awayImplied);
      }
    }
    const playing = new Set(gamesFromCsv(gamesRecords, season).filter((g) => g.week === week).flatMap((g) => [g.home, g.away]));
    // The position averages cover everyone Sleeper projects this week, as in the backtest (membership only).
    // The baseline is the fallback for missing projections, so without them it uses the players file instead.
    const teams = new Map(players.map((p) => [p.id, p.t]));
    let population: Array<{ id: string; pos: string; team: string | null }> = [];
    try {
      population = (await sleeperWeek('projections', season, week, SKILL)).map((r) => ({ id: r.player_id, pos: r.player?.position ?? '', team: r.team ?? teams.get(r.player_id) ?? null }));
    } catch (e) {
      console.warn(`baseline: Sleeper projections unavailable (${e})`);
    }
    if (!population.length) {
      console.warn('baseline: no projection rows; position averages use the players file');
      population = players.filter((p) => SKILL.includes(p.pos)).map((p) => ({ id: p.id, pos: p.pos, team: p.t ?? null }));
    }
    return buildBaselineFile({ season: Number(season), week, now, weeks, players: population, playing, gsisBySleeper, expected, implied });
  } catch (e) {
    console.warn(`baseline skipped: ${e}`);
    return null;
  }
}

async function main() {
  const now = new Date().toISOString();
  const state = JSON.parse(await fetchText('https://api.sleeper.app/v1/state/nfl')) as RawState;
  const season = state.season;
  const week = Math.max(1, state.week);

  const nflverse = 'https://github.com/nflverse/nflverse-data/releases/download';
  const [dump, injuriesCsv, rostersCsv, gamesCsv, snapsCsv, statsCsv] = await Promise.all([
    sleeperPlayers(),
    optional(`${nflverse}/injuries/injuries_${season}.csv`),
    optional(`${nflverse}/weekly_rosters/roster_weekly_${season}.csv`),
    fetchText('https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv'),
    optional(`${nflverse}/snap_counts/snap_counts_${season}.csv`),
    optional(`${nflverse}/stats_player/stats_player_week_${season}.csv`),
  ]);

  const report = injuriesCsv ? latestInjuryReport(csvRecords(injuriesCsv), week) : undefined;
  const rosterRecords = rostersCsv ? csvRecords(rostersCsv) : [];
  const gsisBySleeper = sleeperToGsis(dump, rosterRecords);
  const playersFile: PlayersFile = {
    schemaVersion: DATA_SCHEMA_VERSION,
    generatedAt: now,
    season,
    week,
    ...(report ? { injuryReportWeek: report.week } : {}),
    players: compactPlayers(dump, report, gsisBySleeper),
  };
  const gamesRecords = csvRecords(gamesCsv);
  const scheduleFile: ScheduleFile = {
    schemaVersion: DATA_SCHEMA_VERSION,
    generatedAt: now,
    season,
    games: gamesFromCsv(gamesRecords, season),
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

  const snapRecords = snapsCsv ? csvRecords(snapsCsv) : [];
  const statRecords = statsCsv ? csvRecords(statsCsv) : [];
  const sleeperByGsis = invert(gsisBySleeper);
  const usage = buildUsage({ season, now, snaps: snapRecords, stats: statRecords, rosters: rosterRecords, sleeperByGsis });
  const matchups = buildMatchups({ season, now, snaps: snapRecords, stats: statRecords, rosters: rosterRecords, sleeperByGsis });
  if (usage) {
    manifest.files['usage.json'] = {
      updatedAt: now,
      source: 'nflverse snap counts (compiled by Pro Football Reference) and weekly player stats, joined via nflverse weekly rosters',
      license: 'nflverse data CC-BY 4.0; snap shares, targets and carries for recent weeks only',
      credits: 'Usage via nflverse',
    };
  }
  if (matchups) {
    manifest.files['matchups.json'] = {
      updatedAt: now,
      source: 'nflverse weekly player stats (PPR by opponent) and snap counts (cornerbacks), joined via nflverse weekly rosters',
      license: 'nflverse data CC-BY 4.0; per-defense aggregates and cornerback snap shares only',
      credits: 'Matchup data via nflverse',
    };
  }

  const stats = await seasonStats(season, week);
  const accuracy = stats ? await accuracyLedger(season, stats, now) : null;
  if (accuracy) {
    manifest.files['accuracy.json'] = {
      updatedAt: now,
      source: 'Sleeper projections (RotoWire) for completed weeks vs Sleeper stats, PPR',
      license: 'Aggregate error statistics only; no projections or stats are republished',
    };
  }
  const baseline = stats ? await baselineShard(season, week, now, stats, gamesRecords, gsisBySleeper, playersFile.players) : null;
  if (baseline) {
    manifest.files['baseline.json'] = {
      updatedAt: now,
      source:
        'In-house baseline v0: ffopportunity expected stats over recent games played (games played from Sleeper stats), scaled by implied team totals from nflverse/nfldata lines',
      license: 'CC-BY-SA 4.0, adapted from ffopportunity (CC-BY-SA 4.0); no Sleeper or RotoWire data is republished',
      credits: 'Expected points via ffopportunity (ffverse); lines via nflverse',
    };
  }

  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, 'players.json'), JSON.stringify(playersFile));
  await writeFile(join(OUT, 'schedule.json'), JSON.stringify(scheduleFile));
  if (accuracy) await writeFile(join(OUT, 'accuracy.json'), JSON.stringify(accuracy));
  if (usage) await writeFile(join(OUT, 'usage.json'), JSON.stringify(usage));
  if (matchups) await writeFile(join(OUT, 'matchups.json'), JSON.stringify(matchups));
  if (baseline) await writeFile(join(OUT, 'baseline.json'), JSON.stringify(baseline));
  await writeFile(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  const withPractice = playersFile.players.filter((p) => p.prac).length;
  const all = accuracy?.rows.find((r) => r.pos === 'ALL');
  console.log(
    `season ${season} week ${week}: ${playersFile.players.length} players (${withPractice} with practice status, report week ${report?.week ?? '-'}), ${scheduleFile.games.length} games` +
      `${all ? `, accuracy weeks ${accuracy!.weeks.join(',')} n=${all.n} MAE ${all.mae} within±1sd ${Math.round(all.within1 * 100)}%` : ''}` +
      `${usage ? `, usage weeks ${usage.weeks.join(',')} for ${Object.keys(usage.players).length} players` : ''}` +
      `${matchups ? `, matchups for ${Object.keys(matchups.defense).length} defenses` : ''}` +
      `${baseline ? `, baseline for ${Object.keys(baseline.players).length} players through week ${baseline.throughWeek}` : ''} → ${OUT}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
