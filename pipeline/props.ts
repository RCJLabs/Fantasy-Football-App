// Player props (The Odds API) → stat-level means: the plan's second independent source (PLAN §2-3, docs/props.md).
// - A prop line sits near the median of a skewed outcome, not its mean. The shapes measured on 2022–25 projections
//   against results (pipeline/prop-shapes.ts, from scripts/calibrate/prop-shapes.ts) turn a line and its no-vig
//   chance of going over into a mean.
// - Touchdowns are Poisson.
// - Props are void when a player doesn't play, so the means are conditional on playing, like the app's projections.
import type { StatLine } from '../app/src/domain/types';
import { PROP_SHAPES, type ShapeBand } from './prop-shapes';

export interface OddsOutcome {
  name: string;
  /** The player, for player props. */
  description?: string;
  /** American odds. */
  price: number;
  point?: number;
}
export interface OddsMarket {
  key: string;
  last_update?: string;
  outcomes: OddsOutcome[];
}
export interface OddsBookmaker {
  key: string;
  title?: string;
  last_update?: string;
  markets: OddsMarket[];
}
/** An event from /v4/sports/{sport}/events, or one game's odds from /events/{id}/odds (then with bookmakers). */
export interface OddsEvent {
  id: string;
  sport_key?: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers?: OddsBookmaker[];
}

/** Markets fetched: each costs one credit per game and region when a book offers it. */
export const PROP_MARKETS = ['player_pass_yds', 'player_pass_tds', 'player_rush_yds', 'player_receptions', 'player_reception_yds', 'player_anytime_td'] as const;
const OVER_UNDER: Readonly<Record<string, string>> = {
  player_pass_yds: 'pass_yd',
  player_pass_tds: 'pass_td',
  player_rush_yds: 'rush_yd',
  player_receptions: 'rec',
  player_reception_yds: 'rec_yd',
};
const ANYTIME_TD = 'player_anytime_td';

/**
 * A one-sided anytime-TD price (no "No" offered) carries the book's margin on that side alone. Removed as a share
 * of the implied chance [design: typical two-way hold of 6–8% falls mostly on the popular Yes side]. Calibrate on
 * scored weeks.
 */
export const ANYTIME_MARGIN = 0.08;
/** Share of a player's touchdowns that are rushing, when the projection doesn't say [design]. */
const RUSH_TD_SHARE: Readonly<Record<string, number>> = { QB: 1, RB: 0.75, WR: 0.05, TE: 0 };

/** The Odds API's team names → Sleeper team codes. */
export const TEAM_CODES: Readonly<Record<string, string>> = {
  'Arizona Cardinals': 'ARI', 'Atlanta Falcons': 'ATL', 'Baltimore Ravens': 'BAL', 'Buffalo Bills': 'BUF',
  'Carolina Panthers': 'CAR', 'Chicago Bears': 'CHI', 'Cincinnati Bengals': 'CIN', 'Cleveland Browns': 'CLE',
  'Dallas Cowboys': 'DAL', 'Denver Broncos': 'DEN', 'Detroit Lions': 'DET', 'Green Bay Packers': 'GB',
  'Houston Texans': 'HOU', 'Indianapolis Colts': 'IND', 'Jacksonville Jaguars': 'JAX', 'Kansas City Chiefs': 'KC',
  'Las Vegas Raiders': 'LV', 'Los Angeles Chargers': 'LAC', 'Los Angeles Rams': 'LAR', 'Miami Dolphins': 'MIA',
  'Minnesota Vikings': 'MIN', 'New England Patriots': 'NE', 'New Orleans Saints': 'NO', 'New York Giants': 'NYG',
  'New York Jets': 'NYJ', 'Philadelphia Eagles': 'PHI', 'Pittsburgh Steelers': 'PIT', 'San Francisco 49ers': 'SF',
  'Seattle Seahawks': 'SEA', 'Tampa Bay Buccaneers': 'TB', 'Tennessee Titans': 'TEN', 'Washington Commanders': 'WAS',
};

// ---- Pull (scripts/props/pull.ts) -----------------------------------------------------------------------------

/** props_meta.json: what one archive run fetched. Published next to the encrypted snapshot, so no odds in it. */
export interface PropsMeta {
  schemaVersion: 1;
  createdAt: string;
  /** A test fetch (PROPS_MODE=test): later runs don't count its games as fetched. */
  test?: true;
  /** Credits the event list cost, and the month's credits used and left after the last request. */
  eventsCredits?: number;
  used?: number;
  remaining?: number;
  events: Array<{ id: string; kickoff: string; home: string; away: string; credits?: number; books: number; markets: number; players: number }>;
}

