/**
 * Correlation between two players' projection misses (actual − projected points, each scaled by its
 * spread) when they play in the same NFL game.
 *
 * [own calc] 2026 weeks 1–5, 100–1,000 pairs per cell (95% CI ±0.06–0.18): rounded toward zero, and
 * cells within noise of zero are left out. They agree with commonly cited DFS correlations [reported]:
 * QB–pass-catcher stacks positive, a QB against the opposing DEF strongly negative, same-team RBs
 * negative. Measured: same-team QB–WR +0.27, QB–TE +0.33, RB–RB −0.25, WR–WR −0.13; opposing QB–DEF
 * −0.37, QB–QB +0.12.
 */
const SAME_TEAM: Record<string, number> = {
  'QB-WR': 0.3,
  'QB-TE': 0.3,
  'QB-K': 0.15,
  'QB-RB': 0.05,
  'RB-RB': -0.2,
  'WR-WR': -0.1,
  'RB-WR': -0.05,
  'RB-TE': -0.05,
  'RB-K': 0.1,
  'TE-K': 0.1,
  'WR-K': 0.05,
  'K-DEF': 0.1,
};
const OPPONENTS: Record<string, number> = {
  'QB-DEF': -0.35,
  'RB-DEF': -0.12,
  'WR-DEF': -0.1,
  'TE-DEF': -0.12,
  'K-DEF': -0.15,
  'QB-QB': 0.1,
};
const ORDER = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

export interface CorrPlayer {
  pos: string;
  team: string | null;
  /** NFL opponent this week (a DEF's opponent is the offense it faces). */
  opponent?: string | null;
}

export function pairCorrelation(a: CorrPlayer, b: CorrPlayer): number {
  if (!a.team || !b.team) return 0;
  const [x, y] = ORDER.indexOf(a.pos) <= ORDER.indexOf(b.pos) ? [a, b] : [b, a];
  const key = `${x.pos}-${y.pos}`;
  if (a.team === b.team) return SAME_TEAM[key] ?? 0;
  if (a.opponent && a.opponent === b.team) return OPPONENTS[key] ?? 0;
  return 0;
}

export interface CorrItem extends CorrPlayer {
  /** SD of the part of the player's points that moves with the game (0 once it's in the books). */
  sd: number;
}

/** Extra variance of a lineup's total from correlated pairs: Σ over pairs of 2ρσσ. */
export function withinCovariance(items: readonly CorrItem[]): number {
  let c = 0;
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const r = pairCorrelation(items[i]!, items[j]!);
      if (r) c += 2 * r * items[i]!.sd * items[j]!.sd;
    }
  }
  return c;
}

/** Covariance between two lineups' totals, from players in the same NFL games. */
export function crossCovariance(a: readonly CorrItem[], b: readonly CorrItem[]): number {
  let c = 0;
  for (const x of a) {
    for (const y of b) {
      const r = pairCorrelation(x, y);
      if (r) c += r * x.sd * y.sd;
    }
  }
  return c;
}
