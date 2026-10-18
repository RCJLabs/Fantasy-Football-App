// Spike: ESPN's game summary, for scoring plays of the app's players (game-day idea 7). Run from GitHub Actions during
// games (the dev sandbox can't reach ESPN). Can scoring plays be tied to players? The plays carry no athlete ids at the
// top level, so this checks whether the box score's athletes (ESPN id → name) name them in the play text, and whether
// plays carry participants with ids anywhere. Public log: counts, field names and category labels only; no names or text.
const UA = 'Fantasy-Football-App spike (+https://github.com/RCJLabs/Fantasy-Football-App)';
const ORIGIN = 'https://ff.rcjlabs.com';
const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';
const MAX_GAMES = 4;

const print = (s = '') => console.log(s);
const keysOf = (objs) => [...new Set(objs.flatMap((o) => (o && typeof o === 'object' && !Array.isArray(o) ? Object.keys(o) : [])))].sort().join(', ') || '—';
const count = (xs) => Object.entries(xs.reduce((m, x) => ((m[x] = (m[x] ?? 0) + 1), m), {})).map(([k, n]) => `${k} ${n}`).join(', ') || '—';
const median = (xs) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : '—');

async function get(url) {
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA, origin: ORIGIN } });
    const text = await r.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    return { status: r.status, bytes: Buffer.byteLength(text), acao: r.headers.get('access-control-allow-origin') ?? '', encoding: r.headers.get('content-encoding') ?? '', body };
  } catch (e) {
    return { status: `ERR ${e.message}`, bytes: 0, acao: '', encoding: '', body: null };
  }
}

/** Paths (array elements merged) to keys named `id` under an `athlete`, over every element, not just the first. */
function athleteIdPaths(obj, prefix = '', out = new Map(), depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 7) return out;
  if (Array.isArray(obj)) {
    for (const x of obj) athleteIdPaths(x, `${prefix}[]`, out, depth + 1);
    return out;
  }
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (k === 'id' && /athlete/i.test(prefix) && /^\d+$/.test(String(v))) out.set(path, (out.get(path) ?? 0) + 1);
    if (v && typeof v === 'object') athleteIdPaths(v, path, out, depth + 1);
  }
  return out;
}

async function main() {
  print('### ESPN game summary: scoring plays and players');
  print('');
  print(`Checked ${new Date().toISOString()} with \`Origin: ${ORIGIN}\`. Counts and field names only.`);
  print('');
  const board = (await get(`${ESPN}/scoreboard`)).body;
  const events = (board?.events ?? []).filter((e) => ['in', 'post'].includes(e?.status?.type?.state)).slice(0, MAX_GAMES);
  print(`Games under way or over on the scoreboard: ${events.length} checked (states: ${count(events.map((e) => e.status.type.state))}).`);
  print('');
  for (const [n, e] of events.entries()) {
    const res = await get(`${ESPN}/summary?event=${e.id}`);
    const s = res.body ?? {};
    print(`#### Game ${n + 1} (${e.status.type.state}, period ${e.status.period})`);
    print('');
    print(`- HTTP ${res.status}, ${res.bytes} bytes decoded (content-encoding: \`${res.encoding || 'none'}\`), CORS \`${res.acao || '(none)'}\``);
    // Box score athletes: ESPN id → names, by stat category.
    const athletes = new Map();
    const groups = [];
    for (const team of s.boxscore?.players ?? []) {
      for (const stat of team.statistics ?? []) {
        groups.push(stat.name ?? '?');
        for (const a of stat.athletes ?? []) if (a?.athlete?.id) athletes.set(String(a.athlete.id), a.athlete);
      }
    }
    print(`- box score: ${(s.boxscore?.players ?? []).length} teams; stat groups ${count(groups)}; ${athletes.size} athletes with ids; athlete keys: ${keysOf([...athletes.values()])}`);
    const names = [...athletes.values()].map((a) => ({ full: a.displayName ?? '', short: a.shortName ?? '' })).filter((a) => a.full);
    // Scoring plays naming a box-score athlete.
    const scoring = s.scoringPlays ?? [];
    const named = scoring.map((p) => names.filter((a) => (p.text ?? '').includes(a.full)).length);
    const shortNamed = scoring.map((p) => names.filter((a) => a.short && (p.text ?? '').includes(a.short)).length);
    print(`- scoring plays: ${scoring.length}; types ${count(scoring.map((p) => p.type?.abbreviation ?? '?'))}; scoring types ${count(scoring.map((p) => p.scoringType?.abbreviation ?? '?'))}`);
    print(`  - naming at least one box-score athlete by full name: ${named.filter((k) => k > 0).length}; by short name: ${shortNamed.filter((k) => k > 0).length}; athletes named per play, median ${median(named)}`);
    print(`  - text length median ${median(scoring.map((p) => (p.text ?? '').length))}; with " pass from ": ${scoring.filter((p) => / pass from /i.test(p.text ?? '')).length}; with "Field Goal": ${scoring.filter((p) => /field goal/i.test(p.text ?? '')).length}`);
    // Plays: participants with ids anywhere?
    const plays = [...(s.drives?.previous ?? []).flatMap((d) => d?.plays ?? []), ...(s.drives?.current?.plays ?? [])];
    const ids = athleteIdPaths(plays);
    print(`- plays: ${plays.length}; keys ${keysOf(plays)}`);
    print(`  - with participants: ${plays.filter((p) => Array.isArray(p.participants) && p.participants.length).length}; participant keys ${keysOf(plays.flatMap((p) => p.participants ?? []))}`);
    print(`  - teamParticipants keys ${keysOf(plays.flatMap((p) => p.teamParticipants ?? []))}`);
    print(`  - athlete id paths: ${[...ids].map(([p, k]) => `${p} (${k})`).join(', ') || '—'}`);
    print(`  - scoring plays among them: ${plays.filter((p) => p.scoringPlay).length}; naming a box-score athlete: ${plays.filter((p) => p.scoringPlay && names.some((a) => (p.text ?? '').includes(a.full))).length}`);
    print('');
  }
}

await main();
