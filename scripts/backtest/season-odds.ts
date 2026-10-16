// Backtest: are the season simulation's playoff odds calibrated, and does persistent drift make them better?
// (docs/ros-uncertainty.md)
//
// Synthetic 10-team leagues are drafted by ADP (with noise) from each season's real QB/RB/WR/TE (2022–2025, RotoWire
// projections and Sleeper results from the private history bundle). Each week every team starts its best projected
// lineup and scores what those players actually scored; the top 4 after week 14 make the playoffs. At each anchor week
// the app's own season simulation (app/src/analysis/season.ts) predicts the top 4 from the standings so far and flat
// rest-of-season rates (each player's projection for the next week, zero on byes, times the future-week availability
// curve). Arms differ only in the drift; they're scored by log loss and Brier score. Prints aggregates only.
//
// Usage: tsx scripts/backtest/season-odds.ts <history dir> [--leagues 100] [--sims 1000]
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Dist } from '../../app/src/engine/winprob';
import { HEALTHY_PLAY } from '../../app/src/analysis/ros';
import { mulberry32, simulateSeason, type SeasonTeam } from '../../app/src/analysis/season';
import { scoreStats } from '../../app/src/engine/scoring';
import { played } from '../../pipeline/baseline';
import { LEDGER_SCORING } from '../../pipeline/ledger';

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith('--'));
if (!dir) throw new Error('usage: season-odds.ts <history dir> [--leagues 100] [--sims 1000]');
const opt = (name: string, d: number) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : d;
};
const LEAGUES = opt('leagues', 100);
const SIMS = opt('sims', 1000);
const SEASONS = [2022, 2023, 2024, 2025];
const TEAMS = 10;
const ROUNDS = 14;
const REGULAR = 14;
const PLAYOFF_TEAMS = 4;
const ANCHORS = [3, 5, 7, 9];
/** Relative weekly drift SDs tried: each starter's persistent error grows by this share of his rate each week. */
const DRIFTS = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6];
/** Shares of the starters' rates for a fixed offset per team and season, the other shape tried. */
const OFFSETS = [0.2, 0.3, 0.4, 0.5, 0.6, 0.8];
const CAPS: Record<string, number> = { QB: 2, RB: 6, WR: 6, TE: 2 };
/** Managers replace busts and injured players from free agency (off with --no-waivers). */
const WAIVERS = !args.includes('--no-waivers');

interface Week {
  proj: Map<string, number>;
  act: Map<string, number | null>;
  teams: Set<string>;
}
interface Season {
  pool: Array<{ id: string; pos: string; adp: number }>;
  pos: Map<string, string>;
  team: Map<string, string>;
  weeks: Week[]; // index = week number
}
type Row = { player_id: string; position?: string | null; team?: string | null; stats?: Record<string, number> | null };
const read = (p: string): Row[] | undefined => (existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as Row[]) : undefined);

function loadSeason(season: number): Season {
  const s: Season = { pool: [], pos: new Map(), team: new Map(), weeks: [] };
  for (let w = 1; w <= 18; w++) {
    const ww = String(w).padStart(2, '0');
    const proj = read(join(dir!, String(season), `proj_w${ww}.json`)) ?? [];
    const stats = read(join(dir!, String(season), `stats_w${ww}.json`)) ?? [];
    const week: Week = { proj: new Map(), act: new Map(), teams: new Set() };
    for (const r of proj) {
      if (r.team) week.teams.add(r.team);
      if (!r.position || !(r.position in CAPS) || !r.stats) continue;
      week.proj.set(r.player_id, scoreStats(r.stats, LEDGER_SCORING));
      s.pos.set(r.player_id, r.position);
      if (r.team) s.team.set(r.player_id, r.team);
      if (w === 1 && r.stats.adp_dd_ppr && r.stats.adp_dd_ppr < 400) s.pool.push({ id: r.player_id, pos: r.position, adp: r.stats.adp_dd_ppr });
    }
    for (const r of stats) week.act.set(r.player_id, played(r.stats) ? scoreStats(r.stats!, LEDGER_SCORING) : null);
    s.weeks[w] = week;
  }
  return s;
}