/**
 * Games to fetch now: kickoff within `windowHours` from `now` and not fetched before, nearest first, as many as
 * `credits` cover at `costPerEvent` each.
 */
export function dueEvents(events: readonly OddsEvent[], now: number, windowHours: number, done: ReadonlySet<string>, credits: number, costPerEvent: number): OddsEvent[] {
  const due = events
    .filter((e) => {
      const kickoff = Date.parse(e.commence_time);
      return kickoff > now && kickoff - now <= windowHours * 3_600_000 && !done.has(e.id);
    })
    .sort((a, b) => a.commence_time.localeCompare(b.commence_time) || a.id.localeCompare(b.id));
  return due.slice(0, Math.max(0, Math.floor(credits / costPerEvent)));
}

// ---- Odds -----------------------------------------------------------------------------------------------------

export const impliedProb = (american: number): number => (american > 0 ? 100 / (american + 100) : -american / (100 - american));

/** No-vig chance of the first side: both implied chances rescaled to sum to 1. */
export function noVig(side: number, other: number): number {
  const a = impliedProb(side);
  const b = impliedProb(other);
  return a / (a + b);
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const SKILL = new Set(['QB', 'RB', 'WR', 'TE']);
const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

// ---- Shapes: a line and its chance → a mean ------------------------------------------------------------------

/** Linear interpolation of a quantile table at level p (clamped to the table's ends). */
function atLevel(levels: readonly number[], q: readonly number[], p: number): number {
  if (p <= levels[0]!) return q[0]!;
  for (let i = 1; i < levels.length; i++) {
    if (p <= levels[i]!) {
      const t = (p - levels[i - 1]!) / (levels[i]! - levels[i - 1]!);
      return q[i - 1]! + t * (q[i]! - q[i - 1]!);
    }
  }
  return q.at(-1)!;
}

/** Quantile of outcome ÷ mean at level p for a player whose mean is `mean`, interpolated between bands. */
export function shapeQuantile(bands: readonly ShapeBand[], levels: readonly number[], mean: number, p: number): number {
  const first = bands[0]!;
  if (mean <= first.center || bands.length === 1) return atLevel(levels, first.q, p);
  for (let i = 1; i < bands.length; i++) {
    const b = bands[i]!;
    if (mean <= b.center) {
      const a = bands[i - 1]!;
      const t = (mean - a.center) / (b.center - a.center);
      return (1 - t) * atLevel(levels, a.q, p) + t * atLevel(levels, b.q, p);
    }
  }
  return atLevel(levels, bands.at(-1)!.q, p);
}

/**
 * Mean of a yardage or reception outcome whose over/under `line` goes over with chance `pOver`: the mean μ at which
 * the measured shape puts `line` at quantile 1 − pOver, i.e. μ × Q(1 − pOver | μ) = line. That product rises with μ,
 * so bisection finds it. `shape` is `${stat}:${position}`; undefined when no shape was measured for it.
 */
export function meanFromLine(shape: string, line: number, pOver: number): number | undefined {
  const bands = PROP_SHAPES.shapes[shape];
  if (!bands?.length || !(line > 0)) return undefined;
  const p = 1 - clamp(pOver, 0.1, 0.9);
  const at = (mean: number) => mean * shapeQuantile(bands, PROP_SHAPES.levels, mean, p);
  let lo = 0.2 * line;
  let hi = 6 * line;
  if (at(hi) < line) return hi;
  if (at(lo) > line) return lo;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (at(mid) < line) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** P(X ≥ k) for X ~ Poisson(λ). */
function poissonAtLeast(lambda: number, k: number): number {
  let term = Math.exp(-lambda);
  let below = 0;
  for (let i = 0; i < k; i++) {
    below += term;
    term *= lambda / (i + 1);
  }
  return 1 - below;
}

/** Poisson mean whose chance of going over `line` (an x.5 line) is `pOver`. */
export function poissonMeanFromLine(line: number, pOver: number): number {
  const k = Math.floor(line) + 1;
  const target = clamp(pOver, 0.01, 0.99);
  let lo = 0;
  let hi = 20;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (poissonAtLeast(mid, k) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// ---- Players --------------------------------------------------------------------------------------------------

/** Lowercase, no accents, punctuation or suffixes; joined initials ("A. J." and "A.J." → "aj"). */
export function normalizeName(name: string): string {
  const tokens = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[.-]/g, ' ')
    .replace(/[^a-z ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  while (tokens.length > 2 && ['jr', 'sr', 'ii', 'iii', 'iv', 'v'].includes(tokens.at(-1)!)) tokens.pop();
  // Single letters in a row are initials: "a j brown" → "aj brown".
  const out: string[] = [];
  let initials = false;
  for (const t of tokens) {
    if (t.length === 1 && initials) out[out.length - 1] += t;
    else out.push(t);
    initials = t.length === 1;
  }
  return out.join(' ');
}

export interface PropPlayer {
  id: string;
  name: string;
  pos: string;
  /** Fantasy positions when they differ from `pos` (a two-way DB/WR). */
  fpos?: readonly string[];
  team?: string;
}

/** The QB/RB/WR/TE position a player's props are read as: his own, or the first skill position he's eligible at. */
const skillPos = (p: PropPlayer): string | undefined => [p.pos, ...(p.fpos ?? [])].find((x) => SKILL.has(x));

const last = (n: string) => n.split(' ').at(-1)!;

/** The player on one of `teams` named `name`: full name, then first initial and last name, then a unique last name. */
export function matchPlayer(name: string, teams: readonly string[], byTeam: ReadonlyMap<string, readonly PropPlayer[]>): PropPlayer | undefined {
  const target = normalizeName(name);
  const pool = teams.flatMap((t) => byTeam.get(t) ?? []);
  const norm = pool.map((p) => ({ p, n: normalizeName(p.name) }));
  const exact = norm.filter((x) => x.n === target);
  if (exact.length === 1) return exact[0]!.p;
  const sameLast = norm.filter((x) => last(x.n) === last(target));
  const initial = sameLast.filter((x) => x.n[0] === target[0]);
  if (initial.length === 1) return initial[0]!.p;
  return sameLast.length === 1 ? sameLast[0]!.p : undefined;
}

// ---- Events → stat lines --------------------------------------------------------------------------------------

export interface PropLine {
  /** Means of the stats the props price; the rest come from another source. */
  stats: StatLine;
  /** Books behind each stat (the most for any one). */
  books: number;
}

export interface PropsResult {
  lines: Map<string, PropLine>;
  /** Distinct players in the props: matched to a Sleeper id, or not. */
  matched: number;
  unmatched: number;
}

/** Which measured shape prices `stat` for a player at `pos` (WR/TE rushing props use the RB shape). */
function shapeKey(stat: string, pos: string): string {
  if (stat === 'pass_yd') return 'pass_yd:QB';
  if (stat === 'rush_yd') return pos === 'QB' ? 'rush_yd:QB' : 'rush_yd:RB';
  return `${stat}:${pos === 'QB' ? 'WR' : pos}`;
}

/**
 * Prop-implied stat means for every matched player in `events` (games with bookmakers). Each book's line becomes a
 * mean; the player's mean is the median over books. `base` gives a player's other projection, used only to split
 * anytime-TD expectations between rushing and receiving.
 */
export function propsStatLines(
  events: readonly OddsEvent[],
  players: readonly PropPlayer[],
  base?: (id: string) => StatLine | undefined,
): PropsResult {
  const byTeam = new Map<string, PropPlayer[]>();
  const posOf = new Map<string, string>();
  for (const p of players) {
    const pos = skillPos(p);
    if (!p.team || !pos) continue;
    (byTeam.get(p.team) ?? byTeam.set(p.team, []).get(p.team)!).push(p);
    posOf.set(p.id, pos);
  }
  // per player id → stat → per-book means
  const perBook = new Map<string, Map<string, number[]>>();
  const seen = new Set<string>();
  const unmatched = new Set<string>();
  const add = (id: string, stat: string, v: number) => {
    const m = perBook.get(id) ?? perBook.set(id, new Map()).get(id)!;
    (m.get(stat) ?? m.set(stat, []).get(stat)!).push(v);
  };
  // Team defense touchdown props ("Houston Texans D/ST", "… Defense") aren't players.
  const teamProp = (name: string) => Object.keys(TEAM_CODES).some((t) => name.startsWith(t));

  for (const ev of events) {
    const teams = [TEAM_CODES[ev.home_team], TEAM_CODES[ev.away_team]].filter((t): t is string => !!t);
    const resolved = new Map<string, PropPlayer | undefined>();
    const who = (name: string) => {
      if (teamProp(name)) return undefined;
      if (!resolved.has(name)) resolved.set(name, matchPlayer(name, teams, byTeam));
      const p = resolved.get(name);
      if (p) seen.add(p.id);
      else unmatched.add(name);
      return p;
    };
    for (const book of ev.bookmakers ?? []) {
      for (const market of book.markets) {
        const byPlayer = new Map<string, OddsOutcome[]>();
        for (const o of market.outcomes) if (o.description) (byPlayer.get(o.description) ?? byPlayer.set(o.description, []).get(o.description)!).push(o);
        for (const [name, outs] of byPlayer) {
          const player = who(name);
          if (!player) continue;
          if (market.key === ANYTIME_TD) {
            const yes = outs.find((o) => o.name === 'Yes');
            if (!yes) continue;
            const no = outs.find((o) => o.name === 'No');
            const p = no ? noVig(yes.price, no.price) : impliedProb(yes.price) / (1 + ANYTIME_MARGIN);
            add(player.id, 'td', -Math.log(1 - clamp(p, 0.001, 0.95)));
            continue;
          }
          const stat = OVER_UNDER[market.key];
          const over = outs.find((o) => o.name === 'Over');
          const under = outs.find((o) => o.name === 'Under' && o.point === over?.point);
          if (!stat || !over || !under || over.point === undefined) continue;
          const pOver = noVig(over.price, under.price);
          const mean = stat === 'pass_td' ? poissonMeanFromLine(over.point, pOver) : meanFromLine(shapeKey(stat, posOf.get(player.id)!), over.point, pOver);
          if (mean !== undefined && Number.isFinite(mean)) add(player.id, stat, mean);
        }
      }
    }
  }

  const lines = new Map<string, PropLine>();
  for (const [id, stats] of perBook) {
    const line: StatLine = {};
    let books = 0;
    for (const [stat, values] of stats) {
      books = Math.max(books, values.length);
      if (stat !== 'td') {
        line[stat] = median(values);
        continue;
      }
      // Anytime TD → rushing and receiving touchdowns, split as the other projection splits them.
      const tds = median(values);
      const b = base?.(id);
      const rush = b?.rush_td ?? 0;
      const rec = b?.rec_td ?? 0;
      const share = rush + rec > 0 ? rush / (rush + rec) : (RUSH_TD_SHARE[posOf.get(id) ?? ''] ?? 0.5);
      line.rush_td = tds * share;
      line.rec_td = tds * (1 - share);
    }
    lines.set(id, { stats: line, books });
  }
  return { lines, matched: seen.size, unmatched: unmatched.size };
}

// ---- Calibration (scripts/calibrate/prop-shapes.ts) -----------------------------------------------------------

/** Quantile levels stored for each shape. */
export const SHAPE_LEVELS = [0.02, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 0.98];

/** Type-7 quantile of sorted values. */
export function quantileSorted(sorted: readonly number[], p: number): number {
  const i = p * (sorted.length - 1);
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (i - lo);
}

/**
 * Shapes from (projected, actual) pairs: equal-count bands of the projection, each with the quantiles of actual ÷
 * projected rescaled to mean 1 (so the table describes the outcome around its mean, whatever the projection's bias).
 */
export function bandShapes(pairs: ReadonlyArray<readonly [number, number]>, bandSize: number, maxBands: number): ShapeBand[] {
  const sorted = [...pairs].filter(([m]) => m > 0).sort((a, b) => a[0] - b[0]);
  const count = Math.max(1, Math.min(maxBands, Math.floor(sorted.length / bandSize)));
  const out: ShapeBand[] = [];
  for (let b = 0; b < count; b++) {
    const rows = sorted.slice(Math.floor((b * sorted.length) / count), Math.floor(((b + 1) * sorted.length) / count));
    const ratios = rows.map(([m, a]) => a / m);
    const meanRatio = ratios.reduce((s, r) => s + r, 0) / ratios.length;
    const scaled = ratios.map((r) => r / meanRatio).sort((x, y) => x - y);
    out.push({
      center: rows.reduce((s, [m]) => s + m, 0) / rows.length,
      n: rows.length,
      q: SHAPE_LEVELS.map((p) => quantileSorted(scaled, p)),
    });
  }
  return out;
}
