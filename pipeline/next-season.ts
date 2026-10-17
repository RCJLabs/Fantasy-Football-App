// Next season's projections for the draft helper (docs/draft.md). Per stat, a Marcel-style weighted average of a
// player's per-game rates this season so far and the two seasons before it, pulled toward a position mean by
// pseudo-games; times an age factor and a contract-status factor. Expected games come from age, games played so
// far this season, tier and contract status. Rookies of the next NFL draft are placeholders by the order their
// position is taken. Fitted on nflverse by scripts/calibrate/next-season.ts; the constants are in
// next-season-fit.json. Pure: build-data.ts fetches and writes.
import { DATA_SCHEMA_VERSION, type NextSeasonFile, type NextSeasonPlayer, type NextSeasonRookie } from '../app/src/data/contracts';
import type { StatLine } from '../app/src/domain/types';
import { SLEEPER_PPR } from './lib';
import { nflverseStatLine } from './nflverse-stats';

export const SKILL_POS = ['QB', 'RB', 'WR', 'TE'] as const;
export type SkillPos = (typeof SKILL_POS)[number];

/** Stats projected for QB/RB/WR/TE, per game (Sleeper keys). Bonuses are priced from these by the app. */
export const SKILL_STATS = [
  'pass_att', 'pass_cmp', 'pass_yd', 'pass_td', 'pass_int', 'pass_2pt', 'pass_fd',
  'rush_att', 'rush_yd', 'rush_td', 'rush_2pt', 'rush_fd',
  'rec_tgt', 'rec', 'rec_yd', 'rec_td', 'rec_2pt', 'rec_fd',
  'fum_lost',
] as const;

/** nflverse kicking columns → Sleeper keys (50+ yards together: the app splits 50–59 and 60+). */
const KICKING: ReadonlyArray<readonly [readonly string[], string]> = [
  [['fg_att'], 'fga'],
  [['fg_made'], 'fgm'],
  [['fg_missed'], 'fgmiss'],
  [['fg_made_0_19'], 'fgm_0_19'],
  [['fg_made_20_29'], 'fgm_20_29'],
  [['fg_made_30_39'], 'fgm_30_39'],
  [['fg_made_40_49'], 'fgm_40_49'],
  [['fg_made_50_59', 'fg_made_60_'], 'fgm_50p'],
  [['pat_att'], 'xpa'],
  [['pat_made'], 'xpm'],
  [['pat_missed'], 'xpmiss'],
];
export const K_STATS = KICKING.map(([, key]) => key);

/** Sleeper's default kicker scoring: what the kicker fit minimizes. */
export const SLEEPER_K: Readonly<StatLine> = { fgm_0_19: 3, fgm_20_29: 3, fgm_30_39: 3, fgm_40_49: 4, fgm_50p: 5, xpm: 1, fgmiss: -1, xpmiss: -1 };

/** Team defense stats projected per game (Sleeper keys). */
export const DEF_STATS = ['sack', 'int', 'fum_rec', 'ff', 'def_td', 'safe', 'blk_kick', 'def_st_td', 'pts_allow', 'yds_allow'] as const;

/** Players at or above these position ranks are the draftable tier the games and team-change tables split on. [design] */
export const TOP_RANK: Readonly<Record<SkillPos, number>> = { QB: 24, RB: 48, WR: 60, TE: 24 };
/** Kickers worth drafting, whose games share the fit measures. [design] */
export const K_TOP = 16;

/** A regular season's games from 2021 on. */
export const seasonGames = (season: number): number => (season >= 2021 ? 17 : 16);

const num = (s: string | undefined): number => {
  const v = Number(s);
  return s === undefined || s === '' || s === 'NA' || !Number.isFinite(v) ? 0 : v;
};

export const score = (line: Readonly<StatLine>, scoring: Readonly<StatLine>): number => {
  let pts = 0;
  for (const k in scoring) pts += (line[k] ?? 0) * scoring[k]!;
  return pts;
};
export const pprPoints = (line: Readonly<StatLine>): number => score(line, SLEEPER_PPR);

/** One player's games and stat totals over a season or part of one. */
export interface SeasonSum {
  pos: string;
  /** His team in his first and last game of the span. */
  team0: string;
  team: string;
  g: number;
  s: StatLine;
}

