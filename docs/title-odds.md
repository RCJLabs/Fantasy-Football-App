# Title odds and playoff-week weights

Built 2026-10-16. Code: `app/src/analysis/season.ts` (bracket), `outlook.ts` (wiring, trades), `ros.ts` (`weekWeights`,
`playoffRoundWeeks`); in the playoffs, `bracket.ts` with Sleeper's own bracket (below).

## What the app shows

- **Season tab:** a Title column, the chance of winning the championship, next to playoff, bye and 1st-place odds.
- **Trade tab:** both sides get "title odds X → Y" after their playoff odds.
- **Waivers and trades:** the rest-of-season values weight playoff weeks with the rule below.

## How the bracket is played

Each simulated season goes on into the winners' bracket, from the same simulated standings as the playoff odds.

- **Seeds:** wins (ties count half), then points for.
- **Byes:** the top seeds get first-round byes when the field isn't a power of two.
- **Each round:** each team scores Normal(mean, SD) of its best projected lineup that week, the same distribution the regular season uses.
  A two-week round adds both weeks, treated as independent. A tie goes to the better seed `[unverified]` (it's very rare with continuous
  scores).
- **Pairing:** Sleeper's fixed bracket. In a 6-team field, seed 1 meets the 4/5 winner and seed 2 the 3/6 winner. An 8-team field plays
  1–8, 4–5, 2–7 and 3–6.
  - `[verified]` against Sleeper's pre-filled winners bracket for a real 10-team league with 6 playoff teams (week 6). Its seeding matched
    wins then points for, including ties at 3-2 and 2-3 broken by points for.
- **Re-seeding:** when the league's `playoff_seed_type` is 1, the best seed left plays the worst each round.
  - The setting exists in league data: it was 0 in all three leagues seen.
  - That 1 means re-seed is `[unverified]`.
- **When:** while the whole bracket is ahead, which means through the regular season. After that, the real bracket takes over (next
  section).

## In the playoffs: Sleeper's bracket (built 2026-10-16)

Once every regular-season week is scored, the odds come from Sleeper's `winners_bracket` instead of simulated standings.

**Sleeper's format** `[verified]` on the owner's leagues (week 6, pre-filled with the current seeds):
- Each game has a round, its two teams (roster ids) or, for later rounds, the game whose winner or loser fills the slot, and its winner
  and loser once decided.
- Placement games carry `p`: 1 for the final, 3 and 5 for third and fifth place. The title path is the games without `p`, plus the final.
- The two 6-team brackets seen have 3 rounds with the top two seeds starting in round 2, as the league settings say.
- Once a game is decided, Sleeper fills in the team of each later slot it feeds and keeps the reference beside it (finished 2025 bracket,
  below). The code reads either.
- `[unverified]`: when exactly Sleeper records a winner after a week ends. A finished bracket can't show it; until it does, the round's
  final points decide the game in the simulation.

