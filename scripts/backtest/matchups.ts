// Backtest: does a defense-vs-position adjustment add anything beyond RotoWire's own projection? (docs/matchups-gate.md)
//
// For each regular-season week from 4 on (2022–2025, private history bundle), each QB/RB/WR/TE projected 5+ who played
// is predicted two ways: RotoWire's projection (via Sleeper) as is, and that projection times how players at his
// position have done against this opponent relative to their projections in earlier weeks of the season (actual ÷
// projected, shrunk toward 1 with `c` pseudo projected points, raised to `alpha`). If RotoWire already prices
// matchups, the opponent's past misses don't repeat and the adjustment can't help. The shrinkage and strength are
// tuned on 2022–23 and scored on 2024–25 (and the reverse); differences in MAE get player-clustered bootstrap
// intervals.
//
// With nflverse snap counts, it also tests cornerback depletion: do WRs and TEs beat RotoWire when the defense is
// missing a regular cornerback (top 3 by defensive snap share over the last 4 weeks, 50%+, and no snaps in this
// game; the Matchups card's definition)? Prints aggregates only.
//
// Usage: tsx scripts/backtest/matchups.ts <history dir> [<dir of nflverse snap_counts_YYYY.csv>]
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mulberry32 } from '../../app/src/analysis/season';
import { scoreStats } from '../../app/src/engine/scoring';
import { played } from '../../pipeline/baseline';
import { LEDGER_SCORING } from '../../pipeline/ledger';
import { csvRecords, toSleeperTeam } from '../../pipeline/lib';

const dir = process.argv[2];
const snapsDir = process.argv[3];
if (!dir) throw new Error('usage: matchups.ts <history dir> [<snap counts dir>]');
const SEASONS = [2022, 2023, 2024, 2025];
const POS = ['QB', 'RB', 'WR', 'TE'];
const FIRST_WEEK = 4;

type Row = { player_id: string; position?: string | null; opponent?: string | null; stats?: Record<string, number> | null };
const read = (p: string): Row[] => (existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as Row[]) : []);

interface Game {
  season: number;
  week: number;
  player: string;
  pos: string;
  opp: string;
  mu: number;
  actual: number;
}
const games: Game[] = [];
for (const season of SEASONS) {
  for (let w = 1; w <= 18; w++) {
    const ww = String(w).padStart(2, '0');
    const stats = new Map(read(join(dir, String(season), `stats_w${ww}.json`)).map((r) => [r.player_id, r]));
    for (const p of read(join(dir, String(season), `proj_w${ww}.json`))) {
      if (!p.position || !POS.includes(p.position) || !p.stats || !p.opponent) continue;
      const s = stats.get(p.player_id);
      if (!played(s?.stats)) continue;
      const mu = scoreStats(p.stats, LEDGER_SCORING);
      if (mu < 5) continue;
      games.push({ season, week: w, player: `${season}:${p.player_id}`, pos: p.position, opp: p.opponent, mu, actual: scoreStats(s!.stats!, LEDGER_SCORING) });
    }
  }
}

/** For each game from week 4 on: the opponent's actual and projected totals at this position in earlier weeks. */
interface Scored extends Game {
  priorActual: number;
  priorProjected: number;
}
const scored: Scored[] = [];
for (const season of SEASONS) {
  const ofSeason = games.filter((g) => g.season === season);
  for (let w = FIRST_WEEK; w <= 18; w++) {
    const prior = new Map<string, { a: number; m: number }>();
    for (const g of ofSeason) {
      if (g.week >= w) continue;
      const k = `${g.opp}:${g.pos}`;
      const x = prior.get(k) ?? { a: 0, m: 0 };
      x.a += g.actual;
      x.m += g.mu;
      prior.set(k, x);
    }
    for (const g of ofSeason) {
      if (g.week !== w) continue;
      const x = prior.get(`${g.opp}:${g.pos}`) ?? { a: 0, m: 0 };
      scored.push({ ...g, priorActual: x.a, priorProjected: x.m });
    }
  }
}

