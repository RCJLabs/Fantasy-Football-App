# Rest-of-season uncertainty: projection error that persists

Built 2026-10-16. Code:
- `app/src/analysis/season.ts` (`drift`; `offset` is kept only for the backtest comparison);
- `ros.ts` (`ROS_DRIFT`, `teamDrift`, `ROS_OFFSET`, `changeVariance`);
- `outlook.ts` (wiring, trade odds and ranges);
- `scripts/backtest/season-odds.ts` (the season backtest);
- `scripts/calibrate/ros-ranges.ts` (the range calibration);
- `scripts/calibrate/ros-realization.ts` (the realization check).

## The problem

The season simulation drew each future week independently around the projections. That treats every team's strength as known.
Weekly swings average out over a season, so the simulation was too sure of who'd make the playoffs and win the title. That was the
first limit listed in [title-odds.md](title-odds.md).

## Measured: how much projection error persists

Data: RotoWire projections (via Sleeper) against Sleeper's results, QB/RB/WR/TE projected 5+ who played, 2022–2025. The
`scripts/history/pull.sh` bundle is private; only aggregates are reported here.

- **Week to week, against each week's updated projection:** errors barely carry over. The lag-1 correlation is 0.00–0.06 and lags 2–8
  are near zero. RotoWire updates fast.
- **Against the rate projected at week w (what rest-of-season values use):**
  - the next 8–12 weeks' average misses by an SD of 4.5–5.4 points per game;
  - independent weekly noise alone would give about 2.3.
- **Shape:** errors between later weeks covary more than errors between early and late weeks.
  - That fits a drift that grows like a random walk better than a fixed per-player offset.
  - For players projected 15+, it's roughly 0.3–0.5% of the rate's square per week; for mid-tier players, several times that.
  - These per-band estimates are noisy (overlapping anchors, a few hundred players per band), so the size is set by the backtest below.

## The model `[measured]`

- **Per player:** each QB/RB/WR/TE starter's level drifts from his projection by `ROS_DRIFT` = 0.3 of it per week ahead, as a
  random walk.
- **Per team:** a team's drift is that, added in quadrature over its starters' expected points (`teamDrift`, averaged over the next 4
  weeks so a bye doesn't shrink it). In each simulated season it accumulates week by week and shifts every later week's mean, through
  the playoff rounds too.
- **Fresh weeks:** this week's projections (and next week's, once this week is scored) don't drift.
- **Not covered:** K, DEF and IDP, which weren't measured.

## Backtest: does it make the odds better?

`scripts/backtest/season-odds.ts` builds synthetic leagues from each season's real players.
- **League:** 10 teams, drafted by preseason ADP with noise. Starting lineup: QB, 2 RB, 2 WR, TE, FLEX; 14 rounds.
- **Weeks:** each week every team starts its best projected lineup and scores what those players actually scored. The top 4 after
  week 14 make the playoffs.
- **Predictions:** after weeks 3, 5, 7 and 9, the app's own `simulateSeason` predicts the top 4.
  - It uses the standings so far, plus flat rest-of-season rates: each player's projection for the next week, zero on byes, times the
    future-week availability curve.
  - The weekly SD is the measured spread of actual − projected team scores: 0.21 × the projected total.
- **Scoring:** log loss and Brier score over 16,000 team predictions (100 leagues a season × 4 seasons × 4 anchors × 10 teams), with
  1,000 simulations each.

**Frozen rosters:**

| drift | log loss | Brier | log loss 2022–23 | log loss 2024–25 |
|---|---|---|---|---|
| 0 (before) | 0.520 | 0.167 | 0.533 | 0.508 |
| 0.1 | 0.500 | 0.164 | 0.510 | 0.489 |
| 0.2 | 0.486 | 0.161 | 0.495 | 0.477 |
| **0.3** | **0.484** | **0.161** | **0.493** | **0.476** |
| 0.4 | 0.487 | 0.162 | 0.495 | 0.478 |

**With weekly waiver pickups:** each team swaps its lowest-projected player for the best free agent when he's projected 2+ points more,
one claim a week, in random order.

| drift | log loss | Brier | log loss 2022–23 | log loss 2024–25 |
|---|---|---|---|---|
| 0 (before) | 0.575 | 0.183 | 0.591 | 0.560 |
| 0.2 | 0.515 | 0.172 | 0.525 | 0.506 |
| **0.3** | **0.506** | **0.169** | **0.515** | **0.498** |
| 0.4 | 0.505 | 0.169 | 0.513 | 0.497 |
| 0.5 | 0.506 | 0.169 | 0.513 | 0.498 |

**Calibration, frozen rosters** (each pair of columns is grouped by its own predictions):

| predicted, before | made it | predicted, drift 0.3 | made it |
|---|---|---|---|
| 1.3% | 6.3% | 1.6% | 2.1% |
| 11.7% | 18.4% | 12.6% | 10.9% |
| 29.6% | 34.7% | 30.1% | 27.8% |
| 50.0% | 47.3% | 49.7% | 49.8% |
| 70.0% | 60.5% | 68.8% | 72.6% |
| 87.9% | 78.0% | 86.9% | 90.5% |
| 98.2% | 94.1% | 97.8% | 98.0% |

