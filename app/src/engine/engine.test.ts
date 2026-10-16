import { describe, expect, it } from 'vitest';
import { bestAssignment, hungarianMin } from './assignment';
import { conditionalMean, playProbability } from './availability';
import { expectNormal, gaussHermite, normCdf, normInterval } from './math';
import { crossCovariance, pairCorrelation, withinCovariance } from './correlation';
import { canFill, optimizeLineup, startingSlots, twoStageValue, type LineupPlayer, type LineupProblem } from './lineup';
import { expectedStats, projectedPoints, scoreStats, uncoveredScoringKeys } from './scoring';
import { pointSd, playerDist, probBeatAtLeast, sumDists, winProbability } from './winprob';

describe('math', () => {
  it('normCdf matches known values', () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 7);
    expect(normCdf(1.959964)).toBeCloseTo(0.975, 5);
    expect(normCdf(-1)).toBeCloseTo(0.158655, 5);
  });
  it('Gauss–Hermite weights integrate the normal moments', () => {
    const { weights } = gaussHermite(24);
    expect(weights.reduce((a, b) => a + b, 0)).toBeCloseTo(Math.sqrt(Math.PI), 10);
    expect(expectNormal(3, 2, (x) => x)).toBeCloseTo(3, 10);
    expect(expectNormal(3, 2, (x) => (x - 3) ** 2)).toBeCloseTo(4, 8);
    // Smooth integrands only (what probBeatAtLeast uses): E[Φ(X + 1)] = Φ(1/√2) for X ~ N(0, 1).
    expect(expectNormal(0, 1, (x) => normCdf(x + 1))).toBeCloseTo(normCdf(1 / Math.SQRT2), 6);
  });
  it('normInterval sums to 1 over a partition', () => {
    const cuts = [-Infinity, 0.5, 6.5, 13.5, 20.5, 27.5, 34.5, Infinity];
    let total = 0;
    for (let i = 0; i < cuts.length - 1; i++) total += normInterval(22, 9.5, cuts[i]!, cuts[i + 1]!);
    expect(total).toBeCloseTo(1, 9);
  });
});

describe('scoring', () => {
  const halfPpr = { rec: 0.5, rec_yd: 0.1, rec_td: 6, rush_yd: 0.1, rush_td: 6, pass_yd: 0.04, pass_td: 4, pass_int: -1, fum_lost: -2 };

  it('scores an actual stat line as a dot product over league keys', () => {
    expect(scoreStats({ rec: 6, rec_yd: 85, rec_td: 1, rush_yd: 4, fum_lost: 1, tm_off_snp: 70 }, halfPpr)).toBeCloseTo(3 + 8.5 + 6 + 0.4 - 2, 9);
  });

  it('applies TE premium only through the TE-specific stat key', () => {
    const scoring = { ...halfPpr, bonus_rec_te: 0.5 };
    expect(scoreStats({ rec: 5, bonus_rec_te: 5 }, scoring)).toBeCloseTo(2.5 + 2.5, 9);
    expect(scoreStats({ rec: 5 }, scoring)).toBeCloseTo(2.5, 9); // a WR has no bonus_rec_te
  });

  it('prices yardage bonuses from the projected mean, not as all-or-nothing', () => {
    const exp = expectedStats({ rec_yd: 100, rec: 7 }, 'WR');
    expect(exp.bonus_rec_yd_100).toBeCloseTo(0.5, 6);
    const low = expectedStats({ rec_yd: 40 }, 'WR');
    expect(low.bonus_rec_yd_100).toBeGreaterThan(0);
    expect(low.bonus_rec_yd_100).toBeLessThan(0.1);
    expect(projectedPoints({ rec_yd: 100 }, { bonus_rec_yd_100: 3 }, 'WR')).toBeCloseTo(1.5, 6);
  });

  it('replaces one-hot DEF buckets with probabilities around projected points allowed', () => {
    const proj = { pts_allow: 21, pts_allow_21_27: 1, yds_allow: 330, sack: 2.5 };
    const exp = expectedStats(proj, 'DEF');
    const buckets = ['pts_allow_0', 'pts_allow_1_6', 'pts_allow_7_13', 'pts_allow_14_20', 'pts_allow_21_27', 'pts_allow_28_34', 'pts_allow_35p'];
    const total = buckets.reduce((a, k) => a + (exp[k] ?? 0), 0);
    expect(total).toBeCloseTo(1, 9);
    expect(exp.pts_allow_21_27).toBeLessThan(0.5);
    expect(exp.pts_allow_14_20).toBeGreaterThan(0.2);
    // A typical DST scoring: 14–20 allowed = +1, 21–27 = 0, 28–34 = −1.
    const pts = projectedPoints(proj, { sack: 1, pts_allow_14_20: 1, pts_allow_21_27: 0, pts_allow_28_34: -1 }, 'DEF');
    expect(pts).toBeGreaterThan(2.5);
    expect(pts).toBeLessThan(3.5);
  });

  it('derives position reception bonuses (TE premium) from receptions when a source lacks them', () => {
    expect(expectedStats({ rec: 5 }, 'TE').bonus_rec_te).toBe(5);
    expect(expectedStats({ rec: 5, bonus_rec_te: 4 }, 'TE').bonus_rec_te).toBe(4); // the source's own value wins
    expect(expectedStats({ rec: 5 }, 'WR').bonus_rec_te).toBeUndefined();
    expect(expectedStats({ rec: 1 }, 'QB').bonus_rec_qb).toBeUndefined();
  });

  it('derives position-specific first-down bonuses', () => {
    expect(expectedStats({ rush_fd: 3, rec_fd: 1 }, 'RB').bonus_fd_rb).toBe(4);
    expect(expectedStats({ pass_fd: 12, rush_fd: 1 }, 'QB').bonus_fd_qb).toBe(13);
  });

  it('lists scoring keys no projection covers, minus rare special-teams events', () => {
    const scoring = { rec: 1, pass_td: 4, idp_tkl_solo: 1, def_3_and_out: 1, bonus_rec_yd_100: 2, zero_key: 0, def_st_td: 6, fgmiss: -1 };
    expect(uncoveredScoringKeys(scoring, new Set(['rec', 'pass_td', 'idp_tkl_solo']))).toEqual(['def_3_and_out']);
  });

  it('derives kicker misses and long-FG splits that projections lack', () => {
    const k = expectedStats({ fga: 2.2, fgm: 1.9, fgm_50p: 0.3, xpm: 2.5 }, 'K');
    expect(k.fgmiss).toBeCloseTo(0.3, 9);
    expect(k.fgm_50_59! + k.fgm_60p!).toBeCloseTo(0.3, 9);
    expect(k.fgm_60p).toBeLessThan(0.05);
    // Leagues score either 50+ or 50–59 / 60+: both schemes give the same expected points here.
    const both = { fgm_50p: 5, fgmiss: -1 };
    const split = { fgm_50_59: 5, fgm_60p: 5, fgmiss: -1 };
    expect(projectedPoints({ fga: 2.2, fgm: 1.9, fgm_50p: 0.3 }, both, 'K')).toBeCloseTo(projectedPoints({ fga: 2.2, fgm: 1.9, fgm_50p: 0.3 }, split, 'K'), 9);
  });
});