const predict = (g: Scored, c: number, alpha: number) => (alpha ? g.mu * ((g.priorActual + c) / (g.priorProjected + c)) ** alpha : g.mu);
const mae = (gs: readonly Scored[], c: number, alpha: number) => gs.reduce((x, g) => x + Math.abs(g.actual - predict(g, c, alpha)), 0) / gs.length;
const C = [20, 50, 100, 200, 400];
const ALPHA = [0, 0.25, 0.5, 0.75, 1];
const tune = (gs: readonly Scored[]) => {
  let best = { c: C[0]!, alpha: 0, mae: mae(gs, C[0]!, 0) };
  for (const c of C) for (const alpha of ALPHA) {
    const m = mae(gs, c, alpha);
    if (m < best.mae) best = { c, alpha, mae: m };
  }
  return best;
};
const rand = mulberry32(20261016);
/** Player-clustered bootstrap of MAE(adjusted) − MAE(RotoWire): 95% interval. */
const diffInterval = (gs: readonly Scored[], c: number, alpha: number) => {
  const byPlayer = new Map<string, Scored[]>();
  for (const g of gs) (byPlayer.get(g.player) ?? byPlayer.set(g.player, []).get(g.player)!).push(g);
  const players = [...byPlayer.values()];
  const xs: number[] = [];
  for (let b = 0; b < 400; b++) {
    let d = 0;
    let n = 0;
    for (let i = 0; i < players.length; i++) {
      for (const g of players[Math.floor(rand() * players.length)]!) {
        d += Math.abs(g.actual - predict(g, c, alpha)) - Math.abs(g.actual - g.mu);
        n++;
      }
    }
    xs.push(d / n);
  }
  xs.sort((a, b) => a - b);
  return [xs[10]!, xs[389]!] as const;
};

const early = scored.filter((g) => g.season <= 2023);
const late = scored.filter((g) => g.season >= 2024);
console.log(`## Matchup adjustment over RotoWire: ${scored.length} player-games, weeks ${FIRST_WEEK}–18 of ${SEASONS.join(', ')}\n`);
for (const [train, test, name] of [
  [early, late, 'tuned on 2022–23, scored on 2024–25'],
  [late, early, 'tuned on 2024–25, scored on 2022–23'],
] as const) {
  const t = tune(train);
  const base = mae(test, t.c, 0);
  const adj = mae(test, t.c, t.alpha);
  const [lo, hi] = t.alpha ? diffInterval(test, t.c, t.alpha) : [0, 0];
  console.log(`- ${name}: best c ${t.c}, alpha ${t.alpha}. MAE ${base.toFixed(3)} → ${adj.toFixed(3)} (${(((adj - base) / base) * 100).toFixed(2)}%), 95% interval of the change ${lo.toFixed(3)} to ${hi.toFixed(3)}`);
}
console.log('\n| pos | games | MAE RotoWire | full-strength adjustment (c 100, alpha 1) | change |');
console.log('|---|---|---|---|---|');
for (const p of POS) {
  const gs = scored.filter((g) => g.pos === p);
  const base = mae(gs, 100, 0);
  const adj = mae(gs, 100, 1);
  console.log(`| ${p} | ${gs.length} | ${base.toFixed(3)} | ${adj.toFixed(3)} | ${(((adj - base) / base) * 100).toFixed(2)}% |`);
}
// Does the opponent's past miss predict this game's miss at all? Correlation of the shrunk log ratio with the residual.
const xs = scored.map((g) => Math.log((g.priorActual + 100) / (g.priorProjected + 100)));
const ys = scored.map((g) => (g.actual - g.mu) / g.mu);
const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
const my = ys.reduce((a, b) => a + b, 0) / ys.length;
let sxy = 0;
let sxx = 0;
let syy = 0;
for (let i = 0; i < xs.length; i++) {
  sxy += (xs[i]! - mx) * (ys[i]! - my);
  sxx += (xs[i]! - mx) ** 2;
  syy += (ys[i]! - my) ** 2;
}
console.log(`\nCorrelation of the opponent's earlier miss with this game's relative miss: ${(sxy / Math.sqrt(sxx * syy)).toFixed(3)} (n = ${xs.length}).`);