/** Fantasy position of an nflverse row: fullbacks count as running backs. */
export const fantasyPos = (pos: string | undefined): string => (pos === 'FB' ? 'RB' : (pos ?? ''));

/**
 * nflverse weekly player rows → totals per player (gsis id) over regular-season weeks ≤ `maxWeek`: QB/RB/WR/TE
 * offense, kickers' kicking. A week a player appears in counts as a game.
 */
export function seasonSums(records: ReadonlyArray<Readonly<Record<string, string>>>, maxWeek = 18): Map<string, SeasonSum> {
  const out = new Map<string, SeasonSum & { firstWeek: number; lastWeek: number }>();
  for (const r of records) {
    if ((r.season_type ?? 'REG') !== 'REG' || !r.player_id) continue;
    const week = Number(r.week);
    if (!(week <= maxWeek)) continue;
    const pos = fantasyPos(r.position);
    let line: StatLine;
    if (pos === 'K') {
      line = {};
      for (const [cols, key] of KICKING) {
        const v = cols.reduce((a, c) => a + num(r[c]), 0);
        if (v) line[key] = v;
      }
    } else if ((SKILL_POS as readonly string[]).includes(pos)) {
      const full = nflverseStatLine(r, pos);
      line = {};
      for (const k of SKILL_STATS) if (full[k]) line[k] = full[k]!;
    } else continue;
    const cur = out.get(r.player_id) ?? { pos, team0: r.team ?? '', team: r.team ?? '', g: 0, s: {}, firstWeek: week, lastWeek: 0 };
    cur.g++;
    for (const k in line) cur.s[k] = (cur.s[k] ?? 0) + line[k]!;
    if (week >= cur.lastWeek) {
      cur.lastWeek = week;
      cur.team = r.team ?? cur.team;
      cur.pos = pos;
    }
    if (week < cur.firstWeek) {
      cur.firstWeek = week;
      cur.team0 = r.team ?? cur.team0;
    }
    out.set(r.player_id, cur);
  }
  return new Map([...out].map(([id, { firstWeek: _f, lastWeek: _l, ...s }]) => [id, s]));
}

/** Games each team has played in weeks ≤ `maxWeek` (weeks with any player row). */
export function teamGames(records: ReadonlyArray<Readonly<Record<string, string>>>, maxWeek = 18): Map<string, number> {
  const weeks = new Map<string, Set<number>>();
  for (const r of records) {
    if ((r.season_type ?? 'REG') !== 'REG' || !r.team) continue;
    const week = Number(r.week);
    if (!(week <= maxWeek)) continue;
    const s = weeks.get(r.team) ?? weeks.set(r.team, new Set()).get(r.team)!;
    s.add(week);
  }
  return new Map([...weeks].map(([t, s]) => [t, s.size]));
}

// ---- The fitted model ---------------------------------------------------------------------------------------

/** Age curve: exp(young·min(age − peak, 0) + old·max(age − peak, 0) + first·[after his first season]). */
export interface AgeParams {
  peak: number;
  young: number;
  old: number;
  first: number;
}

/** Share of next season's games played: a linear model, clipped to [0.05, 1]. */
export interface GamesParams {
  base: number;
  /** Age bands under 25, 28–30, 31–33, 34+ (25–27 is the base). */
  age: [number, number, number, number];
  /** Played half or less, or 51–84%, of his team's games so far this season (85%+ is the base). */
  avail: [number, number];
  top: number;
  pending: number;
}

export interface PositionFit {
  /** Weight of a game one and two seasons back, against one this season. */
  a2: number;
  a3: number;
  /** Pseudo-games of `mu` mixed in. */
  k: number;
  /** Per-game rate each stat is pulled toward. */
  mu: StatLine;
  age?: AgeParams;
  games: GamesParams;
  /** Per-game factor for players without a contract past this season, and for those with one. */
  status: { pending: number; signed: number };
  /** Share who played for a different team the next season: [draftable tier, the rest]. */
  change: { pending: [number, number]; signed: [number, number] };
  /** 10th and 90th percentile of actual ÷ projected season points, draftable tier, held out. */
  range: [number, number];
}

export interface RookieLine {
  /** Per-game stat line in the rookie season, over the class's games. */
  s: StatLine;
  /** Share of the season's games played. */
  share: number;
}

