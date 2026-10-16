import type { InjuryStatus, PracticeStatus } from '../domain/types';

/**
 * P(player is active) from the injury designation, and for Questionable players a logistic model (v1).
 *
 * Calibrated on nflverse final injury reports joined to game-day active/inactive rosters, for fantasy-relevant
 * QB/RB/WR/TE/K (≥ 8 PPR per game so far that season; QB 12) [own calc: scripts/calibrate/pplay.ts and
 * pplay-v1.ts; docs/calibration.md]. Doubtful 1% (1/69; 2% for all players, 3/152); Out 0/357; no designation 99%.
 *
 * Questionable (v1, 2019–2025, 1,326 player-games): the final practice status, whether he missed his last game,
 * the injury and the position. Out of sample it beat the practice-only table (v0) on Brier score by 0.014
 * (95% interval 0.007–0.020, each season held out in turn). Before the week's final report (no practice status yet),
 * a second fit without practice applies (0.007 better than one Questionable rate).
 *
 * `practice` must come from the week's final report (the player has a game status). Mid-week, pass undefined.
 */
export function playProbability(injury: InjuryStatus | null | undefined, practice?: PracticeStatus, ctx: PlayContext = {}): number {
  switch (injury) {
    case null:
    case undefined:
    case '':
      return 0.99;
    case 'Questionable':
      return questionableP(practice, ctx);
    case 'Doubtful':
      return 0.02;
    default:
      // Out, IR, PUP, NA, Sus, DNR, COV, …
      return 0;
  }
}

/** What the Questionable model knows about a player besides his designation and practice. */
export interface PlayContext {
  /** Injury body part, as Sleeper or the official report words it. */
  body?: string | null;
  /** Inactive, or off the active roster, in his team's last game. */
  missedLast?: boolean;
  pos?: string;
}

/** Injury groups with their own term; ankle/foot and an unknown injury are the reference. */
export const INJURY_TERMS = ['hamstring', 'other leg muscle', 'knee', 'back/torso', 'arm/shoulder', 'illness', 'concussion', 'other'] as const;
/** Positions with their own term; WR is the reference. */
export const POSITION_TERMS = ['QB', 'RB', 'TE', 'K'] as const;

/** Body parts grouped by how teams tend to handle them (left/right dropped); '' when unknown. */
export function injuryGroup(text: string | null | undefined): string {
  const t = (text ?? '').toLowerCase().replace(/\b(left|right)\b/g, '').trim();
  if (!t || t === 'na') return '';
  if (t.includes('illness')) return 'illness';
  if (t.includes('concussion') || t === 'head') return 'concussion';
  if (t.includes('hamstring')) return 'hamstring';
  if (/groin|calf|quad|thigh|shin|adductor|hip flexor/.test(t)) return 'other leg muscle';
  if (/ankle|foot|toe|heel|achilles|fibula|tibia/.test(t)) return 'ankle/foot';
  if (/knee|acl|mcl|patella|meniscus/.test(t)) return 'knee';
  if (/back|hip|abdom|oblique|rib|chest|pector|neck|core|glute/.test(t)) return 'back/torso';
  if (/shoulder|wrist|hand|elbow|finger|thumb|forearm|tricep|bicep|arm|clavicle/.test(t)) return 'arm/shoulder';
  return 'other';
}

/**
 * The Questionable model's terms: intercept, then Full and DNP practice (Limited is the reference; only when the
 * final practice is known), missed last game, injury group, position.
 */
export function questionableTerms(practice: PracticeStatus | undefined, ctx: PlayContext): number[] {
  const g = injuryGroup(ctx.body);
  return [
    1,
    ...(practice ? [practice === 'Full' ? 1 : 0, practice === 'DNP' ? 1 : 0] : []),
    ctx.missedLast ? 1 : 0,
    ...INJURY_TERMS.map((t) => (g === t ? 1 : 0)),
    ...POSITION_TERMS.map((p) => (ctx.pos === p ? 1 : 0)),
  ];
}

/** Coefficients with the final practice status, in `questionableTerms` order (pplay-v1.ts, 2019–2025, ridge 1). */
export const Q_FINAL: readonly number[] = [1.639, 1.532, -1.31, -0.792, -0.591, 0.171, 0.143, 0.745, -0.027, 1.058, -1.168, -0.108, -0.962, -0.431, 0.024, -0.553];
/** Coefficients before the final report, when practice isn't known yet (ridge 4). */
export const Q_EARLY: readonly number[] = [1.267, -0.507, -0.492, 0.198, 0.22, 0.704, 0.114, 0.551, -0.339, -0.28, -0.645, -0.276, 0.116, -0.302];

export function questionableP(practice: PracticeStatus | undefined, ctx: PlayContext = {}): number {
  const beta = practice ? Q_FINAL : Q_EARLY;
  const x = questionableTerms(practice, ctx);
  return 1 / (1 + Math.exp(-x.reduce((s, v, i) => s + v * (beta[i] ?? 0), 0)));
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
