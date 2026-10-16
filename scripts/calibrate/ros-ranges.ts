// Calibrate ranges on rest-of-season points (docs/ros-uncertainty.md): how wide must they be to hold the truth?
//
// For each QB/RB/WR/TE projected 5+ (RotoWire via Sleeper, 2022–2025, private history bundle) at anchor weeks, the
// predicted rest-of-season total is the app's: this week's projection as a flat rate, zero on byes, times the
// future-week availability curve. Its variance is the app's weekly variance (inactive or a spread around the
// projection, independent weeks) plus a season-long miss: a fixed offset of the expected points from next week on,
// fitted by maximum likelihood (a random walk is fitted too, for comparison). Missed games count as zero. Prints
// aggregates only; ROS_OFFSET in app/src/analysis/ros.ts comes from here.
//
// Usage: tsx scripts/calibrate/ros-ranges.ts <history dir>
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HEALTHY_PLAY } from '../../app/src/analysis/ros';
import { scoreStats } from '../../app/src/engine/scoring';
import { playerDist, pointSd } from '../../app/src/engine/winprob';
import { played } from '../../pipeline/baseline';
import { LEDGER_SCORING } from '../../pipeline/ledger';

const dir = process.argv[2];
if (!dir) throw new Error('usage: ros-ranges.ts <history dir>');
const SEASONS = [2022, 2023, 2024, 2025];
const POS = ['QB', 'RB', 'WR', 'TE'];
const HORIZONS = [4, 8, 12];
const Z80 = 1.2816;

type Row = { player_id: string; position?: string | null; team?: string | null; stats?: Record<string, number> | null };
const read = (p: string): Row[] => (existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as Row[]) : []);

interface Sample {
  pos: string;
  horizon: number;
  season: number;
  error: number;
  /** Variance without drift, and the drift's multiplier (variance = base + d² × driftUnit). */
  base: number;
  driftUnit: number;
  /** A fixed offset's multiplier: the squared expected total from next week on (variance = base + f² × offsetUnit). */
  offsetUnit: number;
}

const samples: Sample[] = [];
for (const season of SEASONS) {
  const proj: Array<Map<string, number>> = [];
  const act: Array<Map<string, number | null>> = [];
  const teams: Array<Set<string>> = [];
  const pos = new Map<string, string>();
  const team = new Map<string, string>();
  for (let w = 1; w <= 18; w++) {
    const ww = String(w).padStart(2, '0');
    proj[w] = new Map();
    act[w] = new Map();
    teams[w] = new Set();
    for (const r of read(join(dir, String(season), `proj_w${ww}.json`))) {
      if (r.team) teams[w]!.add(r.team);
      if (!r.position || !POS.includes(r.position) || !r.stats) continue;
      proj[w]!.set(r.player_id, scoreStats(r.stats, LEDGER_SCORING));
      pos.set(r.player_id, r.position);
      if (r.team) team.set(`${r.player_id}:${w}`, r.team);
    }
    for (const r of read(join(dir, String(season), `stats_w${ww}.json`))) act[w]!.set(r.player_id, played(r.stats) ? scoreStats(r.stats!, LEDGER_SCORING) : null);
  }
  for (let a = 3; a <= 12; a++) {
    for (const [id, mu] of proj[a + 1]!) {
      if (mu < 5) continue;
      const p = pos.get(id)!;
      const home = team.get(`${id}:${a + 1}`);
      for (const H of HORIZONS) {
        if (a + H > 17) continue;
        let predicted = 0;
        let actual = 0;
        let base = 0;
        const ev: number[] = [];
        for (let k = 0; k < H; k++) {
          const w = a + 1 + k;
          const onBye = !!home && !teams[w]!.has(home);
          const play = k === 0 ? 1 : (HEALTHY_PLAY[Math.min(k, HEALTHY_PLAY.length) - 1] ?? 0.8);
          const d = onBye ? { mean: 0, variance: 0 } : playerDist(mu, play, pointSd(p, mu));
          ev.push(d.mean);
          predicted += d.mean;
          base += d.variance;
          actual += act[w]!.get(id) ?? 0;
        }
        // Drift from next week on: week k's level is the sum of steps 1..k, each with SD d × rate.
        let driftUnit = 0;
        for (let j = 1; j < H; j++) {
          let tail = 0;
          for (let k = j; k < H; k++) tail += ev[k]!;
          driftUnit += tail * tail;
        }
        const later = ev.slice(1).reduce((x, v) => x + v, 0);
        samples.push({ pos: p, horizon: H, season, error: actual - predicted, base, driftUnit, offsetUnit: later * later });
      }
    }
  }
}

