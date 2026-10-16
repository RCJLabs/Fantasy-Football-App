// Scoring the prediction ledger (the reveal): for each player-game, the last prediction committed
// before kickoff, against what happened (nflverse game-day actives and PPR points). Only games that
// have been played count. Aggregates only: nothing per player is published.
import { DATA_SCHEMA_VERSION, type LedgerCalibrationRow, type LedgerFile, type LedgerWeek } from '../app/src/data/contracts';
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

/** A scored week is published as is (data/ledger.json), so its shape lives with the data contracts. */
export type CalibrationRow = LedgerCalibrationRow;
export type LedgerScore = LedgerWeek;

/** Days after a week's last kickoff before it's scored, so stats and game-day statuses have settled. [design] */
export const SETTLE_DAYS = 2;
/** After this many days a week is scored even with a game missing from the stats (postponed, or never published). */
export const GIVE_UP_DAYS = 7;

/**
 * Committed regular-season weeks ready to score, ascending: every scheduled game of the week has stats and its
 * last kickoff was SETTLE_DAYS ago, or GIVE_UP_DAYS have passed. A week is scored once, so it waits for
 * corrections to settle.
 */
export function dueWeeks(
  weeks: readonly number[],
  schedule: ReadonlyArray<{ id: string; week: number; kickoff: string }>,
  played: ReadonlySet<string>,
  now: number,
): number[] {
  const day = 86_400_000;
  return weeks
    .filter((w) => {
      if (w < 1 || w > 18) return false;
      const games = schedule.filter((g) => g.week === w);
      if (!games.length) return false;
      const since = (now - Math.max(...games.map((g) => Date.parse(g.kickoff)))) / day;
      return since >= GIVE_UP_DAYS || (since >= SETTLE_DAYS && games.every((g) => played.has(g.id)));
    })
    .sort((a, b) => a - b);
}

/** Regular-season games with stats, by nflverse game id (stats rows exist only once a game is played). */
export function playedGames(stats: ReadonlyArray<Record<string, string>>): Set<string> {
  return new Set(stats.filter((r) => (r.game_type || r.season_type || 'REG') === 'REG' && r.game_id).map((r) => r.game_id!));
}

const finite = (v: unknown) => typeof v === 'number' && Number.isFinite(v);

/** Problems with one scored week before it's published, empty when it's fit to publish. */
export function validateLedgerWeek(w: unknown, season: string): string[] {
  if (typeof w !== 'object' || w === null) return ['not an object'];
  const x = w as Partial<LedgerWeek>;
  const out: string[] = [];
  if (x.season !== season) out.push(`season ${String(x.season)}`);
  if (!finite(x.week) || x.week! < 1 || x.week! > 18) out.push(`week ${String(x.week)}`);
  if (!finite(x.games) || !finite(x.scored)) out.push('bad games or scored');
  const t = x.tagged;
  if (!t || ![t.n, t.brier, t.logLoss].every(finite) || !Array.isArray(t.calibration)) out.push('bad tagged');
  else if (!t.calibration.every((r) => typeof r.group === 'string' && [r.n, r.predicted, r.observed].every(finite))) out.push('bad calibration');
  const p = x.points;
  if (!p || ![p.minProjected, p.n, p.mae, p.bias, p.within1, p.within2].every(finite)) out.push('bad points');
  return out;
}

/** The public ledger file: every scored week of `season`, ascending (one per week, the latest copy wins). */
export function combineLedger(weeks: readonly LedgerWeek[], season: string, now: string): LedgerFile {
  const byWeek = new Map(weeks.filter((w) => w.season === season).map((w) => [w.week, w]));
  return { schemaVersion: DATA_SCHEMA_VERSION, generatedAt: now, season, weeks: [...byWeek.values()].sort((a, b) => a.week - b.week) };
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