export interface NextSeasonFit {
  /** Target seasons the fit used. */
  seasons: [number, number];
  /** By weeks of the current season played (18 = complete): the closest fitted count is used. */
  byWeeks: Record<string, Record<string, PositionFit>>;
  /** By position, in the order taken in the NFL draft (index 0 = first taken). */
  rookies: Record<string, RookieLine[]>;
  /** Kickers' games share (all of them, any age). */
  kickerShare: number;
}

/** The fit for the number of weeks played that's closest to `weeks` (ties go to the later one). */
export function fitFor(fit: NextSeasonFit, weeks: number): Record<string, PositionFit> {
  const keys = Object.keys(fit.byWeeks).map(Number);
  const best = keys.reduce((a, b) => (Math.abs(b - weeks) < Math.abs(a - weeks) || (Math.abs(b - weeks) === Math.abs(a - weeks) && b > a) ? b : a));
  return fit.byWeeks[String(best)]!;
}

/** Inputs for one player: this season so far, last season and the one before (absent = didn't play). */
export interface PlayerSeasons {
  cur?: SeasonSum;
  prev1?: SeasonSum;
  prev2?: SeasonSum;
}

/** Weighted stat totals and games over the three seasons. */
function weighted(p: PlayerSeasons, f: Pick<PositionFit, 'a2' | 'a3'>, stats: readonly string[]): { s: StatLine; g: number } {
  const s: StatLine = {};
  let g = 0;
  for (const [season, w] of [[p.cur, 1], [p.prev1, f.a2], [p.prev2, f.a3]] as const) {
    if (!season || !w) continue;
    g += w * season.g;
    for (const k of stats) s[k] = (s[k] ?? 0) + w * (season.s[k] ?? 0);
  }
  return { s, g };
}

/** Marcel per-game line: weighted rates pulled toward `mu` by `k` pseudo-games. */
export function marcelLine(p: PlayerSeasons, f: Pick<PositionFit, 'a2' | 'a3' | 'k' | 'mu'>, stats: readonly string[]): StatLine {
  const { s, g } = weighted(p, f, stats);
  const out: StatLine = {};
  const den = g + f.k;
  for (const k of stats) out[k] = den > 0 ? ((s[k] ?? 0) + f.k * (f.mu[k] ?? 0)) / den : (f.mu[k] ?? 0);
  return out;
}

export function ageFactor(age: number, first: boolean, a: AgeParams): number {
  return Math.exp(a.young * Math.min(age - a.peak, 0) + a.old * Math.max(age - a.peak, 0) + (first ? a.first : 0));
}

export const ageBand = (age: number): number => (age < 25 ? 1 : age < 28 ? 0 : age < 31 ? 2 : age < 34 ? 3 : 4);
export const availBand = (share: number): number => (share <= 0.5 ? 1 : share < 0.85 ? 2 : 0);

/** The games model's covariates: [age band, availability band, draftable tier, no contract past this season]. */
export function gamesShare(g: GamesParams, age: number, avail: number, top: boolean, pending: boolean): number {
  const a = ageBand(age);
  const v = availBand(avail);
  const x = g.base + (a ? g.age[a - 1]! : 0) + (v ? g.avail[v - 1]! : 0) + (top ? g.top : 0) + (pending ? g.pending : 0);
  return Math.min(1, Math.max(0.05, x));
}

/** A player's projection for next season. */
export interface Projected {
  pos: string;
  /** Per-game stat line when he plays. */
  s: StatLine;
  /** Expected games. */
  g: number;
  pending: boolean;
  /** Chance he plays for another team. */
  chg: number;
  /** In the draftable tier at his position. */
  top: boolean;
}

export interface PlayerInput extends PlayerSeasons {
  pos: string;
  /** Age on September 1 of the target season. */
  age: number;
  /** Share of his team's games he played this season so far (1 when the season is complete and he played all). */
  avail: number;
  /** Without a contract past the current season (or none on record). */
  pending: boolean;
}

/** QB/RB/WR/TE need games in this season or last to be projected (as fitted). */
export const projectable = (p: PlayerSeasons, minGames = 4): boolean => (p.cur?.g ?? 0) + (p.prev1?.g ?? 0) >= minGames;

/**
 * Next season for QB/RB/WR/TE: the rate model per player, then the draftable tier by projected PPR a game within
 * each position, then games and team changes (which depend on the tier).
 */