describe('availability', () => {
  it('maps designations and final practice status to P(active) (2023–25 calibration)', () => {
    expect(playProbability(null)).toBeCloseTo(0.99);
    expect(playProbability('Questionable')).toBeCloseTo(0.72);
    expect(playProbability('Questionable', 'Full')).toBeCloseTo(0.92);
    expect(playProbability('Questionable', 'Limited')).toBeCloseTo(0.71);
    expect(playProbability('Questionable', 'DNP')).toBeCloseTo(0.56);
    expect(playProbability('Doubtful')).toBeCloseTo(0.02);
    expect(playProbability('Out')).toBe(0);
    expect(playProbability('IR')).toBe(0);
  });
  it('treats projections as conditional on playing by default', () => {
    expect(conditionalMean(12, 'Questionable')).toBe(12);
  });
});

describe('assignment', () => {
  it('Hungarian matches brute force on random instances', () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let trial = 0; trial < 40; trial++) {
      const n = 1 + Math.floor(rand() * 4);
      const m = n + Math.floor(rand() * 3);
      const cost = Array.from({ length: n }, () => Array.from({ length: m }, () => Math.round(rand() * 20)));
      const ans = hungarianMin(cost);
      const got = ans.reduce((a, c, r) => a + cost[r]![c]!, 0);
      expect(new Set(ans).size).toBe(n);
      expect(got).toBe(bruteMin(cost));
    }
  });

  it('leaves a slot empty when no item fits', () => {
    const { assignment, total } = bestAssignment(2, 1, (s, _i) => (s === 0 ? 5 : null));
    expect(assignment).toEqual([0, -1]);
    expect(total).toBe(5);
  });
});

function bruteMin(cost: number[][]): number {
  const n = cost.length;
  const m = cost[0]!.length;
  let best = Infinity;
  const used = new Array<boolean>(m).fill(false);
  const rec = (r: number, acc: number) => {
    if (r === n) {
      best = Math.min(best, acc);
      return;
    }
    for (let c = 0; c < m; c++) {
      if (used[c]) continue;
      used[c] = true;
      rec(r + 1, acc + cost[r]![c]!);
      used[c] = false;
    }
  };
  rec(0, 0);
  return best;
}