/** Best lineup (QB, 2 RB, 2 WR, TE, FLEX) by value; returns the starters. */
function lineup(roster: readonly string[], pos: ReadonlyMap<string, string>, value: (id: string) => number): string[] {
  const by = (p: string) => roster.filter((id) => pos.get(id) === p).sort((a, b) => value(b) - value(a));
  const qb = by('QB').slice(0, 1);
  const rb = by('RB');
  const wr = by('WR');
  const te = by('TE');
  const starters = [...qb, ...rb.slice(0, 2), ...wr.slice(0, 2), ...te.slice(0, 1)];
  const flex = [...rb.slice(2), ...wr.slice(2), ...te.slice(1)].sort((a, b) => value(b) - value(a))[0];
  return flex ? [...starters, flex] : starters;
}

function draft(s: Season, rand: () => number): string[][] {
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
  const board = s.pool.map((p) => ({ ...p, key: p.adp * Math.exp(0.2 * gauss()) })).sort((a, b) => a.key - b.key);
  const rosters: string[][] = Array.from({ length: TEAMS }, () => []);
  const taken = new Set<string>();
  for (let round = 0; round < ROUNDS; round++) {
    for (let k = 0; k < TEAMS; k++) {
      const t = round % 2 ? TEAMS - 1 - k : k;
      const counts = (p: string) => rosters[t]!.filter((id) => s.pos.get(id) === p).length;
      const pick = board.find((p) => !taken.has(p.id) && counts(p.pos) < CAPS[p.pos]!);
      if (!pick) continue;
      taken.add(pick.id);
      rosters[t]!.push(pick.id);
    }
  }
  return rosters;
}

/** Round-robin pairings for weeks 1..REGULAR (circle method on a shuffled order); pairs[w] = opponent index per team. */
function schedule(rand: () => number): number[][] {
  const order = Array.from({ length: TEAMS }, (_, i) => i).sort(() => rand() - 0.5);
  const rounds: number[][] = [];
  const ring = order.slice(1);
  for (let r = 0; r < TEAMS - 1; r++) {
    const opp = new Array<number>(TEAMS);
    const line = [order[0]!, ...ring];
    for (let i = 0; i < TEAMS / 2; i++) {
      const a = line[i]!;
      const b = line[TEAMS - 1 - i]!;
      opp[a] = b;
      opp[b] = a;
    }
    rounds.push(opp);
    ring.unshift(ring.pop()!);
  }
  return Array.from({ length: REGULAR + 1 }, (_, w) => (w ? rounds[(w - 1) % rounds.length]! : []));
}

/**
 * One waiver claim per team a week, in random order: the best free agent by next week's projection replaces the
 * team's lowest-projected player of any position when he's projected at least 2 points more (within the caps).
 */
function waivers(s: Season, rosters: string[][], week: number, rand: () => number): void {
  const wk = s.weeks[week];
  if (!wk) return;
  const proj = (id: string) => wk.proj.get(id) ?? 0;
  const rostered = new Set(rosters.flat());
  const free = [...wk.proj.keys()].filter((id) => !rostered.has(id)).sort((a, b) => proj(b) - proj(a));
  const order = rosters.map((_, t) => t).sort(() => rand() - 0.5);
  for (const t of order) {
    const r = rosters[t]!;
    const worst = [...r].sort((a, b) => proj(a) - proj(b))[0];
    if (worst === undefined) continue;
    const count = (pos: string) => r.filter((id) => s.pos.get(id) === pos).length;
    const pick = free.find((id) => {
      const pos = s.pos.get(id)!;
      return proj(id) >= proj(worst) + 2 && (pos === s.pos.get(worst) || count(pos) < CAPS[pos]!);
    });
    if (!pick) continue;
    r[r.indexOf(worst)] = pick;
    free.splice(free.indexOf(pick), 1);
  }
}

interface Prediction {
  season: number;
  anchor: number;
  p: number[]; // P(top 4) per drift arm
  made: boolean;
}
interface Case {
  season: number;
  league: number;
  anchor: number;
  future: number[];
  wins: number[];
  pf: number[];
  /** Per team, per future week: the best lineup's expected points, and its starters' expected points. */
  means: Array<Array<{ mean: number; starters: number[] }>>;
  pairs: number[][];
  made: boolean[];
}