export function projectSkill(players: ReadonlyMap<string, PlayerInput>, fits: Readonly<Record<string, PositionFit>>, targetGames: number): Map<string, Projected> {
  const rated: Array<{ id: string; p: PlayerInput; s: StatLine; ppr: number }> = [];
  for (const [id, p] of players) {
    const f = fits[p.pos];
    if (!f || !(SKILL_POS as readonly string[]).includes(p.pos) || !projectable(p)) continue;
    const line = marcelLine(p, f, SKILL_STATS);
    const first = !p.prev1?.g && !p.prev2?.g;
    const m = (f.age ? ageFactor(p.age, first, f.age) : 1) * (p.pending ? f.status.pending : f.status.signed);
    for (const k in line) line[k] = Math.max(0, line[k]! * m);
    rated.push({ id, p, s: line, ppr: pprPoints(line) });
  }
  const out = new Map<string, Projected>();
  for (const pos of SKILL_POS) {
    const f = fits[pos]!;
    rated
      .filter((r) => r.p.pos === pos)
      .sort((a, b) => b.ppr - a.ppr)
      .forEach((r, i) => {
        const top = i < TOP_RANK[pos];
        const share = gamesShare(f.games, r.p.age, r.p.avail, top, r.p.pending);
        const chg = f.change[r.p.pending ? 'pending' : 'signed'][top ? 0 : 1];
        out.set(r.id, { pos, s: r.s, g: share * targetGames, pending: r.p.pending, chg, top });
      });
  }
  return out;
}

/** Kickers: the same rate model on kicking stats; games at the kickers' share. */
export function projectKicker(p: PlayerSeasons, f: Pick<PositionFit, 'a2' | 'a3' | 'k' | 'mu'>, share: number, targetGames: number): { s: StatLine; g: number } | undefined {
  if (!projectable(p)) return undefined;
  return { s: marcelLine(p, f, K_STATS), g: share * targetGames };
}

/**
 * Team defenses: this season's and last season's per-game lines, last season's games at `a2`, pulled toward the
 * league's mean by `k` pseudo-games. [design] DST_V0 found team rates add little week to week (docs/dst.md).
 */
export function projectDefenses(
  cur: ReadonlyMap<string, { g: number; s: StatLine }>,
  prev: ReadonlyMap<string, { g: number; s: StatLine }>,
  p: { a2: number; k: number } = DEF_PRIOR,
): Map<string, StatLine> {
  const league: StatLine = {};
  let games = 0;
  for (const src of [cur, prev]) {
    for (const t of src.values()) {
      games += t.g;
      for (const k of DEF_STATS) league[k] = (league[k] ?? 0) + (t.s[k] ?? 0);
    }
  }
  for (const k of DEF_STATS) league[k] = games ? (league[k] ?? 0) / games : 0;
  const out = new Map<string, StatLine>();
  for (const team of new Set([...cur.keys(), ...prev.keys()])) {
    const c = cur.get(team);
    const q = prev.get(team);
    const g = (c?.g ?? 0) + p.a2 * (q?.g ?? 0);
    const line: StatLine = {};
    for (const k of DEF_STATS) line[k] = ((c?.s[k] ?? 0) + p.a2 * (q?.s[k] ?? 0) + p.k * (league[k] ?? 0)) / (g + p.k);
    out.set(team, line);
  }
  return out;
}

/** [design] Last season's weight and the pull toward the league mean for defenses (DST_V0's 32 shrink games). */
export const DEF_PRIOR = { a2: 0.5, k: 32 };

/** Per-game Sleeper DEF stat rows summed by team (rows without points allowed are skipped, as in pipeline/dst.ts). */
export function defenseSums(weeks: ReadonlyArray<ReadonlyArray<{ position?: string | null; team?: string | null; player_id: string; stats?: Record<string, number> | null }>>): Map<string, { g: number; s: StatLine }> {
  const out = new Map<string, { g: number; s: StatLine }>();
  for (const rows of weeks) {
    for (const r of rows) {
      if (r.position !== 'DEF' || r.stats?.pts_allow === undefined) continue;
      const team = r.team ?? r.player_id;
      const t = out.get(team) ?? out.set(team, { g: 0, s: {} }).get(team)!;
      t.g++;
      for (const k of DEF_STATS) t.s[k] = (t.s[k] ?? 0) + (r.stats[k] ?? 0);
    }
  }
  return out;
}

