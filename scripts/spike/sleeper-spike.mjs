// Phase 0 spikes against live Sleeper endpoints, run from GitHub Actions (the dev sandbox can't reach Sleeper).
// Prints markdown with field names, counts and aggregates only: this repo's Actions logs are public, so no
// third-party values (individual projections, names) are printed.
//   (b) projection coverage by position, row shape, provider ("company")
//   (conv) availability convention: are Questionable/Out players' projections already discounted?
//   (e) are past weeks served, and are they pre-game snapshots?
//   (f) are future weeks projected?
//   (g) stats endpoint shape (for the scoring golden test)
// League checks (c)(h)(i) run on encrypted data from scripts/league/pull.sh instead.
import { gzipSync } from 'node:zlib';

const API = 'https://api.sleeper.app/v1';
const WEB = 'https://api.sleeper.com';
const UA = 'Fantasy-Football-App spike (+https://github.com/RCJLabs/Fantasy-Football-App)';
const POS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB'];
const out = [];
const log = (s = '') => out.push(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, { text = false } = {}) {
  let last = 'ERR';
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': UA } });
      last = r.status;
      if (!r.ok) {
        if (r.status >= 500 || r.status === 429) { await sleep(3000 * (i + 1)); continue; }
        return { status: r.status, body: null, bytes: 0 };
      }
      const t = await r.text();
      return { status: r.status, body: text ? t : JSON.parse(t), bytes: Buffer.byteLength(t) };
    } catch (e) {
      last = `ERR ${e.message}`;
      await sleep(3000 * (i + 1));
    }
  }
  return { status: last, body: null, bytes: 0 };
}

const qs = (positions) => positions.map((p) => `position[]=${p}`).join('&');
const projUrl = (season, week) => `${WEB}/projections/nfl/${season}/${week}?season_type=regular&${qs(POS)}`;
const statsUrl = (season, week) => `${WEB}/stats/nfl/${season}/${week}?season_type=regular&${qs(POS)}`;
const keysOf = (objs) => [...new Set(objs.flatMap((o) => (o && typeof o === 'object' ? Object.keys(o) : [])))].sort();
const hasStats = (r) => !!r && !!r.stats && Object.keys(r.stats).length > 0;
let PLAYERS = {}; // player_id -> players-dump entry (fallback for position / injury status)
const posOf = (r) => r?.player?.position ?? r?.position ?? PLAYERS[r?.player_id]?.position ?? '?';
const statusOf = (r) => r?.player?.injury_status ?? PLAYERS[r?.player_id]?.injury_status ?? 'healthy';
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const median = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const fmt = (x) => (x == null ? '—' : typeof x === 'number' ? String(Math.round(x * 1000) / 1000) : String(x));
const asRows = (res) => (Array.isArray(res.body) ? res.body : []);
const tsFields = ['updated_at', 'last_modified', 'date', 'created'];

