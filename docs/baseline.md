# In-house baseline v0 and the blend gate

Should the app average RotoWire's projections (via Sleeper) with a projection of our own? The plan's rule (PLAN §2, roadmap Phase 2 item 4): a
second source joins the blend only if its walk-forward MAE is within ~5–10% of RotoWire's for that position, on 2023–25 plus live shadow
weeks. Computed 2026-10-16 with [`scripts/backtest/baseline.ts`](../scripts/backtest/baseline.ts). Only aggregates are published here: the
Sleeper/RotoWire inputs stay in an encrypted release.

## Decision

**No blend in 2026.**
- **The plan's bar:** RB, WR and TE pass it out of sample (baseline MAE 1.05×, 1.03× and 1.01× RotoWire's). QB fails (1.21×).
- **The direct test** shows the bar is too weak. Blending with weights fit on earlier seasons gains little, and not every season:
  - 2024: +0.1% MAE (worse);
  - 2025: −1.1%;
  - 2026 weeks 1–5: −0.6%, an interval that includes 0.

  A source can sit within 5% of RotoWire's MAE and still add almost nothing when its misses move with RotoWire's. Both lean on recent usage.
- **What v0 becomes instead:** a labelled second opinion, and the fallback if Sleeper's projections go dark. It runs in shadow: computed
  weekly, committed in the prediction ledger beside the app's numbers, and scored. That's the next step.
- **Gate amended for any future source** (v1, props): it must also lower MAE when blended with weights fit on earlier seasons, tested out of
  sample, with the pooled 95% interval below zero.
- **What would reopen it:** baseline v1 (the Phase 3 team model), aimed at QBs and role changes, or live shadow weeks showing a consistent gain.

## What was compared

- **Baseline v0** (`pipeline/baseline.ts`), as specified in PLAN §2. It is stat-level, so each league's scoring applies to it as it does to
  Sleeper's projections.
  - **Per stat:** a recency-weighted mean of the player's ffopportunity expected stats (`*_exp`; targets, carries and pass attempts are actual)
    over his last 16 games played. The weight halves every 4 games, and earlier seasons' games count half.
  - **Shrinkage:** 1 pseudo-game toward the position's average player.
  - **Matchup:** multiplied by this week's implied team total over the weighted implied total of those games, bounded to 0.67–1.5×.
- **RotoWire:** Sleeper's stored weekly projections, the feed the app uses, rescored from their stat lines.
- **Outcome:** Sleeper's actual stat lines, scored the same way (Sleeper's default PPR: 0.04/pass yd, 4/pass TD, −1/INT).
- **Population:** QB/RB/WR/TE player-weeks that were played (a game played or an offensive snap) and that both sources project, where either
  projects at least 5 points. Availability is P(play)'s job, so it is left out.
- **Walk-forward:** each week uses only earlier games.
  - 2022 warms the means up. 2023, 2024, 2025 and 2026 weeks 1–5 are scored.
  - The parameters were set before looking. On 2023 alone, none of 81 grid settings beat them by more than 0.02 MAE, so they stayed untuned
    and 2024–26 are a clean test.

## Results

