import type { BracketMatch, BracketSlot } from '../domain/types';
import type { Dist } from '../engine/winprob';
import { mulberry32, normalSampler } from './season';

/** The games that lead to the title: the bracket's games without a placement, and the final. */
export function titlePath(matches: readonly BracketMatch[]): BracketMatch[] {
  return matches.filter((m) => m.place === undefined || m.place === 1).sort((a, b) => a.round - b.round || a.id - b.id);
}

/** A slot's team: fixed, or the winner or loser of an earlier game once that's decided. */
export function slotTeam(slot: BracketSlot, winners: ReadonlyMap<number, number>, losers: ReadonlyMap<number, number>): number | null {
  if (slot.rosterId !== null) return slot.rosterId;
  if (!slot.from) return null;
  return (slot.from.take === 'winner' ? winners : losers).get(slot.from.match) ?? null;
}

export interface BracketGame {
  match: number;
  round: number;
  /** As far as the results so far decide them. */
  teams: [number | null, number | null];
  winner: number | null;
}

export interface BracketState {
  /** Rounds to the final. */
  rounds: number;
  /** The earliest round with a game still to decide; rounds + 1 once the final is decided. */
  currentRound: number;
  /** The title-path games, in round order. */
  games: BracketGame[];
  /** Teams that can still win the title. */
  alive: Set<number>;
  /** Teams that skipped the first round. */
  byes: Set<number>;
  /** The round each team was knocked out in. */
  outIn: Map<number, number>;
  champion?: number;
}

/** Where the title race stands, from the bracket's results. */
export function bracketState(matches: readonly BracketMatch[]): BracketState {
  const path = titlePath(matches);
  const winners = new Map<number, number>();
  const losers = new Map<number, number>();
  const games: BracketGame[] = [];
  const seen = new Set<number>();
  const outIn = new Map<number, number>();
  const firstRound = new Map<number, number>();
  for (const m of path) {
    const teams: [number | null, number | null] = [slotTeam(m.slots[0], winners, losers), slotTeam(m.slots[1], winners, losers)];
    for (const t of teams) {
      if (t === null) continue;
      seen.add(t);
      if (!firstRound.has(t)) firstRound.set(t, m.round);
    }
    if (m.winner !== null) {
      winners.set(m.id, m.winner);
      const loser = m.loser ?? teams.find((t) => t !== null && t !== m.winner) ?? null;
      if (loser !== null) {
        losers.set(m.id, loser);
        outIn.set(loser, m.round);
      }
    }
    games.push({ match: m.id, round: m.round, teams, winner: m.winner });
  }
  const rounds = path.reduce((r, m) => Math.max(r, m.round), 0);
  const open = path.filter((m) => m.winner === null);
  const final = path.find((m) => m.place === 1) ?? path.at(-1);
  const state: BracketState = {
    rounds,
    currentRound: open.length ? Math.min(...open.map((m) => m.round)) : rounds + 1,
    games,
    alive: new Set([...seen].filter((t) => !outIn.has(t))),
    byes: new Set([...firstRound].filter(([, r]) => r > 1).map(([t]) => t)),
    outIn,
  };
  if (final?.winner != null) state.champion = final.winner;
  return state;
}

export interface BracketTeam {
  rosterId: number;
  /** Score distribution in each round (index = round − 1): the round's weeks added up. */
  rounds: readonly Dist[];
  /** Weekly SD of persistent drift (season.ts), over the rounds' weeks still to come. */
  drift?: number;
}

export interface BracketInput {
  matches: readonly BracketMatch[];
  teams: readonly BracketTeam[];
  /** Weeks still to come in each round (index = round − 1): the drift walks through them in order. */
  futureWeeks?: readonly number[];
  /** Regular-season finish (1 = best): a tied game goes to the better seed. */
  seeds: ReadonlyMap<number, number>;
  sims?: number;
  seed?: number;
}

export interface BracketOdds {
  rosterId: number;
  alive: boolean;
  bye: boolean;
  pTitle: number;
  /** P(playing a title-path game in each round), decided games included. */
  pRound: number[];
  /** P(winning a title-path game in each round). */
  pWin: number[];
}