// Pass 1: play every league's season, and record what the simulation would know at each anchor.
const residuals: Array<[number, number]> = [];
const cases: Case[] = [];
for (const season of SEASONS) {
  const s = loadSeason(season);
  for (let L = 0; L < LEAGUES; L++) {
    const rand = mulberry32(season * 1000 + L);
    const rosters = draft(s, rand);
    const pairs = schedule(rand);
    const wins: number[][] = [new Array<number>(TEAMS).fill(0)];
    const pfs: number[][] = [new Array<number>(TEAMS).fill(0)];
    for (let w = 1; w <= REGULAR; w++) {
      const wk = s.weeks[w]!;
      const scores = rosters.map((r) => {
        const st = lineup(r, s.pos, (id) => wk.proj.get(id) ?? 0);
        const projected = st.reduce((a, id) => a + (wk.proj.get(id) ?? 0), 0);
        const actual = st.reduce((a, id) => a + (wk.act.get(id) ?? 0), 0);
        residuals.push([projected, actual - projected]);
        return actual;
      });
      wins[w] = wins[w - 1]!.map((x, t) => {
        const o = pairs[w]![t]!;
        return x + (scores[t]! > scores[o]! ? 1 : scores[t]! === scores[o]! ? 0.5 : 0);
      });
      pfs[w] = pfs[w - 1]!.map((x, t) => x + scores[t]!);
      if (WAIVERS) waivers(s, rosters, w + 1, rand);
    }
    const final = rosters.map((_, t) => t).sort((a, b) => wins[REGULAR]![b]! - wins[REGULAR]![a]! || pfs[REGULAR]![b]! - pfs[REGULAR]![a]!);
    const made = rosters.map((_, t) => final.indexOf(t) < PLAYOFF_TEAMS);
    for (const a of ANCHORS) {
      const next = s.weeks[a + 1]!;
      const future = Array.from({ length: REGULAR - a }, (_, i) => a + 1 + i);
      const means = rosters.map((r) =>
        future.map((w, i) => {
          const wk = s.weeks[w]!;
          // This week's projection is fresh (it already reflects known absences); later weeks get the availability curve.
          const play = i === 0 ? 1 : (HEALTHY_PLAY[Math.min(i, HEALTHY_PLAY.length) - 1] ?? 0.8);
          const ev = (id: string) => (wk.teams.has(s.team.get(id) ?? '') ? (next.proj.get(id) ?? 0) * play : 0);
          const st = lineup(r, s.pos, ev);
          return { mean: st.reduce((x, id) => x + ev(id), 0), starters: st.map(ev) };
        }),
      );
      cases.push({ season, league: L, anchor: a, future, wins: wins[a]!, pf: pfs[a]!, means, pairs, made });
    }
  }
}

// The weekly team SD the simulation uses: the measured SD of actual − projected, as a share of the projected total.
const resMean = residuals.reduce((x, r) => x + r[1], 0) / residuals.length;
const resSd = Math.sqrt(residuals.reduce((x, r) => x + (r[1] - resMean) ** 2, 0) / residuals.length);
const projMean = residuals.reduce((x, r) => x + r[0], 0) / residuals.length;
const SD_SHARE = resSd / projMean;

// Pass 2: the season simulation at each anchor, once per drift.
const predictions: Prediction[] = [];
for (const c of cases) {
  const preds: Prediction[] = c.made.map((made) => ({ season: c.season, anchor: c.anchor, p: [], made }));
  const pairings = new Map(c.future.map((w) => [w, new Map(c.pairs[w]!.map((o, t) => [t + 1, Math.min(t, o)]))]));
  for (const drift of DRIFTS) {
    const teams: SeasonTeam[] = c.means.map((m, t) => {
      const weeks: Dist[] = m.map((x) => ({ mean: x.mean, variance: (SD_SHARE * x.mean) ** 2 }));
      const team: SeasonTeam = { rosterId: t + 1, wins: c.wins[t]!, losses: c.anchor - c.wins[t]!, ties: 0, pointsFor: c.pf[t]!, weeks };
      if (drift) team.drift = drift * Math.sqrt(m[0]!.starters.reduce((x, v) => x + v * v, 0));
      return team;
    });
    const odds = simulateSeason({
      teams,
      weeks: c.future,
      pairings,
      medianGame: false,
      playoffTeams: PLAYOFF_TEAMS,
      sims: SIMS,
      seed: c.season * 7919 + c.league * 31 + c.anchor,
      freshWeeks: 1,
    });
    preds.forEach((p, t) => p.p.push(odds.get(t + 1)!.pPlayoffs));
  }
  for (const off of OFFSETS) {
    const teams: SeasonTeam[] = c.means.map((m, t) => ({
      rosterId: t + 1,
      wins: c.wins[t]!,
      losses: c.anchor - c.wins[t]!,
      ties: 0,
      pointsFor: c.pf[t]!,
      weeks: m.map((x) => ({ mean: x.mean, variance: (SD_SHARE * x.mean) ** 2 })),
      offset: off * Math.sqrt(m[0]!.starters.reduce((x, v) => x + v * v, 0)),
    }));
    const odds = simulateSeason({ teams, weeks: c.future, pairings, medianGame: false, playoffTeams: PLAYOFF_TEAMS, sims: SIMS, seed: c.season * 7919 + c.league * 31 + c.anchor, freshWeeks: 1 });
    preds.forEach((p, t) => p.p.push(odds.get(t + 1)!.pPlayoffs));
  }
  predictions.push(...preds);
}

