# Game day

Built 2026-10-18 at the owner's request, from the seven ideas weighed that day:
- first ideas 1 (live feed), 3 (swing players) and 6 (game clock), in PR #45;
- then ideas 2 (win-chance graph), 4 (rooting guide) and 5 (around the league), in PR #46;
- then idea 7 (scoring plays) and the late-swap shortcut.

All seven are built; [PLAN.md](PLAN.md) lists them under "Game day".

Code:
- `app/src/data/scoreboard.ts`: ESPN's scoreboard, read into game clocks by Sleeper team code.
- `app/src/analysis/analyze.ts` (`played`, `starterDist`, `corrItem`): how much of a started game is left, from its clock.
- `app/src/analysis/liveFeed.ts`: the live feed (each check compared with the one before; stat lines matched to entries).
- `app/src/analysis/swing.ts`: swing players (the win chance with one player's points fixed).
- `app/src/analysis/rooting.ts`: the rooting guide (each game's net and its stake in each league).
- `app/src/analysis/aroundLeague.ts` and `oddsWithWeek` in `app/src/analysis/outlook.ts`: around the league and its playoff odds.
- `app/src/ui/MatchupTab.tsx`: the cards; `app/src/ui/WinChart.tsx`: the graph; `app/src/ui/Home.tsx` (`RootingGuide`).
- `app/src/ui/statLine.ts` (`statChange`): what a change in a stat line says.
- `app/src/data/plays.ts`: ESPN's game summary, read into scoring plays and the box score's names; plays matched to players.
- `app/src/data/repo.ts` (`loadWeekStats`, `newerStats`) and `app/src/sleeper/api.ts`: stat lines with each check, the newer copy
  kept, and the browser asked every time (see "Live data").
- `scripts/spike/espn-plays-spike.mjs`: the game summary check (`spike.yml` with `checks: plays`).
- `scripts/spike/live-gameday-spike.mjs`: the live checks, run from Actions (`spike.yml` with `checks: live`).

## What it does

- **Game clock (idea 6):** while games are on, the Matchup tab loads ESPN's NFL scoreboard with each check.
  - Each starter's game shows its quarter and clock ("Q2 8:43", "Half", "End Q3", "OT 4:10", "Final/OT") and the score, his team's first.
  - When his offense has the ball: "has the ball", or "red zone" inside the opponent's 20, with ESPN's down and distance.
  - **Accuracy:** what's left of a started game's projection now follows the clock.
    - Share played = (quarters done × 15 + minutes into this one) / 60. Halftime is 0.5.
    - Overtime counts its clock against the same hour: 10 minutes left is a sixth of a game's expected points.
    - Before, the share was time since kickoff over a typical 3¼ hours, which was off at halftime, in slow games and in overtime.
    - In the Matchup tab, projected finals, the win chances (as set, and with the Lineup tab's changes) and swing players use it.
      The Lineup tab itself still goes by time since kickoff: it doesn't load the scoreboard.
  - Live or final by the clock, not 3½ hours after kickoff: a delayed start stays "to play", and overtime stays live.
  - **Fallback:** without the scoreboard (ESPN down, another week's scoreboard, a copy older than 5 minutes), time since kickoff
    as before. Team codes: ESPN's `WSH` is Sleeper's `WAS`; the other 27 codes on the week 6 scoreboard match.
- **Live feed (idea 1):** each check (every 20 seconds while a starter's game is on and the page is open) is compared with the one before.
  - An entry lists each starter on either side whose points moved, with the win chance before and after. Your gains and their
    losses are green; the rest red.
  - What happened ("TD catch, 34 yd", "2 carries, 11 yd", "INT thrown", "FG, 52 yd", "stat correction") fills in when Sleeper's stat
    line catches up with its score. If a player scores twice before it does, the later entry gets both plays.
  - A pop-up shows each new entry for 6 seconds.
  - **Buzz** (phones that support vibration, on unless turned off) when your player scores 6+ at once or your win chance moves 10
    points: one buzz for good news, two for bad. Not for a catch-up after time away.
  - The feed is kept on the device per league and week, so a reload keeps it. Time away shows as one entry "since" the last check.
  - Each check's win chance and scores are kept too, for the queued graph of the day (idea 2).
- **Swing players (idea 3):** starters on both sides whose games aren't over, ranked by how much their game moves your win chance.
  - Each shows your win chance if he has a big game (one SD above his expected points) or a quiet one (one SD below, never under
    his points so far): about 1 game in 6 each way.
  - Tap one for a what-if slider: his final points → your win chance.
  - **Method:** the matchup's margin (your total minus theirs) is the same normal model the win chance uses. Fixing one player's
    points moves its mean by his covariance with the margin over his variance, and shrinks its variance by that covariance squared
    over his variance. So a QB's covariance includes his receivers in your lineup (+0.3 correlation) and the defense he faces.
  - Shown when a player moves your chance by at least a point; otherwise the card says nobody left can swing the game.

- **Win chance through the day (idea 2):** a line in the Matchup tab's score card, from the feed's record of each check.
  - A point for each check that moved a score, else one about a minute apart, while the page was open; the line breaks where it
    was closed (checks more than 3 minutes apart).
  - The 50% line, today's high and low under it, and the latest value at the end of the line.
  - Hover, or focus it and use the arrow keys, to read any check (win chance, time, score); a table lists every move of a point
    or more.
- **Rooting guide (idea 4):** a Home card covering all your in-season leagues (best ball aside).
  - For each NFL game not over yet: whom to root for, side by side of the ball ("Root for KC offense"), with the expected points
    still to come for your starters minus your opponents', over all your leagues, and who they are.
  - Each league's win chance now, if the game goes your way and if it doesn't. "Your way": your starters in it beat your
    opponent's in it by one SD more than expected; the game's net moves the margin one for one, and players elsewhere are
    independent of it, so the rest of the margin keeps its spread.
  - Games with the most at stake first (the leagues' swings added up: expected wins at stake); games nothing can swing by kickoff.
  - From the lineups as loaded: Home's Refresh brings newer scores. Players with nothing left to score (Out) aren't listed.
- **Around the league (idea 5):** a Matchup tab card, updated with each check.
  - Every matchup this week: each team's points so far, projected final and win chance, modelled like your opponent (lineups as
    set in Sleeper, assumed fill-ins for starters who can't play, same-game correlations). Yours first.
  - **Playoff odds** at the start of the week and now: the Season tab's simulation of the rest of the season, rerun with this
    week's distributions swapped in: before the first kickoff (projections only), and as the games stand (points so far plus
    what's left). Later weeks as on the Season tab. Both runs use the same seeded draws, so the difference isn't sampling noise.
  - Regular season only: once the bracket starts, the Season tab's bracket odds apply.

- **Scoring plays (idea 7):** ESPN's own description of each scoring play, for your starters and your opponent's.
  - In each live or finished player's cell, "Scoring plays" opens his plays in this game ("Q2 9:12 Taylor Wideout 34 Yd pass from
    Alex Thrower (Sam Boot Kick)"). Passers and kickers are named in the same plays (the kicker's extra point).
  - In the live feed, an entry of 3.5 points or more shows the play behind it: his plays between the check before (less 5
    minutes, since Sleeper's points can trail the play) and this one, by ESPN's time of the play.
  - **Matching:** the plays carry no player ids, but the summary's box score maps ESPN athlete ids to ESPN's spelling of each
    name. The player file's ESPN ids (2,218 of 3,089 players, 296 of the 300 most-searched) find that spelling; without one, the
    app's name, compared without punctuation or suffixes ("D.J. Moore Jr." reads as "DJ Moore"). One-word names never match.
    Team defenses are left out: their plays name the players, not the unit.
  - **Data:** a summary is 200–650 KB before compression (sent gzipped). It loads only for games the page shows plays for, and
    again only when that game's score or state changes, or while the copy trails the scoreboard's score (see "Live data"); what
    it found is kept on the device per game.
- **Late swaps (the shortcut):** a Matchup tab card with the Lineup tab's changes for the lineup as it stands (live scores and
  clocks), when they're worth it by what the advice aims for: half a point of win chance, or half an expected point.
  - Each change ("Start X over Y"), the expected points and win chance they add, and a link to the Lineup tab.
  - Lineups are set in Sleeper: the app can't change them. Players whose games have started can't be moved, and aren't.

## Data rules

- **Browser only:** the browser loads ESPN's scoreboard straight from ESPN while games are on. The pipeline never fetches it, and
  the site never stores or republishes it. It's the same rule as the player news.
- **Privacy:** the request is the plain scoreboard, nothing about the user or their leagues. The About page says so.
- **On the device:** the live feed stays in this browser's storage (IndexedDB), like the rest of the cache.

## Live data

The Matchup tab checks every 20 seconds while a starter's game is on and the page is open, and right away on coming back to the
page when the last check is 15 seconds old or more. Checks don't overlap. Each check loads what's due (`checkPlan`):

| What | From | How fresh |
|---|---|---|
| Points | Sleeper's matchups | Every check, the browser asking Sleeper every time |
| Lineups | Sleeper's rosters (and league members) | Once a minute, and on coming back to the page |
| Stat lines | Sleeper's stats | Once a minute; at every check while a starter's line trails his points ("updating"); and on coming back. Sleeper's CDN copy is about as old as the gap since the last request for it; an older copy from another CDN edge is ignored (by its newest row's `updated_at`, which moves during games) |
| Game clock, score, ball | ESPN's scoreboard | Kept 30 seconds, plus ESPN's own `max-age` of up to 10 |
| Scoring plays | ESPN's game summary | Loaded when the game's score changes, and again while the copy trails the scoreboard's score |
| Win chance, the graph, swing players, around the league, the feed | Worked out on the device | Each check |

Not live: the Lineup tab (as the page loaded it) and Home's rooting guide (Home's Refresh).

**"Updating":** a starter whose points moved while his stat line hasn't shown it yet gets a small "updating" tag beside his
line, and stat lines load at every check until it catches up.
- Quarterbacks, backs, receivers, tight ends, kickers and team defenses only: IDP lines leave out much of what scores.
- Given up after 3 minutes, since some points never show in a line.
- A stat line that moves before the points is kept for his next entry rather than lost, so the feed still says what happened.
- The lines now keep the keys the feed's "what happened" reads: 2-point tries, field goal distance, missed kicks, return
  touchdowns, safeties, blocked kicks, yards allowed and forced fumbles. Before, they were dropped, so a 2-point catch, say,
  never found its stat change.

**Why 20 seconds** (asked for on 2026-10-18 after the fix below; my estimates, not measured):
- A change waits about 10 seconds for the next check on average, instead of 30.
- Sleeper's CDN copy is roughly as old as the gap between requests for it, so about 20 seconds instead of 60 while a line
  trails. The CDN ignores a browser's `no-cache` (run 39151992208), so asking more often is the only lever. Together, stat lines
  should land about 30 seconds behind Sleeper instead of about 1½ minutes.
- **Data:** scores-only checks fetch this week's matchups, a few KB. Stat lines (about 390 KB of JSON for six positions, before
  compression) still load once a minute, more only while one trails. ESPN's scoreboard is kept 30 seconds, so it loads every
  other check.

**Fixed 2026-10-18,** after the owner saw a quarterback's touchdown pass in his points but not in his stat line (the line had
his first completion only):
- **Stat lines trailed points by up to about 9 minutes.** Three delays stacked:
  - The app kept stat lines 4 minutes, from the Thursday check's `s-maxage=300`.
  - On game day Sleeper sends `s-maxage=4, stale-while-revalidate=600` and no `max-age`. With those headers, Chromium answers a
    `fetch` with the copy from the request before, and refreshes it behind the scenes.
    - Checked in Chromium against a local server sending the same headers: plain `fetch` got the previous copy;
      `cache: 'no-cache'` got the newest, with no extra CORS preflight.
  - Sleeper's CDN copy was itself about a minute old, and sometimes 3–9 minutes (run 39145684454 below).
- **Now:**
  - Stat lines load with each check.
  - The browser asks Sleeper every time (`cache: 'no-cache'`) for stats, matchups, rosters and a draft under way.
  - A copy whose newest row (`updated_at`) is older than the one held is ignored. Rows' `updated_at` moves during games, a few
    seconds before each copy is made (run 39151992208), so an older copy has an older newest row.
  - Stat lines are kept per league's positions: leagues with different positions get different copies from Sleeper.
- **Scoring plays could stay a score behind.** A summary loaded just as a score landed could miss that play, and was kept until
  the game's next score. Now each copy is labelled with the score its own scoring plays reach. One behind the scoreboard is
  loaded again after 30 seconds, up to 4 times per score. It happens: 2 of 18 summaries loaded as a score changed trailed it
  (run 39151992208).
- **Tests:**
  - Unit: the newest copy (dates, an older copy kept out, positions apart); the cache mode of each Sleeper request; a summary's
    own score; when one is loaded again.
  - End to end: the next automatic check (no Refresh) shows the touchdown's stat line; an older copy after it doesn't roll it
    back; coming back to the page checks right away.
  - With the old 4-minute keep, or without the older-copy guard, that end-to-end test fails.

## Checked

- **Spike from Actions, 2026-10-18** (`scripts/spike/live-gameday-spike.mjs`; metadata and aggregates only, no names, stats or text):
  - **ESPN scoreboard** (run 39145816042, 16:37 UTC, London game in the 2nd half): HTTP 200, `access-control-allow-origin: *`,
    `cache-control: max-age=2`, about 240 KB.
    - `status` has `clock` (seconds, a number), `displayClock`, `period` and `type` (`state` pre/in/post; names such as
      `STATUS_IN_PROGRESS`, `STATUS_HALFTIME`, `STATUS_FINAL`).
    - `competitions[0].situation` has `down`, `distance`, `yardLine`, `downDistanceText`, `possession` (a team id),
      `possessionText`, `isRedZone` and `lastPlay`.
    - The live game's clock had moved a minute later.
  - **ESPN game summary** (`summary?event={id}`): HTTP 200 and CORS `*` too, but about 640 KB per game. Its scoring plays and plays
    carry text and team ids, no athlete ids; that matters for idea 7.
  - **Sleeper stats** (run 39145684454, 70 polls a minute apart, 16:35–17:44 UTC, through the first 45 minutes of the 1 pm
    games):
    - HTTP 200, CORS `*`, `cache-control: public, s-maxage=4, stale-while-revalidate=600, stale-if-error=600`.
    - **It updates during games:** the copy changed in 62 of 69 polls, a median of 60 seconds apart (as often as it was asked).
    - The CDN copy was usually 59–60 seconds old: each request gets the copy fetched after the request before.
    - 4 of 69 answers were older copies: `age` 180–540 seconds, with the PPR sum over all rows lower than the copy before. These
      were other CDN edges that hadn't caught up. One more repeated the copy before (`age` 120).
  - **Sleeper stats, second run** (run 39151992208, 50 polls a minute apart, 17:58–18:47 UTC, the 1 pm games' second and third
    quarters):
    - The copy changed in 48 of 49 polls. Sleeper sends an `ETag` (no `Last-Modified`), so a `no-cache` request can come back
      304 when nothing changed.
    - **`updated_at` moves during games.** Each copy's newest row was a median of 65 seconds before the poll (8 to 393). That's
      about 5–15 seconds before the copy was made (its `age`), and it never went backward from one poll to the next.
    - No older CDN copy turned up this time, apart from the first poll (`age` 386).
    - The PPR sum fell 4 times, but each time the newest row moved forward: real stat changes (a sack, a fumble, a correction).
      The older-copy guard rightly lets them through; a guard on the PPR sum would have thrown them away.
    - **`cache-control: max-age=0` got nothing fresher.** That's what a browser sends for `cache: 'no-cache'`. It got the same
      copy as the plain request in 49 of 50 polls (median `age` 59 seconds). The CDN ignores it, so `no-cache` only skips the
      browser's copy; the CDN copy stays about as old as the gap since the last request for it.
  - **ESPN summaries at a score change** (same run):
    - 18 loaded the moment a live game's score changed on the scoreboard: 16 had the scoring play, and 2 trailed it.
    - The header's score matched the last scoring play's in 17 of 18, so the app goes by the scoring plays, which is what it
      shows.
- **Unit tests:** the scoreboard parser (clock, halftime, overtime, a later week, `WSH` → `WAS`); the share played; the clock in
  `starterDist` and in live or final; the feed (entries, win chance, stats matched late, two plays before the stats catch up,
  older data ignored); swing players (ranking, theirs, conditioning, a QB with his receiver); what a stat change says.
- **End to end** (Sleeper and ESPN mocked):
  - the live game shows "Q2 8:43 · 10–7" and "red zone 1st & Goal at BBB 4" for the wideout whose team has the ball;
  - a touchdown between page load and the first check shows as "+6.0 T. Wideout yours" with the win chance before and after, then
    "TD catch, 34 yd" once the stat line catches up; it's still there after a reload;
  - in a close game, swing players list both sides and the what-if slider changes the win chance; in a lopsided one the card says
    nobody can swing it.
  - the win-chance line draws from the checks, the arrow keys read the first check (11.4–75.0) and the table the last (17.4–75.0);
  - around the league lists both matchups (yours first) and playoff odds for all four teams, at the start of the week and now;
  - Home's rooting guide lists the three games still to finish with a verdict per side and each league's win chance either way.
- **Game summaries from Actions, 2026-10-18** (run 39149248559, four of the 1 pm games in the first quarter; counts only):
  - HTTP 200, `access-control-allow-origin: *`, `content-encoding: gzip`; about 190 KB decoded this early (the London game's was
    640 KB late on).
  - Box score: 27–30 athletes per game with ESPN ids and `displayName`, `firstName`, `lastName`, `jersey`.
  - Scoring plays: 3 (2 TDs, 1 FG), every one naming at least one box-score athlete in full (3 per TD pass: receiver, passer,
    kicker). The play-by-play's own text abbreviates names (no full-name matches), so the scoring plays are the ones to match.
  - Participants with athlete ids appear on only some plays (1 of 24 in one game), so ids can't carry the matching.
- **Unit tests (idea 7 and the shortcut):** the summary parser (order, times from the play-by-play, box-score names); matching by
  ESPN name, then by the app's name without punctuation or suffixes, never by one word; the event id on the scoreboard; reloads by
  score and state.
- **End to end (idea 7 and the shortcut):** the wideout's cell opens his touchdown; his feed entry shows the play; the late-swap
  card lists the Lineup tab's two changes with what they add and the link.
- **Unit tests (ideas 2, 4, 5):** the rooting guide (verdicts by side, leagues counted, the stake against a hand calculation,
  what's left of a live game, a defense on its own side, Out players left out, kickoff order when nothing can swing); the odds
  rerun (unchanged with nothing swapped, up for a huge week); matchups as they stand (yours first and on your side).

## Limits

- **Unofficial:** ESPN's scoreboard can change or disappear without notice. The clock then falls back to time since kickoff, and
  the rest works as before.
- **Only while the page is open:** there's no server and no push. Entries are check times, 20 seconds apart at best, not play times;
  one entry can hold several plays.
- **Stat lines can trail the score** by up to about a minute (Sleeper's CDN copy and our check interval). They're tagged "updating"
  meanwhile, and "what happened" arrives a check or two after the points.
- **Points from an older copy:** whether Sleeper's matchups can come from an older CDN copy, as its stats can, isn't measured. It
  would take a league in the public spike's requests.
- **Swing players use the normal model:** rough for players who may not play (their spread mixes "inactive" with "active"), and
  the floor is his points so far (negative plays are possible but rare).
- **The graph only knows what this device saw:** checks while the Matchup tab was open, nothing from before or from other devices.
- **The rooting guide's "your way" is one scenario:** one SD in the game's net. A game can still matter more in a way it doesn't
  capture (an injury, a blowout that benches starters).
- **Scoring plays are matched by name:** an ESPN id with no box-score line yet, or a name ESPN spells differently, can miss.
  Team defenses get none.
- **Google Play:** the plan keeps ESPN out of a Play build until its use is reviewed. That now covers the player news and this
  game clock; no Play build exists yet.
