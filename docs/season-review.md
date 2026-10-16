# Season so far, and the weeks ahead

Built 2026-10-16 at the owner's request: "looking at previous weeks and future weeks to plan and assess". Code:
`app/src/analysis/review.ts` (past weeks), `app/src/analysis/planner.ts` (weeks ahead), `app/src/ui/advice.ts` (the app's saved
picks); shown in the Season tab (`app/src/ui/WeeksCards.tsx`). The **Weeks ahead** card replaces "Your schedule".

## Weeks ahead

One row per week from next week to the end of the season, playoff weeks included:
- **Opponent, Proj, Win:** as before. The best lineup's expected points, chances to play included, and the win chance against the
  scheduled opponent. Playoff weeks show the round and **where your best lineup ranks** in the league that week, since the opponent
  isn't known yet.
- **Holes:**
  - **Bye:** a regular starter whose NFL team is off. A regular starter is a player who starts in at least half the weeks he plays
    (the same rule as the trade tab's bye grid).
  - **Not projected:** a regular starter with no projection that week and no bye. In practice that means injured, suspended or released.
  - **Open slots:** starting slots nobody with a projection can fill.
- **Back:** a player out now (Out, IR, PUP, suspended and the like, or on IR) in the first week Sleeper projects him again. That's
  Sleeper's estimate of his return, the same one the rest-of-season values use (`ros.ts`, `RETURN_PLAY`).
- **Best pickup** (only in a week with a hole): the free agent who adds most to that week's best lineup.
  - The candidates are the 6 best free agents at each position by that week's expected points.
  - It's named only if it adds at least 1 point `[design]`.
  - The gain is before any drop he needs. The Waivers tab weighs the drop over the whole season.

**Bye detection** relies on the projections the app caches: rows under 0.2 points are dropped, and Sleeper sends zero-point rows for
teams on bye. A real-league check that skipped that step saw no byes at all; done as the app does it, the byes were all there.

## Season so far

From Sleeper's final matchups of the regular-season weeks already scored:
- **Record**, head-to-head, plus the league-median game where the league has one.
- **All-play:** each week's score against every other team's.
  - **Expected wins:** each week's share of all-play wins, summed. That's what the scores would earn against an average schedule.
  - **Luck:** actual wins (ties half) minus expected wins. Across a league it sums to zero; on the owner's leagues it did, to three
    decimals.
- **Points against**, ranked in the league.
- **Best possible lineup, in hindsight:** the most any legal lineup from that week's roster could have scored, by the same assignment
  solver as the optimizer.
  - Taxi-squad players are left out.
  - A slot may stay empty, as in Sleeper.
  - **Efficiency:** your points as a share of that total. The league's average share and your rank show what's normal: nobody gets
    100%.
- **App:** the points of the lineup the app recommended, for weeks it saved one on this device.
  - The pick is saved whenever the app works out your lineup (Home or the league page), until the week's main Sunday kickoff: the first
    at or after noon Eastern.
  - Thursday and early international games lock before that, and the optimizer treats them as fixed. So the saved pick is one lineup
    you could have played.
  - It's per device (localStorage) and starts with this release: earlier weeks have no pick. Best-ball leagues aren't saved.
- **Your players vs projections:** current players (taxi aside), per game.
  - It covers weeks in which Sleeper projected him to play and he was on a roster in the league. Sleeper only reports points for
    rostered players.
  - Projections are Sleeper's past-week rows, which freeze around kickoff ([spikes.md](spikes.md#e-past-weeks-are-served)). They're
    rescored to the league, as points if he plays.
  - **Highlighted:** the total gap is more than 2 weekly SDs. That's the spread the win chances use (`pointSd`); within it, the gap is
    ordinary weekly noise.

## Limits

- **Looks back.** Projections already move with results, so a player beating his projection so far isn't a forecast that he will. It
  stays display-only. A "buy low, sell high" signal would need its own backtest (roadmap: assistance list, item 5).
- **Late scratches:** a player projected but ruled out after the rows froze counts as a 0 against his projection.
- **Positions** come from today's player database, as do taxi squads. A player released since, and missing from the database, can't be
  placed; the week's best is then at least what was scored.
- **The app's pick** is only as complete as your visits: no visit before the cutoff, no pick that week.
- **Pickups** in the planner ignore waiver order and FAAB. They show where a pickup would matter, not whether you'd get him.

## On the owner's leagues (2026-10-16, week 6)

Aggregates only.
- **10-team keeper league:**
  - 4-1 on scores that beat 31 of 45 others; 3.4 wins expected, so luck is +0.6.
  - Lineups at 89% of the best possible against a league average of 89% (6th of 10), 90 points left on benches over five weeks. The
    league ranges from 82% to 95%.
  - **Weeks ahead:** holes in weeks 7–11 (one to three regular starters on bye; an open slot in week 9) and one player back in week 7.
    Best pickups add 3.6 to 9.6 points in those weeks.
  - **Players:** 15 compared; gaps from +6.6 to −7.9 a game; none beyond 2 SD.
- **12-team redraft league (median game):**
  - 2-3, and 2-3 against the median; all-play 26-29, 2.4 wins expected, luck −0.4.
  - Lineups at 88% against 89% (9th of 12).
  - **Weeks ahead:** holes in weeks 8–11 and 13.
  - **Players:** 12 compared; one beyond 2 SD.
- **Dynasty league before its draft:** no review.
- **Time:** the review takes 3–10 ms and the planner about 75 ms per league on a desktop, after the season simulation.
