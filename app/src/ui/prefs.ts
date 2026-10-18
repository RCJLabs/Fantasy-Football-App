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

/** Draft helper settings for one league (docs/draft.md): kept on this device until the draft. */
export interface DraftPrefs {
  /** Roster ids in round 1's order. */
  order?: number[];
  style?: 'snake' | 'linear' | '3rr';
  rounds?: number;
  keepers?: number;
  cost?: 'last' | 'drafted' | 'earlier';
}
const draftKey = (leagueId: string) => `ff:draft:${leagueId}`;

export function draftPrefs(leagueId: string): DraftPrefs {
  try {
    const v = JSON.parse(localStorage.getItem(draftKey(leagueId)) ?? '{}') as unknown;
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as DraftPrefs) : {};
  } catch {
    return {};
  }
}

export function setDraftPrefs(leagueId: string, value: DraftPrefs): void {
  try {
    localStorage.setItem(draftKey(leagueId), JSON.stringify(value));
  } catch {
    /* not saved; the settings still apply for this visit */
  }
}

const BUZZ_KEY = 'ff:buzz';

/** Vibrate on big plays in the Matchup tab's live feed (phones that support it). On unless turned off. */
export function buzzPref(): boolean {
  try {
    return localStorage.getItem(BUZZ_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setBuzzPref(on: boolean): void {
  try {
    localStorage.setItem(BUZZ_KEY, on ? 'on' : 'off');
  } catch {
    /* not saved; the choice still applies for this visit */
  }
}
