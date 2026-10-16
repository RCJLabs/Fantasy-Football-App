import type { Game } from '../domain/types';

// The app's lineup pick for each week, saved on this device so the season review can score it later. Storage can be
// unavailable (private mode, blocked site data): then nothing is saved and the review leaves the column out.

const key = (leagueId: string, week: number) => `ff:advice:${leagueId}:${week}`;

const eastern = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', hourCycle: 'h23' });

function easternDayHour(ms: number): { day: string; hour: number } {
  const parts = eastern.formatToParts(new Date(ms));
  return { day: parts.find((p) => p.type === 'weekday')?.value ?? '', hour: Number(parts.find((p) => p.type === 'hour')?.value ?? 0) };
}

/**
 * When the pick stops being saved: the week's main Sunday kickoff (the first at or after noon Eastern; else the first
 * Sunday game; else the first game). Thursday and early international games lock before it, and the app treats
 * them as fixed, so the saved pick is still one lineup you could have played.
 */
export function adviceCutoff(games: Iterable<Game>): number | undefined {
  const kicks = [...new Set([...games].map((g) => Date.parse(g.kickoff)))].filter(Number.isFinite).sort((a, b) => a - b);
  const sunday = kicks.filter((k) => easternDayHour(k).day === 'Sun');
  return sunday.find((k) => easternDayHour(k).hour >= 12) ?? sunday[0] ?? kicks[0];
}

/** Saves the recommended starters, replacing the week's earlier pick, until the cutoff. */
export function saveAdvice(leagueId: string, week: number, starters: readonly string[], now: number, cutoff: number | undefined): void {
  if (cutoff === undefined || now >= cutoff || !starters.length) return;
  try {
    localStorage.setItem(key(leagueId, week), JSON.stringify({ at: now, starters }));
  } catch {
    /* not saved */
  }
}

/** Saved picks for the weeks asked: week → starters. */
export function loadAdvice(leagueId: string, weeks: readonly number[]): Map<number, string[]> {
  const out = new Map<number, string[]>();
  for (const w of weeks) {
    try {
      const v = JSON.parse(localStorage.getItem(key(leagueId, w)) ?? 'null') as { starters?: unknown } | null;
      if (Array.isArray(v?.starters) && v.starters.every((s) => typeof s === 'string')) out.set(w, v.starters as string[]);
    } catch {
      /* unreadable: skip the week */
    }
  }
  return out;
}
