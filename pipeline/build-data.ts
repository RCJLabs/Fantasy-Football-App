// Build the static data files the app reads from GitHub Pages:
//   data/players.json   Sleeper player DB (trimmed) + official practice status (nflverse injuries)
//   data/schedule.json  kickoff times (UTC), lines and implied team totals (nflverse nfldata)
//   data/accuracy.json  projection accuracy by position over completed weeks (aggregates only)
//   data/usage.json     recent snap share, targets and carries (nflverse), shown as context only
//   data/matchups.json  defense vs position beyond players' usual, and regular cornerbacks (nflverse), context only
//   data/baseline.json  in-house baseline v0, a second opinion the app shows but doesn't blend (ffopportunity, CC-BY-SA)
//   data/ledger.json    the app's pre-kickoff predictions, scored each finished week (aggregates; the `ledger` release)
//   data/nextseason.json next season's projections for the draft helper (nflverse stats, contracts and draft picks; derived only)
//   data/manifest.json  timestamps, sources and licences
// Usage: tsx pipeline/build-data.ts [--out dist/data] [--cache .cache]
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  DATA_SCHEMA_VERSION,
  type AccuracyFile,
  type BaselineFile,
  type CompactPlayer,
  type LedgerFile,
  type Manifest,
  type NextSeasonFile,
  type ManifestEntry,
  type MatchupsFile,
  type PlayersFile,
  type ScheduleFile,
  type UsageFile,
} from '../app/src/data/contracts';
import type { StatLine } from '../app/src/domain/types';
import type { RawPlayer, RawState } from '../app/src/sleeper/raw';
import { parquetReadObjects } from 'hyparquet';
import { buildBaselineFile, ffoppStats, SKILL, type SleeperRow } from './baseline';
import { compactPlayers, csvRecords, gamesFromCsv, latestInjuryReport, missedLastGame, projectionAccuracy, sleeperToGsis, type PointsRow } from './lib';
import { defGames, dstWeek } from './dst';
import { buildMatchups } from './matchups';
import { buildNextSeasonFile, type ContractRow, contractThrough, defenseSums, fantasyPos, type NextSeasonFit, normalizeName, seasonSums, teamGames } from './next-season';
import { decideShard, type ShardName } from './shards';
import { buildUsage, invert } from './usage';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i]!.replace(/^--/, ''), process.argv[i + 1] ?? '');
const OUT = args.get('out') || 'dist/data';
const CACHE = args.get('cache') || '.cache';
const UA = 'Fantasy-Football-App pipeline (+https://github.com/RCJLabs/Fantasy-Football-App)';
/** The deployed app, whose data files are the "last good" copies. */
const SITE = process.env.DATA_SITE || 'https://ff.rcjlabs.com';

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

async function fetchBuffer(url: string): Promise<ArrayBuffer> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA } });
      if (res.ok) return await res.arrayBuffer();
      if ((res.status < 500 && res.status !== 429) || attempt >= 3) throw new Error(`HTTP ${res.status} ${url}`);
    } catch (e) {
      if (attempt >= 3) throw e;
    }
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
  }
}

const FFOPPORTUNITY = 'https://github.com/ffverse/ffopportunity/releases/download/latest-data';
const NFLVERSE = 'https://github.com/nflverse/nflverse-data/releases/download';

const optional = (url: string) =>
  fetchText(url).catch((e) => {
    console.warn(`optional source unavailable: ${e}`);
    return '';
  });

/** The scored prediction ledger, published by the archive workflow's ledger job (scripts/ledger/auto.sh). */
async function scoredLedger(): Promise<unknown> {
  const repo = process.env.GITHUB_REPOSITORY || 'RCJLabs/Fantasy-Football-App';
  const text = await optional(`https://github.com/${repo}/releases/download/ledger/ledger.json`);
  try {
    return text ? (JSON.parse(text) as unknown) : null;
  } catch (e) {
    console.warn(`ledger.json unreadable: ${e}`);
    return null;
  }
}

