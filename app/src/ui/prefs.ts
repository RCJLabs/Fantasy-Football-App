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

/** Back to the app's default for that phase (max points in the regular season, win chance in the playoffs). */
export function clearObjectivePref(leagueId: string, phase: Phase): void {
  try {
    localStorage.removeItem(objectiveKey(leagueId, phase));
  } catch {
    /* nothing saved */
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

export function clearDraftPrefs(leagueId: string): void {
  try {
    localStorage.removeItem(draftKey(leagueId));
  } catch {
    /* nothing saved */
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

const API_KEY = 'ff:anthropic-key';

/** The manager's own Anthropic API key for Ask the analyst, kept on this device only. */
export function apiKey(): string | null {
  try {
    return localStorage.getItem(API_KEY);
  } catch {
    return null;
  }
}

export function setApiKey(key: string | null): void {
  try {
    if (key) localStorage.setItem(API_KEY, key);
    else localStorage.removeItem(API_KEY);
  } catch {
    /* private mode: the key lasts this visit only */
  }
}

/** Every preference above back to its default (the API key and the season review's saved picks stay). */
export function resetPrefs(): void {
  try {
    const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i) ?? '');
    for (const k of keys) if (k.startsWith('ff:objective:') || k.startsWith('ff:draft:') || k === BUZZ_KEY) localStorage.removeItem(k);
  } catch {
    /* nothing saved */
  }
}
