// Archive hook: player props from The Odds API for games kicking off soon (docs/props.md). scripts/archive/snapshot.sh
// runs it on each snapshot directory before encrypting it.
// - Each game is fetched once, in the first archive run within PROPS_WINDOW_HOURS (default 6) of its kickoff: six
//   markets, one region, so about 6 credits a game and 90 a week (the free plan has 500 a month).
// - Nothing is requested unless the app's schedule has a game inside the window.
// - The raw responses stay inside the encrypted snapshot: props_events.json and props_event_<id>.json.
// - props_meta.json lists only which games were fetched and the credits used. The archive publishes it, and later
//   runs skip the games it lists.
// - Never blocks the snapshot: failures are logged and the hook exits 0. The API key never reaches a file or a log.
//
// Usage: tsx scripts/props/pull.ts <snapshot dir> <dir of earlier props_*.json metadata>
// Env: ODDS_API_KEY; PROPS_MODE = auto | test (the next game whatever its kickoff, not marked as fetched) | off;
// ODDS_API_BASE (tests only: a mock server instead of the real API).
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ScheduleFile } from '../../app/src/data/contracts';
import { dueEvents, type OddsEvent, PROP_MARKETS, type PropsMeta, TEAM_CODES } from '../../pipeline/props';

const API = `${process.env.ODDS_API_BASE ?? 'https://api.the-odds-api.com'}/v4/sports/americanfootball_nfl`;
const UA = 'Fantasy-Football-App archive (+https://github.com/RCJLabs/Fantasy-Football-App)';
const WINDOW_HOURS = Number(process.env.PROPS_WINDOW_HOURS ?? 6);

const [dir, seenDir] = process.argv.slice(2);
if (!dir) throw new Error('usage: pull.ts <snapshot dir> [<dir of earlier props metadata>]');
const key = process.env.ODDS_API_KEY ?? '';
const mode = process.env.PROPS_MODE ?? 'auto';
const now = Date.now();

const quit = (why: string): never => {
  console.log(`Props: ${why}.`);
  process.exit(0);
};

interface Reply {
  status: number;
  body: unknown;
  used?: number;
  remaining?: number;
  last?: number;
}

/** GET from the API. The key goes only into the request; errors are reported without the URL. */
async function get(path: string, params: Record<string, string>): Promise<Reply> {
  const query = new URLSearchParams({ ...params, apiKey: key });
  try {
    const res = await fetch(`${API}${path}?${query}`, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(30_000) });
    const header = (name: string) => {
      const v = res.headers.get(name);
      return v === null || v === '' || !Number.isFinite(Number(v)) ? undefined : Number(v);
    };
    return {
      status: res.status,
      body: res.ok ? await res.json() : undefined,
      used: header('x-requests-used'),
      remaining: header('x-requests-remaining'),
      last: header('x-requests-last'),
    };
  } catch (e) {
    const err = e as { name?: string; cause?: { code?: string } };
    console.log(`Props: request failed (${err.cause?.code ?? err.name ?? 'error'}).`);
    return { status: 0, body: undefined };
  }
}

