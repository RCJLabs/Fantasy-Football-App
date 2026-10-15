import type { Objective } from '../analysis/analyze';

// Per-device preferences. Storage can be unavailable (private mode, blocked site data): fall back to defaults.

/** Regular season and playoffs keep separate choices, so October's pick doesn't override the playoff default. */
export type Phase = 'regular' | 'playoffs';
const objectiveKey = (leagueId: string, phase: Phase) => `ff:objective:${leagueId}:${phase}`;

export function objectivePref(leagueId: string, phase: Phase): Objective | undefined {
  try {
    const v = localStorage.getItem(objectiveKey(leagueId, phase));
    return v === 'win' || v === 'points' ? v : undefined;
  } catch {
    return undefined;
  }
}

export function setObjectivePref(leagueId: string, phase: Phase, value: Objective): void {
  try {
    localStorage.setItem(objectiveKey(leagueId, phase), value);
  } catch {
    /* not saved; the choice still applies for this visit */
  }
}