if (snapsDir) {
  // Regular cornerbacks out, per defense and week: top 3 by average defensive snap share over the last 4 weeks
  // (games played, 50%+), with no snaps in this week's game.
  const out = new Map<string, number>(); // `${season}:${week}:${team}` → regular CBs out
  for (const season of SEASONS) {
    const rows = csvRecords(readFileSync(join(snapsDir, `snap_counts_${season}.csv`), 'utf8')).filter((r) => r.game_type === 'REG' && r.position === 'CB');
    const played = new Map<string, Set<string>>(); // `${week}:${team}` → CBs with snaps
    const share = new Map<string, Array<{ week: number; team: string; pct: number }>>();
    for (const r of rows) {
      const week = Number(r.week);
      const team = toSleeperTeam(r.team ?? '');
      const pct = Number(r.defense_pct) || 0;
      if (pct > 0) (played.get(`${week}:${team}`) ?? played.set(`${week}:${team}`, new Set()).get(`${week}:${team}`)!).add(r.pfr_player_id ?? '');
      (share.get(r.pfr_player_id ?? '') ?? share.set(r.pfr_player_id ?? '', []).get(r.pfr_player_id ?? '')!).push({ week, team, pct });
    }
    for (let w = 5; w <= 18; w++) {
      const regulars = new Map<string, Array<{ id: string; snap: number }>>();
      for (const [id, games] of share) {
        const recent = games.filter((g) => g.week >= w - 4 && g.week < w && g.pct > 0);
        if (!recent.length) continue;
        const snap = recent.reduce((a, g) => a + g.pct, 0) / recent.length;
        const team = recent.reduce((a, g) => (g.week > a.week ? g : a)).team;
        if (snap >= 0.5) (regulars.get(team) ?? regulars.set(team, []).get(team)!).push({ id, snap });
      }
      for (const [team, cbs] of regulars) {
        const top = cbs.sort((a, b) => b.snap - a.snap).slice(0, 3);
        const playing = played.get(`${w}:${team}`);
        if (!playing) continue; // bye
        out.set(`${season}:${w}:${team}`, top.filter((c) => !playing.has(c.id)).length);
      }
    }
  }
  console.log('\n### Cornerback depletion: relative miss of RotoWire (actual ÷ projected − 1), games played\n');
  console.log('| pos | defense missing a regular CB | games | mean relative miss | full secondary: games | mean | difference (95% interval) |');
  console.log('|---|---|---|---|---|---|---|');
  for (const pos of ['WR', 'TE']) {
    const gs = scored.filter((g) => g.pos === pos && out.has(`${g.season}:${g.week}:${g.opp}`));
    const depleted = gs.filter((g) => out.get(`${g.season}:${g.week}:${g.opp}`)! >= 1);
    const full = gs.filter((g) => out.get(`${g.season}:${g.week}:${g.opp}`)! === 0);
    const rel = (xs: readonly Scored[]) => xs.reduce((a, g) => a + g.actual / g.mu - 1, 0) / xs.length;
    // Bootstrap clustered by defense-week.
    const cluster = (xs: readonly Scored[]) => {
      const m = new Map<string, Scored[]>();
      for (const g of xs) (m.get(`${g.season}:${g.week}:${g.opp}`) ?? m.set(`${g.season}:${g.week}:${g.opp}`, []).get(`${g.season}:${g.week}:${g.opp}`)!).push(g);
      return [...m.values()];
    };
    const [cd, cf] = [cluster(depleted), cluster(full)];
    const diffs: number[] = [];
    for (let b = 0; b < 400; b++) {
      const pick = (cs: Scored[][]) => Array.from({ length: cs.length }, () => cs[Math.floor(rand() * cs.length)]!).flat();
      diffs.push(rel(pick(cd)) - rel(pick(cf)));
    }
    diffs.sort((a, b) => a - b);
    const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
    console.log(`| ${pos} | ≥1 out | ${depleted.length} | ${pct(rel(depleted))} | ${full.length} | ${pct(rel(full))} | ${pct(rel(depleted) - rel(full))} (${pct(diffs[10]!)} to ${pct(diffs[389]!)}) |`);
  }

  // Robustness for WRs: each half, one vs two or more out, and the gate's metric. The gap could as well be RotoWire
  // running high against a full secondary as low against a depleted one, so the test fits a factor on WR projections
  // for each case and compares it with one factor for every WR game: the CB signal is worth only the difference.
  const wr = scored.filter((g) => g.pos === 'WR' && out.has(`${g.season}:${g.week}:${g.opp}`));
  const outOf = (g: Scored) => out.get(`${g.season}:${g.week}:${g.opp}`)!;
  const rel = (xs: readonly Scored[]) => xs.reduce((a, g) => a + g.actual / g.mu - 1, 0) / (xs.length || 1);
  const pts = (xs: readonly Scored[]) => xs.reduce((a, g) => a + g.actual - g.mu, 0) / (xs.length || 1);
  console.log('\n| WR games | n | mean relative miss | mean miss (pts) |');
  console.log('|---|---|---|---|');
  for (const [name, gs] of [
    ['full secondary', wr.filter((g) => outOf(g) === 0)],
    ['1 regular CB out', wr.filter((g) => outOf(g) === 1)],
    ['2+ out', wr.filter((g) => outOf(g) >= 2)],
    ['2022–23, full', wr.filter((g) => g.season <= 2023 && outOf(g) === 0)],
    ['2022–23, 1+ out', wr.filter((g) => g.season <= 2023 && outOf(g) >= 1)],
    ['2024–25, full', wr.filter((g) => g.season >= 2024 && outOf(g) === 0)],
    ['2024–25, 1+ out', wr.filter((g) => g.season >= 2024 && outOf(g) >= 1)],
  ] as const) {
    console.log(`| ${name} | ${gs.length} | ${(rel(gs) * 100).toFixed(1)}% | ${pts(gs).toFixed(2)} |`);
  }
  // MAE rewards the median; squared error rewards fixing the mean, which is what expected-points lineups use.
  const loss = (gs: readonly Scored[], full: number, depleted: number, squared: boolean) => {
    const e = gs.reduce((a, g) => {
      const d = g.actual - g.mu * (outOf(g) >= 1 ? depleted : full);
      return a + (squared ? d * d : Math.abs(d));
    }, 0) / gs.length;
    return squared ? Math.sqrt(e) : e;
  };
  const FACTORS = Array.from({ length: 21 }, (_, i) => 0.8 + i * 0.02);
  console.log('\nWR projections times a factor fitted on the other half:\n');
  console.log('| metric | scored on | RotoWire as is | one factor | a factor per case | per case vs one |');
  console.log('|---|---|---|---|---|---|');
  for (const squared of [false, true]) {
    for (const [train, test, name] of [
      [wr.filter((g) => g.season <= 2023), wr.filter((g) => g.season >= 2024), '2024–25'],
      [wr.filter((g) => g.season >= 2024), wr.filter((g) => g.season <= 2023), '2022–23'],
    ] as const) {
      const one = FACTORS.reduce((b, f) => (loss(train, f, f, squared) < loss(train, b, b, squared) ? f : b), 1);
      let two = [1, 1] as [number, number];
      for (const f of FACTORS) for (const d of FACTORS) if (loss(train, f, d, squared) < loss(train, two[0], two[1], squared)) two = [f, d];
      const [base, a, b] = [loss(test, 1, 1, squared), loss(test, one, one, squared), loss(test, two[0], two[1], squared)];
      console.log(
        `| ${squared ? 'RMSE' : 'MAE'} | ${name} | ${base.toFixed(3)} | ${a.toFixed(3)} (×${one.toFixed(2)}) | ${b.toFixed(3)} (full ×${two[0].toFixed(2)}, depleted ×${two[1].toFixed(2)}) | ${(((b - a) / a) * 100).toFixed(2)}% |`,
      );
    }
  }
}