describe('lineup', () => {
  const H = 3600_000;
  const now = Date.UTC(2026, 9, 18, 12, 0); // Sun 08:00 ET
  const at = (hoursFromNow: number) => now + hoursFromNow * H;
  const pl = (id: string, fpos: string[], mu: number, p: number, kickoff: number | null, extra: Partial<LineupPlayer> = {}): LineupPlayer => ({
    id,
    fpos,
    mu,
    p,
    kickoff,
    locked: false,
    ...extra,
  });

  it('knows slot eligibility', () => {
    expect(canFill('FLEX', ['WR'])).toBe(true);
    expect(canFill('FLEX', ['QB'])).toBe(false);
    expect(canFill('SUPER_FLEX', ['QB'])).toBe(true);
    expect(canFill('REC_FLEX', ['RB'])).toBe(false);
    expect(canFill('IDP_FLEX', ['LB'])).toBe(true);
    expect(startingSlots(['QB', 'RB', 'FLEX', 'BN', 'BN'])).toEqual(['QB', 'RB', 'FLEX']);
  });

  it('values a Questionable starter with the option to swap him out (13.5 vs 10.5)', () => {
    // A: Q, early game. B: healthy, later game. Same slot.
    const problem: LineupProblem = {
      slots: ['RB'],
      players: [pl('A', ['RB'], 15, 0.7, at(5)), pl('B', ['RB'], 10, 1, at(8.4))],
      current: [1],
      now,
    };
    expect(twoStageValue(problem, [0])).toBeCloseTo(0.7 * 15 + 0.3 * 10, 9);
    const res = optimizeLineup(problem);
    expect(res.lineup).toEqual([0]);
    expect(res.expected).toBeCloseTo(13.5, 9);
    expect(res.currentExpected).toBeCloseTo(10, 9);
  });

  it('loses the swap option when the backup plays earlier', () => {
    const problem: LineupProblem = {
      slots: ['RB'],
      players: [pl('A', ['RB'], 13, 0.7, at(8.4)), pl('B', ['RB'], 10, 1, at(5))],
      current: [0],
      now,
    };
    expect(twoStageValue(problem, [0])).toBeCloseTo(0.7 * 13, 9); // 9.1 < 10
    expect(optimizeLineup(problem).lineup).toEqual([1]);
  });

  it('puts the Questionable player in FLEX when only a FLEX-eligible backup plays late', () => {
    // A: Q RB in an early game; D: healthy RB in a London game (locks before A's reveal);
    // E: healthy WR in a late game. Only the FLEX slot can take E.
    const players = [pl('A', ['RB'], 16, 0.6, at(5)), pl('D', ['RB'], 12, 1, at(1.5)), pl('E', ['WR'], 11, 1, at(8.4))];
    const problem: LineupProblem = { slots: ['RB', 'FLEX'], players, current: [0, 1], now };
    const res = optimizeLineup(problem);
    expect(res.lineup).toEqual([1, 0]); // D at RB, A at FLEX
    expect(res.expected).toBeCloseTo(12 + 0.6 * 16 + 0.4 * 11, 9);
    expect(res.currentExpected).toBeCloseTo(0.6 * 16 + 12, 9);
  });

  it('never moves locked players and credits their points', () => {
    const players = [pl('L', ['WR'], 10, 1, at(-1), { locked: true, lockedPoints: 7 }), pl('X', ['WR'], 12, 1, at(5))];
    const problem: LineupProblem = { slots: ['WR'], players, current: [0], now };
    const res = optimizeLineup(problem);
    expect(res.lineup).toEqual([0]);
    expect(res.expected).toBe(7);
  });

  it('never recommends a player in a slot he cannot fill, even if the current lineup does', () => {
    const players = [pl('wr', ['WR'], 25, 1, at(5)), pl('k', ['K'], 8, 1, at(5)), pl('qb', ['QB'], 20, 1, at(5))];
    // Current lineup puts the WR in the K slot and the QB in the WR slot.
    const res = optimizeLineup({ slots: ['K', 'WR'], players, current: [0, 2], now });
    expect(res.lineup).toEqual([1, 0]);
    res.lineup.forEach((i, s) => expect(canFill(['K', 'WR'][s]!, players[i]!.fpos)).toBe(true));
  });

  it('skips players on bye and fills empty slots', () => {
    const players = [pl('bye', ['TE'], 9, 1, null), pl('te2', ['TE'], 5, 1, at(5))];
    const res = optimizeLineup({ slots: ['TE'], players, current: [0], now });
    expect(res.lineup).toEqual([1]);
    expect(res.currentExpected).toBe(0);
  });

  it('optimizes a custom objective, starting from given lineups', () => {
    // Objective prefers the lower-mean player: the search must follow it, not expected points.
    const players = [pl('a', ['WR'], 12, 1, at(5)), pl('b', ['WR'], 10, 1, at(5))];
    const problem: LineupProblem = { slots: ['WR'], players, current: [0], now };
    const res = optimizeLineup(problem, { score: (l) => (l[0] === 1 ? 1 : 0), starts: [[0]] });
    expect(res.lineup).toEqual([1]);
    expect(res.score).toBe(1);
    expect(res.expected).toBeCloseTo(10, 9);
  });

  it('keeps the current slot arrangement when a reshuffle gains nothing', () => {
    // Static optimum would order RB1/RB2 and FLEX by value; the user's order is just as good.
    const players = [pl('a', ['RB'], 10, 1, at(5)), pl('b', ['RB'], 14, 1, at(5)), pl('c', ['RB'], 12, 1, at(5)), pl('d', ['RB'], 3, 1, at(5))];
    const res = optimizeLineup({ slots: ['RB', 'RB', 'FLEX'], players, current: [0, 2, 1], now });
    expect(res.lineup).toEqual([0, 2, 1]);
    expect(res.expected).toBeCloseTo(res.currentExpected, 9);
    // With a bench upgrade, only the replaced slot changes.
    const res2 = optimizeLineup({ slots: ['RB', 'RB', 'FLEX'], players, current: [3, 2, 1], now });
    expect(res2.lineup).toEqual([0, 2, 1]);
  });
});

