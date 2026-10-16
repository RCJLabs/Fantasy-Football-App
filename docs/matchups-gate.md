# Matchup adjustments: the backtest gate

Decided 2026-10-16: **no adjustment.** Both matchup signals stay context only. Code: `scripts/backtest/matchups.ts`.

## The question

The Matchups card in player details shows two signals:
- **defense vs position (DvP):** how players at a position have scored against this opponent;
- **cornerbacks out:** which of the opponent's regular corners are missing.

The gate ([PLAN.md](PLAN.md) §6): a matchup adjustment changes projections only if it beats the projection without it. Here that's
RotoWire's projection via Sleeper, since no second source passed the blend gate ([baseline.md](baseline.md)). RotoWire already prices
matchups, so the question is whether either signal holds anything RotoWire leaves out.

## Data

- **Projections and results:** the private history bundle (Sleeper's stored weekly RotoWire projections and stats, 2022–2025),
  rescored in full PPR.
- **Games:** QB/RB/WR/TE projected 5+ who played, weeks 4–18. That's 11,094 player-games.
- **Cornerbacks:** nflverse snap counts (compiled by PFR).
- Only aggregates are reported.

## Defense vs position `[measured]`

**Method:**
- **The signal:** what RotoWire missed at the position against this opponent in earlier weeks of the season, as actual ÷ projected
  points.
- **Shrinkage:** that ratio is shrunk toward 1 with `c` pseudo projected points.
- **Adjustment:** RotoWire's projection is multiplied by the shrunk ratio raised to a strength `alpha`.
- **Tuning:** `c` and `alpha` are tuned on two seasons and scored on the other two, both ways.
- **Scoring:** MAE, with player-clustered bootstrap intervals.

The app's card measures raw DvP: players against their own averages. Raw DvP includes what RotoWire already prices, so only the miss can
add anything.

| tuned on | scored on | tuned to | MAE, RotoWire | MAE, adjusted | change | 95% interval of the change (points) |
|---|---|---|---|---|---|---|
| 2022–23 | 2024–25 | c 400, alpha 1 | 5.593 | 5.591 | −0.04% | −0.018 to +0.012 |
| 2024–25 | 2022–23 | c 50, alpha 0.25 | 5.520 | 5.503 | −0.31% | −0.027 to −0.007 |

At full strength (c 100, alpha 1), the adjustment makes every position worse:

| pos | games | MAE, RotoWire | MAE, adjusted | change |
|---|---|---|---|---|
| QB | 1,794 | 6.046 | 6.086 | +0.66% |
| RB | 2,894 | 5.555 | 5.574 | +0.35% |
| WR | 4,701 | 5.569 | 5.583 | +0.26% |
| TE | 1,705 | 5.012 | 5.038 | +0.52% |

**Reading:**
- **Forward in time** (tuned on earlier seasons, the way the app would use it): no change. The interval spans zero.
- **The reverse direction:** a 0.3% gain, about 0.02 points a game.
- **Tuned settings disagree:** the best settings differ widely between the two halves.
- **Signal:** the correlation between a defense's earlier misses and this game's miss is 0.047.
- **Verdict:** RotoWire's misses against a defense barely repeat. That fits the reported finding that defense-vs-position hardly carries
  from one sample to the next ([PLAN.md](PLAN.md) §2).

## Cornerbacks out `[measured]`

**Definition** (the card's): a defense's top 3 corners by defensive snap share over the last 4 weeks, at 50% or more, are its regulars.
- A regular is **out** if he has no defensive snaps in this game. That's known only after the fact, so it's a best case for the signal.
- The card has to rely on injury tags before kickoff.

**RotoWire's miss** (actual ÷ projected − 1, games played), weeks 5–18:

| pos | regular CB out: games | mean miss | full secondary: games | mean miss | difference (95% interval) |
|---|---|---|---|---|---|
| WR | 1,773 | −0.0% | 2,538 | −6.7% | +6.7% (+2.3% to +11.4%) |
| TE | 625 | +11.1% | 947 | +4.3% | +6.7% (−0.8% to +14.7%) |

**WRs in points:**

| WR games | n | mean miss (points) |
|---|---|---|
| full secondary | 2,538 | −0.54 |
| 1 regular CB out | 1,552 | +0.01 |
| 2+ out | 221 | −0.20 |
| 2022–23: full / 1+ out | 1,213 / 975 | −0.45 / −0.17 |
| 2024–25: full / 1+ out | 1,325 / 798 | −0.62 / +0.17 |

**Does it predict better?** WR projections were multiplied by a factor fitted on the other two seasons. Two versions were compared:
- one factor for every game;
- a separate factor for a full and a depleted secondary.

The cornerback signal is worth only the difference between them.

| metric | scored on | RotoWire as is | one factor | a factor per case | per case vs one |
|---|---|---|---|---|---|
| MAE | 2024–25 | 5.568 | 5.448 (×0.88) | 5.441 (×0.86 / ×0.88) | −0.12% |
| MAE | 2022–23 | 5.573 | 5.462 (×0.86) | 5.464 (×0.84 / ×0.92) | +0.03% |
| RMSE | 2024–25 | 7.135 | 7.130 (×0.98) | 7.130 (×0.98 / ×0.98) | 0.00% |
| RMSE | 2022–23 | 7.118 | 7.113 (×0.98) | 7.119 (×0.96 / ×1.02) | +0.10% |

**Reading:**
- **A real average effect:** WRs gain about half a point against RotoWire when a regular corner is out, on both season halves.
  - Against a full secondary, RotoWire runs high (−0.54); against a depleted one it's right on average.
  - It doesn't grow with more corners out: two or more out is no better than one.
- **Too small to help prediction:** half a point is small next to the 7-point spread of a WR's game.
  - A factor per case beats one factor by 0.12% at best and loses on the other half.
  - By squared error, which matches the expected points that lineups use, the gain is nil.
- **Why one factor lowers MAE by 2%:** it moves projections toward the median of a right-skewed outcome. That suits MAE, not expected
  points; by squared error the best single factor is ×0.98 and gains under 0.1%. It isn't a matchup effect.

## Decision

- **Both signals stay context only:** they're shown in player details with their sample sizes and don't change projections.
- **Retest:** if the ledger's own residuals by matchup ever show a pattern, retest then.

## Limits

- **Simple versions only.** Coverage shells, man/zone rates and WR-vs-CB alignment weren't tested. The alignment data is paid
  ([PLAN.md](PLAN.md) §0); FTN's scheme charting isn't joined yet.
- **Hindsight on who's out.** Missing corners come from snap counts after the game. A pre-game version from injury tags would be noisier,
  so it can only do worse.
- **One source.** Results are against RotoWire as Sleeper stored it. Another projection source might price matchups less well.

## Reproduce

```sh
npx tsx scripts/backtest/matchups.ts <decrypted history dir> <dir of nflverse snap_counts_YYYY.csv>
```
