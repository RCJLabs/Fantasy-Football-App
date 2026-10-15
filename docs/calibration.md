# P(play) calibration

How often is a player active for his game, given his final injury designation and final practice status? The app multiplies each projection by
this probability, so it drives start/sit, win chances and waiver values. Computed 2026-10-15 with
[`scripts/calibrate/pplay.ts`](../scripts/calibrate/pplay.ts). Data: nflverse (CC-BY 4.0). Only aggregates are published here.

## What the app uses

| Final game status | Final practice | App | Observed, fantasy-relevant players, 2023–25 |
|---|---|---|---|
| none | – | 99% | 99.3% (7,536/7,587; includes 1,341 listed on the report without a status) |
| Questionable | Full | 92% | 92.1% (82/89) |
| Questionable | Limited | 71% | 70.8% (228/322) |
| Questionable | Did not practice | 56% | 56.3% (45/80) |
| Questionable | final report not out yet | 72% | 72.5% (364/502, all Questionable) |
| Doubtful | any | 2% | 1.4% (1/69); all players 2.0% (3/152) |
| Out, IR, PUP, suspended… | – | 0% | 0/357 Out |

Practice status sets the odds only when it comes from the player's **final report of the current week**, which is when he has a game status.
Before then, the app uses the overall Questionable rate and says so. nflverse updates a player's row through the week, and early in a week the
pipeline's file still holds last week's report. Before this change, the app applied those mid-week or week-old statuses to a table that only fits
final reports.

## Method

- **Data:**
  - nflverse `injuries`: one row per player-week, overwritten through the week; for a game already played it is the final report.
  - `weekly_rosters`: game-day status.
  - `stats_player`: PPR points.
- **Join:** season, week and `gsis_id`. Scope: regular season, QB/RB/WR/TE/K, games already played (team-weeks that have stats).
- **Active** means roster status `ACT` on game day. `INA` (inactive) and `RES`/`CUT`/`DEV` (off the 53) count as not playing.
  - Check: 2024 averages about 48 `ACT` and 6 `INA` per team-game, in line with game-day roster limits.
  - Check: Out players were active 0 times in 1,045.
- **Fantasy-relevant** means the player averaged at least 8 PPR points (QB 12, any kicker) in his earlier games that season. Week 1 has no
  history, so it drops out of the relevant columns.
  - Why the filter matters: lineup decisions are about these players, and relevance changes the rate. Questionable players overall were active
    64.5%; relevant ones 72.5%.
- **"Not on report"** means relevant players on the game-day 53 with no report row that week.
- **Intervals:** Wilson 95%.
- **Cross-check:** an independent Python implementation gave identical counts.

## Results, 2023–2025

| game status | practice | active/n | P(active) | 95% CI | relevant: active/n | P(active) | 95% CI |
|---|---|---|---|---|---|---|---|
| not on report | – | 20632/22596 | 91.3% | 90.9%–91.7% | 6216/6246 | 99.5% | 99.3%–99.7% |
| listed, no status | any | 2626/2780 | 94.5% | 93.5%–95.3% | 1320/1341 | 98.4% | 97.6%–99.0% |
| listed, no status | Full | 2123/2211 | 96.0% | 95.1%–96.8% | 1035/1040 | 99.5% | 98.9%–99.8% |
| listed, no status | Limited | 344/356 | 96.6% | 94.2%–98.1% | 203/206 | 98.5% | 95.8%–99.5% |
| listed, no status | DNP | 157/210 | 74.8% | 68.5%–80.2% | 81/93 | 87.1% | 78.8%–92.5% |
| Questionable | any | 828/1283 | 64.5% | 61.9%–67.1% | 364/502 | 72.5% | 68.4%–76.2% |
| Questionable | Full | 232/311 | 74.6% | 69.5%–79.1% | 82/89 | 92.1% | 84.6%–96.1% |
| Questionable | Limited | 482/750 | 64.3% | 60.8%–67.6% | 228/322 | 70.8% | 65.6%–75.5% |
| Questionable | DNP | 95/198 | 48.0% | 41.1%–54.9% | 45/80 | 56.3% | 45.3%–66.6% |
| Doubtful | any | 3/152 | 2.0% | 0.7%–5.6% | 1/69 | 1.4% | 0.3%–7.8% |
| Out | any | 0/1045 | 0.0% | 0.0%–0.4% | 0/357 | 0.0% | 0.0%–1.1% |