**Checked on a finished season (2026-10-16)** `[verified]`, on the owner's one 2025 league: 10 teams, 6 in the playoffs, one-week rounds
in weeks 15–17. `scripts/check/bracket-replay.ts` reads it from the private league pull (`scripts/league/pull.sh` now fetches last
season's leagues too) and prints roster ids and numbers only.
- **Sleeper's results:** in all 7 games, placement games included, the recorded winner had more points in the round's week. None tied.
- **Seeding:** roster points for are regular-season points only. The app's finish order (wins, then points for) gives the bracket's six
  teams, its two byes and its first-round pairs (seeds adding up to 9); a 10-4 tie for the second bye went to points for.
- **Replay:** at the start of each playoff week, with later results hidden, and after the final, the app's bracket mode showed:
  - the right teams alive, and title odds adding up to 1, none for teams that are out;
  - rounds already played at their final points;
  - the weeks ahead weighted only for teams still alive;
  - the champion at 100% after the final.
- **The champion's odds:** 21% before round 1, 33% before round 2, 59% before the final. One league says nothing about calibration. The
  replay counts every player as healthy, because stored projection rows carry each player's injury status today, not that week's.
- **Not covered:** two-week rounds or championships, re-seeding, Sleeper's tie rule, and other bracket sizes. The league had none of
  them.

**How the rest is played:**
- **Decided games** stand as Sleeper recorded them, whatever the projections said.
- **Open games:** each team's round score adds:
  - its final points for weeks already played (a two-week round's first week, or a round Sleeper hasn't recorded yet);
  - this week's set lineup, with points already scored;
  - its best projected lineup for weeks still to come, drifting as in the regular season (the first week simulated is fresh).
- **Ties** go to the better seed (wins, then points for) `[unverified]`, as above.
- **Shown:** a Playoffs card in the Season tab with this round's games, each team's chance to win its game, title odds, and who's out.
  Trades show title odds before and after; playoff odds no longer apply.

**Weights in the playoffs:** a team still alive counts each remaining round in full, except a first-round bye week; a team that's out
counts nothing, so its waiver board shows no rest-of-season gain. This is the same rule as before with the playoff odds at 100% or 0%.
Before, every team kept the share of teams that make the playoffs as a weight, out or not.

## Playoff-week weights `[design]`

Rest-of-season values add up each week's best-lineup points times a weight:

- **Regular-season weeks:** 1.
- **Playoff weeks:** the playoff odds.
- **First-round weeks:** the playoff odds minus the bye odds, which is the chance of playing that week.

Before this change every playoff week counted by the playoff odds, so a likely bye week still counted in full.

### Why not weight each round by the chance of playing it?

That weighting was the first version. It ranks the final far below round 1 for most teams, because few teams get there. But the title
needs every round won:

- For a team that must win rounds 1 to R, an extra point in round r is worth P(reach r) × P(win the rest | win r), times how close the game
  is.
- With the same win chance p in each round, that is p^(r−1) × p^(R−r) = p^(R−1), equal in every round.

**Measured.** The same real league as above, as of week 6: 10 teams, 6 in the playoffs, one-week rounds.

- **Team strength:** points per game so far, shrunk halfway to the league average, as a stand-in for projections. SD 25 a week.
- **Test:** add 10 points to one round's mean and count the title-odds gain. 200,000 simulations, with the same random numbers before and
  after.
- **Results** (rounds listed as round 1 / round 2 / final):

| Avg seed | Playoffs | Bye | Title | Title gain from +10 pts | This rule's weights | Chance of playing |
|---|---|---|---|---|---|---|
| 1.4 | 100% | 91% | 35.6% | 0.28 / 5.71 / 6.30 pp | 9 / 100 / 100 | 9 / 97 / 60 |
| 3.7 | 93% | 24% | 14.9% | 1.64 / 3.47 / 3.39 pp | 69 / 93 / 93 | 69 / 64 / 31 |
| 4.7 | 82% | 10% | 7.8% | 1.33 / 2.13 / 2.08 pp | 72 / 82 / 82 | 73 / 46 / 19 |
| 5.8 | 63% | 3% | 5.4% | 1.12 / 1.52 / 1.40 pp | 60 / 63 / 63 | 60 / 32 / 13 |

- **Later rounds** matter as much as round 2 or more. The chance-of-playing weights get the order backwards for every team without a bye.
- **Remaining bias:** for teams without a bye, this rule still gives round 1 more weight than measured. It gives 0.75–0.95 of a later
  round's weight; the measured share is 0.5–0.75, because round-1 points are diluted by the rounds still to win. Kept simple on purpose.
- **Regular-season weeks** stay at 1, as before. Their worth in title terms (through seeding and qualifying) isn't measured.

## Noise

- **Simulations:** the app runs 4,000 by default. That leaves title odds near 15% with a sampling error of about 0.6 points.
- **Trades:** both sides are simulated with the same random numbers before and after, so the change is steadier than either number.
- **Measured** on the same league, giving one team +3 points a week:

| Team | Title change (4,000 sims, mean ± SD over 60 seeds) | Same change, 400,000 sims | Playoff change |
|---|---|---|---|
| 2nd | +4.58 ± 0.45 pp | +4.6 pp | +0.51 ± 0.12 pp |
| 5th | +2.79 ± 0.35 pp | +2.7 pp | +6.88 ± 0.37 pp |

- **Reading it:** a change of a point or less can be noise.
- **Contenders:** the 2nd team's playoff odds were already near 100%, so title odds are the number a trade moves.

## Limits

- **Team strength:** since 2026-10-16 each team can drift from its projection as the season goes on. The drift is sized by a backtest that
  found the old odds too sure of themselves ([ros-uncertainty.md](ros-uncertainty.md)). The examples above predate it.
- **Rosters are frozen.** No trades, pickups or injuries beyond the future-week availability curves ([hazard.md](hazard.md)).
- **Weeks are independent.** The two weeks of a round are drawn independently.
- **In the playoffs, the bracket must load.** If Sleeper's bracket doesn't answer, the Season tab shows the standings only, and every
  team's playoff weeks count by the share of teams that make the playoffs, as before this change.
- **Consolation games** (losers' bracket, placement games) aren't valued: the app plays for the title.