/**
 * Monte Carlo of the rest of the winners' bracket from Sleeper's results so far: decided games stand, and each game
 * still open goes to the higher score drawn from the two teams' distributions for that round (actual points for
 * the weeks already played). A tie goes to the better seed. Placement games (3rd, 5th) don't matter for the title.
 */
export function simulateBracket(input: BracketInput): Map<number, BracketOdds> {
  const state = bracketState(input.matches);
  const path = titlePath(input.matches);
  const final = path.find((m) => m.place === 1) ?? path.at(-1);
  const rounds = state.rounds;
  const sims = input.sims ?? 4000;
  const gauss = normalSampler(mulberry32(input.seed ?? 20261216));
  const index = new Map(input.teams.map((t, i) => [t.rosterId, i]));
  const n = input.teams.length;
  const sds = input.teams.map((t) => t.rounds.map((d) => Math.sqrt(Math.max(0, d.variance))));
  const shift = new Float64Array(n * Math.max(1, rounds));
  const played = new Float64Array(n * Math.max(1, rounds));
  const won = new Float64Array(n * Math.max(1, rounds));
  const titles = new Float64Array(n);
  const winners = new Map<number, number>();
  const losers = new Map<number, number>();
  const seedOf = (t: number) => input.seeds.get(t) ?? Number.MAX_SAFE_INTEGER;
  const count = (a: Float64Array, team: number, round: number) => {
    const i = index.get(team);
    if (i !== undefined && round >= 1 && round <= rounds) a[i * rounds + round - 1] = a[i * rounds + round - 1]! + 1;
  };
  const score = (team: number, round: number) => {
    const i = index.get(team);
    const d = i === undefined ? undefined : input.teams[i]!.rounds[round - 1];
    if (i === undefined || !d) return 0;
    return d.mean + shift[i * rounds + round - 1]! + sds[i]![round - 1]! * gauss();
  };

  for (let s = 0; s < sims; s++) {
    winners.clear();
    losers.clear();
    // Persistent drift: each team's level walks on through the weeks still to come, round by round.
    for (let i = 0; i < n; i++) {
      const drift = input.teams[i]!.drift ?? 0;
      let level = 0;
      for (let r = 0; r < rounds; r++) {
        let total = 0;
        for (let w = 0; w < (input.futureWeeks?.[r] ?? 0); w++) {
          if (drift > 0) level += drift * gauss();
          total += level;
        }
        shift[i * rounds + r] = total;
      }
    }
    for (const m of path) {
      const a = slotTeam(m.slots[0], winners, losers);
      const b = slotTeam(m.slots[1], winners, losers);
      if (m.winner !== null) {
        const loser = m.loser ?? (a === m.winner ? b : a);
        winners.set(m.id, m.winner);
        if (loser !== null) losers.set(m.id, loser);
        count(played, m.winner, m.round);
        if (loser !== null) count(played, loser, m.round);
        count(won, m.winner, m.round);
        continue;
      }
      if (a === null || b === null) {
        // Only one team known (a bye Sleeper didn't list as one): it goes through without a game.
        const through = a ?? b;
        if (through !== null) winners.set(m.id, through);
        continue;
      }
      count(played, a, m.round);
      count(played, b, m.round);
      const sa = score(a, m.round);
      const sb = score(b, m.round);
      const w = sa > sb || (sa === sb && seedOf(a) <= seedOf(b)) ? a : b;
      winners.set(m.id, w);
      losers.set(m.id, w === a ? b : a);
      count(won, w, m.round);
    }
    const champion = final ? winners.get(final.id) : undefined;
    const ci = champion === undefined ? undefined : index.get(champion);
    if (ci !== undefined) titles[ci] = titles[ci]! + 1;
  }

  return new Map(
    input.teams.map((t, i) => [
      t.rosterId,
      {
        rosterId: t.rosterId,
        alive: state.alive.has(t.rosterId),
        bye: state.byes.has(t.rosterId),
        pTitle: titles[i]! / sims,
        pRound: Array.from(played.subarray(i * rounds, (i + 1) * rounds), (c) => c / sims),
        pWin: Array.from(won.subarray(i * rounds, (i + 1) * rounds), (c) => c / sims),
      },
    ]),
  );
}
