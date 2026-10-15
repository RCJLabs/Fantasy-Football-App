// Local-only error log for the "Report a problem" link. Nothing is sent anywhere automatically.
const KEY = 'ffa.errors.v1';
const MAX = 20;

export interface LoggedError {
  at: string;
  message: string;
}

export function readErrors(): LoggedError[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as LoggedError[];
  } catch {
    return [];
  }
}

export function logError(e: unknown): void {
  try {
    const message = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    const next = [{ at: new Date().toISOString(), message: message.slice(0, 300) }, ...readErrors()].slice(0, MAX);
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable */
  }
}

export function installErrorLog(): void {
  window.addEventListener('error', (ev) => logError(ev.error ?? ev.message));
  window.addEventListener('unhandledrejection', (ev) => logError(ev.reason));
}

/** Pre-filled GitHub issue with app version and recent errors (no usernames or league data). */
export function reportProblemUrl(): string {
  const errors = readErrors()
    .slice(0, 5)
    .map((e) => `- ${e.at} ${e.message}`)
    .join('\n');
  const body = [
    '**What happened?**',
    '',
    '',
    '**Diagnostics** (no personal data)',
    `- App build: ${import.meta.env.MODE} ${__APP_VERSION__}`,
    `- User agent: ${navigator.userAgent}`,
    '- Recent errors:',
    errors || '- none',
  ].join('\n');
  return `https://github.com/RCJLabs/Fantasy-Football-App/issues/new?title=${encodeURIComponent('Problem report')}&body=${encodeURIComponent(body)}`;
}