**Reading:**
- Without drift the odds were too extreme at both ends.
- 0.3 is the best value with frozen rosters, and within 0.3% of the best (0.4) with pickups.
- Picking it on 2022–23 and testing on 2024–25 (or the reverse) gives the same answer.
- Pickups make the old odds worse, not better: the simulation sees only today's rosters, so roster churn is more drift it can't foresee.
- By anchor, the best drift was 0.2–0.5. It was smaller early in the season, when there's more of the season left for weekly noise.

**Shape at the team level.** A fixed per-team offset (one draw per simulated season) was tried too, with
`--no-waivers` and without. The random walk predicted standings better:

| | frozen rosters | with waiver pickups |
|---|---|---|
| Best random walk | 0.484 (0.3 a week) | 0.505 (0.4) |
| Best fixed offset | 0.486 (0.4) | 0.510 (0.5–0.6) |

Roster churn piles up over a season, so standings odds keep the walk. A single player is different (next section).

## Ranges on a trade's points `[measured]` (built 2026-10-16)

`scripts/calibrate/ros-ranges.ts` sets the size of a trade's ranges.

**Data.** 14,623 player-anchors from 2022–2025: QB/RB/WR/TE projected 5+, anchors after weeks 3–12, horizons of 4, 8 and 12 weeks.
- **Predicted total:** the app's own. This week's projection is used as a flat rate, zero on byes, times the availability curve.
- **Actual total:** missed games count as zero.

**Model.**
- **Variance:** the app's weekly variance (inactive or a spread around the projection) plus a season-long miss.
- **Shape:** fitted by maximum likelihood on errors centered by position and horizon.
  - A fixed offset fits best: `ROS_OFFSET` = 0.41 of the expected points from next week on. Log-likelihood −3.782.
  - A random walk fits worse (−3.796), and adding one to the offset doesn't help.

| pos | weeks | n | mean error | SD of error | app SD, no offset | 80% held, no offset | with the offset |
|---|---|---|---|---|---|---|---|
| QB | 4 | 1169 | −6.2 | 22.7 | 15.8 | 62.3% | 79.6% |
| QB | 8 | 817 | −15.5 | 41.0 | 23.4 | 50.6% | 82.9% |
| QB | 12 | 360 | −27.6 | 63.3 | 29.7 | 39.4% | 80.6% |
| RB | 4 | 1896 | −2.3 | 19.1 | 15.4 | 66.0% | 79.0% |
| RB | 8 | 1341 | −5.5 | 33.0 | 22.0 | 54.8% | 78.1% |
| RB | 12 | 599 | −8.8 | 48.4 | 26.8 | 47.6% | 78.0% |
| WR | 4 | 3096 | −4.4 | 17.7 | 15.5 | 68.7% | 81.1% |
| WR | 8 | 2158 | −10.5 | 29.8 | 22.3 | 62.0% | 84.7% |
| WR | 12 | 962 | −15.3 | 42.6 | 27.5 | 55.7% | 85.1% |
| TE | 4 | 1113 | −0.8 | 16.3 | 13.3 | 66.9% | 77.0% |
| TE | 8 | 773 | −3.9 | 27.7 | 18.9 | 56.8% | 80.6% |
| TE | 12 | 339 | −4.2 | 38.2 | 22.7 | 47.2% | 78.2% |

**Reading the table:**
- **Overall:** 80.8% held (81.1% on 2022–23, 80.5% on 2024–25).
- **By horizon:** 79.7%, 82.0% and 81.5% over 4, 8 and 12 weeks. The random walk swings from 75.1% to 88.0%.
- **Bias:** the app's totals run high, by 5–12% (more for QBs). Players miss more games, or get benched, more often than the availability
  curve expects. A trade compares players with the same lean, so the range is centered on the change.

**In the app** (`changeVariance`):
- **Which players count:** each player who arrives or leaves, including forced drops and free-agent fills. Each counts in the weeks he'd
  start for the roster in question, with his weekly variance plus a fixed offset of 0.41 of his weighted points.
- **Combining:** players are independent.
- **Shown:** the 80% range of the change, and the chance it adds points (normal approximation).

## Realization: do the values come true on average? `[measured on a proxy]` (2026-10-16, open)

`scripts/calibrate/ros-realization.ts`, on the same population as the ranges: 1,243 player-seasons, 2022–2025.
- **Expected** points k weeks ahead: this week's projection as a flat rate, times the availability curve, zero on byes.
- **Actual** points: what was scored, missed games as zero.

Actual ÷ expected points:

| pos | this week | 1 week ahead | 2 | 4 | 8 | 12 | weeks 1–12 pooled (95% interval) | 2022–23 | 2024–25 |
|---|---|---|---|---|---|---|---|---|---|
| QB | 0.99 | 0.87 | 0.85 | 0.87 | 0.81 | 0.78 | 0.84 (0.78–0.89) | 0.81 | 0.88 |
| RB | 1.02 | 0.90 | 0.91 | 0.94 | 0.94 | 1.01 | 0.93 (0.89–0.98) | 0.92 | 0.95 |
| WR | 0.97 | 0.86 | 0.86 | 0.88 | 0.90 | 0.92 | 0.88 (0.84–0.92) | 0.88 | 0.88 |
| TE | 1.06 | 0.94 | 0.94 | 0.95 | 0.94 | 1.05 | 0.94 (0.87–1.01) | 0.90 | 0.97 |

Intervals are bootstrapped by player. Over all positions, weeks 1–12: 0.89.

**Established:**
- This week's projection comes true on average (0.97–1.06), even counting missed games as zero.
- From next week on, the proxy runs high: by 6–16% depending on position, and about 11% over all. Both season halves agree; QBs most.

**Not established: why.** Two likely causes, neither measured:
- The availability curve counts game-day actives. A player who leaves a game hurt, loses snaps or is benched counts as fully available.
- Players picked for a good projection this week may drift back toward their usual level later. For example, a role that grew because
  a teammate is out.

**The proxy is not what the app uses.** The app values each future week with Sleeper's own projection for it. The history bundle can't
show what those were, because Sleeper's API returns each past week's projection as it stood that week. In the archive's one full 2026
snapshot (week 6), for the same population:
- Sleeper's future weeks average 0.97 of next week's projection.
  - The typical player is flat: the median is 1.00.
  - Players differ: the 10th to 90th percentiles are 0.87 and 1.09.
- Week to week, a player's projection moves about 7%, mostly with the opponent.

So about 3 of the 11 points may already be in the app's values. The per-player differences touch more than the bias:
- **The ranges** were sized on the proxy. If Sleeper's per-player differences foresee real changes (a role growing, a return from
  injury), the app's totals miss by less than the proxy's, and the ranges are too wide. If the differences are noise, the ranges are too
  narrow.
- **The drift** has the same question, through the season odds.

**Decision: no correction yet.**
- It's measured on a proxy, not on the app's values.
- In a trade or a waiver claim both sides carry a lean, so much of it cancels. It doesn't cancel across positions: a QB's lean (0.84)
  isn't a TE's (0.94).
- A cut to each player's points would overstate a team's loss. When a player is benched or loses his role, his manager starts someone
  else. The app's lineup values count a bench player stepping in only when a starter is inactive.

**Plan:**
- **Data:** the archive now saves every remaining week's Sleeper projections every day; the daily job no longer misses days when GitHub
  starts a run late.
- **Rerun on the app's real values:** this table, the ranges' coverage and the drift backtest, using Sleeper's future-week projections as
  they stood at each anchor.
- **When:** a first look after a few weeks; a real answer after the season, since one season is a small sample.
- **If the lean holds:** test a factor per position for future weeks, with the same out-of-sample checks as the drift.

## What changes in the app

- Playoff, bye, 1st-place and title odds are less extreme, most of all early in the season.
- A trade's odds before and after both carry each roster's drift, recomputed for the roster after the trade.
- Each side of a trade shows an 80% range for its change in rest-of-season points, and the chance it adds points.
  - Example: swapping two similar starters for about +8 points can still come out anywhere from −55 to +72 (57% to help).
- Playoff-week weights follow the playoff odds ([title-odds.md](title-odds.md)), so they move with them.
- Rest-of-season point values don't change: the drift and the offset are symmetric, so expected points stay the same.

## Limits

- **Synthetic leagues.** The leagues are built, not real:
  - 10 teams, top 4 make it;
  - projection-based lineups;
  - no trades;
  - a crude waiver model;
  - skill positions only.

  Real leagues differ in size, scoring and how active managers are.
- **Not unbiased.** The backtest's weekly SD and the app's (from its player model and same-game correlations) are close, but not the same.
- **Not per player.** The drift is the same share for every starter. The measurement hints it's larger for mid-tier players.
- **Ranges simplify.** They count only the players who move, in the weeks they'd start. Bench players who start more after a trade aren't
  counted, and players are treated as independent.
- **Unmeasured positions.** K, DEF and IDP use the same offset.
- **Bias left in.** The 5–12% lean in projected totals isn't corrected. It largely cancels in a trade, and it's measured on a proxy
  (Realization, above).
- **A flat proxy.** The drift, the ranges and the lean were all measured with this week's projection as a flat rate for every later week.
  The app uses Sleeper's own future-week projections, which differ per player (Realization, above).

## Reproduce

```sh
npx tsx scripts/backtest/season-odds.ts <decrypted history dir> --leagues 100 --sims 1000               # with waiver pickups
npx tsx scripts/backtest/season-odds.ts <decrypted history dir> --leagues 100 --sims 1000 --no-waivers  # frozen rosters
npx tsx scripts/calibrate/ros-ranges.ts <decrypted history dir>                                         # trade ranges
npx tsx scripts/calibrate/ros-realization.ts <decrypted history dir>                                    # realization
```
