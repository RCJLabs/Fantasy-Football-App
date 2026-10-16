import { useState } from 'preact/hooks';
import { clearCache } from '../data/cache';
import type { AccuracyFile } from '../data/contracts';
import { loadAccuracy, loadManifest } from '../data/repo';
import { dateTime, pct } from './format';
import { reportProblemUrl } from './errorLog';
import { useAsync } from './hooks';

export function About({ onSignOut }: { onSignOut?: () => void }) {
  const manifest = useAsync(() => loadManifest(), []);
  const accuracy = useAsync(() => loadAccuracy(), []);
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
            <strong>Chance to play</strong> comes from the injury designation and the final practice report. Over 2023–2025, fantasy-relevant players
            listed Questionable were active 92% of the time after a full final practice, 71% after a limited one and 56% after missing it (72% overall,
            used until the final report is out). Doubtful players played 1 time in 69.
          </li>
          <li>
            <strong>Lineup advice</strong> maximizes expected points, including the option to swap out a Questionable starter for a backup who kicks off
            later. Players whose games have started are locked.
          </li>
          <li>
            <strong>Win chance</strong> uses each player's expected points, a typical weekly spread, and how players in the same NFL game move
            together (a QB and his receivers; a QB and the defense he faces). It's an estimate, not a guarantee.
          </li>
          <li>
            <strong>Playoff mode</strong>: in playoff weeks the lineup maximizes your chance to win the round (both weeks of a two-week round),
            not expected points. Favorites narrow the range of outcomes, underdogs widen it. It only departs from the max-points lineup when the
            edge is at least half a percentage point. You can switch modes in any week.
          </li>
          <li>
            <strong>Rest of season</strong> (waivers, trades, playoff odds) uses Sleeper's projections for every remaining week, so byes and expected
            injury returns are built in. Each team's best lineup is valued week by week, with a small allowance for new injuries and for bench players
            covering them. Playoff weeks count in proportion to your playoff odds.
          </li>
          <li>
            <strong>Keeper and dynasty leagues</strong> also get a long-term view. Trades show market value this season and beyond it (FantasyCalc
            dynasty values). In dynasty leagues you can add draft picks: next year's are priced by the original team's projected finish (worst record
            picks first), later years at the round's price. The Season tab ranks teams by the value of the players (and picks) they carry forward and
            lists your likely keepers.
          </li>
          <li>
            <strong>FAAB bids</strong> follow what your league has actually paid for players at the same position this season, scaled by your remaining
            budget.
          </li>
          <li>
            <strong>Usage</strong> (snap share, targets and carries over the last four weeks, with the share of the team's) is shown for context in player
            details and on the waiver board. It doesn't change projections.
          </li>
          <li>
            <strong>Matchups</strong>, also context only: how many more (or fewer) PPR points players at a position have scored against this week's
            opponent than in their other games, pulled toward average while the sample is small, and which of the opponent's regular cornerbacks are out.
          </li>
        </ul>
        <p class="muted small">Coming next: matchup adjustments, added only after backtests show they help.</p>
      </div>

      {accuracy.data ? <AccuracyCard file={accuracy.data} /> : null}

      <div class="card">
        <h2>Data and credits</h2>
        <ul>
          <li>League, roster, matchup and player data: Sleeper API (read-only, non-commercial use).</li>
          <li>Projections: RotoWire, via Sleeper.</li>
          <li>Practice reports and schedule: nflverse (CC-BY 4.0), processed daily.</li>
          <li>Usage and matchups: nflverse (CC-BY 4.0) weekly stats and snap counts (compiled by Pro Football Reference).</li>
          <li>Trending adds: Sleeper.</li>
          <li>
            Trade market values:{' '}
            <a href="https://www.fantasycalc.com" target="_blank" rel="noopener">
              FantasyCalc
            </a>{' '}
            (fetched by your browser, non-commercial use).
          </li>
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

/** How past weeks' projections did against actual PPR points (published aggregates). */
function AccuracyCard({ file }: { file: AccuracyFile }) {
  const weeks = file.weeks.length > 1 ? `weeks ${file.weeks[0]}–${file.weeks.at(-1)}` : `week ${file.weeks[0]}`;
  return (
    <div class="card">
      <h2>How accurate are the projections?</h2>
      <p class="muted small">
        {file.season} {weeks}, PPR, players projected for at least {file.minProjected} points who played. “Within ±1 SD” checks the spread the app
        uses for win chances: about 68% means it's well calibrated.
      </p>
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>Pos</th>
              <th class="num">Games</th>
              <th class="num">Avg miss</th>
              <th class="num">Bias</th>
              <th class="num">Corr</th>
              <th class="num">±1 SD</th>
            </tr>
          </thead>
          <tbody>
            {file.rows.map((r) => (
              <tr class={r.pos === 'ALL' ? 'mine' : ''}>
                <td>{r.pos === 'ALL' ? 'All' : r.pos}</td>
                <td class="num">{r.n}</td>
                <td class="num">{r.mae.toFixed(1)}</td>
                <td class="num">{(r.bias >= 0 ? '+' : '') + r.bias.toFixed(1)}</td>
                <td class="num">{r.corr.toFixed(2)}</td>
                <td class="num">{pct(r.within1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
