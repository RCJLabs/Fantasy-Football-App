import type { InjuryStatus, PracticeStatus } from '../domain/types';

/**
 * P(player is active) from the injury designation and final practice status (v0 table).
 *
 * Sources: Questionable ≈ 70% active (2026 Wk 1–5: 181/259 by exact gsis join [own calc]);
 * Doubtful ≈ 0% (0/24); conditional on Questionable, final practice FP/LP/DNP ≈ 87/65/45%
 * (2026 Wk 1–5, name join adjusted [own calc]). No designation: ~1% inactive [design].
 */
export function playProbability(injury: InjuryStatus | null | undefined, practice?: PracticeStatus): number {
  switch (injury) {
    case null:
    case undefined:
    case '':
      return 0.99;
    case 'Questionable':
      if (practice === 'Full') return 0.87;
      if (practice === 'Limited') return 0.65;
      if (practice === 'DNP') return 0.45;
      return 0.7;
    case 'Doubtful':
      return 0.03;
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