/** An OverTheCap contract row (nflverse `historical_contracts.parquet`), the columns read. */
export interface ContractRow {
  gsis_id?: string | null;
  year_signed?: number | null;
  years?: number | null;
  is_active?: boolean | null;
  draft_round?: number | null;
  draft_year?: number | null;
  /** The player's cap years, void years included. */
  season_history?: ReadonlyArray<{ year?: string | null }> | null;
}

/**
 * Contract years by gsis id: the last season any contract on record runs through. A first-round rookie deal's
 * fifth-year option counts once exercised: OTC keeps such deals at 4 years and lists the option year only in the
 * cap history (the history's void years make it unusable otherwise). History (`asOf`) can't see options.
 */
export function contractThrough(rows: ReadonlyArray<ContractRow>, asOf?: number): Map<string, number> {
  const active = new Map<string, number>();
  const any = new Map<string, number>();
  for (const r of rows) {
    const g = r.gsis_id?.trim();
    if (!g || r.year_signed == null || r.years == null || !(r.years > 0)) continue;
    if (asOf !== undefined && r.year_signed > asOf) continue;
    let end = r.year_signed + r.years - 1;
    const rookieDeal = r.draft_round === 1 && r.draft_year === r.year_signed && r.years === 4;
    if (asOf === undefined && rookieDeal && r.season_history?.some((h) => h.year === String(end + 1))) end++;
    any.set(g, Math.max(any.get(g) ?? -Infinity, end));
    if (asOf === undefined && r.is_active) active.set(g, Math.max(active.get(g) ?? -Infinity, end));
  }
  // Today's status: the active contract when OTC marks one; history (asOf) uses every contract signed by then.
  return new Map([...any].map(([g, end]) => [g, active.get(g) ?? end]));
}

/** Age in years on September 1 of `season`. */
export function ageOn(birthDate: string | undefined | null, season: number): number | undefined {
  if (!birthDate) return undefined;
  const b = Date.parse(birthDate);
  if (!Number.isFinite(b)) return undefined;
  return (Date.UTC(season, 8, 1) - b) / (365.25 * 86_400_000);
}

// ---- The published file ----------------------------------------------------------------------------------------

export interface NextSeasonInput {
  fit: NextSeasonFit;
  now: string;
  /** Sleeper's current season. */
  season: string;
  /** The latest season with games, and how many weeks of it have been played (18 = complete). */
  basisSeason: number;
  basisWeeks: number;
  /** nflverse totals by gsis id: the basis season so far and the two before it. */
  cur: ReadonlyMap<string, SeasonSum>;
  prev1: ReadonlyMap<string, SeasonSum>;
  prev2: ReadonlyMap<string, SeasonSum>;
  /** Games each team has played in the basis season so far. */
  teamGames: ReadonlyMap<string, number>;
  birthDates: ReadonlyMap<string, string>;
  /** Last season under contract, by gsis id (contractThrough). */
  through: ReadonlyMap<string, number>;
  sleeperByGsis: ReadonlyMap<string, string>;
  /** Names by Sleeper id (team defenses by team code). */
  names?: ReadonlyMap<string, string>;
  /** Players to leave out (retired, by Sleeper id). */
  inactive?: ReadonlySet<string>;
  /** Sleeper DEF lines by team: the basis season so far and the season before. */
  defenses?: { cur: ReadonlyMap<string, { g: number; s: StatLine }>; prev: ReadonlyMap<string, { g: number; s: StatLine }> };
  /** The projected season's NFL draft once it has happened: gsis ids in the order taken. */
  draft?: ReadonlyArray<{ pos: string; gsis: string }>;
}

/** Skill players projected for less than this many PPR points a season are left out of the file. [design] */
const MIN_SEASON_PPR = 10;
/** Kickers kept: the best this many by projected points. [design] */
const MAX_KICKERS = 40;
/** Age when a birth date is missing. [design] about the median of fantasy-relevant players */
const DEFAULT_AGE = 26;

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const r1 = (x: number) => Math.round(x * 10) / 10;
const compact = (line: Readonly<StatLine>): StatLine => {
  const out: StatLine = {};
  for (const k in line) {
    const v = r3(line[k]!);
    if (v > 0) out[k] = v;
  }
  return out;
};

