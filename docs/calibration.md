# P(play) calibration

How often is a player active for his game, given his final injury designation and final practice status? The app multiplies each projection by
this probability, so it drives start/sit, win chances and waiver values. Computed 2026-10-15 with
[`scripts/calibrate/pplay.ts`](../scripts/calibrate/pplay.ts). Data: nflverse (CC-BY 4.0). Only aggregates are published here.
Later weeks use a separate curve by weeks ahead: [hazard.md](hazard.md).

## What the app uses

**Since 2026-10-16, Questionable players use a model (v1, below):** the final practice status, whether he missed his last game, the
injury and his position. The table below is v0, the practice-only table; its other rows (no status, Doubtful, Out) still apply.

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

## v1: the Questionable model `[measured]` (2026-10-16)

`scripts/calibrate/pplay-v1.ts`; the terms and coefficients are in `app/src/engine/availability.ts`.

**Data:** 2019–2025, same join and relevance cut as above. 1,326 relevant player-games listed Questionable, 74.2% active. 2016–18 are left
out: their game-day statuses mark nearly every listed player active (99%), which can't be right.

**What else matters**, beyond practice (relevant Questionable players, 2019–2025):

| factor | active | after a Limited final practice |
|---|---|---|
| played his last game | 746/958 (77.9%) | 528/650 (81.2%) |
| missed his last game (inactive or on a reserve list) | 238/368 (64.7%) | 164/266 (61.7%) |
| hamstring | 91/152 (59.9%) | 70/113 (61.9%) |
| concussion | 25/41 (61.0%) | 10/20 (50.0%) |
| ankle/foot | 231/327 (70.6%) | 175/237 (73.8%) |
| back/torso | 175/204 (85.8%) | 127/145 (87.6%) |
| illness | 53/61 (86.9%) | 16/18 (88.9%) |
| QB | 84/134 (62.7%) | 58/96 (60.4%) |
| RB | 266/373 (71.3%) | 191/263 (72.6%) |
| WR | 473/612 (77.3%) | 322/409 (78.7%) |

The weekday of the game (Thursday's short week, Monday) made no difference.

**Model:** a logistic regression on:
- the final practice (Full, Limited, DNP);
- whether he missed his last game;
- the injury, in 9 groups (hamstring, other leg muscle, ankle/foot, knee, back/torso, arm/shoulder, illness, concussion, other);
- position.

Ridge-penalized, with the strength picked by leaving out one training season at a time. A second fit leaves out practice for the days
before the final report.

**Gate:** Brier score on seasons the model wasn't fitted on, against v0 refitted on the same seasons. Intervals are bootstrapped by player.

| | test set | v0 | v1 | change (95% interval) | log loss v0 → v1 |
|---|---|---|---|---|---|
| final practice known | 2019–22 fit, 2023–25 test (491) | 0.1926 | 0.1784 | −0.0142 (−0.0241 to −0.0047) | 0.568 → 0.538 |
| final practice known | each season held out (1,308) | 0.1813 | 0.1677 | −0.0136 (−0.0201 to −0.0071) | 0.544 → 0.511 |
| before the final report | 2019–22 fit, 2023–25 test (502) | 0.2001 | 0.1933 | −0.0068 (−0.0138 to −0.0002) | 0.590 → 0.574 |
| before the final report | each season held out (1,326) | 0.1915 | 0.1844 | −0.0071 (−0.0114 to −0.0029) | 0.571 → 0.553 |

v0 is the practice-only table, or one Questionable rate before the report. Each factor added helped. Missed-last-game and injury did
most of it; position added a little more.

**Calibration**, each season held out (final practice known):

| v1 predicted | n | mean predicted | active |
|---|---|---|---|
| under 50% | 120 | 41.7% | 43.3% |
| 50–65% | 238 | 58.8% | 55.9% |
| 65–80% | 373 | 73.4% | 75.9% |
| 80–90% | 385 | 84.5% | 84.7% |
| 90%+ | 192 | 93.5% | 91.1% |

**Examples** (the app's coefficients, fitted on 2019–2025):
- WR, ankle, played last week: 96% after a Full practice, 84% Limited, 58% DNP; 78% before the final report.
- RB, hamstring, missed last week, Limited: 46%.
- QB, knee, Limited: 69%.
- WR, back, Limited: 92%.

**Limits:**
- **Recent seasons run lower.** Fitted on 2019–22, the model ran 3–5 points high on 2023–25 above 80%: Questionable players played less
  often lately (72.5% against 75%). The app's coefficients include 2023–25.
- **"Missed his last game"** comes from nflverse weekly rosters through the pipeline (`ml` in `players.json`). A player signed or traded
  since then counts by his last game with any team.
- **Unknown injury** counts as ankle/foot, the reference group. That's close to the average of all injuries.
- **Before the final report**, the data are players who were Questionable on the final report, not Sleeper's mid-week tags.

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
6. **Quarterbacks.** 27 of 51 relevant Questionable QBs played (53%) in 2023–25, mostly because of Limited practice (18/37).
   - The gap is unstable. By season the rate was 13/19, 8/14 and 6/18. Above 18 PPR per game it was 6/7.
   - Since v1 the app adjusts for position: over 2019–2025, QBs were active 62.7% (84/134), the lowest of any position.
   - One possible reason, which is speculation: teams sit a limited starter when the backup is close in value.

## Reproduce

```sh
dir=$(mktemp -d)
base=https://github.com/nflverse/nflverse-data/releases/download
for y in 2019 2020 2021 2022 2023 2024 2025 2026; do
  curl -sSfL -o "$dir/injuries_$y.csv" "$base/injuries/injuries_$y.csv"
  curl -sSfL -o "$dir/roster_weekly_$y.csv" "$base/weekly_rosters/roster_weekly_$y.csv"
  curl -sSfL -o "$dir/stats_player_week_$y.csv" "$base/stats_player/stats_player_week_$y.csv"
done
npx tsx scripts/calibrate/pplay.ts "$dir" 2023 2024 2025 --test 2026
# v1: the same files for 2019–2025, plus games.csv for weekdays
curl -sSfL -o "$dir/games.csv" https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv
npx tsx scripts/calibrate/pplay-v1.ts "$dir" 2019 2025 "$dir/games.csv"
```

The held-out section scores whatever table `app/src/engine/availability.ts` holds at the time. Re-run it after each change, and as more 2026
weeks finish. nflverse sometimes corrects past seasons, so counts can drift slightly.
