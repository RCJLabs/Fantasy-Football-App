# Buy low, sell high: running hot or cold

Built 2026-10-16, item 5 of the owner's assistance list. Backtest: `pipeline/luck.ts` and `scripts/backtest/luck.ts`. Figures:
`pipeline/usage.ts` (the usage file's `luck` entries). App: `app/src/analysis/luck.ts`, shown in player details
(`app/src/ui/components.tsx`, `StreakNote`) and the Trade tab (`app/src/ui/SeasonTabs.tsx`, `BuyLowSellHigh`).

## What the app shows

- **Player details:** a "running hot" or "running cold" line when a player's PPR points a game over recent games are 3+ above or below
  what his usage was worth. It also gives his touchdowns, scored and expected.
- **Buy low, sell high card** (Trade tab, until the trade deadline):
  - **Sell high:** your players running hot, biggest gap first.
  - **Buy low:** other teams' players running cold who'd be regular starters for you, most valuable first. A regular starter starts in
    at least half the weeks he plays.
  - Both lists need 5+ expected points a week over the rest of the season, show up to four players, and open the player in the trade
    builder.
- **No value changes.** The backtest below found no lift, so a streak is information for trade talks, not an input.

## The figures `[data]`

- **Games:** the usage file's last four NFL weeks, counting only games ffopportunity has processed, so both sides cover the same games.
  A figure needs 3+ games.
- **Points scored:** nflverse weekly stats mapped to Sleeper's stat keys ([stat-mapping.md](stat-mapping.md)).
- **What the usage was worth:** ffopportunity's expected stats for the same games, mapped the same way as for the baseline
  ([baseline.md](baseline.md)).
- **Scoring:** both are scored PPR (a point a reception) in every league, so the threshold means the same everywhere. In half-PPR
  leagues a receiver's gap is a little smaller, since catch luck counts half.
- **Touchdowns:** passing, rushing and receiving, scored and expected.
- **Licence:** the expected figures are adapted from ffopportunity (CC-BY-SA 4.0) and published under the same licence, as recent-game
  totals only.

## Does a streak predict anything? `[measured]`

**Question:** does a player's recent luck (points above what his usage was worth) predict how he does against Sleeper's (RotoWire's)
projection, this week and over the next four? If it did, values should adjust for it. If not, it's display only. That usage predicts
future points better than recent points is a common claim (`[reported]`); this tests it against the projection the app actually uses.

**Data:** 2022–2025 regular seasons.
- Sleeper's weekly projections, frozen around kickoff, and Sleeper's stats (our encrypted history pull).
- ffopportunity expected points per game, and nflverse weekly rosters for ids.

**Setup:**
- **Luck:** points a game over the player's last four games (3+ with usage data) minus what his usage was worth, full PPR.
- **Rows:** player-weeks projected 5+ points.
- **Fit and test:** slopes fitted on 2022–23, scored on 2024–25. The 95% intervals are a bootstrap over players.

**How big luck is (2022–23):** SD 2.70 points a game. Its correlation with how players then did against the projection is under 0.06
everywhere.

| Pos | Player-weeks | Luck SD | Corr. with this week vs projection | Corr. with next 4 weeks vs projection |
|---|---|---|---|---|
| QB | 789 | 3.13 | 0.053 | 0.016 |
| RB | 1,385 | 2.70 | 0.013 | −0.028 |
| WR | 2,285 | 2.65 | 0.007 | −0.027 |
| TE | 770 | 2.15 | −0.004 | 0.040 |
| All | 5,229 | 2.70 | 0.018 | −0.007 |

**Slope: projection error per point of luck (2022–23).** Negative would mean players running hot then fall short of their projections,
so the projection hadn't priced the luck out. Every interval includes zero.

| Pos | This week (95%) | Next 4 weeks (95%) |
|---|---|---|
| QB | 0.122 (−0.014 to 0.244) | 0.026 (−0.119 to 0.159) |
| RB | 0.034 (−0.125 to 0.172) | −0.049 (−0.183 to 0.073) |
| WR | 0.018 (−0.098 to 0.132) | −0.048 (−0.166 to 0.079) |
| TE | −0.012 (−0.257 to 0.197) | 0.075 (−0.144 to 0.257) |
| All | 0.046 (−0.028 to 0.116) | −0.012 (−0.087 to 0.056) |

**What predicts the next four weeks (2022–23):** correlation of a player's points a game over this week and the next three with each
predictor.

| Pos | Recent points | What recent usage was worth | Projection |
|---|---|---|---|
| QB | 0.379 | 0.377 | 0.504 |
| RB | 0.457 | 0.497 | 0.668 |
| WR | 0.494 | 0.526 | 0.670 |
| TE | 0.386 | 0.395 | 0.532 |
| All | 0.529 | 0.564 | 0.687 |

**Held out:** the projection plus slope × luck, with the slope from 2022–23, scored on 2024–25. ΔMAE above zero means worse.

| Pos | Player-weeks | MAE, projection | ΔMAE this week (95%) | MAE over 4 weeks | ΔMAE over 4 weeks (95%) |
|---|---|---|---|---|---|
| QB | 831 | 6.164 | +0.035 (0.007 to 0.063) | 4.222 | +0.009 (0.000 to 0.016) |
| RB | 1,385 | 5.614 | +0.003 (−0.001 to 0.007) | 3.556 | +0.001 (−0.007 to 0.009) |
| WR | 2,227 | 5.583 | −0.001 (−0.003 to 0.000) | 3.653 | +0.004 (−0.004 to 0.012) |
| TE | 873 | 5.025 | −0.000 (−0.002 to 0.002) | 3.251 | −0.003 (−0.020 to 0.013) |
| All | 5,316 | 5.590 | +0.002 (−0.002 to 0.005) | 3.651 | −0.000 (−0.001 to 0.001) |

**Verdict: no lift.**
- **The claim holds against recent points:** what a player's usage was worth predicts his next four weeks better than his recent
  points do (0.564 against 0.529).
- **The projection beats both** (0.687), and its errors don't move with luck. RotoWire's projections already price streaks in.
- **Adjusting for luck** changed held-out error by nothing measurable, and for QBs made it slightly worse.
- **So no values change.** The streak is shown as information: other managers may still value players by recent points
  (`[speculation]`; nothing here tests how managers trade).

## Threshold `[design]`

**3 PPR points a game** is a little over one SD of luck (2.70 on 2022–23). If luck were normal, about 13% of players would run hot and
13% cold. **5+ expected points a week** matches the backtest's 5+ projected; below that, a streak isn't worth trading on.

## On the owner's leagues `[data]`

2026, weeks 2–5 (ffopportunity through week 5):
- **Figures:** 274 players have one. Among the 205 whose usage was worth 5+ a game, the gap averages 0.0 with SD 2.6, in line with
  the backtest. 27 run hot and 19 cold.
- **Rostered players with a streak:** 31 of 167 in the 10-team league and 34 of 182 in the 12-team league. The owner has 4 and 3.
- **The card:**
  - 10-team league: two to sell high (a WR +10.6 a game on 6 TDs against 2.7 expected, and an RB +4.2) and five to buy low.
  - 12-team league: one to sell high (a TE) and ten to buy low, of which the card shows the four most valuable.
- **Speed:** the card takes about 4 ms per league.

## Limits

- **Untested premise:** nothing here measures how managers trade. The card assumes some go by recent points.
- **ffopportunity's lag:** it can trail nflverse's stats by days, so the latest week may be missing. That shows as fewer games.
- **One scoring:** PPR everywhere. Leagues with other scoring see the gap in PPR terms.
- **Points scored come from nflverse in the app and from Sleeper in the backtest.** Scored PPR, the two agree within 0.1 point on
  99.99% of player-weeks ([stat-mapping.md](stat-mapping.md)).
