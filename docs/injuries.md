# Injury absences: how long they last

When a player is Out, Doubtful or on IR, how long do absences with his injury usually last? Player details now show this as history,
labelled, next to his chance to play. It isn't a forecast for that player, and it doesn't change projections or rest-of-season values. Built
2026-10-16 with [`scripts/calibrate/injury-durations.ts`](../scripts/calibrate/injury-durations.ts) (`pipeline/injury-durations.ts`). Data:
nflverse (CC-BY 4.0). Only aggregates are published here.

## What the app shows

For example, a player Out with a knee injury:

> Knee absences (QB/RB/WR/TE, 2019–2025, 213): 28% lasted one game, 46% two or fewer, 70% four or fewer. 13% of those that began by week 10
> lasted the rest of the season. Counted from the first game missed; he may have missed some already.

- Injuries with fewer than 60 absences get the all-injuries line, and the note says so.
- Sleeper's body-part field and the injury report's labels go through the same grouping (`app/src/engine/injuries.ts`).

## Results, 2019–2025

1,538 absences. 382 were still running when a season ended; those are censored, so the shares are Kaplan–Meier estimates.

| injury | absences | 1 game | 2 or fewer (95% CI) | 4 or fewer | season-ending, of those starting by week 10 |
|---|---|---|---|---|---|
| Ankle | 235 | 31% | 51% (45–58%) | 78% | 8% (120) |
| Hamstring | 226 | 35% | 61% (54–67%) | 83% | 6% (157) |
| Knee | 213 | 28% | 46% (39–53%) | 70% | 13% (120) |
| Concussion | 197 | 50% | 70% (63–76%) | 81% | 6% (96) |
| Shoulder | 110 | 45% | 71% (62–80%) | 86% | 11% (62) |
| Groin / hip | 109 | 51% | 70% (61–79%) | 82% | 11% (70) |
| Foot / toe | 85 | 29% | 46% (35–56%) | 64% | 20% (51) |
| **All injuries** | 1,538 | 37% | 57% (55–60%) | 77% | 9% (864) |

Smaller groups (ribs and chest, hand and wrist, quad, calf, illness, neck, back, abdomen, arm, Achilles) have 3–58 absences each. The
script prints them; the app uses the all-injuries line for them.

**By final report status on the first game missed:**

| status | absences | 1 game | 2 or fewer | 4 or fewer |
|---|---|---|---|---|
| Questionable, then inactive | 424 | 54% | 71% | 82% |
| Doubtful | 155 | 46% | 73% | 88% |
| Out | 959 | 28% | 49% | 73% |

**Fantasy-relevant players only** (8+ PPR a game before the absence; QB 12): 586 absences, 38% one game, 59% two or fewer, 81% four or
fewer, 7% season-ending. That's a little shorter than all skill players. The app uses all of them for the larger samples.

**By season**, two or fewer: 50% (2019, from week 5), then 56–60% every season 2020–2025.

## Method

- **Data:**
  - nflverse `weekly_rosters`: game-day status;
  - `injuries`: the final report, one row per player-week.

  Regular seasons 2019–2025. 2019 starts in week 5, the first week its rosters mark game-day inactives.
- **An absence:** a QB/RB/WR/TE misses a team game after playing in his previous one.
  - Missing means not `ACT`: inactive, on a reserve list, or on no roster.
  - That week's final report must list him with a game status (Questionable, Doubtful or Out) and an injury.
  - Byes don't count.
- **Length:** team games missed in a row until he plays again.
  - Absences still running at the season's end are censored. The final week is left out (rested starters).
  - Absences that touched the COVID-19 reserve list are dropped.
- **Groups:** the report's primary injury, grouped by keywords. "Right Shoulder" and "Shoulder" are one group; "Not injury related" is left
  out.
- **Season-ending:** of absences that began by week 10, the share that didn't end before the season did.
- **Cross-check:** an independent Python implementation gave identical counts and shares.

## Not used for rest-of-season values (yet)

- **What the app does now:** rest-of-season values give a player who's Out an 80% chance to play in each week Sleeper projects him
  ([hazard.md](hazard.md)).
- **What the data says:** players Out at their first missed game were back for the next one 28% of the time.
- **Why that isn't the comparison that matters:** Sleeper's projections drop a player until his expected return. What matters is the chance
  given that he's projected, and the injury reports can't tell us that.
- **How it gets settled:** the archive now records which Out players Sleeper projects for the following weeks. A few weeks of those will
  calibrate it (P(play) v1).

## Limits

- **Labels are coarse.** "Knee" covers sprains and torn ACLs alike, and severity isn't on the report. The ranges are wide for that reason.
- **Counted from the first missed game.** The app doesn't know how many games a player has already missed in the current absence.
- **Small groups** (under 60 absences) fall back to the overall line rather than showing noisy numbers.

## Reproduce

```bash
# <dir>: injuries_YYYY.csv, roster_weekly_YYYY.csv, stats_player_week_YYYY.csv (nflverse-data releases)
npx tsx scripts/calibrate/injury-durations.ts <dir> 2019 2020 2021 2022 2023 2024 2025 --write
```
