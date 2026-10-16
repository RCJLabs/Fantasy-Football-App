// Do rest-of-season values come true on average? (docs/ros-uncertainty.md, "Realization")
//
// For each QB/RB/WR/TE projected 5+ (RotoWire via Sleeper, 2022–2025, private history bundle) at anchor weeks 3–12,
// the app's expected points k weeks ahead are this week's projection (a flat rate, as RotoWire's future weeks are)
// times the future-week availability curve, zero on byes. Against what they scored (missed games as zero), the ratio
// of actual to expected points by position and weeks ahead shows how much the values run high: players get hurt
// mid-game, are benched, or are active without playing, none of which the game-day-active curve counts.
// Prints aggregates only, with player-clustered bootstrap intervals.
//
// Usage: tsx scripts/calibrate/ros-realization.ts <history dir>
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HEALTHY_PLAY } from '../../app/src/analysis/ros';
import { mulberry32 } from '../../app/src/analysis/season';
import { scoreStats } from '../../app/src/engine/scoring';
import { played } from '../../pipeline/baseline';
import { LEDGER_SCORING } from '../../pipeline/ledger';

const dir = process.argv[2];
if (!dir) throw new Error('usage: ros-realization.ts <history dir>');
const SEASONS = [2022, 2023, 2024, 2025];
const POS = ['QB', 'RB', 'WR', 'TE'];
const AHEAD = 12;

type Row = { player_id: string; position?: string | null; team?: string | null; stats?: Record<string, number> | null };
const read = (p: string): Row[] => (existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as Row[]) : []);

/** Per player-season: expected and actual points by weeks ahead (index 0 = the fresh week). */
interface Cell {
  key: string;
  pos: string;
  season: number;
  expected: Float64Array;
  actual: Float64Array;
}
const cells: Cell[] = [];
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
  const byPlayer = new Map<string, Cell>();
  for (let a = 3; a <= 12; a++) {
    for (const [id, mu] of proj[a + 1]!) {
      if (mu < 5) continue;
      const home = team.get(`${id}:${a + 1}`);
      const cell = byPlayer.get(id) ?? { key: `${season}:${id}`, pos: pos.get(id)!, season, expected: new Float64Array(AHEAD + 1), actual: new Float64Array(AHEAD + 1) };
      byPlayer.set(id, cell);
      for (let k = 0; k <= AHEAD; k++) {
        const w = a + 1 + k;
        if (w > 17) break;
        if (home && !teams[w]!.has(home)) continue; // bye: expected zero, and he can't score
        const play = k === 0 ? 1 : (HEALTHY_PLAY[Math.min(k, HEALTHY_PLAY.length) - 1] ?? 0.8);
        cell.expected[k] = cell.expected[k]! + play * mu;
        cell.actual[k] = cell.actual[k]! + (act[w]!.get(id) ?? 0);
      }
    }
  }
  cells.push(...byPlayer.values());
}

const ratio = (cs: readonly Cell[], k: number) => cs.reduce((x, c) => x + c.actual[k]!, 0) / cs.reduce((x, c) => x + c.expected[k]!, 0);
const pooled = (cs: readonly Cell[], from: number, to: number) => {
  let a = 0;
  let e = 0;
  for (const c of cs) for (let k = from; k <= to; k++) {
    a += c.actual[k]!;
    e += c.expected[k]!;
  }
  return a / e;
};
const rand = mulberry32(20261016);
const interval = (cs: readonly Cell[], stat: (s: readonly Cell[]) => number) => {
  const xs: number[] = [];
  for (let b = 0; b < 400; b++) xs.push(stat(Array.from({ length: cs.length }, () => cs[Math.floor(rand() * cs.length)]!)));
  xs.sort((p, q) => p - q);
  return [xs[10]!, xs[389]!] as const;
};

console.log(`## Do rest-of-season values come true? Actual ÷ expected points, ${SEASONS[0]}–${SEASONS.at(-1)} (${cells.length} player-seasons)\n`);
console.log('| pos | this week | 1 ahead | 2 | 4 | 8 | 12 | weeks 1–12 pooled (95% CI) | 2022–23 | 2024–25 |');
console.log('|---|---|---|---|---|---|---|---|---|---|');
for (const p of POS) {
  const cs = cells.filter((c) => c.pos === p);
  const ci = interval(cs, (s) => pooled(s, 1, AHEAD));
  const f = (x: number) => x.toFixed(3);
  console.log(
    `| ${p} | ${f(ratio(cs, 0))} | ${f(ratio(cs, 1))} | ${f(ratio(cs, 2))} | ${f(ratio(cs, 4))} | ${f(ratio(cs, 8))} | ${f(ratio(cs, 12))} | ${f(pooled(cs, 1, AHEAD))} (${f(ci[0])}–${f(ci[1])}) | ${f(pooled(cs.filter((c) => c.season <= 2023), 1, AHEAD))} | ${f(pooled(cs.filter((c) => c.season >= 2024), 1, AHEAD))} |`,
  );
}
const all = pooled(cells, 1, AHEAD);
console.log(`\nAll positions, weeks 1–12: ${all.toFixed(3)}.`);