async function main() {
  const stateRes = await get(`${API}/state/nfl`);
  const state = stateRes.body ?? {};
  log('### Sleeper `/state/nfl`');
  log('```json');
  log(JSON.stringify(state));
  log('```');
  const season = Number(state.season ?? 2026);
  const week = Number(state.week ?? 6);

  // Players dump first (size and fields; also the fallback for position and injury status below).
  // Sleeper asks for at most one call per day.
  const pl = await get(`${API}/players/nfl`, { text: true });
  if (pl.body) {
    PLAYERS = JSON.parse(pl.body);
    const players = Object.values(PLAYERS);
    log(`### Players dump: HTTP ${pl.status}, ${players.length} players, ${pl.bytes} bytes raw, ${gzipSync(pl.body).length} bytes gzip`);
    log(`- fields: \`${keysOf(players).join(', ')}\``);
    log(`- injury_status counts: \`${JSON.stringify(countBy(players.filter((p) => p.injury_status), (p) => p.injury_status))}\``);
    log(`- practice_participation non-null: ${players.filter((p) => p.practice_participation != null).length}; depth_chart_order non-null: ${players.filter((p) => p.depth_chart_order != null).length}; active with team: ${players.filter((p) => p.active && p.team).length}`);
  } else {
    log(`### Players dump: HTTP ${pl.status}`);
  }
  log('');

  // (b) current-week projections
  const cur = await get(projUrl(season, week));
  const rows = asRows(cur);
  log(`### (b) Projections, week ${week}: HTTP ${cur.status}, ${rows.length} rows, ${cur.bytes} bytes`);
  log(`- row keys: \`${keysOf(rows).join(', ')}\``);
  log(`- \`player\` keys: \`${keysOf(rows.map((r) => r.player)).join(', ')}\``);
  log(`- companies: \`${JSON.stringify(countBy(rows, (r) => r.company ?? 'none'))}\``);
  for (const f of tsFields) {
    const v = rows.map((r) => r[f]).filter((x) => x != null);
    if (v.length) log(`- \`${f}\`: ${v.length} rows, min ${fmtTs(Math.min(...v.map(toMs)))}, max ${fmtTs(Math.max(...v.map(toMs)))}`);
  }
  log('');
  log('| position | rows | with stats | stat keys |');
  log('|---|---|---|---|');
  const byPos = groupBy(rows, posOf);
  for (const [p, rs] of Object.entries(byPos).sort()) {
    log(`| ${p} | ${rs.length} | ${rs.filter(hasStats).length} | \`${keysOf(rs.map((r) => r.stats)).join(' ')}\` |`);
  }
  log('');

  // (conv) availability convention, comparing this week's projection to last week's for the same player.
  const prevRows = asRows(await get(projUrl(season, week - 1)));
  const prevById = new Map(prevRows.map((r) => [r.player_id, r]));
  log(`### (conv) Availability convention (week ${week} vs week ${week - 1}, half-PPR projections)`);
  log('Median ratio of this week to last week, by current injury status. ~1 = projections are conditional on playing; well below 1 = already discounted.');
  log('');
  log('| status | players | median ratio | share projected ≤0.5 pts this week |');
  log('|---|---|---|---|');
  const byStatus = groupBy(rows.filter((r) => ['QB', 'RB', 'WR', 'TE'].includes(posOf(r))), statusOf);
  for (const [s, rs] of Object.entries(byStatus).sort()) {
    const ratios = [];
    let low = 0;
    for (const r of rs) {
      const now = num(r.stats?.pts_half_ppr) ?? 0;
      if (now <= 0.5) low++;
      const before = num(prevById.get(r.player_id)?.stats?.pts_half_ppr);
      if (before != null && before >= 5) ratios.push(now / before);
    }
    log(`| ${s} | ${rs.length} | ${fmt(median(ratios))} (n=${ratios.length}) | ${fmt(low / rs.length)} |`);
  }
  log('');

  // (e) past weeks served? pre-game snapshots or overwritten with actuals?
  log('### (e) Past weeks');
  log('| week | rows | with stats | proj == actual (half-PPR, exact) | corr(proj, actual) | timestamp range |');
  log('|---|---|---|---|---|---|');
  for (let w = 1; w < week; w++) {
    const pr = asRows(await get(projUrl(season, w)));
    const st = asRows(await get(statsUrl(season, w)));
    const actual = new Map(st.map((r) => [r.player_id, num(r.stats?.pts_half_ppr)]));
    let both = 0, equal = 0;
    const xs = [], ys = [];
    for (const r of pr) {
      const p = num(r.stats?.pts_half_ppr), a = actual.get(r.player_id);
      if (p == null || a == null || (p === 0 && a === 0)) continue;
      both++;
      if (Math.abs(p - a) < 1e-9) equal++;
      xs.push(p); ys.push(a);
    }
    const ts = tsFields.flatMap((f) => pr.map((r) => r[f]).filter((x) => x != null)).map(toMs).filter(Number.isFinite);
    const range = ts.length ? `${fmtTs(Math.min(...ts))} → ${fmtTs(Math.max(...ts))}` : '—';
    log(`| ${w} | ${pr.length} | ${pr.filter(hasStats).length} | ${both ? fmt(equal / both) : '—'} (n=${both}) | ${fmt(corr(xs, ys))} | ${range} |`);
  }
  log('');

  // (f) future weeks
  log('### (f) Future weeks');
  log('| week | rows | with stats |');
  log('|---|---|---|');
  for (let w = week + 1; w <= 18; w++) {
    const pr = asRows(await get(projUrl(season, w)));
    log(`| ${w} | ${pr.length} | ${pr.filter(hasStats).length} |`);
  }
  log('');

  // (g) stats endpoint shape
  const stRes = await get(statsUrl(season, week - 1));
  const st = asRows(stRes);
  log(`### (g) Stats, week ${week - 1}: HTTP ${stRes.status}, ${st.length} rows`);
  log(`- row keys: \`${keysOf(st).join(', ')}\``);
  for (const [p, rs] of Object.entries(groupBy(st, posOf)).sort()) {
    log(`- ${p} (${rs.length}): \`${keysOf(rs.map((r) => r.stats)).join(' ')}\``);
  }
  const v1 = await get(`${API}/stats/nfl/regular/${season}/${week - 1}`);
  log(`- v1 path \`/v1/stats/nfl/regular/${season}/${week - 1}\`: HTTP ${v1.status}, ${v1.bytes} bytes, ${v1.body && typeof v1.body === 'object' ? Object.keys(v1.body).length : 0} entries`);
  log('');

  // Trending + schedule shapes
  const tr = asRows(await get(`${API}/players/nfl/trending/add?lookback_hours=24&limit=5`));
  log(`### Trending: ${tr.length} rows, keys \`${keysOf(tr).join(', ')}\``);
  const sch = await get(`${WEB}/schedule/nfl/regular/${season}`);
  const schRows = asRows(sch);
  log(`### Schedule (web): HTTP ${sch.status}, ${schRows.length} rows, keys \`${keysOf(schRows).join(', ')}\``);
  log('');

  console.log(out.join('\n'));
}

function groupBy(xs, f) { const g = {}; for (const x of xs) (g[f(x)] ??= []).push(x); return g; }
function countBy(xs, f) { const c = {}; for (const x of xs) { const k = f(x); c[k] = (c[k] ?? 0) + 1; } return c; }
function toMs(x) { return typeof x === 'number' ? (x < 1e12 ? x * 1000 : x) : Date.parse(x); }
function fmtTs(ms) { return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 16) + 'Z' : '—'; }
function corr(xs, ys) {
  const n = xs.length;
  if (n < 3) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
}

main().catch((e) => { console.log(out.join('\n')); console.log(`\n**Spike crashed:** ${e.stack}`); process.exitCode = 1; });
