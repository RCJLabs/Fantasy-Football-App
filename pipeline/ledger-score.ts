// Scoring the prediction ledger (the reveal): for each player-game, the last prediction committed
// before kickoff, against what happened (nflverse game-day actives and PPR points). Only games that
// have been played count. Aggregates only: nothing per player is published.
import { scoreStats } from '../app/src/engine/scoring';
import { LEDGER_SCORING, type PlayerPrediction, type PredictionFile } from './ledger';
import { nflverseStatLine } from './nflverse-stats';

export interface Outcome {
  active: boolean;
  ppr: number;
}

export interface ScoredPrediction extends PlayerPrediction {
  createdAt: string;
  kickoff: string;
}

/** The latest prediction for each player-game made before that game's kickoff (among those `keep` accepts). */
export function lastBeforeKickoff(files: readonly PredictionFile[], keep: (p: PlayerPrediction) => boolean = () => true): Map<string, ScoredPrediction> {
  const out = new Map<string, ScoredPrediction>();
  for (const f of [...files].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))) {
    const kickoffs = new Map(f.games.map((g) => [g.id, g.kickoff]));
    for (const p of f.players) {
      const kickoff = kickoffs.get(p.game);
      if (!kickoff || Date.parse(f.createdAt) >= Date.parse(kickoff) || !keep(p)) continue;
      out.set(`${p.game}:${p.id}`, { ...p, createdAt: f.createdAt, kickoff });
    }
  }
  return out;
}

/**
 * Outcomes by gsis id for one week's played games: active = game-day roster status ACT; points = the
 * player's nflverse line mapped to Sleeper's stat keys and scored with the ledger's own scoring (0 when
 * active without a stat). nflverse's `fantasy_points_ppr` differs on about 0.7% of player-weeks (return TDs,
 * return fumbles; docs/stat-mapping.md). Weekly rosters exist before kickoff too, so only games with stats
 * count (`played`).
 */
export function nflverseOutcomes(
  rosters: ReadonlyArray<Record<string, string>>,
  stats: ReadonlyArray<Record<string, string>>,
  week: number,
): { played: Set<string>; byGsis: Map<string, Outcome> } {
  const regularWeek = (r: Record<string, string>) => Number(r.week) === week && (r.game_type || r.season_type || 'REG') === 'REG';
  const weekStats = stats.filter(regularWeek);
  const played = new Set(weekStats.map((r) => r.game_id ?? '').filter(Boolean));
  const playedTeams = new Set(weekStats.map((r) => r.team ?? ''));
  const ppr = new Map(weekStats.map((r) => [r.player_id ?? '', scoreStats(nflverseStatLine(r, r.position ?? ''), LEDGER_SCORING)]));
  const byGsis = new Map<string, Outcome>();
  for (const r of rosters) {
    if (!regularWeek(r) || !r.gsis_id || !playedTeams.has(r.team ?? '')) continue;
    const active = r.status === 'ACT';
    byGsis.set(r.gsis_id, { active, ppr: active ? (ppr.get(r.gsis_id) ?? 0) : 0 });
  }
  return { played, byGsis };
}

export interface CalibrationRow {
  group: string;
  n: number;
  /** Mean predicted P(active) and observed share active. */
  predicted: number;
  observed: number;
}

export interface LedgerScore {
  season: string;
  week: number;
  games: number;
  /** Predictions with an outcome (played game, player on a game-day roster). */
  scored: number;
  /** Players tagged Questionable, Doubtful or Out: where the chance to play matters. */
  tagged: { n: number; brier: number; logLoss: number; calibration: CalibrationRow[] };
  /** Active players projected for at least `minProjected` PPR: points if active against the result. */
  points: { minProjected: number; n: number; mae: number; bias: number; within1: number; within2: number };
  /**
   * The shadow baseline against the app's own numbers, on active QB/RB/WR/TE that both predicted and
   * either put at `minProjected` or more (the backtest's population, docs/baseline.md).
   */
  baseline: { n: number; appMae: number; baselineMae: number; ratio: number };
  /**
   * The props shadow (`pr`) against the app's number from the same snapshot, on the same population; `blendMae`
   * averages the two (the question the blend gate asks).
   */
  props: { n: number; appMae: number; propsMae: number; blendMae: number; ratio: number };
}

const TAGS = new Set(['Questionable', 'Doubtful', 'Out']);
const r3 = (x: number) => Math.round(x * 1000) / 1000;