/** The currently deployed copy of a data file, if there is one. */
async function deployedShard(name: string): Promise<unknown> {
  try {
    return JSON.parse(await fetchText(`${SITE}/data/${name}`)) as unknown;
  } catch {
    return undefined;
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

/** A finished regular season of Sleeper stats for QB/RB/WR/TE and team defenses (the baseline's history, defenses next season). */
async function sleeperSeasonStats(season: number): Promise<Array<{ week: number; rows: PointsRow[] }>> {
  const out = [];
  for (let w = 1; w <= 18; w++) out.push({ week: w, rows: await sleeperWeek('stats', season, w, [...SKILL, 'DEF']) });
  return out;
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

const toSleeperRow = (r: PointsRow): SleeperRow => ({
  player_id: r.player_id,
  position: r.player?.position ?? null,
  team: r.team ?? null,
  opponent: r.opponent ?? null,
  stats: r.stats ?? null,
});

/**
 * In-house baseline v0 for this week (docs/baseline.md): ffopportunity expected stats over each player's
 * recent games (this season's and last season's), times this week's implied-total factor, plus team
 * defense v0 lines (docs/dst.md). The app shows it as a second opinion; it isn't blended. No RotoWire values
 * go into it.
 */
async function baselineShard(
  season: string,
  week: number,
  now: string,
  thisSeason: ReadonlyArray<{ week: number; rows: PointsRow[] }>,
  gamesRecords: Array<Record<string, string>>,
  gsisBySleeper: ReadonlyMap<string, string>,
  players: readonly CompactPlayer[],
  cur: string | null,
  lastSeason: ReadonlyArray<{ week: number; rows: PointsRow[] }>,
): Promise<BaselineFile | null> {
  const prev = Number(season) - 1;
  try {
    const last = await optional(`${FFOPPORTUNITY}/ep_weekly_${prev}.csv`);
    if (!cur && !last) return null;
    const expected = new Map<string, StatLine>();
    for (const text of [cur, last]) {
      for (const r of text ? csvRecords(text) : []) if (Number(r.week) <= 18) expected.set(`${r.player_id}|${Number(r.season)}|${Number(r.week)}`, ffoppStats(r));
    }
    const weeks = thisSeason.map((s) => ({ season: Number(season), week: s.week, stats: s.rows.map(toSleeperRow) }));
    for (const w of lastSeason) weeks.push({ season: prev, week: w.week, stats: w.rows.map(toSleeperRow) });
    const implied = new Map<string, number>();
    const context = new Map<string, { home: boolean; oppImplied?: number }>();
    for (const s of [prev, Number(season)]) {
      for (const g of gamesFromCsv(gamesRecords, String(s))) {
        if (g.homeImplied !== undefined) implied.set(`${s}|${g.week}|${g.home}`, g.homeImplied);
        if (g.awayImplied !== undefined) implied.set(`${s}|${g.week}|${g.away}`, g.awayImplied);
        context.set(`${s}|${g.week}|${g.home}`, { home: true, ...(g.awayImplied !== undefined ? { oppImplied: g.awayImplied } : {}) });
        context.set(`${s}|${g.week}|${g.away}`, { home: false, ...(g.homeImplied !== undefined ? { oppImplied: g.homeImplied } : {}) });
      }
    }
    const thisWeek = gamesFromCsv(gamesRecords, season).filter((g) => g.week === week);
    const playing = new Set(thisWeek.flatMap((g) => [g.home, g.away]));
    // Team defenses (pipeline/dst.ts), from every earlier DEF line of both seasons.
    const defHistory = weeks.flatMap((w) => defGames(w.season, w.week, w.stats, context));
    const matchups = new Map(thisWeek.flatMap((g) => [[g.home, g.away], [g.away, g.home]] as Array<[string, string]>));
    const defenses = dstWeek(Number(season), week, defHistory, matchups, context);
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
    return buildBaselineFile({ season: Number(season), week, now, weeks, players: population, playing, defenses, gsisBySleeper, expected, implied });
  } catch (e) {
    console.warn(`baseline skipped: ${e}`);
    return null;
  }
}

/**
 * Next season's projections for the draft helper (docs/draft.md): nflverse weekly stats of the latest three seasons,
 * OverTheCap contracts (via nflverse), the NFL draft once it has happened, and Sleeper's team defense lines. Only
 * derived values are published.
 */
async function nextSeasonShard(o: {
  season: string;
  now: string;
  statRecords: Array<Record<string, string>>;
  rosterRecords: Array<Record<string, string>>;
  dump: Record<string, RawPlayer>;
  gsisBySleeper: ReadonlyMap<string, string>;
  sleeperByGsis: ReadonlyMap<string, string>;
  /** Sleeper stats: this season's played weeks, and last season's. */
  thisSeason: ReadonlyArray<{ week: number; rows: PointsRow[] }>;
  lastSeason: ReadonlyArray<{ week: number; rows: PointsRow[] }>;
}): Promise<NextSeasonFile | null> {
  try {
    const fit = JSON.parse(await readFile(new URL('./next-season-fit.json', import.meta.url), 'utf8')) as NextSeasonFit;
    const S = Number(o.season);
    const isReg = (r: Record<string, string>) => (r.season_type ?? 'REG') === 'REG';
    // Before this season's first game the projection is built on last season, complete.
    const basis = o.statRecords.some(isReg) ? S : S - 1;
    const stats = async (y: number) => (y === S ? o.statRecords : csvRecords(await fetchText(`${NFLVERSE}/stats_player/stats_player_week_${y}.csv`)));
    const curRecs = await stats(basis);
    const weeks = basis < S ? 18 : Math.min(18, Math.max(0, ...curRecs.filter(isReg).map((r) => Number(r.week) || 0)));
    const [p1, p2] = [await stats(basis - 1), await stats(basis - 2)];
    const contracts = await parquetReadObjects({
      file: await fetchBuffer(`${NFLVERSE}/contracts/historical_contracts.parquet`),
      columns: ['gsis_id', 'year_signed', 'years', 'is_active', 'draft_round', 'draft_year', 'season_history'],
    });
    const target = basis + 1;
    const picksText = await optional(`${NFLVERSE}/draft_picks/draft_picks.csv`);
    const draft = (picksText ? csvRecords(picksText) : [])
      .filter((r) => Number(r.season) === target && r.gsis_id && r.gsis_id !== 'NA')
      .sort((a, b) => Number(a.pick) - Number(b.pick))
      .map((r) => ({ pos: fantasyPos(r.position), gsis: r.gsis_id!, ...(r.pfr_player_name ? { name: r.pfr_player_name } : {}) }));
    // Sleeper's rookies by name and position, for draftees nflverse can't yet link to a Sleeper id.
    const rookieIds = new Map(
      Object.entries(o.dump).flatMap(([id, p]) => (p.years_exp === 0 && p.full_name && p.position ? [[`${normalizeName(p.full_name)}|${fantasyPos(p.position)}`, id] as const] : [])),
    );
    const birthDates = new Map<string, string>();
    for (const r of o.rosterRecords) if (r.gsis_id && r.birth_date && r.birth_date !== 'NA') birthDates.set(r.gsis_id, r.birth_date);
    for (const [sid, g] of o.gsisBySleeper) {
      const b = o.dump[sid]?.birth_date;
      if (b) birthDates.set(g, b);
    }
    const inactive = new Set(Object.entries(o.dump).flatMap(([id, p]) => (p.active === false ? [id] : [])));
    // Team defenses from Sleeper's DEF lines: the basis season so far and the one before (optional).
    let defenses: Parameters<typeof buildNextSeasonFile>[0]['defenses'];
    try {
      const curDef = basis === S ? o.thisSeason : o.lastSeason;
      const prevDef = basis === S ? o.lastSeason : await sleeperSeasonStats(basis - 1);
      if (curDef.length || prevDef.length) defenses = { cur: defenseSums(curDef.map((w) => w.rows.map(toSleeperRow))), prev: defenseSums(prevDef.map((w) => w.rows.map(toSleeperRow))) };
    } catch (e) {
      console.warn(`next season: no team defenses (${e})`);
    }
    return buildNextSeasonFile({
      fit,
      now: o.now,
      season: o.season,
      basisSeason: basis,
      basisWeeks: weeks,
      cur: seasonSums(curRecs, weeks),
      prev1: seasonSums(p1),
      prev2: seasonSums(p2),
      teamGames: teamGames(curRecs, weeks),
      birthDates,
      through: contractThrough(contracts as ContractRow[]),
      sleeperByGsis: o.sleeperByGsis,
      // Every player's name, signed or not: free agents without a team aren't in players.json.
      names: new Map(Object.entries(o.dump).map(([id, p]) => [id, p.position === 'DEF' ? `${p.first_name ?? id} ${p.last_name ?? ''}`.trim() : (p.full_name ?? `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim())])),
      inactive,
      ...(defenses ? { defenses } : {}),
      ...(draft.length ? { draft, rookieIds } : {}),
    });
  } catch (e) {
    console.warn(`next season skipped: ${e}`);
    return null;
  }
}

async function main() {
  const now = new Date().toISOString();
  const state = JSON.parse(await fetchText('https://api.sleeper.app/v1/state/nfl')) as RawState;
  const season = state.season;
  const week = Math.max(1, state.week);

  const nflverse = NFLVERSE;
  const [dump, injuriesCsv, rostersCsv, gamesCsv, snapsCsv, statsCsv, ffoCurrent] = await Promise.all([
    sleeperPlayers(),
    optional(`${nflverse}/injuries/injuries_${season}.csv`),
    optional(`${nflverse}/weekly_rosters/roster_weekly_${season}.csv`),
    fetchText('https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv'),
    optional(`${nflverse}/snap_counts/snap_counts_${season}.csv`),
    optional(`${nflverse}/stats_player/stats_player_week_${season}.csv`),
    optional(`${FFOPPORTUNITY}/ep_weekly_${season}.csv`),
  ]);

  const report = injuriesCsv ? latestInjuryReport(csvRecords(injuriesCsv), week) : undefined;
  const rosterRecords = rostersCsv ? csvRecords(rostersCsv) : [];
  const gsisBySleeper = sleeperToGsis(dump, rosterRecords);
  const gamesRecords = csvRecords(gamesCsv);
  const playersFile: PlayersFile = {
    schemaVersion: DATA_SCHEMA_VERSION,
    generatedAt: now,
    season,
    week,
    ...(report ? { injuryReportWeek: report.week } : {}),
    players: compactPlayers(dump, report, gsisBySleeper, missedLastGame(rosterRecords, gamesRecords, season, week)),
  };
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
  // ffopportunity's expected stats this season: points against usage in the usage shard (the baseline reads them too).
  const expected = new Map<string, StatLine>();
  for (const r of ffoCurrent ? csvRecords(ffoCurrent) : []) if (Number(r.season) === Number(season) && Number(r.week) <= 18) expected.set(`${r.player_id}|${Number(r.week)}`, ffoppStats(r));
  const usage = buildUsage({ season, now, snaps: snapRecords, stats: statRecords, rosters: rosterRecords, sleeperByGsis, expected });
  const matchups = buildMatchups({ season, now, snaps: snapRecords, stats: statRecords, rosters: rosterRecords, sleeperByGsis });
  const stats = await seasonStats(season, week);
  const accuracy = stats ? await accuracyLedger(season, stats, now) : null;
  const lastSeason = stats
    ? await sleeperSeasonStats(Number(season) - 1).catch((e) => {
        console.warn(`Sleeper stats for ${Number(season) - 1} unavailable (baseline skipped): ${e}`);
        return null;
      })
    : null;
  const baseline = stats && lastSeason ? await baselineShard(season, week, now, stats, gamesRecords, gsisBySleeper, playersFile.players, ffoCurrent, lastSeason) : null;
  const nextSeason = await nextSeasonShard({ season, now, statRecords, rosterRecords, dump, gsisBySleeper, sleeperByGsis, thisSeason: stats ?? [], lastSeason: lastSeason ?? [] });
  const ledger = await scoredLedger();

  // Optional shards: publish a fresh build that checks out, otherwise keep the deployed copy while it still
  // describes this season (this week, for the baseline), so one upstream outage doesn't take a feature down.
  const entries: Record<ShardName, Omit<ManifestEntry, 'updatedAt'>> = {
    'usage.json': {
      source:
        'nflverse snap counts (compiled by Pro Football Reference) and weekly player stats, joined via nflverse weekly rosters; ffopportunity expected stats for points and touchdowns against usage',
      license:
        'nflverse data CC-BY 4.0; snap shares, targets and carries for recent weeks only. Expected points and touchdowns: CC-BY-SA 4.0, adapted from ffopportunity (CC-BY-SA 4.0), recent-game totals only',
      credits: 'Usage via nflverse; expected points via ffopportunity (ffverse)',
    },
    'matchups.json': {
      source: 'nflverse weekly player stats (PPR by opponent) and snap counts (cornerbacks), joined via nflverse weekly rosters',
      license: 'nflverse data CC-BY 4.0; per-defense aggregates and cornerback snap shares only',
      credits: 'Matchup data via nflverse',
    },
    'accuracy.json': {
      source: 'Sleeper projections (RotoWire) for completed weeks vs Sleeper stats, PPR',
      license: 'Aggregate error statistics only; no projections or stats are republished',
    },
    'baseline.json': {
      source:
        'In-house baseline v0: ffopportunity expected stats over recent games played (games played from Sleeper stats), scaled by implied team totals from nflverse/nfldata lines; team defenses from implied totals and Sleeper defense stats',
      license: 'CC-BY-SA 4.0, adapted from ffopportunity (CC-BY-SA 4.0); no Sleeper or RotoWire data is republished',
      credits: 'Expected points via ffopportunity (ffverse); lines via nflverse',
    },
    'ledger.json': {
      source:
        "The app's own predictions, committed before each kickoff (SHA-256 fingerprints in the archive releases), scored against nflverse game-day rosters and weekly stats",
      license: 'Aggregate scores only; no predictions, projections or stats are republished. nflverse data CC-BY 4.0',
      credits: 'Outcomes via nflverse',
    },
    'nextseason.json': {
      source:
        'In-house next-season projections (docs/draft.md): nflverse weekly player stats of the latest three seasons, contract years from OverTheCap via nflverse, the NFL draft via nflverse once held; team defenses from Sleeper defense stats',
      license:
        'Derived projections only: no stats, contract terms or draft data are republished (a no-contract-next-season flag and modelled chances of a team change). nflverse data CC-BY 4.0',
      credits: 'Stats, contracts (OverTheCap) and draft picks via nflverse',
    },
  };
  const fresh: Record<ShardName, unknown> = {
    'usage.json': usage,
    'matchups.json': matchups,
    'accuracy.json': accuracy,
    'baseline.json': baseline,
    'ledger.json': ledger,
    'nextseason.json': nextSeason,
  };
  const shards = new Map<ShardName, Record<string, unknown>>();
  const health: string[] = [];
  for (const name of Object.keys(entries) as ShardName[]) {
    const d = decideShard(name, fresh[name], await deployedShard(name), season, week);
    if (d.use === 'none') {
      health.push(`| ${name} | missing | 0 | ${d.reason} |`);
      continue;
    }
    shards.set(name, d.shard);
    if (d.use === 'kept') {
      const from = String(d.shard.generatedAt);
      manifest.files[name] = { ...entries[name], updatedAt: from, note: `Kept from the last good build: ${d.reason}` };
      health.push(`| ${name} | kept from ${from.slice(0, 16)}Z | ${d.rows} | ${d.reason} |`);
      console.warn(`${name}: kept the deployed copy from ${from} (${d.reason})`);
    } else {
      manifest.files[name] = { ...entries[name], updatedAt: now };
      health.push(`| ${name} | fresh | ${d.rows} | ${d.warning ?? ''} |`);
      if (d.warning) console.warn(`${name}: ${d.warning}`);
    }
  }

  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, 'players.json'), JSON.stringify(playersFile));
  await writeFile(join(OUT, 'schedule.json'), JSON.stringify(scheduleFile));
  for (const [name, shard] of shards) await writeFile(join(OUT, name), JSON.stringify(shard));
  await writeFile(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `### Data shards\n\n| shard | status | rows | note |\n|---|---|---|---|\n${health.join('\n')}\n\n`);
  }
  const withPractice = playersFile.players.filter((p) => p.prac).length;
  const withEspn = playersFile.players.filter((p) => p.espn).length;
  const acc = shards.get('accuracy.json') as AccuracyFile | undefined;
  const all = acc?.rows.find((r) => r.pos === 'ALL');
  const use = shards.get('usage.json') as UsageFile | undefined;
  const mat = shards.get('matchups.json') as MatchupsFile | undefined;
  const base = shards.get('baseline.json') as BaselineFile | undefined;
  const led = shards.get('ledger.json') as LedgerFile | undefined;
  const next = shards.get('nextseason.json') as NextSeasonFile | undefined;
  console.log(
    `season ${season} week ${week}: ${playersFile.players.length} players (${withPractice} with practice status, report week ${report?.week ?? '-'}; ${withEspn} with ESPN ids), ${scheduleFile.games.length} games` +
      `${all ? `, accuracy weeks ${acc!.weeks.join(',')} n=${all.n} MAE ${all.mae} within±1sd ${Math.round(all.within1 * 100)}%` : ''}` +
      `${use ? `, usage weeks ${use.weeks.join(',')} for ${Object.keys(use.players).length} players` : ''}` +
      `${mat ? `, matchups for ${Object.keys(mat.defense).length} defenses` : ''}` +
      `${base ? `, baseline for ${Object.keys(base.players).length} players through week ${base.throughWeek}` : ''}` +
      `${led ? `, ledger weeks ${led.weeks.map((w) => w.week).join(',')}` : ''}` +
      `${next ? `, ${next.target} projections for ${Object.keys(next.players).length} players from ${next.basis.season} week ${next.basis.weeks}` : ''} → ${OUT}`,
  );
  for (const line of health) console.log(line);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
