import { useState } from 'preact/hooks';
import type { Objective } from '../analysis/analyze';
import { clearCache } from '../data/cache';
import type { League } from '../domain/types';
import { Spinner } from './components';
import { loadOverview } from './data';
import { reportProblemUrl } from './errorLog';
import { useAsync } from './hooks';
import {
  apiKey,
  buzzPref,
  clearDraftPrefs,
  clearObjectivePref,
  draftPrefs,
  objectivePref,
  resetPrefs,
  setApiKey,
  setBuzzPref,
  setObjectivePref,
  type Phase,
} from './prefs';
import type { Session } from './session';

// Settings (docs/settings.md): every per-device choice in one place, as sections that new settings join. The tabs that
// use a setting keep their own control for it; both write the same stored value.

const PHASES: Array<{ phase: Phase; label: string; fallback: string }> = [
  { phase: 'regular', label: 'Regular season', fallback: 'max points' },
  { phase: 'playoffs', label: 'Playoffs', fallback: 'win chance' },
];

export function Settings({ session, onSignOut }: { session: Session | null; onSignOut?: () => void }) {
  // Bumped after a reset, so the sections re-read what's stored.
  const [version, setVersion] = useState(0);
  return (
    <section key={version}>
      <div class="page-head">
        <div>
          <h1>Settings</h1>
          <p class="muted">Kept on this device only.</p>
        </div>
      </div>
      <div class="stack">
        <GameDay />
        {session ? <Lineups session={session} /> : null}
        <Analyst />
        {session ? <Drafts session={session} /> : null}
        <DeviceData onSignOut={onSignOut} onReset={() => setVersion((v) => v + 1)} />
      </div>
    </section>
  );
}

function GameDay() {
  const [buzz, setBuzz] = useState(buzzPref);
  return (
    <div class="card">
      <h2>Game day</h2>
      <label class="setting">
        <input
          type="checkbox"
          checked={buzz}
          onChange={(e) => {
            const on = (e.currentTarget as HTMLInputElement).checked;
            setBuzz(on);
            setBuzzPref(on);
          }}
        />
        <span>
          Buzz on big plays
          <span class="muted small"> · the Matchup tab&apos;s live feed, on phones that can vibrate: your player scoring 6+ at once, or your win chance moving 10 points</span>
        </span>
      </label>
    </div>
  );
}

/** What each league's lineups aim for, in the regular season and the playoffs (the Lineup tab's switch). */
function Lineups({ session }: { session: Session }) {
  const overview = useAsync((force) => loadOverview(session, force), [session.userId]);
  // Leagues with lineups to advise on now (best ball sets its own).
  const leagues = (overview.data?.leagues ?? []).filter((l) => !l.rules.bestBall && (l.status === 'in_season' || l.status === 'post_season'));
  return (
    <div class="card">
      <h2>Lineups</h2>
      <p class="muted small">
        What the Lineup tab&apos;s advice aims for in each league. Its Max points / Win chance switch sets the same choice. By default: max points in
        the regular season, win chance in the playoffs.
      </p>
      {overview.loading && !overview.data ? <Spinner label="Loading your leagues…" /> : null}
      {leagues.map((l) => (
        <LeagueObjective key={l.id} league={l} />
      ))}
      {overview.data && !leagues.length ? <p class="muted small">No leagues with lineups to set this season.</p> : null}
    </div>
  );
}

function LeagueObjective({ league }: { league: League }) {
  const [choices, setChoices] = useState(() => new Map(PHASES.map(({ phase }) => [phase, objectivePref(league.id, phase)])));
  const pick = (phase: Phase, value: string) => {
    if (value === 'win' || value === 'points') setObjectivePref(league.id, phase, value);
    else clearObjectivePref(league.id, phase);
    setChoices(new Map(choices).set(phase, value === 'win' || value === 'points' ? (value as Objective) : undefined));
  };
  return (
    <fieldset class="setting-group">
      <legend>{league.name}</legend>
      {PHASES.map(({ phase, label, fallback }) => (
        <label class="setting-select">
          <span>{label}</span>
          <select value={choices.get(phase) ?? ''} onChange={(e) => pick(phase, (e.currentTarget as HTMLSelectElement).value)}>
            <option value="">Default ({fallback})</option>
            <option value="points">Max points</option>
            <option value="win">Win chance</option>
          </select>
        </label>
      ))}
    </fieldset>
  );
}

/** The Anthropic API key Ask the analyst uses: whether one is saved, and a way to remove it. */
function Analyst() {
  const [key, setKey] = useState(apiKey);
  return (
    <div class="card">
      <h2>Ask the analyst</h2>
      {key ? (
        <div class="row setting-row">
          <span>
            Anthropic API key saved on this device <span class="muted">(ends …{key.slice(-4)})</span>
          </span>
          <button
            type="button"
            class="btn btn-small"
            onClick={() => {
              setApiKey(null);
              setKey(null);
            }}
          >
            Remove key
          </button>
        </div>
      ) : (
        <p class="muted small">No API key saved. Add yours on a league&apos;s Ask tab; it stays on this device.</p>
      )}
    </div>
  );
}

/** Leagues with saved draft helper settings (order, style, rounds, keepers), each with a reset. */
function Drafts({ session }: { session: Session }) {
  const overview = useAsync((force) => loadOverview(session, force), [session.userId]);
  const [cleared, setCleared] = useState<Set<string>>(new Set());
  const saved = (overview.data?.leagues ?? []).filter((l) => !cleared.has(l.id) && Object.keys(draftPrefs(l.id)).length > 0);
  if (!saved.length) return null;
  return (
    <div class="card">
      <h2>Draft helper</h2>
      <p class="muted small">Draft settings saved for these leagues (order, style, rounds, keepers). Resetting goes back to Sleeper&apos;s draft data.</p>
      {saved.map((l) => (
        <div class="row setting-row" key={l.id}>
          <span>{l.name}</span>
          <button
            type="button"
            class="btn btn-small"
            onClick={() => {
              clearDraftPrefs(l.id);
              setCleared(new Set(cleared).add(l.id));
            }}
          >
            Reset
          </button>
        </div>
      ))}
    </div>
  );
}

function DeviceData({ onSignOut, onReset }: { onSignOut: (() => void) | undefined; onReset: () => void }) {
  const [cleared, setCleared] = useState(false);
  return (
    <div class="card" id="data">
      <h2>Data on this device</h2>
      <ul class="setting-notes muted small">
        <li>Saved data: what the app loaded from Sleeper, ESPN and this site, and the Matchup tab&apos;s live feeds. Clearing it reloads everything.</li>
        <li>Settings: the choices above. Resetting keeps your API key and the lineup picks the season review uses.</li>
      </ul>
      <div class="row">
        <button
          type="button"
          class="btn"
          onClick={async () => {
            await clearCache();
            setCleared(true);
          }}
        >
          {cleared ? 'Saved data cleared' : 'Clear saved data'}
        </button>
        <button
          type="button"
          class="btn"
          onClick={() => {
            resetPrefs();
            onReset();
          }}
        >
          Reset settings
        </button>
        {onSignOut ? (
          <button type="button" class="btn" onClick={onSignOut}>
            Switch Sleeper user
          </button>
        ) : null}
        <a class="btn" href={reportProblemUrl()} target="_blank" rel="noopener">
          Report a problem
        </a>
      </div>
    </div>
  );
}
