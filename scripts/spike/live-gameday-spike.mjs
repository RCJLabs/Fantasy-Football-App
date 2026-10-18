// Spike: live game-day feeds, for the Matchup tab's stat lines, game clock and scoring plays. Polls while games are on,
// from GitHub Actions (the dev sandbox can't reach Sleeper or ESPN):
// - Sleeper's stats endpoint (the Matchup tab's stat lines): does it update during games, how often, and how stale is its
//   CDN copy? Does each copy's newest row `updated_at` tell an older copy (another CDN edge) from a newer one? Does a request
//   with `cache-control: max-age=0` (what a browser sends for `fetch(…, { cache: 'no-cache' })`) get a fresher copy?
// - ESPN's unofficial scoreboard: do its live games move between polls?
// - ESPN's game summary, loaded when a live game's score changes on the scoreboard (as the Matchup tab does): do its scoring
//   plays already reach the scoreboard's score, or trail it?
// Run 39145684454 (2026-10-18, 70 minutes over the 1 pm games) answered the first question; this version adds the others.
// This repo's Actions logs are public, so it prints timings, counts, headers and field names only: no names, stats or play text.
import { createHash } from 'node:crypto';

const UA = 'Fantasy-Football-App spike (+https://github.com/RCJLabs/Fantasy-Football-App)';
const ORIGIN = 'https://ff.rcjlabs.com';
const MINUTES = Math.max(1, Number(process.env.MINUTES) || 50);
const EVERY_MS = 60_000;
const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';
const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
/** A CDN copy at least this old is another edge's (polls are a minute apart). */
const OLD_AGE = 90;

const print = (s = '') => console.log(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const digest = (s) => createHash('sha1').update(s).digest('hex').slice(0, 8);
const keysOf = (objs) => [...new Set(objs.flatMap((o) => (o && typeof o === 'object' && !Array.isArray(o) ? Object.keys(o) : [])))].sort().join(', ') || '—';
const clock = (t) => new Date(t).toISOString().slice(11, 19);
const median = (xs) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : '—');

async function get(url, headers = {}) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA, origin: ORIGIN, ...headers } });
    const text = await r.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    const h = (k) => r.headers.get(k) ?? '';
    return { status: r.status, ms: Date.now() - t0, bytes: Buffer.byteLength(text), hash: digest(text), body, acao: h('access-control-allow-origin'), cache: h('cache-control'), age: h('age'), lastModified: h('last-modified'), etag: h('etag') };
  } catch (e) {
    return { status: `ERR ${e.message}`, ms: Date.now() - t0, bytes: 0, hash: '', body: null, acao: '', cache: '', age: '', lastModified: '', etag: '' };
  }
}

/** Sleeper stat rows: how many carry stats, the sum of PPR points over all of them, and the newest row times (aggregates). */
function sleeperAgg(body) {
  const rows = Array.isArray(body) ? body : [];
  let withStats = 0;
  let pts = 0;
  let newest = 0;
  let newestModified = 0;
  for (const r of rows) {
    const s = r && typeof r.stats === 'object' && r.stats ? r.stats : {};
    if (Object.keys(s).length) withStats++;
    if (typeof s.pts_ppr === 'number') pts += s.pts_ppr;
    if (typeof r?.updated_at === 'number' && r.updated_at > newest) newest = r.updated_at;
    if (typeof r?.last_modified === 'number' && r.last_modified > newestModified) newestModified = r.last_modified;
  }
  return { rows: rows.length, withStats, pts: Math.round(pts), newest, newestModified };
}

/** Live games by event id: their scores ("away-home") and a mark that moves with the clock, down or ball spot. */
function boardGames(body) {
  const out = new Map();
  for (const e of Array.isArray(body?.events) ? body.events : []) {
    const c = e?.competitions?.[0];
    const score = (side) => Number(c?.competitors?.find((t) => t?.homeAway === side)?.score) || 0;
    const s = c?.situation;
    out.set(String(e?.id), { state: e?.status?.type?.state, score: `${score('away')}-${score('home')}`, mark: [e?.status?.period, e?.status?.clock, s?.down, s?.yardLine, s?.possession].join('|') });
  }
  return out;
}

