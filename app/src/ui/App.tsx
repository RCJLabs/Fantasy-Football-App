import { useEffect, useState } from 'preact/hooks';
import { requestPersistence } from '../data/cache';
import { About } from './About';
import { Connect } from './Connect';
import { useRoute } from './hooks';
import { Home } from './Home';
import { LeaguePage } from './LeaguePage';
import { clearSession, loadSession, saveSession, type Session } from './session';

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
  else if (route[0] === 'about') page = <About onSignOut={signOut} />;
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
        </nav>
      </header>
      <main class="content">{children}</main>
      <footer class="footer muted">
        Read-only. Not affiliated with Sleeper, the NFL or any team. Projections by RotoWire via Sleeper.
      </footer>
    </div>
  );
}
