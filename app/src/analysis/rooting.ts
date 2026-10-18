// Rooting guide (Home, docs/gameday.md): for each NFL game not over yet, which sides to root for across all your
// leagues, and how much the game can move each league's win chance. A game's stake in one league conditions that
// matchup's margin on the game's net (your starters in it minus your opponent's), with the win chance's own normal
// model; players in other games are independent of it, so the conditioning needs only the net's own spread.
import { pairCorrelation } from '../engine/correlation';
import { normCdf } from '../engine/math';
import { corrItem, starterDist, type LineupAnalysis, type PlayerRow } from './analyze';
import { gameState } from './liveMatchup';

/** Sides with less than this many expected points left either way aren't worth a verdict. [design] */
const MIN_NET = 0.5;
/** A game whose net can't move by this SD has nothing at stake. [design] */
const MIN_SD = 0.5;
const DEFENSE = new Set(['DEF', 'DL', 'LB', 'DB', 'IDP_FLEX']);

export interface RootingInput {
  leagueId: string;
  name: string;
  /** That league's lineup analysis: your lineup as set and the opponent's starters. */
  a: LineupAnalysis;
}

export interface RootingSide {
  team: string;
  unit: 'offense' | 'defense';
  /** Your starters' expected points still to come minus your opponents', over all your leagues. */
  net: number;
  /** Players and how many of your leagues each one starts in, for you or against you. */
  yours: Array<{ row: PlayerRow; leagues: number }>;
  theirs: Array<{ row: PlayerRow; leagues: number }>;
}

export interface RootingStake {
  leagueId: string;
  name: string;
  /** Win chance now, and if the game goes your way or against you (its net one SD above or below expected). */
  now: number;
  good: number;
  bad: number;
}

export interface RootingGame {
  /** "AWY@HOM". */
  game: string;
  kickoff: number | null;
  live: boolean;
  /** Sides with something at stake, biggest first. */
  sides: RootingSide[];
  /** Leagues with players in the game, biggest swing first. */
  stakes: RootingStake[];
  /** Expected wins at stake: the leagues' (good − bad) added up. */
  swing: number;
}

const isRow = (r: PlayerRow | null): r is PlayerRow => r !== null;
const gameKey = (r: PlayerRow) => (r.home ? `${r.opponent}@${r.team}` : `${r.team}@${r.opponent}`);

function addPlayer(list: Array<{ row: PlayerRow; leagues: number }>, row: PlayerRow): void {
  const e = list.find((x) => x.row.id === row.id);
  if (e) e.leagues++;
  else list.push({ row, leagues: 1 });
}

/** Games not over yet with your starters or your opponents' in them: the most at stake first, then by kickoff. */
export function rootingGuide(leagues: readonly RootingInput[], now: number): RootingGame[] {
  type Building = RootingGame & { bySide: Map<string, RootingSide> };
  const games = new Map<string, Building>();
  for (const { leagueId, name, a } of leagues) {
    const signed = [
      ...a.current.filter(isRow).map((row) => ({ row, sign: 1 })),
      ...(a.opponent?.rows.filter(isRow) ?? []).map((row) => ({ row, sign: -1 })),
    ].filter(({ row }) => row.team && row.opponent && ['upcoming', 'live'].includes(gameState(row, now)));
    const byGame = new Map<string, typeof signed>();
    for (const p of signed) byGame.set(gameKey(p.row), [...(byGame.get(gameKey(p.row)) ?? []), p]);
    for (const [key, players] of byGame) {
      const first = players[0]!.row;
      const g: Building = games.get(key) ?? { game: key, kickoff: first.kickoff, live: false, sides: [], stakes: [], swing: 0, bySide: new Map() };
      g.live ||= gameState(first, now) === 'live';
      for (const { row, sign } of players) {
        const left = starterDist(row, now).mean - (row.actual ?? 0);
        if (left <= 0) continue; // Out, or nothing left to score
        const unit = DEFENSE.has(row.pos) ? 'defense' : 'offense';
        const sideKey = `${row.team}:${unit}`;
        const side: RootingSide = g.bySide.get(sideKey) ?? { team: row.team!, unit, net: 0, yours: [], theirs: [] };
        side.net += sign * left;
        addPlayer(sign > 0 ? side.yours : side.theirs, row);
        g.bySide.set(sideKey, side);
      }
      // The game's net and its spread, teammates' correlations included (signs flip for the opponent's players).
      const margin = a.marginCurrent;
      if (margin && a.opponent) {
        let v = 0;
        for (let i = 0; i < players.length; i++) {
          const pi = players[i]!;
          v += starterDist(pi.row, now).variance;
          const ci = corrItem(pi.row, now);
          for (let j = i + 1; j < players.length; j++) {
            const pj = players[j]!;
            const cj = corrItem(pj.row, now);
            v += 2 * pi.sign * pj.sign * pairCorrelation(ci, cj) * ci.sd * cj.sd;
          }
        }
        if (v >= MIN_SD * MIN_SD) {
          const sd = Math.sqrt(v);
          const rest = Math.sqrt(Math.max(1e-9, margin.variance - v));
          const stake: RootingStake = {
            leagueId,
            name,
            now: a.winProbCurrent ?? normCdf(margin.mean / Math.sqrt(Math.max(1e-9, margin.variance))),
            good: normCdf((margin.mean + sd) / rest),
            bad: normCdf((margin.mean - sd) / rest),
          };
          g.stakes.push(stake);
          g.swing += stake.good - stake.bad;
        }
      }
      games.set(key, g);
    }
  }
  return [...games.values()]
    .map(({ bySide, ...g }) => ({
      ...g,
      sides: [...bySide.values()].filter((s) => Math.abs(s.net) >= MIN_NET).sort((x, y) => Math.abs(y.net) - Math.abs(x.net)),
      stakes: g.stakes.sort((x, y) => y.good - y.bad - (x.good - x.bad)),
    }))
    .filter((g) => g.sides.length)
    // Swings within half a point of each other count as equal: then the earlier game first.
    .sort((x, y) => Math.round(y.swing * 100) - Math.round(x.swing * 100) || (x.kickoff ?? 0) - (y.kickoff ?? 0));
}
