// Spike: live game-day feeds, for the Matchup tab's live play feed and game clock. Polls while games are on, from GitHub
// Actions (the dev sandbox can't reach Sleeper or ESPN):
// - Sleeper's stats endpoint (the Matchup tab's stat lines): does it update during games, how often, how stale is its CDN copy?
// - ESPN's unofficial scoreboard: may browsers read it, and does it carry period, clock, possession and red-zone state?
// - ESPN's game summary: may browsers read it, and do its plays carry ESPN athlete ids?
// This repo's Actions logs are public, so it prints timings, counts, headers and field names only: no names, stats or play text.
import { createHash } from 'node:crypto';

const UA = 'Fantasy-Football-App spike (+https://github.com/RCJLabs/Fantasy-Football-App)';
const ORIGIN = 'https://ff.rcjlabs.com';
const MINUTES = Math.max(1, Number(process.env.MINUTES) || 50);
const EVERY_MS = 60_000;
const SUMMARY_EVERY = 10; // polls between game-summary checks
const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';
const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

const print = (s = '') => console.log(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const digest = (s) => createHash('sha1').update(s).digest('hex').slice(0, 8);
const keysOf = (objs) => [...new Set(objs.flatMap((o) => (o && typeof o === 'object' && !Array.isArray(o) ? Object.keys(o) : [])))].sort().join(', ') || '—';
const clock = (t) => new Date(t).toISOString().slice(11, 19);
const count = (xs) => Object.entries(xs.reduce((m, x) => ((m[x] = (m[x] ?? 0) + 1), m), {})).map(([k, n]) => `${k} ${n}`).join(', ') || '—';

async function get(url) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA, origin: ORIGIN } });
    const text = await r.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    const h = (k) => r.headers.get(k) ?? '';
    return { status: r.status, ms: Date.now() - t0, bytes: Buffer.byteLength(text), hash: digest(text), body, acao: h('access-control-allow-origin'), cache: h('cache-control'), age: h('age') };
  } catch (e) {
    return { status: `ERR ${e.message}`, ms: Date.now() - t0, bytes: 0, hash: '', body: null, acao: '', cache: '', age: '' };
  }
}

/** Sleeper stat rows: how many carry stats, and the sum of PPR points over all of them (an aggregate). */
function sleeperAgg(body) {
  const rows = Array.isArray(body) ? body : [];
  let withStats = 0;
  let pts = 0;
  for (const r of rows) {
    const s = r && typeof r.stats === 'object' && r.stats ? r.stats : {};
    if (Object.keys(s).length) withStats++;
    if (typeof s.pts_ppr === 'number') pts += s.pts_ppr;
  }
  return { rows: rows.length, withStats, pts: Math.round(pts) };
}

/** Scoreboard games by state, and how many live ones moved (period, clock, down or ball spot) since the last poll. */
function boardAgg(body, prev) {
  const events = Array.isArray(body?.events) ? body.events : [];
  const marks = new Map();
  const out = { events: events.length, states: count(events.map((e) => e?.status?.type?.state ?? '?')), live: 0, situation: 0, possession: 0, redZone: 0, moved: 0, marks };
  for (const e of events) {
    const c = e?.competitions?.[0];
    const s = c?.situation;
    const mark = [e?.status?.period, e?.status?.clock, s?.down, s?.yardLine, s?.possession].join('|');
    marks.set(e?.id, mark);
    if (e?.status?.type?.state !== 'in') continue;
    out.live++;
    if (s) out.situation++;
    if (s?.possession) out.possession++;
    if (s?.isRedZone) out.redZone++;
    if (prev?.has(e?.id) && prev.get(e?.id) !== mark) out.moved++;
  }
  return out;
}

