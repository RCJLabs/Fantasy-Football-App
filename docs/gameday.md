# Game day

Built 2026-10-18 at the owner's request, from the seven ideas weighed that day:
- first ideas 1 (live feed), 3 (swing players) and 6 (game clock), in PR #45;
- then ideas 2 (win-chance graph), 4 (rooting guide) and 5 (around the league).

Idea 7 and a late-swap shortcut are queued in [PLAN.md](PLAN.md) under "Game day".

Code:
- `app/src/data/scoreboard.ts`: ESPN's scoreboard, read into game clocks by Sleeper team code.
- `app/src/analysis/analyze.ts` (`played`, `starterDist`, `corrItem`): how much of a started game is left, from its clock.
- `app/src/analysis/liveFeed.ts`: the live feed (each check compared with the one before; stat lines matched to entries).
- `app/src/analysis/swing.ts`: swing players (the win chance with one player's points fixed).
- `app/src/analysis/rooting.ts`: the rooting guide (each game's net and its stake in each league).
- `app/src/analysis/aroundLeague.ts` and `oddsWithWeek` in `app/src/analysis/outlook.ts`: around the league and its playoff odds.
- `app/src/ui/MatchupTab.tsx`: the cards; `app/src/ui/WinChart.tsx`: the graph; `app/src/ui/Home.tsx` (`RootingGuide`).
- `app/src/ui/statLine.ts` (`statChange`): what a change in a stat line says.
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
- **Live feed (idea 1):** each check (every minute while a starter's game is on and the page is open) is compared with the one before.
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
  - One point per check while the page was open; the line breaks where it was closed (checks more than 3 minutes apart).
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

## Data rules

- **Browser only:** the browser loads ESPN's scoreboard straight from ESPN while games are on. The pipeline never fetches it, and
  the site never stores or republishes it. It's the same rule as the player news.
- **Privacy:** the request is the plain scoreboard, nothing about the user or their leagues. The About page says so.
- **On the device:** the live feed stays in this browser's storage (IndexedDB), like the rest of the cache.

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
  - **Sleeper stats:** HTTP 200, CORS `*`, `cache-control: public, s-maxage=4, stale-while-revalidate=600`; unchanged between two
    polls a minute apart (the CDN copy was 59 seconds old). Whether its stat lines update during play is for the 70-minute run over
    the 1 pm games (39145684454); until then the feed's "what happened" may only fill in after Sleeper's stats catch up.
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
- **Unit tests (ideas 2, 4, 5):** the rooting guide (verdicts by side, leagues counted, the stake against a hand calculation,
  what's left of a live game, a defense on its own side, Out players left out, kickoff order when nothing can swing); the odds
  rerun (unchanged with nothing swapped, up for a huge week); matchups as they stand (yours first and on your side).

## Limits

- **Unofficial:** ESPN's scoreboard can change or disappear without notice. The clock then falls back to time since kickoff, and
  the rest works as before.
- **Only while the page is open:** there's no server and no push. Entries are check times, a minute apart at best, not play times;
  one entry can hold several plays.
- **Stat lines can lag the score,** so "what happened" can arrive a check or more after the points.
- **Swing players use the normal model:** rough for players who may not play (their spread mixes "inactive" with "active"), and
  the floor is his points so far (negative plays are possible but rare).
- **The graph only knows what this device saw:** checks while the Matchup tab was open, nothing from before or from other devices.
- **The rooting guide's "your way" is one scenario:** one SD in the game's net. A game can still matter more in a way it doesn't
  capture (an injury, a blowout that benches starters).
- **Google Play:** the plan keeps ESPN out of a Play build until its use is reviewed. That now covers the player news and this
  game clock; no Play build exists yet.