/** Next season's file: QB/RB/WR/TE, kickers, team defenses and rookie placeholders. */
export function buildNextSeasonFile(input: NextSeasonInput): NextSeasonFile {
  const fits = fitFor(input.fit, input.basisWeeks);
  const target = input.basisSeason + 1;
  const games = seasonGames(target);
  const players = new Map<string, PlayerInput>();
  const kickers: Array<{ id: string; p: PlayerSeasons }> = [];
  for (const id of new Set([...input.cur.keys(), ...input.prev1.keys()])) {
    const sid = input.sleeperByGsis.get(id);
    if (!sid || input.inactive?.has(sid)) continue;
    const c = input.cur.get(id);
    const p1 = input.prev1.get(id);
    const p2 = input.prev2.get(id);
    const p: PlayerSeasons = {};
    if (c) p.cur = c;
    if (p1) p.prev1 = p1;
    if (p2) p.prev2 = p2;
    const pos = (c ?? p1)!.pos;
    if (pos === 'K') {
      kickers.push({ id: sid, p });
      continue;
    }
    if (!(SKILL_POS as readonly string[]).includes(pos)) continue;
    const played = c ? (input.teamGames.get(c.team) ?? input.basisWeeks) : 0;
    const thru = input.through.get(id);
    players.set(sid, {
      ...p,
      pos,
      age: ageOn(input.birthDates.get(id), target) ?? DEFAULT_AGE,
      avail: c && played ? Math.min(1, c.g / played) : 0,
      pending: thru === undefined || thru <= input.basisSeason,
    });
  }
  const out: Record<string, NextSeasonPlayer> = {};
  const named = (sid: string, pos: string) => {
    const n = input.names?.get(sid);
    return n ? { n, pos } : { pos };
  };
  for (const [sid, pr] of projectSkill(players, fits, games)) {
    if (pprPoints(pr.s) * pr.g < MIN_SEASON_PPR) continue;
    const age = players.get(sid)!.age;
    out[sid] = {
      ...named(sid, pr.pos),
      s: compact(pr.s),
      g: r1(pr.g),
      ...(age !== DEFAULT_AGE ? { age: r1(age) } : {}),
      ...(pr.pending ? { fa: 1 as const } : {}),
      chg: Math.round(pr.chg * 100) / 100,
    };
  }
  const kf = fits.K;
  if (kf) {
    kickers
      .map(({ id, p }) => ({ id, k: projectKicker(p, kf, input.fit.kickerShare, games) }))
      .filter((x): x is { id: string; k: { s: StatLine; g: number } } => !!x.k)
      .sort((a, b) => score(b.k.s, SLEEPER_K) - score(a.k.s, SLEEPER_K))
      .slice(0, MAX_KICKERS)
      .forEach(({ id, k }) => (out[id] = { ...named(id, 'K'), s: compact(k.s), g: r1(k.g) }));
  }
  if (input.defenses) for (const [team, line] of projectDefenses(input.defenses.cur, input.defenses.prev)) out[team] = { ...named(team, 'DEF'), s: compact(line), g: games };

  // Rookies: the real ones once the NFL draft has happened, placeholders by the order taken before then.
  const rookies: NextSeasonRookie[] = [];
  for (const pos of SKILL_POS) {
    const lines = input.fit.rookies[pos] ?? [];
    const taken = input.draft?.filter((d) => d.pos === pos) ?? [];
    lines.forEach((line, i) => {
      if (input.draft?.length && !taken[i]) return;
      const sid = taken[i] ? input.sleeperByGsis.get(taken[i]!.gsis) : undefined;
      rookies.push({ pos, order: i + 1, s: compact(line.s), g: r1(line.share * games), ...(sid ? { id: sid } : {}) });
    });
  }
  const range: Record<string, [number, number]> = {};
  for (const pos of SKILL_POS) if (fits[pos]) range[pos] = fits[pos]!.range;
  return {
    schemaVersion: DATA_SCHEMA_VERSION,
    generatedAt: input.now,
    season: input.season,
    target: String(target),
    basis: { season: String(input.basisSeason), weeks: input.basisWeeks },
    players: out,
    rookies,
    range,
  };
}
