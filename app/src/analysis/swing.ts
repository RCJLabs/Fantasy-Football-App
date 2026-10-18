// Swing players (the Matchup tab, docs/gameday.md): starters on either side whose games aren't over, ranked by how much
// their result moves your win chance. It conditions the matchup's margin on one player's points, with the same normal
// model and same-game correlations as the win chance itself, so a QB's boom also lifts his receivers in your lineup.
import { pairCorrelation } from '../engine/correlation';
import { normCdf } from '../engine/math';
import { corrItem, starterDist, type LineupAnalysis, type PlayerRow } from './analyze';
import { gameState } from './liveMatchup';

/** A boom or a bust: one SD above or below his expected points (about the 84th and 16th percentiles). [design] */
const Z = 1;
/** Players with less than this SD left can't move the game. [design] */
const MIN_SD = 0.5;

export interface SwingPlayer {
  row: PlayerRow;
  side: 'me' | 'opp';
  /** Expected final points, and the SD of what's left. */
  mean: number;
  sd: number;
  /** Lowest final he can have: his points so far. */
  floor: number;
  /** Win chance if he finishes one SD above / below his expected points. */
  boom: number;
  bust: number;
  /** How much he moves your chance: boom − bust for yours, bust − boom for theirs. */
  swing: number;
  /** Win chance if he finishes with `points`. */
  winIf: (points: number) => number;
}

const isRow = (r: PlayerRow | null): r is PlayerRow => r !== null;

/** Swing players for the lineup as set, biggest first; empty without an opponent. */
export function swingPlayers(a: LineupAnalysis, now: number): SwingPlayer[] {
  const margin = a.marginCurrent;
  if (!margin || !a.opponent) return [];
  const sides = { me: a.current.filter(isRow), opp: a.opponent.rows.filter(isRow) };
  const out: SwingPlayer[] = [];
  for (const side of ['me', 'opp'] as const) {
    const own = sides[side];
    const other = sides[side === 'me' ? 'opp' : 'me'];
    for (const r of own) {
      const state = gameState(r, now);
      if (state === 'final' || state === 'bye') continue;
      const d = starterDist(r, now);
      if (d.variance < MIN_SD * MIN_SD) continue;
      // Covariance of the margin (yours − theirs) with his points: his own variance plus his correlated teammates'.
      const x = corrItem(r, now);
      let c = d.variance;
      for (const q of own) if (q.id !== r.id) c += pairCorrelation(x, q) * x.sd * corrItem(q, now).sd;
      for (const q of other) c -= pairCorrelation(x, q) * x.sd * corrItem(q, now).sd;
      if (side === 'opp') c = -c;
      const sdLeft = Math.sqrt(Math.max(1e-9, margin.variance - (c * c) / d.variance));
      const winIf = (points: number) => normCdf((margin.mean + (c * (points - d.mean)) / d.variance) / sdLeft);
      const sd = Math.sqrt(d.variance);
      const floor = r.actual ?? 0;
      const boom = winIf(d.mean + Z * sd);
      const bust = winIf(Math.max(floor, d.mean - Z * sd));
      out.push({ row: r, side, mean: d.mean, sd, floor, boom, bust, swing: side === 'me' ? boom - bust : bust - boom, winIf });
    }
  }
  return out.sort((p, q) => q.swing - p.swing);
}