**Out of sample, 2024 – 2026 week 5** (95% intervals from a bootstrap over players, whose weeks aren't independent):

| pos | n | RotoWire MAE | baseline MAE | ratio | RotoWire r | baseline r |
|---|---|---|---|---|---|---|
| QB | 1,461 | 5.45 | 6.61 | 1.21 (1.15–1.30) | 0.63 | 0.46 |
| RB | 2,229 | 5.23 | 5.47 | 1.05 (1.02–1.07) | 0.59 | 0.52 |
| WR | 3,534 | 5.39 | 5.57 | 1.03 (1.02–1.05) | 0.51 | 0.43 |
| TE | 1,330 | 4.95 | 4.98 | 1.01 (0.99–1.03) | 0.38 | 0.34 |
| all | 8,554 | 5.29 | 5.63 | 1.06 (1.05–1.08) | 0.58 | 0.49 |

**Ratio by season:**

| season | QB | RB | WR | TE |
|---|---|---|---|---|
| 2023 | 1.20 | 1.09 | 1.02 | 1.02 |
| 2024 | 1.19 | 1.06 | 1.05 | 1.02 |
| 2025 | 1.24 | 1.03 | 1.01 | 0.99 |
| 2026 wk 1–5 | 1.18 | 1.07 | 1.05 | 1.02 |

**Blend.** Weights are fit per position on the earlier seasons and tested on the next one. The change is in MAE, with a 95% interval.

| tested on (fit on) | QB | RB | WR | TE | all |
|---|---|---|---|---|---|
| 2024 (2023) | −0.2% | −0.0% | +0.4% | −0.4% | **+0.1%** (−0.3 to +0.5) |
| 2025 (2023–24) | −0.2% | −0.5% | −1.4% | −2.3% | **−1.1%** (−1.4 to −0.8) |
| 2026 wk 1–5 (2023–25) | −0.2% | −1.0% | −0.4% | −0.7% | **−0.6%** (−1.5 to +0.4) |

The fitted baseline weights wander from fit to fit (RB 0.05–0.25, WR 0.2–0.35, TE 0.3–0.5). The MAE surface is flat, which is another
sign there is little to gain.

**Robustness.** Ratios barely move with the relevance threshold: at 8 points, QB 1.18, RB 1.03, WR 1.03, TE 1.00. At 12 points, QB 1.12,
RB 1.03, WR 1.04, TE 1.00. The blend results follow the same pattern: about zero in 2024, under about 1% in 2025–26.

## Data checks

- **Joins:** 99.6% of played skill player-weeks map from Sleeper to GSIS ids via nflverse weekly rosters. Of those with a target, carry or
  pass, 17,318 of 17,319 have an ffopportunity row.
- **Are Sleeper's stored projections really pre-game?** Their timestamps can't prove it.
  - Every row's `updated_at` falls about 28 hours after its game day (2025 week 1: about four weeks), as from a weekly re-save. 2022–23
    rows have no timestamps.
  - Indirect test: an in-game injury can't be known before kickoff. Players who left early (snap share under 35% of their previous three
    games, n = 194) were projected at 0.90× their previous three weeks' projections. Normal games (n = 5,186) were at 1.00×. Projections
    revised after the game would sit near 0.2× (they scored 2.1 against 8.6 projected). The 10% dip fits pre-game news such as Questionable
    tags.
  - RotoWire's accuracy here (MAE 4.7–5.8, r 0.34–0.65) also looks like genuine pre-game projections.
  - Any leakage would flatter RotoWire and make this gate stricter, not looser.
  - Direct test, pending: the archive's pre-kickoff snapshot of 2026 week 6 Thursday (00:03 UTC) against the stored values once the week
    closes.
- **A Sleeper quirk:** in its stored 2022–25 projections, Sleeper's own `pts_ppr` counts QB interceptions as +2 instead of −1. That adds
  2.2–2.4 points to the average QB projection (about 3 per projected INT). 2026 rows are correct.
  - The app always rescores stat lines, so its projections were never affected.
  - The accuracy shard now rescores too, which is what the app shows. Before, it took `pts_ppr`, which is fine for 2026.
- **Lines:** nfldata's spreads and totals are near closing lines, a little later than a Thursday decision sees. Dropping the implied-total
  factor entirely costs only 0.02 MAE on 2023, so the look-ahead is negligible.
- **Timing for live use:** ffopportunity's 2026 file was last updated Tuesday 12:57 UTC after Monday night's games, in time for Thursday.

## Limits

- One RotoWire feed and one baseline. "Consensus" stays two sources at most until props (Odds API, pending its terms) or v1.
- The baseline doesn't see news: role changes, teammates' injuries, depth-chart moves. That's most of why QBs fail and why the blend gains
  little. RotoWire already prices what the baseline knows.
- Results are conditional on playing and on a 5-point relevance threshold. Deep players and availability aren't scored here.
- ffopportunity is CC-BY-SA 4.0. Any baseline numbers the app publishes carry that licence and the attribution (PLAN §4 rule 6).

## Reproduce

```bash
# 1. The private history bundle (Actions → history-pull → Run workflow; needs the archive key to read):
gh api repos/RCJLabs/Fantasy-Football-App/releases/tags/history --jq '.assets[] | "\(.id) \(.name)"'
gh api -H "Accept: application/octet-stream" repos/RCJLabs/Fantasy-Football-App/releases/assets/<id> \
  | age -d -i <identity file> | tar -xzf -        # → history/<season>/proj_wNN.json, stats_wNN.json
# 2. Public inputs, one directory:
#    ep_weekly_<season>.csv      https://github.com/ffverse/ffopportunity/releases/download/latest-data/ep_weekly_<season>.csv
#    roster_weekly_<season>.csv  https://github.com/nflverse/nflverse-data/releases/download/weekly_rosters/roster_weekly_<season>.csv
#    games.csv                   https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv
# 3. Run (warm-up season = the first directory; --min sets the relevance threshold):
npx tsx scripts/backtest/baseline.ts history <data dir> --tune --json gate.json
```

The 2026 rows came from a second pull (seasons `2026`, last week `5`), copied into the same `history/` directory.