The all-player "not on report" rate (91%) is mostly healthy scratches of depth players.

**Stable across seasons** (Questionable, relevant players):

| season | active/n | P(active) | Full | Limited | DNP |
|---|---|---|---|---|---|
| 2023 | 142/193 | 73.6% | 35/38 | 80/111 | 23/40 |
| 2024 | 117/165 | 70.9% | 25/28 | 78/110 | 12/23 |
| 2025 | 105/144 | 72.9% | 22/23 | 70/101 | 10/17 |

**Sensitivity to the relevance cut** (Questionable; to reproduce, edit `RELEVANT_PPR` in the script):

| Cut | Overall | Full | Limited | DNP |
|---|---|---|---|---|
| 6 PPR, QB 10 | 71% | 90% | 70% | 53% |
| 8, QB 12 (used) | 72.5% | 92% | 71% | 56% |
| 10, QB 15 | 75% | 95% | 73% | 59% |
| 12, QB 18 | 75% | 96% | 74% | 57% |

Better players play through a Questionable tag a little more often, by 2–4 points.

## Held out: 2026 weeks 1–5

Relevant players, scored with the app's `playProbability()`:

| group | n | active | expected, old table | expected, new table |
|---|---|---|---|---|
| Questionable, Full | 5 | 5 | 4.3 | 4.6 |
| Questionable, Limited | 27 | 19 | 17.6 | 19.2 |
| Questionable, DNP | 6 | 3 | 2.7 | 3.4 |
| Questionable, any | 38 | 27 | 24.6 | 27.1 |
| Doubtful | 2 | 0 | 0.1 | 0.0 |
| Out | 24 | 0 | 0 | 0 |
| not on report | 495 | 494 | 490.1 | 490.1 |

Brier score (Questionable + Doubtful): old 0.183, new 0.180. That's 40 player-weeks, too few to tell the tables apart. The new table's totals
line up, but the old table had been fit on 2026 weeks 1–5 itself, so this isn't a clean comparison. Treat it as a sanity check. The
three-season fit is the evidence.

## Limits

These are not established by this calibration:

1. **Mid-week states.** nflverse keeps only the latest row per player-week, so this data can't say how often a Wednesday DNP ends up playing.
   The app uses the overall 72% until the final report. The archive's twice-daily snapshots (since Week 6) can calibrate mid-week states once
   a few weeks are final.
2. **Sleeper's tag vs the official status.** The app reads Sleeper's `injury_status`. After the final report it should match the official
   status. Before the report, Sleeper's tags follow the news, and how closely they track the eventual designation is unmeasured. Spike (j)
   checks game-day changes.
3. **Every player gets the relevant-player rates.** Deep-bench and waiver players listed Questionable play less often: non-relevant players
   59%, 464/781.
4. **Active is not a full workload.** A Questionable player who suits up may play fewer snaps. Projections aren't reduced for that
   (`ROTOWIRE_Q_FACTOR = 1`, unmeasured).
5. **DNP on the final report without a game status.** Relevant players were active 87% of the time (81/93). The app keeps practice status
   only for players Sleeper tags, so it treats these players as untagged (99%).
6. **Quarterbacks.** 27 of 51 relevant Questionable QBs played (53%), mostly because of Limited practice (18/37).
   - The gap is unstable. By season the rate was 13/19, 8/14 and 6/18. Above 18 PPR per game it was 6/7.
   - The app doesn't adjust for position.
   - One possible reason, which is speculation: teams sit a limited starter when the backup is close in value.

## Reproduce

```sh
dir=$(mktemp -d)
base=https://github.com/nflverse/nflverse-data/releases/download
for y in 2023 2024 2025 2026; do
  curl -sSfL -o "$dir/injuries_$y.csv" "$base/injuries/injuries_$y.csv"
  curl -sSfL -o "$dir/roster_weekly_$y.csv" "$base/weekly_rosters/roster_weekly_$y.csv"
  curl -sSfL -o "$dir/stats_player_week_$y.csv" "$base/stats_player/stats_player_week_$y.csv"
done
npx tsx scripts/calibrate/pplay.ts "$dir" 2023 2024 2025 --test 2026
```

The held-out section scores whatever table `app/src/engine/availability.ts` holds at the time. Re-run it after each change, and as more 2026
weeks finish. nflverse sometimes corrects past seasons, so counts can drift slightly.