/** A game summary's score by its last scoring play, and by its header (ESPN's own score bug). */
function summaryScores(body) {
  const plays = Array.isArray(body?.scoringPlays) ? body.scoringPlays : [];
  const last = plays.at(-1);
  const byPlays = !plays.length ? '0-0' : typeof last?.awayScore === 'number' && typeof last?.homeScore === 'number' ? `${last.awayScore}-${last.homeScore}` : '?';
  const cs = body?.header?.competitions?.[0]?.competitors ?? [];
  const side = (s) => cs.find((t) => t?.homeAway === s)?.score;
  const byHeader = side('away') != null && side('home') != null ? `${Number(side('away')) || 0}-${Number(side('home')) || 0}` : '?';
  return { byPlays, byHeader, plays: plays.length, headerKeys: keysOf(cs) };
}

/** "behind", "same" or "ahead": a summary's score against the scoreboard's (both "away-home"; totals only ever rise). */
function compare(summary, board) {
  if (summary === '?') return 'unknown';
  const total = (s) => s.split('-').reduce((a, b) => a + Number(b), 0);
  if (summary === board) return 'same';
  return total(summary) < total(board) ? 'behind' : total(summary) > total(board) ? 'ahead' : 'different';
}

async function main() {
  const state = (await get('https://api.sleeper.app/v1/state/nfl')).body ?? {};
  const season = String(state.season ?? new Date().getUTCFullYear());
  const week = Number(state.week) || 1;
  const stats = `https://api.sleeper.com/stats/nfl/${season}/${week}?season_type=regular&${POSITIONS.map((p) => `position[]=${p}`).join('&')}`;
  print('### Live game-day feeds');
  print('');
  print(`Started ${new Date().toISOString()} with \`Origin: ${ORIGIN}\`, polling every ${EVERY_MS / 1000} s for ${MINUTES} min. Season ${season} week ${week}.`);
  print('Metadata and aggregates only: no names, stats or play text. "Newest row" is the newest `updated_at` in the copy, as seconds before the poll.');
  print('');
  const head = '| time (UTC) | Sleeper stats | age | newest row | PPR sum | changed | older than the copy before | `max-age=0`: age · newest row | ESPN live games moved | scores changed → summary |';
  print(head);
  print('|---|---|---|---|---|---|---|---|---|---|');
  const seen = { stats: [], statsCache: new Set(), newest: [], older: { pts: 0, newest: 0, both: 0 }, oldAge: { n: 0, olderNewest: 0 }, fresh: { ages: [], newer: 0, same: 0, older: 0 }, summaries: { same: 0, behind: 0, ahead: 0, different: 0, unknown: 0, headerMatches: 0, n: 0 }, rowKeys: '', tsType: '', validators: new Set() };
  let prev = null; // last plain copy: { hash, pts, newest }
  let prevGames;
  for (let i = 0; i < MINUTES; i++) {
    const t = Date.now();
    const [st, fr, sb] = await Promise.all([get(stats), get(stats, { 'cache-control': 'max-age=0' }), get(`${ESPN}/scoreboard`)]);
    const sa = sleeperAgg(st.body);
    const fa = sleeperAgg(fr.body);
    if (!seen.rowKeys && Array.isArray(st.body) && st.body.length) {
      seen.rowKeys = keysOf(st.body.slice(0, 50));
      seen.tsType = `updated_at ${typeof st.body[0]?.updated_at}, last_modified ${typeof st.body[0]?.last_modified}`;
    }
    seen.statsCache.add(st.cache || '(none)');
    seen.validators.add(`last-modified ${st.lastModified ? 'yes' : 'no'}, etag ${st.etag ? 'yes' : 'no'}`);
    const changed = prev && st.hash && st.hash !== prev.hash;
    if (changed) seen.stats.push(t);
    const before = (x) => (x ? Math.round((t - x) / 1000) : '—');
    if (sa.newest) seen.newest.push(Math.round((t - sa.newest) / 1000));
    // An older copy than the one before: by its PPR sum (rarely falls between real copies) and by its newest row.
    const olderPts = Boolean(prev && changed && sa.pts < prev.pts);
    const olderNewest = Boolean(prev && sa.newest && prev.newest && sa.newest < prev.newest);
    if (olderPts) seen.older.pts++;
    if (olderNewest) seen.older.newest++;
    if (olderPts && olderNewest) seen.older.both++;
    if (Number(st.age) >= OLD_AGE) {
      seen.oldAge.n++;
      if (olderNewest) seen.oldAge.olderNewest++;
    }
    if (fr.age !== '') seen.fresh.ages.push(Number(fr.age));
    if (fa.newest && sa.newest) seen.fresh[fa.newest > sa.newest ? 'newer' : fa.newest < sa.newest ? 'older' : 'same']++;

    // Live games whose clock or ball moved, and those whose score changed since the poll before: load their summaries now.
    const games = boardGames(sb.body);
    let moved = 0;
    const scored = [];
    for (const [id, g] of games) {
      const was = prevGames?.get(id);
      if (g.state !== 'in' || !was) continue;
      if (was.mark !== g.mark) moved++;
      if (was.score !== g.score) scored.push([id, g.score]);
    }
    const verdicts = [];
    for (const [id, score] of scored) {
      const sum = await get(`${ESPN}/summary?event=${id}`);
      const s = summaryScores(sum.body);
      const v = compare(s.byPlays, score);
      seen.summaries[v]++;
      seen.summaries.n++;
      if (s.byHeader === s.byPlays) seen.summaries.headerMatches++;
      if (!seen.headerKeys) seen.headerKeys = s.headerKeys;
      verdicts.push(v);
    }
    const oldMark = olderPts || olderNewest ? `${olderPts ? 'PPR sum' : ''}${olderPts && olderNewest ? ' + ' : ''}${olderNewest ? 'newest row' : ''}` : '';
    print(`| ${clock(t)} | ${st.status} · ${st.bytes} B | ${st.age || '—'} | ${before(sa.newest)} | ${sa.pts} | ${changed ? 'yes' : prev ? 'no' : '—'} | ${oldMark || '—'} | ${fr.age || '—'} · ${before(fa.newest)} | ${prevGames ? moved : '—'} | ${verdicts.join(', ') || '—'} |`);
    if (st.hash) prev = { hash: st.hash, pts: sa.pts, newest: sa.newest };
    prevGames = games;
    if (i < MINUTES - 1) await sleep(Math.max(0, t + EVERY_MS - Date.now()));
  }
  const gaps = (ts) => ts.slice(1).map((x, k) => Math.round((x - ts[k]) / 1000));
  const sm = seen.summaries;
  print('');
  print('#### Summary');
  print('');
  print(`- Sleeper stats: changed in ${seen.stats.length} of ${MINUTES - 1} polls; median seconds between changes: ${median(gaps(seen.stats))}; cache-control: ${[...seen.statsCache].join(', ')}; validators: ${[...seen.validators].join('; ')}`);
  print(`- Row fields: ${seen.rowKeys || '—'}; types: ${seen.tsType || '—'}`);
  print(`- Newest row: median ${median(seen.newest)} s before the poll (min ${seen.newest.length ? Math.min(...seen.newest) : '—'}, max ${seen.newest.length ? Math.max(...seen.newest) : '—'})`);
  print(`- Older copies than the one before: ${seen.older.pts} by PPR sum, ${seen.older.newest} by newest row, ${seen.older.both} by both; copies ${OLD_AGE} s or older (age header): ${seen.oldAge.n}, of which older by newest row: ${seen.oldAge.olderNewest}`);
  print(`- \`cache-control: max-age=0\` requests: median age ${median(seen.fresh.ages)} s; newest row newer than the plain request's in ${seen.fresh.newer}, same in ${seen.fresh.same}, older in ${seen.fresh.older}`);
  print(`- Summaries loaded when a live game's score changed: ${sm.n}; scoring plays reach the scoreboard's score: ${sm.same}; behind it: ${sm.behind}; ahead: ${sm.ahead}; other: ${sm.different + sm.unknown}; header score equals the last scoring play's: ${sm.headerMatches} of ${sm.n}; header competitor fields: ${seen.headerKeys ?? '—'}`);
}

await main();
