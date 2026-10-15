import { useState } from 'preact/hooks';
import { lookupUser } from '../data/repo';
import { logError } from './errorLog';
import type { Session } from './session';

export function Connect({ onConnected }: { onConnected: (s: Session) => void }) {
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: Event) => {
    e.preventDefault();
    const name = username.trim();
    if (!name) return;
    setBusy(true);
    setError(null);
    try {
      const user = await lookupUser(name);
      onConnected({ userId: user.user_id, username: user.username ?? name, displayName: user.display_name ?? name });
    } catch (err) {
      logError(err);
      setError(err instanceof Error ? err.message : 'Lookup failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section class="connect card">
      <h1>Your leagues, your scoring, your opponent.</h1>
      <p>
        Enter your Sleeper username. The app finds every league you're in this season and checks your lineup against your league's exact scoring, injury
        reports and kickoff times.
      </p>
      <form onSubmit={submit} class="connect-form">
        <label for="username">Sleeper username</label>
        <input
          id="username"
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          spellcheck={false}
          value={username}
          onInput={(e) => setUsername((e.target as HTMLInputElement).value)}
          placeholder="e.g. yourname"
          required
        />
        <button class="btn btn-primary" type="submit" disabled={busy}>
          {busy ? 'Looking up…' : 'Find my leagues'}
        </button>
        {error ? (
          <p class="problem problem-error" role="alert">
            {error}
          </p>
        ) : null}
      </form>
      <p class="muted small">
        Read-only: the app only reads public Sleeper data for that username. Nothing is posted to your leagues and nothing is stored on a server.
      </p>
    </section>
  );
}