/** Paths in an object whose key names an athlete id, e.g. `participants[].athlete.id`. */
function athletePaths(obj, prefix = '', out = new Set(), depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 6) return out;
  for (const [k, v] of Object.entries(obj)) {
    const path = Array.isArray(obj) ? `${prefix}[]` : prefix ? `${prefix}.${k}` : k;
    if (k === 'id' && /athlete/i.test(prefix) && /^\d+$/.test(String(v))) out.add(path);
    if (v && typeof v === 'object') athletePaths(v, path, out, depth + 1);
    if (Array.isArray(obj)) break; // one element stands for the rest
  }
  return out;
}

function describeBoard(body) {
  const events = Array.isArray(body?.events) ? body.events : [];
  const live = events.find((e) => e?.status?.type?.state === 'in') ?? events[0];
  const c = live?.competitions?.[0];
  print('#### Scoreboard fields');
  print('');
  print(`- top level: ${keysOf([body])}; week: ${body?.week?.number ?? '—'}, season type: ${body?.season?.type ?? '—'}`);
  print(`- event: ${keysOf([live])}`);
  print(`- status: ${keysOf([live?.status])}; status.type: ${keysOf([live?.status?.type])}; status.clock is a ${typeof live?.status?.clock}`);
  print(`- status names: ${count(events.map((e) => e?.status?.type?.name ?? '?'))}`);
  print(`- competition: ${keysOf([c])}`);
  print(`- situation: ${keysOf([c?.situation])}`);
  print(`- competitor: ${keysOf(c?.competitors ?? [])}; team: ${keysOf((c?.competitors ?? []).map((t) => t?.team))}`);
  print(`- team abbreviations: ${[...new Set(events.flatMap((e) => (e?.competitions?.[0]?.competitors ?? []).map((t) => t?.team?.abbreviation)))].filter(Boolean).sort().join(' ')}`);
  print('');
}

async function checkSummary(eventId) {
  const res = await get(`${ESPN}/summary?event=${eventId}`);
  const b = res.body;
  const scoring = Array.isArray(b?.scoringPlays) ? b.scoringPlays : [];
  const drives = b?.drives;
  const plays = [...(drives?.previous ?? []).flatMap((d) => d?.plays ?? []), ...(drives?.current?.plays ?? [])];
  print(`#### Game summary at ${clock(Date.now())}`);
  print('');
  print(`- \`${ESPN}/summary?event={id}\`: HTTP ${res.status}, ${res.bytes} bytes, ${res.ms} ms; access-control-allow-origin: \`${res.acao || '(none)'}\`; cache-control: \`${res.cache || '(none)'}\``);
  print(`- top level: ${keysOf([b])}`);
  print(`- scoring plays: ${scoring.length}; keys: ${keysOf(scoring)}; type: ${keysOf(scoring.map((p) => p?.type))}; scoringType: ${keysOf(scoring.map((p) => p?.scoringType))}`);
  print(`- scoring play athlete id paths: ${[...athletePaths(scoring)].join(', ') || '—'}`);
  print(`- drives: ${keysOf([drives])}; previous: ${drives?.previous?.length ?? 0}; current: ${drives?.current ? 'yes' : 'no'}; plays: ${plays.length}`);
  print(`- play keys: ${keysOf(plays)}; play type: ${keysOf(plays.map((p) => p?.type))}; play types: ${count(plays.map((p) => p?.type?.abbreviation ?? p?.type?.text ?? '?')).slice(0, 400)}`);
  print(`- play athlete id paths: ${[...athletePaths(plays)].join(', ') || '—'}`);
  print(`- win probability rows: ${Array.isArray(b?.winprobability) ? b.winprobability.length : 0}; keys: ${keysOf(b?.winprobability ?? [])}`);
  print('');
}

