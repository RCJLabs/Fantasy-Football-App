import { useEffect, useState } from 'preact/hooks';
import { requestPersistence } from '../data/cache';
import { About } from './About';
import { Connect } from './Connect';
import { useRoute } from './hooks';
import { Home } from './Home';
import { LeaguePage } from './LeaguePage';
import { clearSession, loadSession, saveSession, type Session } from './session';
import { Settings } from './Settings';

export function App() {
  const [session, setSession] = useState<Session | null>(loadSession);
  const route = useRoute();

  useEffect(() => {
    void requestPersistence();
  }, []);

  if (!session) {
    return (
      <Shell>
        {route[0] === 'about' ? (
          <About />
        ) : route[0] === 'settings' ? (
          <Settings session={null} />
        ) : (
          <Connect
            onConnected={(s) => {
              saveSession(s);
              setSession(s);
              location.hash = '#/';
            }}
          />
        )}
      </Shell>
    );
  }

  const signOut = () => {
    clearSession();
    setSession(null);
    location.hash = '#/';
  };

  let page;
  if (route[0] === 'league' && route[1]) page = <LeaguePage session={session} leagueId={route[1]} tab={route[2] ?? 'lineup'} />;
  else if (route[0] === 'about') page = <About />;
  else if (route[0] === 'settings') page = <Settings session={session} onSignOut={signOut} />;
  else page = <Home session={session} />;

  return <Shell session={session}>{page}</Shell>;
}

function Shell({ session, children }: { session?: Session; children: preact.ComponentChildren }) {
  return (
    <div class="shell">
      <header class="topbar">
        <a class="brand" href="#/">
          <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" width={24} height={24} />
          FF Assistant
        </a>
        <nav>
          {session ? <a href="#/">Leagues</a> : null}
          <a href="#/about">About</a>
          <a href="#/settings" class="icon-link" aria-label="Settings" title="Settings">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
              <path d="M4 6h16M4 12h16M4 18h16" />
              <circle cx="9" cy="6" r="2.4" fill="currentColor" />
              <circle cx="15" cy="12" r="2.4" fill="currentColor" />
              <circle cx="7" cy="18" r="2.4" fill="currentColor" />
            </svg>
          </a>
        </nav>
      </header>
      <main class="content">{children}</main>
      <footer class="footer muted">
        Read-only. Not affiliated with Sleeper, the NFL or any team. Projections by RotoWire via Sleeper.
      </footer>
    </div>
  );
}
