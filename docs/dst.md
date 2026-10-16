# In-house team defense v0

Can our own team-defense projection beat, or add to, RotoWire's DEF projections (via Sleeper)? The model is the plan's DST v0 (PLAN §2,
K/DST row; roadmap N3): opponent implied total, opponent sack and turnover rates, home/away. Computed 2026-10-16 with
[`scripts/backtest/dst.ts`](../scripts/backtest/dst.ts) on Sleeper's stored projections and stats. Only aggregates are published here.

## Decision

**No blend.** DST v0 is about as accurate as RotoWire, and averaging the two adds nothing.
- Out of sample (2024 – 2026 week 5, 1,236 team-games): MAE 4.43 against RotoWire's 4.41, ratio 1.005 (95% interval 0.993–1.018).
  Correlation with the result is 0.29 for DST v0 and 0.30 for RotoWire.
- Blending with weights fit on earlier seasons changes MAE by:
  - 2024: +0.6%;
  - 2025: −0.1%;
  - 2026 weeks 1–5: −1.0% (95% interval −2.3% to +0.2%).

  That fails the amended gate, which requires a consistent out-of-sample gain.
- **What it's for:** it joins the in-house baseline (`baseline.json`, keyed by team code) as a labelled second opinion. More importantly,
  it's the fallback for defenses when Sleeper's projections are missing, at about RotoWire's accuracy. Before this, a week without
  projections left DEF with nothing.
- **The finding behind both:** a 2023-only grid found team sack and turnover rates add nothing. Shrinking them all the way to the league
  average did as well as anything (MAE 4.630 against the best 4.628). A defense's week is the opponent's implied total plus noise:
  RotoWire and DST v0 both reach r ≈ 0.3, and so does the plan's earlier own calculation (r = −0.32 for points against the opponent's
  implied total).

## The model (`pipeline/dst.ts`)

- **Points allowed:** the opponent's implied total plus the league's average gap between Sleeper's points allowed and that total.
  - Sleeper's points allowed leave out what the defense didn't give up: the opponent's defensive and return touchdowns, and safeties.
  - It differs from the final score in 8–14% of games, by −6, −12 or −2.
  - Points-allowed tiers are then priced from that mean, as for any projection.
- **Sacks, interceptions, fumble recoveries, forced fumbles, yards allowed:**
  - the defense's own recent rate × the rate the opponent's offense has allowed ÷ the league rate;
  - each rate is shrunk toward the league by 32 pseudo-games, with recent games weighted more (half-life 3 games);
  - home/away factors apply to the pass rush and takeaways.
- **Defensive TDs** follow expected takeaways at the league's TDs-per-takeaway. Return TDs, safeties and blocked kicks are league rates.
- **Settings:** the best of a 36-point grid on 2023 alone. The grid was flat. League rates come from this season and last, which is what
  the live pipeline fetches, so the backtest runs the same code (`dstWeek`) the pipeline does.
- **Scoring for the test:** Sleeper-style DEF scoring — sack 1, interception 2, fumble recovery 2, forced fumble 1, TD 6, safety 2,
  blocked kick 2, and points-allowed tiers from +10 down to −4. Both sources' tiers are priced from their points-allowed means.

## Results

| seasons | team-games | RotoWire MAE | DST v0 MAE | ratio (95% interval) | RotoWire r | DST v0 r |
|---|---|---|---|---|---|---|
| 2023 (tuning) | 536 | 4.64 | 4.63 | 1.00 (0.98–1.02) | 0.23 | 0.23 |
| 2024 | 541 | 4.42 | 4.49 | 1.02 (1.00–1.03) | 0.33 | 0.34 |
| 2025 | 537 | 4.42 | 4.44 | 1.01 (0.99–1.02) | 0.29 | 0.28 |
| 2026 wk 1–5 | 158 | 4.31 | 4.23 | 0.98 (0.94–1.02) | 0.22 | 0.23 |
| 2024 – 2026 wk 5 | 1,236 | 4.41 | 4.43 | 1.005 (0.993–1.018) | 0.30 | 0.29 |

Intervals come from a bootstrap over teams.

## Limits

- One season of tuning, three of testing. Weekly defense scoring is mostly noise, so differences under about 2% aren't detectable here.
- Kickers have no in-house model (PLAN: Sleeper only), so they stay without a projection in a fallback week.
- Like the skill-position baseline, it needs Sleeper's stats endpoint (team defense lines).

## Reproduce

```bash
# history: the decrypted bundle from scripts/history/pull.sh; data: games.csv from nflverse/nfldata
npx tsx scripts/backtest/dst.ts history <data dir> --tune --json dst.json
```