// Errors are centered by position and horizon: the app's totals run high (more missed games and benchings than the
// availability curve expects), but a trade's change compares players with the same lean, so ranges sit on the change.
const groupMean = new Map<string, number>();
for (const p of POS) {
  for (const H of HORIZONS) {
    const ss = samples.filter((x) => x.pos === p && x.horizon === H);
    groupMean.set(`${p}:${H}`, ss.reduce((t, x) => t + x.error, 0) / ss.length);
  }
}
const centered = samples.map((x) => ({ ...x, error: x.error - groupMean.get(`${x.pos}:${x.horizon}`)! }));
const variance = (q: Sample, f: number, d: number) => q.base + f * f * q.offsetUnit + d * d * q.driftUnit;
const cov = (ss: readonly Sample[], f: number, d: number) => ss.filter((q) => Math.abs(q.error) <= Z80 * Math.sqrt(variance(q, f, d))).length / ss.length;
const ll = (ss: readonly Sample[], f: number, d: number) =>
  ss.reduce((x, q) => {
    const v = variance(q, f, d);
    return x - 0.5 * (Math.log(v) + (q.error * q.error) / v);
  }, 0) / ss.length;
const steps = Array.from({ length: 81 }, (_, i) => i / 100);
const best = (score: (f: number, d: number) => number, fs: readonly number[], ds: readonly number[]) => {
  let out = { f: 0, d: 0, ll: -Infinity };
  for (const f of fs) for (const d of ds) {
    const l = score(f, d);
    if (l > out.ll) out = { f, d, ll: l };
  }
  return out;
};
const offset = best((f, d) => ll(centered, f, d), steps, [0]);
const walk = best((f, d) => ll(centered, f, d), [0], steps);
const both = best((f, d) => ll(centered, f, d), steps, steps.slice(0, 21));
const early = centered.filter((x) => x.season <= 2023);
const late = centered.filter((x) => x.season >= 2024);
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

console.log(`## Ranges on rest-of-season points: ${samples.length} player-anchors, ${SEASONS[0]}–${SEASONS.at(-1)}\n`);
console.log(`Fixed offset (maximum likelihood): ${offset.f} of the expected points from next week on. 80% ranges hold ${pct(cov(centered, offset.f, 0))}; ${pct(cov(early, offset.f, 0))} on 2022–23 and ${pct(cov(late, offset.f, 0))} on 2024–25.\n`);
console.log('| pos | weeks | n | mean error | SD of error | app SD, no offset | 80% held, no offset | with the offset |');
console.log('|---|---|---|---|---|---|---|---|');
for (const p of POS) {
  for (const H of HORIZONS) {
    const raw = samples.filter((x) => x.pos === p && x.horizon === H);
    const ss = centered.filter((x) => x.pos === p && x.horizon === H);
    const m = groupMean.get(`${p}:${H}`)!;
    const sd = Math.sqrt(ss.reduce((t, x) => t + x.error ** 2, 0) / ss.length);
    const appSd = Math.sqrt(raw.reduce((t, x) => t + x.base, 0) / raw.length);
    console.log(`| ${p} | ${H} | ${ss.length} | ${m.toFixed(1)} | ${sd.toFixed(1)} | ${appSd.toFixed(1)} | ${pct(cov(ss, 0, 0))} | ${pct(cov(ss, offset.f, 0))} |`);
  }
}
console.log(`\n### Shape (maximum likelihood on centered errors)\n`);
console.log(`- fixed offset: ${offset.f}, log-likelihood ${offset.ll.toFixed(4)}`);
console.log(`- random walk from next week: ${walk.d} a week, log-likelihood ${walk.ll.toFixed(4)}`);
console.log(`- both: offset ${both.f}, walk ${both.d}, log-likelihood ${both.ll.toFixed(4)}\n`);
console.log('| weeks | 80% held: offset | walk |');
console.log('|---|---|---|');
for (const H of HORIZONS) {
  const ss = centered.filter((x) => x.horizon === H);
  console.log(`| ${H} | ${pct(cov(ss, offset.f, 0))} | ${pct(cov(ss, 0, walk.d))} |`);
}