function group(p: PlayerPrediction): string {
  if (p.inj !== 'Questionable') return p.inj!;
  return p.prac && p.final ? `Questionable, ${p.prac} (final report)` : 'Questionable (before final report)';
}

export function scoreLedger(
  season: string,
  week: number,
  predictions: ReadonlyMap<string, ScoredPrediction>,
  outcomes: { played: Set<string>; byGsis: ReadonlyMap<string, Outcome> },
  minProjected = 5,
  /** The latest pre-kickoff prediction that carried props (`pr`), per player-game. */
  withProps: ReadonlyMap<string, ScoredPrediction> = new Map(),
): LedgerScore {
  const withOutcomes = (ps: ReadonlyMap<string, ScoredPrediction>) => {
    const out: Array<{ p: ScoredPrediction; o: Outcome }> = [];
    for (const p of ps.values()) {
      const o = p.gsis && outcomes.played.has(p.game) ? outcomes.byGsis.get(p.gsis) : undefined;
      if (o) out.push({ p, o });
    }
    return out;
  };
  const scored = withOutcomes(predictions);

  const tagged = scored.filter(({ p }) => TAGS.has(p.inj ?? ''));
  const eps = 1e-6;
  const brier = tagged.reduce((a, { p, o }) => a + (p.p - (o.active ? 1 : 0)) ** 2, 0) / (tagged.length || 1);
  const logLoss = -tagged.reduce((a, { p, o }) => a + Math.log(Math.min(1 - eps, Math.max(eps, o.active ? p.p : 1 - p.p))), 0) / (tagged.length || 1);
  const groups = new Map<string, Array<{ p: ScoredPrediction; o: Outcome }>>();
  for (const s of tagged) groups.set(group(s.p), [...(groups.get(group(s.p)) ?? []), s]);
  const calibration = [...groups].map(([name, rows]) => ({
    group: name,
    n: rows.length,
    predicted: r3(rows.reduce((a, { p }) => a + p.p, 0) / rows.length),
    observed: r3(rows.filter(({ o }) => o.active).length / rows.length),
  }));

  const skill = (p: PlayerPrediction) => ['QB', 'RB', 'WR', 'TE'].includes(p.pos);
  const played = scored.filter(({ p, o }) => o.active && p.mu >= minProjected && skill(p));
  const err = played.map(({ p, o }) => o.ppr - p.mu);
  const n = played.length || 1;
  const both = scored.filter(({ p, o }) => o.active && skill(p) && p.bl !== undefined && Math.max(p.mu, p.bl) >= minProjected);
  const meanAbs = (rows: ReadonlyArray<{ p: ScoredPrediction; o: Outcome }>, f: (p: ScoredPrediction) => number) =>
    rows.reduce((a, x) => a + Math.abs(x.o.ppr - f(x.p)), 0) / (rows.length || 1);
  const appMae = meanAbs(both, (p) => p.mu);
  const baselineMae = meanAbs(both, (p) => p.bl!);
  const priced = withOutcomes(withProps).filter(({ p, o }) => o.active && skill(p) && p.pr !== undefined && Math.max(p.mu, p.pr) >= minProjected);
  const propsAppMae = meanAbs(priced, (p) => p.mu);
  const propsMae = meanAbs(priced, (p) => p.pr!);
  return {
    season,
    week,
    games: new Set(scored.map(({ p }) => p.game)).size,
    scored: scored.length,
    tagged: { n: tagged.length, brier: r3(brier), logLoss: r3(logLoss), calibration: calibration.sort((a, b) => b.n - a.n) },
    points: {
      minProjected,
      n: played.length,
      mae: r3(err.reduce((a, e) => a + Math.abs(e), 0) / n),
      bias: r3(err.reduce((a, e) => a + e, 0) / n),
      within1: r3(played.filter(({ p, o }) => Math.abs(o.ppr - p.mu) <= p.sd).length / n),
      within2: r3(played.filter(({ p, o }) => Math.abs(o.ppr - p.mu) <= 2 * p.sd).length / n),
    },
    baseline: { n: both.length, appMae: r3(appMae), baselineMae: r3(baselineMae), ratio: appMae > 0 ? r3(baselineMae / appMae) : 0 },
    props: {
      n: priced.length,
      appMae: r3(propsAppMae),
      propsMae: r3(propsMae),
      blendMae: r3(meanAbs(priced, (p) => (p.mu + p.pr!) / 2)),
      ratio: propsAppMae > 0 ? r3(propsMae / propsAppMae) : 0,
    },
  };
}
