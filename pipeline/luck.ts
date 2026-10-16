// Buy low / sell high (docs/luck.md): a player's recent "luck" is his points above what his usage was worth
// (ffopportunity expected points) over his last few games. scripts/backtest/luck.ts tests whether it predicts how he
// does against Sleeper's (RotoWire's) projection afterwards.

/** One player's week: points scored, what his usage was worth, and the projection before kickoff. */
export interface PlayerWeek {
  season: number;
  week: number;
  player: string;
  pos: string;
  played: boolean;
  actual: number;
  /** Expected points from usage (ffopportunity), when it has the game. */
  xfp?: number;
  /** Points if he plays, from Sleeper's projection frozen around kickoff. */
  proj?: number;
}

/** A player-week with his luck going into it, and what happened against the projection then and over the next few weeks. */
export interface LuckRow {
  season: number;
  week: number;
  player: string;
  pos: string;
  games: number;
  /** Per game over the window: points, usage-expected points, and their difference (the luck). */
  recent: number;
  usage: number;
  luck: number;
  /** This week: projection and points. */
  proj: number;
  actual: number;
  /** This week and the next `horizon − 1` he played and was projected: mean projection and points. */
  ahead: { n: number; proj: number; actual: number };
}

export interface LuckOptions {
  /** Previous games in the window. */
  window?: number;
  /** Fewest of them with usage data. */
  minGames?: number;
  /** Weeks counted ahead, this one included. */
  horizon?: number;
  /** Projected at least this many points (as in the other backtests). */
  minProj?: number;
}

/** Every relevant player-week with at least `minGames` of the player's last `window` games behind it, in the same season. */
export function luckRows(weeks: readonly PlayerWeek[], opts: LuckOptions = {}): LuckRow[] {
  const { window = 4, minGames = 3, horizon = 4, minProj = 5 } = opts;
  const byPlayer = new Map<string, PlayerWeek[]>();
  for (const w of weeks) {
    const key = `${w.season}|${w.player}`;
    byPlayer.set(key, [...(byPlayer.get(key) ?? []), w]);
  }
  const out: LuckRow[] = [];
  for (const list of byPlayer.values()) {
    list.sort((a, b) => a.week - b.week);
    const games = list.filter((w) => w.played && w.xfp !== undefined);
    for (const now of list) {
      if (!now.played || now.proj === undefined || now.proj < minProj) continue;
      const before = games.filter((g) => g.week < now.week).slice(-window);
      if (before.length < minGames) continue;
      const recent = before.reduce((s, g) => s + g.actual, 0) / before.length;
      const usage = before.reduce((s, g) => s + g.xfp!, 0) / before.length;
      const next = list.filter((w) => w.week >= now.week && w.week < now.week + horizon && w.played && w.proj !== undefined && w.proj >= minProj);
      out.push({
        season: now.season,
        week: now.week,
        player: now.player,
        pos: now.pos,
        games: before.length,
        recent,
        usage,
        luck: recent - usage,
        proj: now.proj,
        actual: now.actual,
        ahead: { n: next.length, proj: next.reduce((s, w) => s + w.proj!, 0) / next.length, actual: next.reduce((s, w) => s + w.actual, 0) / next.length },
      });
    }
  }
  return out;
}

/** Least-squares slope (with intercept) of y on x. */
export function slope(xs: readonly number[], ys: readonly number[]): { b: number; a: number } {
  const n = xs.length;
  if (!n) return { b: 0, a: 0 };
  const mx = xs.reduce((s, x) => s + x, 0) / n;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i]! - mx) * (ys[i]! - my);
    sxx += (xs[i]! - mx) ** 2;
  }
  const b = sxx > 0 ? sxy / sxx : 0;
  return { b, a: my - b * mx };
}

/** Pearson correlation. */
export function correlation(xs: readonly number[], ys: readonly number[]): number {
  const n = xs.length;
  const mx = xs.reduce((s, x) => s + x, 0) / n;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i]! - mx) * (ys[i]! - my);
    sxx += (xs[i]! - mx) ** 2;
    syy += (ys[i]! - my) ** 2;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
}