async function main(): Promise<void> {
  if (mode === 'off') quit('off');
  if (!key) quit('no ODDS_API_KEY');

  // Games earlier runs fetched (their published metadata), test fetches aside.
  const fetched: PropsMeta['events'] = [];
  if (seenDir && existsSync(seenDir)) {
    for (const f of readdirSync(seenDir)) {
      if (!/^props_.*\.json$/.test(f)) continue;
      try {
        const meta = JSON.parse(readFileSync(join(seenDir, f), 'utf8')) as PropsMeta;
        if (!meta.test) fetched.push(...(meta.events ?? []));
      } catch {
        console.log(`Props: skipped unreadable metadata ${f}.`);
      }
    }
  }
  const done = new Set(fetched.map((e) => e.id));

  // Spend nothing unless the app's own schedule has a game inside the window that no earlier run fetched.
  if (mode !== 'test') {
    const path = join(dir!, 'site_schedule.json');
    if (!existsSync(path)) quit('no schedule in the snapshot');
    const schedule = JSON.parse(readFileSync(path, 'utf8')) as ScheduleFile;
    const soon = schedule.games.filter((g) => {
      const t = Date.parse(g.kickoff);
      return t > now && t - now <= WINDOW_HOURS * 3_600_000;
    });
    if (!soon.length) quit(`no game kicks off within ${WINDOW_HOURS} hours`);
    const sameGame = (g: (typeof soon)[number], e: PropsMeta['events'][number]) =>
      TEAM_CODES[e.home] === g.home && TEAM_CODES[e.away] === g.away && Math.abs(Date.parse(e.kickoff) - Date.parse(g.kickoff)) < 12 * 3_600_000;
    if (soon.every((g) => fetched.some((e) => sameGame(g, e)))) quit(`all ${soon.length} game(s) within ${WINDOW_HOURS} hours fetched already`);
  }

  const list = await get('/events', { dateFormat: 'iso' });
  if (list.status !== 200 || !Array.isArray(list.body)) quit(`event list failed (HTTP ${list.status})`);
  const events = list.body as OddsEvent[];
  writeFileSync(join(dir!, 'props_events.json'), JSON.stringify(events));

  const cost = PROP_MARKETS.length; // regions=us: one credit per market a book offers
  const credits = list.remaining ?? Number.POSITIVE_INFINITY;
  const due = dueEvents(events, now, mode === 'test' ? Number.POSITIVE_INFINITY : WINDOW_HOURS, done, credits, cost).slice(0, mode === 'test' ? 1 : undefined);
  if (!due.length) quit(`nothing due (${events.length} events listed, ${done.size} fetched before, ${list.remaining ?? '?'} credits left)`);

  const meta: PropsMeta = {
    schemaVersion: 1,
    createdAt: new Date(now).toISOString(),
    ...(mode === 'test' ? { test: true as const } : {}),
    ...(list.last !== undefined ? { eventsCredits: list.last } : {}),
    ...(list.used !== undefined ? { used: list.used } : {}),
    ...(list.remaining !== undefined ? { remaining: list.remaining } : {}),
    events: [],
  };
  for (const ev of due) {
    const r = await get(`/events/${encodeURIComponent(ev.id)}/odds`, { regions: 'us', markets: PROP_MARKETS.join(','), oddsFormat: 'american', dateFormat: 'iso' });
    if (r.used !== undefined) meta.used = r.used;
    if (r.remaining !== undefined) meta.remaining = r.remaining;
    if (r.status !== 200 || !r.body) {
      console.log(`Props: ${ev.away_team} at ${ev.home_team} failed (HTTP ${r.status}).`);
      continue;
    }
    const odds = r.body as OddsEvent;
    writeFileSync(join(dir!, `props_event_${ev.id.replace(/[^A-Za-z0-9_-]/g, '')}.json`), JSON.stringify(odds));
    const books = odds.bookmakers ?? [];
    meta.events.push({
      id: ev.id,
      kickoff: ev.commence_time,
      home: ev.home_team,
      away: ev.away_team,
      ...(r.last !== undefined ? { credits: r.last } : {}),
      books: books.length,
      markets: new Set(books.flatMap((b) => b.markets.map((m) => m.key))).size,
      players: new Set(books.flatMap((b) => b.markets.flatMap((m) => m.outcomes.map((o) => o.description ?? '')))).size,
    });
  }
  if (!meta.events.length) quit('no game fetched');
  writeFileSync(join(dir!, 'props_meta.json'), `${JSON.stringify(meta, null, 1)}\n`);
  const spent = meta.events.reduce((a, e) => a + (e.credits ?? 0), 0) + (meta.eventsCredits ?? 0);
  console.log(`Props: fetched ${meta.events.length} game(s)${meta.test ? ' (test)' : ''}, ${spent} credits; ${meta.remaining ?? '?'} left this month.`);
}

main().catch((e: unknown) => quit(`failed (${(e as Error).name})`));
