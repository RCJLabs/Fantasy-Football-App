import type { InjuryStatus, PracticeStatus } from '../domain/types';

/**
 * P(player is active) from the injury designation and the final practice status.
 *
 * Calibrated on the 2023–2025 regular seasons [own calc: scripts/calibrate/pplay.ts, see
 * docs/calibration.md]: nflverse final injury reports joined to game-day active/inactive rosters,
 * for fantasy-relevant QB/RB/WR/TE/K (≥ 8 PPR per game so far that season; QB 12).
 * Questionable 72% active (364/502); by final practice Full 92% (82/89), Limited 71% (228/322),
 * DNP 56% (45/80); stable across the three seasons. Doubtful 1% (1/69; 2% for all players, 3/152).
 * Out 0/357. No designation 99% (including players listed on the report without one).
 * Held out, 2026 weeks 1–5: see docs/calibration.md.
 *
 * `practice` must come from the week's final report (the player has a game status). Mid-week,
 * pass undefined: the overall Questionable rate applies.
 */
export function playProbability(injury: InjuryStatus | null | undefined, practice?: PracticeStatus): number {
  switch (injury) {
    case null:
    case undefined:
    case '':
      return 0.99;
    case 'Questionable':
      if (practice === 'Full') return 0.92;
      if (practice === 'Limited') return 0.71;
      if (practice === 'DNP') return 0.56;
      return 0.72;
    case 'Doubtful':
      return 0.02;
    default:
      // Out, IR, PUP, NA, Sus, DNR, COV, …
      return 0;
  }
}

/** Statuses that make a player eligible for an IR slot in most leagues (checked against league rules). */
export function isReserveStatus(injury: InjuryStatus | null | undefined): boolean {
  return injury === 'IR' || injury === 'PUP' || injury === 'Out' || injury === 'Sus' || injury === 'NA' || injury === 'DNR' || injury === 'COV' || injury === 'Doubtful';
}

/**
 * RotoWire (via Sleeper) zeroes Out/Doubtful/IR players. For Questionable players the evidence is
 * mixed (spikes: ratio 0.94 vs last week, 0.86 vs next week), so we treat their projection as
 * conditional on playing, scaled by this factor. Tune once the archive can measure it. [design]
 */
export const ROTOWIRE_Q_FACTOR = 1.0;

/** Projection conditional on playing, given the source's (already-applied) availability convention. */
export function conditionalMean(projected: number, injury: InjuryStatus | null | undefined): number {
  if (injury === 'Questionable') return projected / ROTOWIRE_Q_FACTOR;
  return projected;
}