async function main() {
  const state = (await get('https://api.sleeper.app/v1/state/nfl')).body ?? {};
  const season = String(state.season ?? new Date().getUTCFullYear());
  const week = Number(state.week) || 1;
  const stats = `https://api.sleeper.com/stats/nfl/${season}/${week}?season_type=regular&${POSITIONS.map((p) => `position[]=${p}`).join('&')}`;
  print('### Live game-day feeds');
  print('');
  print(`Started ${new Date().toISOString()} with \`Origin: ${ORIGIN}\`, polling every ${EVERY_MS / 1000} s for ${MINUTES} min. Season ${season} week ${week}.`);
  print('Metadata and aggregates only: no names, stats or play text.');
  print('');
  print('| time (UTC) | Sleeper stats | age | rows with stats | PPR sum | changed | ESPN scoreboard | games by state | live: situation / possession / red zone | live games moved |');
  print('|---|---|---|---|---|---|---|---|---|---|');
  const seen = { stats: [], board: [], acao: new Set(), boardAcao: new Set(), statsCache: new Set(), boardCache: new Set() };
  let prevStats = '';
  let prevMarks;
  let described = false;
  let summaries = 0;
  const polls = MINUTES;
  for (let i = 0; i < polls; i++) {
    const t = Date.now();
    const [st, sb] = await Promise.all([get(stats), get(`${ESPN}/scoreboard`)]);
    const sa = sleeperAgg(st.body);
    const ba = boardAgg(sb.body, prevMarks);
    const changed = prevStats !== '' && st.hash !== prevStats;
    if (changed) seen.stats.push(t);
    if (ba.moved) seen.board.push(t);
    seen.acao.add(st.acao || '(none)');
    seen.boardAcao.add(sb.acao || '(none)');
    seen.statsCache.add(st.cache || '(none)');
    seen.boardCache.add(sb.cache || '(none)');
    print(`| ${clock(t)} | ${st.status} · ${st.bytes} B | ${st.age || '—'} | ${sa.withStats}/${sa.rows} | ${sa.pts} | ${changed ? 'yes' : prevStats ? 'no' : '—'} | ${sb.status} · ${sb.bytes} B | ${ba.states} | ${ba.situation} / ${ba.possession} / ${ba.redZone} of ${ba.live} | ${prevMarks ? ba.moved : '—'} |`);
    prevStats = st.hash || prevStats;
    prevMarks = ba.marks;
    const live = (Array.isArray(sb.body?.events) ? sb.body.events : []).find((e) => e?.status?.type?.state === 'in');
    if ((live && !described) || (i === polls - 1 && !described && sb.body)) {
      print('');
      describeBoard(sb.body);
      described = Boolean(live);
      print('| time (UTC) | Sleeper stats | age | rows with stats | PPR sum | changed | ESPN scoreboard | games by state | live: situation / possession / red zone | live games moved |');
      print('|---|---|---|---|---|---|---|---|---|---|');
    }
    if (live && summaries * SUMMARY_EVERY <= i && summaries < 3) {
      print('');
      await checkSummary(live.id);
      summaries++;
      print('| time (UTC) | Sleeper stats | age | rows with stats | PPR sum | changed | ESPN scoreboard | games by state | live: situation / possession / red zone | live games moved |');
      print('|---|---|---|---|---|---|---|---|---|---|');
    }
    if (i < polls - 1) await sleep(Math.max(0, t + EVERY_MS - Date.now()));
  }
  const gaps = (ts) => ts.slice(1).map((x, k) => Math.round((x - ts[k]) / 1000));
  const median = (xs) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : '—');
  print('');
  print('#### Summary');
  print('');
  print(`- Sleeper stats: changed in ${seen.stats.length} of ${polls - 1} polls; median seconds between changes: ${median(gaps(seen.stats))}; access-control-allow-origin: ${[...seen.acao].join(', ')}; cache-control: ${[...seen.statsCache].join(', ')}`);
  print(`- ESPN scoreboard: live games moved in ${seen.board.length} of ${polls - 1} polls; median seconds between moves: ${median(gaps(seen.board))}; access-control-allow-origin: ${[...seen.boardAcao].join(', ')}; cache-control: ${[...seen.boardCache].join(', ')}`);
}

await main();
