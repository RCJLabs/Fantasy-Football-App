import { useState } from 'preact/hooks';
import { clearCache } from '../data/cache';
import { loadManifest } from '../data/repo';
import { dateTime } from './format';
import { reportProblemUrl } from './errorLog';
import { useAsync } from './hooks';

export function About({ onSignOut }: { onSignOut?: () => void }) {
  const manifest = useAsync(() => loadManifest(), []);
  const [cleared, setCleared] = useState(false);

  return (
    <section class="stack about">
      <div class="card">
        <h1>How it works</h1>
        <ul>
          <li>
            <strong>Projections</strong> are RotoWire's stat-level projections, served by Sleeper, rescored to your league's exact scoring (TE premium,
            first downs, bonuses, IDP). Yardage bonuses and defense points-allowed tiers are priced from a spread around the projection.
          </li>
          <li>
            <strong>Chance to play</strong> comes from the injury designation and the final practice report: Questionable players have been active about 70%
            of the time in 2026, Doubtful almost never.
          </li>
          <li>
            <strong>Lineup advice</strong> maximizes expected points, including the option to swap out a Questionable starter for a backup who kicks off
            later. Players whose games have started are locked.
          </li>
          <li>
            <strong>Win chance</strong> uses each player's expected points and a typical weekly spread. It's an estimate, not a guarantee.
          </li>
        </ul>
        <p class="muted small">
          Coming next: rest-of-season trade values, FAAB bids, usage trends and matchup adjustments, each added only after backtests show it helps.
        </p>
      </div>

      <div class="card">
        <h2>Data and credits</h2>
        <ul>
          <li>League, roster, matchup and player data: Sleeper API (read-only, non-commercial use).</li>
          <li>Projections: RotoWire, via Sleeper.</li>
          <li>Practice reports and schedule: nflverse (CC-BY 4.0), processed daily.</li>
          <li>Trending adds: Sleeper.</li>
        </ul>
        {manifest.data ? (
          <p class="muted small">
            App data built {dateTime(Date.parse(manifest.data.generatedAt))}.
          </p>
        ) : (
          <p class="muted small">App data files not available in this build.</p>
        )}
        <p class="muted small">Not affiliated with or endorsed by Sleeper, RotoWire, the NFL or any team.</p>
      </div>

      <div class="card" id="privacy">
        <h2>Privacy</h2>
        <ul>
          <li>No accounts and no server-side storage. Your Sleeper username and the data the app loads stay on this device.</li>
          <li>Your browser requests data directly from Sleeper (username, league IDs) and from this site (GitHub Pages, which keeps standard access logs).</li>
          <li>Errors are logged only on this device; “Report a problem” opens a pre-filled GitHub issue that you choose whether to submit.</li>
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
    </section>
  );
}
