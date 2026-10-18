// Spike: ESPN's unofficial news endpoints, for recent news in the app's player details (fetched in the browser,
// never republished). Run from GitHub Actions: the dev sandbox can't reach ESPN. Prints status, CORS headers, field
// names, counts, dates and lengths only. This repo's Actions logs are public, so no headlines or text are printed.
const UA = 'Fantasy-Football-App spike (+https://github.com/RCJLabs/Fantasy-Football-App)';
const ORIGIN = 'https://ff.rcjlabs.com';
const SITE = 'https://site.api.espn.com/apis';
// Fallback athlete ids for the per-player checks, in case the feeds name none (ESPN ids, as in Sleeper's espn_id).
const FALLBACK_IDS = ['3139477', '4262921'];

const out = [];
const log = (s = '') => out.push(s);

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
    return {
      status: r.status,
      acao: r.headers.get('access-control-allow-origin') ?? '',
      cache: r.headers.get('cache-control') ?? '',
      bytes: Buffer.byteLength(text),
      body,
    };
  } catch (e) {
    return { status: `ERR ${e.message}`, acao: '', cache: '', bytes: 0, body: null };
  }
}

/** The array of news items in a response, wherever it sits (feed, articles, items, news, ...). */
function itemsOf(body) {
  if (!body || typeof body !== 'object') return { key: '', items: [] };
  if (Array.isArray(body)) return { key: '(root)', items: body };
  for (const [k, v] of Object.entries(body)) {
    if (Array.isArray(v) && v.length && typeof v[0] === 'object' && v[0] && ('headline' in v[0] || 'title' in v[0])) return { key: k, items: v };
  }
  for (const [k, v] of Object.entries(body)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const inner = itemsOf(v);
      if (inner.items.length) return { key: `${k}.${inner.key}`, items: inner.items };
    }
  }
  return { key: '', items: [] };
}

const keysOf = (objs) => [...new Set(objs.flatMap((o) => (o && typeof o === 'object' ? Object.keys(o) : [])))].sort();
const median = (xs) => {
  if (!xs.length) return '—';
  const s = [...xs].sort((a, b) => a - b);
  return String(s[Math.floor(s.length / 2)]);
};
const count = (xs) => Object.entries(xs.reduce((m, x) => ((m[x] = (m[x] ?? 0) + 1), m), {})).map(([k, n]) => `${k} ${n}`).join(', ') || '—';
const str = (x) => (typeof x === 'string' ? x : '');
const host = (u) => {
  try {
    return new URL(u).host;
  } catch {
    return '';
  }
};

/** Paths inside an item whose key names an athlete or player id, with how often each holds a numeric id. */
function idPaths(item, prefix = '', out = new Map()) {
  if (!item || typeof item !== 'object') return out;
  for (const [k, v] of Object.entries(item)) {
    const path = prefix ? `${prefix}.${Array.isArray(item) ? '[]' : k}` : k;
    if (/^(athleteId|playerId|athlete_id|player_id|id)$/i.test(k) && /athlete|player/i.test(path) && /^\d+$/.test(String(v))) out.set(path, String(v));
    if (v && typeof v === 'object') idPaths(v, Array.isArray(item) ? `${prefix}[]` : path, out);
  }
  return out;
}

function describe(label, url, res) {
  const { key, items } = itemsOf(res.body);
  log(`#### ${label}`);
  log('');
  log(`- \`${url.replace(/\d{6,}/, '{id}')}\``);
  log(`- HTTP ${res.status}, ${res.bytes} bytes; access-control-allow-origin: \`${res.acao || '(none)'}\`; cache-control: \`${res.cache || '(none)'}\``);
  if (res.body && typeof res.body === 'object') log(`- top-level keys: ${keysOf([res.body]).join(', ') || '—'}`);
  log(`- items at \`${key || '(none found)'}\`: ${items.length}`);
  if (items.length) {
    log(`- item keys: ${keysOf(items).join(', ')}`);
    const dates = items.map((i) => Date.parse(str(i.published) || str(i.lastModified) || str(i.date))).filter(Number.isFinite);
    if (dates.length) log(`- published: newest ${new Date(Math.max(...dates)).toISOString()}, oldest ${new Date(Math.min(...dates)).toISOString()}`);
    log(`- type: ${count(items.map((i) => str(i.type) || '(none)'))}`);
    log(`- headline length, median: ${median(items.map((i) => str(i.headline || i.title).length))}; description length, median: ${median(items.map((i) => str(i.description).length))}; with story text: ${items.filter((i) => str(i.story)).length}`);
    log(`- link hosts: ${count(items.map((i) => host(str(i.links?.web?.href) || str(i.link) || str(i.url)) || '(none)'))}`);
    log(`- link keys: ${keysOf(items.map((i) => i.links)).join(', ') || '—'}`);
    const paths = new Map();
    for (const i of items) for (const [p] of idPaths(i)) paths.set(p, (paths.get(p) ?? 0) + 1);
    log(`- athlete/player id paths: ${[...paths].map(([p, n]) => `${p} (${n})`).join(', ') || '—'}`);
  }
  log('');
  return items;
}

async function main() {
  log('### ESPN player news (unofficial endpoints)');
  log('');
  log(`Checked ${new Date().toISOString()} with \`Origin: ${ORIGIN}\`. Metadata only: no headlines or text.`);
  log('');
  const ids = new Map();
  for (const [label, url] of [
    ['Fantasy news, all players', `${SITE}/fantasy/v2/games/ffl/news/players?limit=50`],
    ['NFL news', `${SITE}/site/v2/sports/football/nfl/news?limit=50`],
  ]) {
    const items = describe(label, url, await get(url));
    for (const i of items) for (const [, id] of idPaths(i)) ids.set(id, (ids.get(id) ?? 0) + 1);
  }
  const top = [...ids].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([id]) => id);
  const picked = top.length ? top : FALLBACK_IDS;
  log(`Per-player checks use ${top.length ? 'the ids most named in the feeds above' : 'fallback ids'} (${picked.length}).`);
  log('');
  for (const [n, id] of picked.entries()) {
    for (const [label, url] of [
      [`Fantasy news, player ${n + 1}`, `${SITE}/fantasy/v2/games/ffl/news/players?limit=10&playerId=${id}`],
      [`Athlete news (common v3), player ${n + 1}`, `${SITE}/common/v3/sports/football/nfl/athletes/${id}/news?limit=10`],
      [`NFL news by athlete, player ${n + 1}`, `${SITE}/site/v2/sports/football/nfl/news?athlete=${id}&limit=10`],
    ])
      describe(label, url, await get(url));
  }
  console.log(out.join('\n'));
}

await main();