describe('correlation', () => {
  const qb = { pos: 'QB', team: 'KC', opponent: 'BUF' };
  it('pairs players in the same NFL game', () => {
    expect(pairCorrelation(qb, { pos: 'WR', team: 'KC', opponent: 'BUF' })).toBe(0.3);
    expect(pairCorrelation({ pos: 'TE', team: 'KC', opponent: 'BUF' }, qb)).toBe(0.3); // order doesn't matter
    expect(pairCorrelation(qb, { pos: 'DEF', team: 'BUF', opponent: 'KC' })).toBe(-0.35);
    expect(pairCorrelation(qb, { pos: 'QB', team: 'BUF', opponent: 'KC' })).toBe(0.1);
    expect(pairCorrelation(qb, { pos: 'WR', team: 'DAL', opponent: 'NYG' })).toBe(0);
    expect(pairCorrelation({ pos: 'RB', team: 'KC' }, { pos: 'RB', team: 'KC' })).toBe(-0.2);
  });
  it('adds covariance for stacks and between lineups', () => {
    const stack = [
      { ...qb, sd: 8 },
      { pos: 'WR', team: 'KC', opponent: 'BUF', sd: 6 },
    ];
    expect(withinCovariance(stack)).toBeCloseTo(2 * 0.3 * 8 * 6, 9);
    expect(crossCovariance([stack[0]!], [{ pos: 'DEF', team: 'BUF', opponent: 'KC', sd: 5 }])).toBeCloseTo(-0.35 * 8 * 5, 9);
  });
});

describe('win probability', () => {
  it('is 50% for identical teams and favors the higher mean', () => {
    const a = { mean: 100, variance: 900 };
    expect(winProbability(a, a)).toBeCloseTo(0.5, 7);
    expect(winProbability({ mean: 110, variance: 900 }, a)).toBeCloseTo(normCdf(10 / Math.sqrt(1800)), 9);
  });
  it('mixes availability into a player distribution', () => {
    const d = playerDist(10, 0.7, 4);
    expect(d.mean).toBeCloseTo(7, 9);
    expect(d.variance).toBeCloseTo(0.7 * (16 + 100) - 49, 9);
    expect(pointSd('WR', 15)).toBeCloseTo(9.9, 9);
    expect(sumDists([d, d]).mean).toBeCloseTo(14, 9);
  });
  it('narrows the spread of the difference when the two lineups move together', () => {
    const a = { mean: 110, variance: 900 };
    const b = { mean: 100, variance: 900 };
    expect(winProbability(a, b, 300)).toBeCloseTo(normCdf(10 / Math.sqrt(1200)), 9);
    expect(winProbability(a, b, 300)).toBeGreaterThan(winProbability(a, b));
  });
  it('median-game probability is ~50% for an average team in a symmetric league', () => {
    const team = { mean: 100, variance: 400 };
    const others = Array.from({ length: 11 }, () => team);
    expect(probBeatAtLeast(team, others, 6)).toBeCloseTo(0.5, 2);
    expect(probBeatAtLeast({ mean: 130, variance: 400 }, others, 6)).toBeGreaterThan(0.85);
  });
});
