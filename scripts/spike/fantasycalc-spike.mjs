// FantasyCalc market values: response shape and coverage for the trade analyzer. Prints field names,
// counts and parameter coverage only (this repo's Actions logs are public; values are FantasyCalc's).
const UA = 'Fantasy-Football-App spike (+https://github.com/RCJLabs/Fantasy-Football-App)';
const out = [];
const log = (s = '') => out.push(s);
const keysOf = (objs) => [...new Set(objs.flatMap((o) => (o && typeof o === 'object' ? Object.keys(o) : [])))].sort();
const countBy = (xs, f) => xs.reduce((c, x) => ((c[f(x)] = (c[f(x)] ?? 0) + 1), c), {});

async function get(url) {
  const r = await fetch(url, { headers: { 'user-agent': UA } });
  const text = await r.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: r.status, bytes: text.length, body };
}

log('### FantasyCalc `/values/current`');
log('');
log('| params | HTTP | bytes | rows | with sleeperId | positions |');
log('|---|---|---|---|---|---|');
let sample = null;
for (const [dynasty, qbs, teams, ppr] of [
  [false, 1, 12, 1],
  [false, 1, 10, 1],
  [false, 1, 12, 0.5],
  [false, 2, 12, 1],
  [true, 1, 12, 1],
  [false, 1, 8, 1],
]) {
  const url = `https://api.fantasycalc.com/values/current?isDynasty=${dynasty}&numQbs=${qbs}&numTeams=${teams}&ppr=${ppr}`;
  const res = await get(url);
  const rows = Array.isArray(res.body) ? res.body : [];
  sample ??= rows.length ? rows : null;
  const withSleeper = rows.filter((r) => r?.player?.sleeperId).length;
  log(`| dynasty=${dynasty} qbs=${qbs} teams=${teams} ppr=${ppr} | ${res.status} | ${res.bytes} | ${rows.length} | ${withSleeper} | \`${JSON.stringify(countBy(rows, (r) => r?.player?.position ?? '?'))}\` |`);
}
log('');
if (sample) {
  log(`- row keys: \`${keysOf(sample).join(', ')}\``);
  log(`- player keys: \`${keysOf(sample.map((r) => r.player)).join(', ')}\``);
  const nums = Object.fromEntries(keysOf(sample).filter((k) => typeof sample[0][k] === 'number').map((k) => [k, true]));
  log(`- numeric fields: \`${Object.keys(nums).join(', ')}\``);
}
console.log(out.join('\n'));