const eps = 1e-4;
const logLoss = (ps: Prediction[], arm: number) => -ps.reduce((x, r) => x + Math.log(Math.min(1 - eps, Math.max(eps, r.made ? r.p[arm]! : 1 - r.p[arm]!))), 0) / ps.length;
const brier = (ps: Prediction[], arm: number) => ps.reduce((x, r) => x + (r.p[arm]! - (r.made ? 1 : 0)) ** 2, 0) / ps.length;
console.log(`## Season odds backtest: ${SEASONS.join(', ')}; ${LEAGUES} leagues a season; anchors after weeks ${ANCHORS.join(', ')}; ${SIMS} sims; waivers ${WAIVERS ? 'on' : 'off'}\n`);
console.log(`Team-weeks: ${residuals.length}; projected ${projMean.toFixed(1)} a week; actual − projected: mean ${resMean.toFixed(2)}, SD ${resSd.toFixed(2)}, so the weekly SD used is ${SD_SHARE.toFixed(3)} × the projected total\n`);
console.log('| drift (share of rate per week) | log loss, all | Brier, all | log loss 2022–23 | log loss 2024–25 |');
console.log('|---|---|---|---|---|');
const early = predictions.filter((r) => r.season <= 2023);
const late = predictions.filter((r) => r.season >= 2024);
DRIFTS.forEach((d, arm) => console.log(`| ${d} | ${logLoss(predictions, arm).toFixed(4)} | ${brier(predictions, arm).toFixed(4)} | ${logLoss(early, arm).toFixed(4)} | ${logLoss(late, arm).toFixed(4)} |`));
console.log('\n| offset (share of rate, fixed for the season) | log loss, all | Brier, all | log loss 2022–23 | log loss 2024–25 |');
console.log('|---|---|---|---|---|');
OFFSETS.forEach((f, i) => {
  const arm = DRIFTS.length + i;
  console.log(`| ${f} | ${logLoss(predictions, arm).toFixed(4)} | ${brier(predictions, arm).toFixed(4)} | ${logLoss(early, arm).toFixed(4)} | ${logLoss(late, arm).toFixed(4)} |`);
});
console.log('\n| anchor | n | log loss, no drift | best drift | log loss there |');
console.log('|---|---|---|---|---|');
for (const a of ANCHORS) {
  const ps = predictions.filter((r) => r.anchor === a);
  const losses = DRIFTS.map((_, arm) => logLoss(ps, arm));
  const best = losses.indexOf(Math.min(...losses));
  console.log(`| ${a} | ${ps.length} | ${losses[0]!.toFixed(4)} | ${DRIFTS[best]} | ${losses[best]!.toFixed(4)} |`);
}
console.log('\n| predicted (no drift) | n | made it | predicted (drift 0.3) | n | made it |');
console.log('|---|---|---|---|---|---|');
const buckets = [0, 0.05, 0.2, 0.4, 0.6, 0.8, 0.95, 1.0001];
const arm8 = DRIFTS.indexOf(0.3);
for (let b = 0; b + 1 < buckets.length; b++) {
  const cell = (arm: number) => {
    const ps = predictions.filter((r) => r.p[arm]! >= buckets[b]! && r.p[arm]! < buckets[b + 1]!);
    const avg = ps.reduce((x, r) => x + r.p[arm]!, 0) / (ps.length || 1);
    return `${(avg * 100).toFixed(1)}% | ${ps.length} | ${((ps.filter((r) => r.made).length / (ps.length || 1)) * 100).toFixed(1)}%`;
  };
  console.log(`| ${cell(0)} | ${cell(arm8)} |`);
}
