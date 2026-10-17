import { useState } from 'preact/hooks';
import { groupLabel, poolLedger, type PooledLedger } from '../analysis/ledger';
import { clearCache } from '../data/cache';
import type { AccuracyFile } from '../data/contracts';
import { loadAccuracy, loadLedger, loadManifest } from '../data/repo';
import { dateTime, pct, signed } from './format';
import { reportProblemUrl } from './errorLog';
import { useAsync } from './hooks';

export function About({ onSignOut }: { onSignOut?: () => void }) {
  const manifest = useAsync(() => loadManifest(), []);
  const accuracy = useAsync(() => loadAccuracy(), []);
  const ledger = useAsync(() => loadLedger(), []);
  const pooled = poolLedger(ledger.data);
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
            <strong>Chance to play</strong> comes from the injury designation. For Questionable players it also weighs the final practice report,
            whether he missed his last game, the injury and his position, fitted on 2019–2025 game-day actives. A Questionable WR with an ankle
            injury who played last week is active about 84% of the time after a limited final practice. With a hamstring injury, after missing his
            last game, it's about 56%. Tested on seasons it wasn't fitted on, this beat practice alone. Until the final report is out, the same
            factors apply without practice. Doubtful players played 1 time in 69. For players who are out, player details also show how long
            absences with the same injury have lasted (2019–2025): history, not a forecast.
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
            injury returns are built in. Each week also counts the chance a player is still active by then: for a healthy player 94% next week, 85%
            eight weeks out and 80% thirteen weeks out (game-day rosters, 2019–2025). Each team's best lineup is valued week by week, with
            bench players covering absences, so depth counts for more later in the season. Playoff weeks count by your playoff odds (every round is
            a must-win, the final as much as the first), except a first-round bye week, which counts only by your chance of playing it. Title odds
            play the bracket out round by round with each team's projected lineups; once the playoffs begin, they play out Sleeper's own bracket
            from the games already decided, and a team that's out counts its remaining weeks for nothing. Playoff and title odds also let every team drift from its
            projection as the season goes on (injuries, role changes, pickups): in a backtest on leagues built from 2022–2025 seasons, odds without
            that drift were too sure of themselves, and teams given a 1% chance made the playoffs 6% of the time. Trades show an 80% range for
            the change in rest-of-season points, and the chance it adds points: a player's season can miss his projection by about 40%, and
            ranges sized that way held 80% of 2022–2025 outcomes.
          </li>
          <li>
            <strong>Team grades</strong> (Season tab) compare every team with the rest of its league, S to F, on four parts: this week's best
            lineup, the best lineup's points per week over the rest of the season, what the bench adds by covering byes and injuries, and
            playoff odds (title odds once the playoffs start). S stands clearly above the rest; A to F step half a standard deviation from the
            league average. Overall weighs the rest of the season 45%, odds 25%, this week 15% and depth 15%, a design choice rather than a
            fitted model.
          </li>
          <li>
            <strong>Claim plan</strong> (Waivers tab): up to three waiver claims in order, each with the drop that costs least for the roster the
            claims above would leave. Each has a backup for the same drop, which can only go through if the claim above it fails. In FAAB leagues,
            each bid comes from the budget left after the claims above, and a backup never bids more than its claim.
          </li>
          <li>
            <strong>Handcuffs</strong> (Waivers tab): the depth chart&apos;s next man up behind your QB and RB starters. In 2019–2025 games a starter
            sat, his backup gained 76% (QBs) or 40% (RBs) of the starter&apos;s points on top of his own, and those shares predicted later seasons
            better than the backup&apos;s own average. TE and WR backups didn&apos;t pass that test, so they aren&apos;t valued. Insurance is the chance the
            starter misses each week ahead times what the backup would add then, beyond your bench and the best free agent at the position.
          </li>
          <li>
            <strong>IR stash</strong> (Waivers tab, when you have an open IR slot): injured free agents your league allows on IR, ranked by what
            they add to your lineups once Sleeper projects them back. On IR they take no bench spot until then.
          </li>
          <li>
            <strong>Before lock</strong> (Lineup tab, and a line on each Home league card): your lineup as set in Sleeper, kickoff by kickoff, with
            the changes due before each game starts. For Questionable starters it says when inactives come out (90 minutes before kickoff) and who
            would replace him if he&apos;s out, including a better fill-in whose game starts before the news. The app can&apos;t send alerts, so this
            tells you when to look again.
          </li>
          <li>
            <strong>Ask the analyst</strong> (a league&apos;s Ask tab, with your own Anthropic API key): questions in plain words, answered by Claude from
            the app&apos;s own figures for that league. The model quotes figures by reference and the app puts in the numbers, so they match the other
            tabs; any number it types itself is checked and marked when it isn&apos;t one of the app&apos;s. It can still misread a figure, so the
            reasoning is worth a glance.
          </li>
          <li>
            <strong>Across your leagues</strong> (Home, with two or more in-season leagues): players in the recommended lineup in more than one
            league, NFL games holding three or more of your starter spots, and on request, free agents who are top waiver targets in more than one
            league, with what each adds in each and where he adds more.
          </li>
          <li>
            <strong>What would it take?</strong> (Trade tab): pick a player on another team, and it searches packages of one or two of your players
            for him that improve both best lineups, best for you first, with market values. When none does, it shows the cheapest packages their
            lineup gains from, and what they&apos;d cost yours.
          </li>
          <li>
            <strong>Buy low, sell high</strong> (Trade tab and player details): players whose PPR points over recent games ran 3+ a game ahead of
            or behind what their usage was worth (expected points from ffopportunity). Tested on 2022–2025, a streak didn&apos;t predict how
            players did against RotoWire&apos;s projections afterwards, so values don&apos;t change. The card lists your players running hot and other
            teams&apos; players running cold who&apos;d start for you, for trading with managers who go by recent points.
          </li>
          <li>
            <strong>Weeks ahead and season so far</strong> (Season tab). Ahead: each week to the end of the season, with regular starters on bye
            or not projected, players coming back, and in weeks with a hole, the free agent who adds most that week. So far: your record against
            all-play (your score against every team each week), which shows how much the schedule has helped or hurt. Each week&apos;s best lineup
            in hindsight, against the league&apos;s average share. Your players against their projections. And, from now on, the app&apos;s own
            lineup pick, saved on this device until the main Sunday kickoff.
          </li>
          <li>
            <strong>Trade ideas</strong> search one-for-one and two-for-one trades with every team, among each team's eight most valuable QBs, RBs,
            WRs and TEs, for trades that improve both best lineups over the rest of the season. It's lineup math only: whether the other manager says
            yes also depends on how they rank players, so market values are shown beside each idea. A spot a trade opens isn&apos;t filled from free
            agency in any trade evaluation: you could make that pickup without the trade.
          </li>
          <li>
            <strong>Keeper and dynasty leagues</strong> also get a long-term view. Trades show market value this season and beyond it (FantasyCalc
            dynasty values). In dynasty leagues you can add draft picks: next year's are priced by the original team's projected finish (worst record
            picks first), later years at the round's price. The Season tab ranks teams by the value of the players (and picks) they carry forward and
            lists your likely keepers.
          </li>
          <li>
            <strong>Draft helper</strong> (Draft tab, redraft and keeper leagues): next season&apos;s board under your league&apos;s scoring, valued over
            replacement. Projections are our own, from this season so far and the two before it, pulled toward each position&apos;s average and
            adjusted for age and contract status; on 2015–2025 they ranked players better than &quot;same as this year&quot;, with wide misses. Rookies
            are placeholders by the order their position is taken until the NFL draft. Keeper leagues get each team&apos;s likely keepers. Set or
            randomize the draft order, compare first-round slots, and run a mock draft against teams picking from the same board with noise.
            Once Sleeper&apos;s draft starts, the tab follows it pick by pick, with suggestions for your next pick.
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
            Tested on 2022–2025, neither predicted points better than RotoWire's projections, which already price matchups, so neither changes them.
          </li>
          <li>
            <strong>Second opinion</strong>: player details also show our own baseline, built from each player's recent expected usage
            (ffopportunity) and this week's implied team total. Over 2024–2026 it was about 1–5% less accurate than RotoWire for RBs, WRs and TEs and
            about 20% for QBs. Team defenses come from the opponent's implied total and league-average sacks and takeaways, about as accurate as
            RotoWire's. Averaging either with RotoWire gained little and not every season, so neither is used in projections. If Sleeper's
            projections are missing for a week, every position but kicker falls back to it, labelled.
          </li>
        </ul>
      </div>

      {accuracy.data ? <AccuracyCard file={accuracy.data} /> : null}
      {pooled ? <LedgerCard ledger={pooled} /> : null}

      <div class="card">
        <h2>Data and credits</h2>
        <ul>
          <li>League, roster, matchup and player data: Sleeper API (read-only, non-commercial use).</li>
          <li>Projections: RotoWire, via Sleeper.</li>
          <li>Practice reports and schedule: nflverse (CC-BY 4.0), processed daily.</li>
          <li>Usage and matchups: nflverse (CC-BY 4.0) weekly stats and snap counts (compiled by Pro Football Reference).</li>
          <li>
            Next season&apos;s projections (draft helper): our own, from nflverse (CC-BY 4.0) weekly stats, NFL draft picks and contract years
            (OverTheCap, via nflverse). Only projections and a no-contract flag are published, no contract terms.
          </li>
          <li>
            Second-opinion baseline and points against usage: expected points from{' '}
            <a href="https://github.com/ffverse/ffopportunity" target="_blank" rel="noopener">
              ffopportunity
            </a>{' '}
            (ffverse, CC-BY-SA 4.0); our baseline file and the usage file&apos;s expected-point figures are shared under the same licence.
          </li>
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
          <li>No accounts and no server-side storage. Your Sleeper username, the lineup picks the app saves for its season review and the data the app loads stay on this device.</li>
          <li>Your browser requests data directly from Sleeper (username, league IDs) and from this site (GitHub Pages, which keeps standard access logs).</li>
          <li>
            Ask the analyst (only if you add an Anthropic API key): the key stays on this device, and each question sends that league&apos;s figures (team
            and player names, projections, odds, free agents) and your question from your browser to Anthropic, under your Anthropic account.
          </li>
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

const RELEASES = 'https://github.com/RCJLabs/Fantasy-Football-App/releases';

/** The app's own predictions, saved before each kickoff and scored after the games (published aggregates; docs/ledger.md). */
function LedgerCard({ ledger }: { ledger: PooledLedger }) {
  const w = ledger.weeks;
  const contiguous = w.every((x, i) => i === 0 || x === w[i - 1]! + 1);
  const span = w.length > 1 && contiguous ? `weeks ${w[0]}–${w.at(-1)}` : `week${w.length > 1 ? 's' : ''} ${w.join(', ')}`;
  const p = ledger.points;
  return (
    <div class="card">
      <h2>How did the app's own predictions do?</h2>
      <p class="muted small">
        Before every kickoff the app saves each player's chance to play and points, and publishes a fingerprint of them so they can't be changed
        afterwards. After the games they're checked against what happened: {ledger.season} {span}, {ledger.games} games.
      </p>
      {ledger.calibration.length ? (
        <div class="table-wrap">
          <table class="table">
            <caption class="muted small">Chance to play, players with an injury tag</caption>
            <thead>
              <tr>
                <th>Tag</th>
                <th class="num">Players</th>
                <th class="num">Predicted</th>
                <th class="num">Played</th>
              </tr>
            </thead>
            <tbody>
              {ledger.calibration.map((r) => (
                <tr>
                  <td>{groupLabel(r.group)}</td>
                  <td class="num">{r.n}</td>
                  <td class="num">{pct(r.predicted)}</td>
                  <td class="num">{pct(r.observed)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {p.n ? (
        <p class="small">
          <strong>Points if active:</strong> {p.n} players projected for {p.minProjected}+ PPR who played. Average miss {p.mae.toFixed(1)} points, bias{' '}
          {signed(p.bias)}; {pct(p.within1)} landed within the app's ±1 SD range (about 68% means the range is right).
        </p>
      ) : null}
      <p class="muted small">
        Groups of a few dozen players are a rough read. The weekly scores and the fingerprints are public on{' '}
        <a href={RELEASES} target="_blank" rel="noopener">
          GitHub
        </a>
        .
      </p>
    </div>
  );
}
