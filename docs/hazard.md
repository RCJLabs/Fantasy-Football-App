# Future-week availability (injury hazard)

How likely is a player to be active k weeks from now, given his injury status today? Rest-of-season values (waivers, FAAB bids, trades,
playoff odds) multiply each future week's projection by this chance, and bench depth is valued by covering for the misses. Computed
2026-10-16 with [`scripts/calibrate/hazard.ts`](../scripts/calibrate/hazard.ts) (`pipeline/hazard.ts`). Data: nflverse (CC-BY 4.0).
Only aggregates are published here.

## Decision

**A curve by weeks ahead replaces the app's flat guesses.**
- **Before:** the same chance in every future week, by position, marked `[design]` (QB 95%, RB 91%, WR and TE 93%, K 98%).
- **Now:** a healthy QB, RB, WR or TE is active 94% of the time a week later, 85% eight weeks later and 76–80% thirteen to fifteen weeks
  later. Kickers 95% falling to 85%; defenses always 100%.
- **On held-out seasons** the old constants expected 7% too many active player-weeks (46,332 against 43,339 in 2023–25). The curve was
  within 1%, with a lower log loss (0.364 against 0.409).
- **Position and age are left out.** RBs were 1–2 points less available than the pooled curve and 28–30-year-olds up to 8 points less.
  Neither helped as a model: separate position curves and age bands both scored worse or no better on held-out seasons. One age cell
  repeated across periods ([below](#held-out-tests)).
- **Questionable now:** 82% in every later week, about flat, never above a healthy player's chance at the same distance.
- **Out, IR, PUP and similar:** unchanged at 80% in the weeks Sleeper projects him (his expected return and after), now capped by the healthy
  curve. Not calibrated: past projections don't record expected return dates. For scale, players Out now were active 74–78% of the time four
  to eight weeks later, whether projected or not.

## What the app uses

Fit on 2019–2025. Intervals are 95%, from a bootstrap over players (a player's weeks aren't independent).

| weeks ahead | QB/RB/WR/TE | 95% interval | n | K | 95% interval |
|---|---|---|---|---|---|
| 1 | 94.0% | 93.4–94.5% | 11,564 | 95.4% | 94.1–96.6% |
| 2 | 91.0% | 90.2–91.7% | 10,767 | 93.1% | 91.1–94.8% |
| 3 | 88.9% | 88.0–89.8% | 9,930 | 91.4% | 89.1–93.6% |
| 4 | 87.6% | 86.5–88.7% | 9,180 | 90.0% | 87.1–92.6% |
| 6 | 85.5% | 84.1–86.8% | 7,634 | 88.6% | 85.2–91.5% |
| 8 | 84.5% | 82.9–86.0% | 6,165 | 87.0% | 83.0–90.4% |
| 10 | 83.2% | 81.3–84.9% | 4,671 | 85.9% | 81.5–89.9% |
| 12 | 81.5% | 79.6–83.5% | 3,154 | 85.6% | 80.6–89.7% |
| 14 | 78.7% | 76.2–81.2% | 1,467 | 85.1% | 79.2–89.5% |
| 15+ | 76.3% | 72.5–79.8% | 590 | 85.1% | 78.9–89.5% |

IDP players get the QB/RB/WR/TE curve `[design]`.

**Why players aren't active** (healthy QB/RB/WR/TE now):

| weeks ahead | active | inactive on game day | reserve lists (IR, PUP, NFI…) | cut, practice squad or no roster |
|---|---|---|---|---|
| 1 | 94.0% | 4.4% | 1.4% | 0.2% |
| 4 | 87.6% | 7.3% | 4.8% | 0.3% |
| 8 | 84.5% | 7.0% | 7.9% | 0.5% |
| 12 | 81.5% | 7.2% | 10.5% | 0.7% |

Game-day inactives level off after a few weeks; reserve-list stints keep accumulating.

**Status now other than healthy** (all five positions):

| status now | 1 ahead | 2 ahead | 4 ahead | 8 ahead |
|---|---|---|---|---|
| Questionable | 81.6% (1,006) | 83.6% (938) | 81.7% (774) | 82.4% (524) |
| Doubtful | 43.7% (103) | 68.4% (95) | 80.7% (83) | 84.3% (51) |
| Out | 36.6% (544) | 57.6% (519) | 74.1% (467) | 77.7% (292) |

## Held-out tests

Everything fit on the earlier seasons, scored on the later ones. Healthy players, all five positions.

| model | log loss, 2023–25 (fit 2019–22) | expected / active | log loss, 2024–25 (fit 2019–23) | expected / active |
|---|---|---|---|---|
| previous app constants | 0.4090 | 46,332 / 43,339 | 0.4316 | 31,220 / 28,997 |
| fitted flat rate by position | 0.3736 | 43,105 / 43,339 | 0.3874 | 29,161 / 28,997 |
| curve by position | 0.3662 | 43,074 / 43,339 | 0.3804 | 29,157 / 28,997 |
| **one curve for QB/RB/WR/TE, one for K** | **0.3640** | 43,084 / 43,339 | **0.3783** | 29,166 / 28,997 |
| same, plus age bands | 0.3662 | 42,954 / 43,339 | 0.3785 | 29,121 / 28,997 |

Questionable players: a flat 81–82% (capped by the healthy curve) scored 0.446 and 0.449. The healthy curve scored 0.462 and 0.474, the old
constants 0.513 and 0.534.

**Why age is out:** mostly, the pattern doesn't repeat (the script prints the table).
- 28–30-year-old RBs were 9 points less available four to eight weeks ahead in 2019–22, and not at all in 2023–25.
- QBs over 30 went from the most available group (92%) to the least available QBs (84%).
- One cell did repeat: WRs aged 28–30 were 8–10 points below other WRs in both periods (78% and 81%). One cell in sixteen may be chance, so
  it's noted here, not modelled.

**By season** (healthy QB/RB/WR/TE, 4–8 weeks ahead): 2019 86.8%, 2020 87.4%, 2021 84.0%, 2022 83.6%, 2023 87.2%, 2024 86.7%,
2025 86.8%. Seasons differ by up to 4 points, so the curve is an average, not a forecast of this season.

## Double-counting check

Applying the curve on top of Sleeper's projections assumes RotoWire's future weeks don't already discount for injury risk. In the archive's
2026-10-15 snapshot, 99 healthy players projected for 8+ PPR in week 7 had the same median projection in every later week: 0.97–1.01×
week 7, excluding byes. So there's no discount to double count. Players already ruled out are dropped from Sleeper's future weeks until
their expected return: of 35 fantasy-relevant players on IR in the same snapshot, 6 had a week-7 projection and 20–22 had one in weeks
12–16. That's why Out/IR players get their own rule above.

## Effect on the app

On the owner's two in-season leagues, as of week 6. These are one-off checks run on private league data (scripts not in the repo); only
aggregates are shown.
- **Best-lineup points per future week** (the next eight): down 2–4.5% per team. That's less than the drop in availability, because bench
  players cover more of the misses.
- **Playoff odds:** moved by 3 points or less.
- **Depth is worth more later in the season.** For one team, the rest-of-season gain from adding a free-agent tight end rose 15–50%. Its
  starter now misses more weeks, so cover is worth more.
- **Bench insurance check.** The app credits each starter's slot with the best eligible bench player, one absence at a time. A Monte Carlo
  check drew absences independently and re-picked the best lineup from the active players. The app came out about 10% lower on the bench
  term: 5.3 against 6.0 points a week 1–3 weeks ahead, 9.5 against 10.8 at 8+. The approximation is slightly conservative, not inflated.

## Method

- **Data:**
  - nflverse `weekly_rosters`: game-day status;
  - `injuries`: the final report, one row per player-week;
  - `stats_player`: PPR, for relevance.

  Joined on season, week and `gsis_id`.
- **Anchors:** fantasy-relevant players, as in [calibration.md](calibration.md): at least 8 PPR a game in earlier games that season (QB 12,
  any kicker). They must be on the game-day 53 (active or inactive) of a team that played. Their state comes from the final report: no game
  status, Questionable, Doubtful or Out.
- **Follow-ups:** every later regular-season week in which the player's team played.
  - **Active** means roster status `ACT`.
  - **Not active:** `INA`, reserve lists, cut, practice squad, or on no roster while his team played.
  - **Byes are skipped:** a week counts only if the player's current team (or, with no roster, his old team) played.
- **Left out as target weeks:**
  - the final regular-season week (rested starters);
  - Reserve/COVID-19 and COVID opt-out weeks (2020–21), absences no 2026 player faces;
  - 2019 weeks 1–4, whose rosters don't mark game-day inactives (only partly in week 4). 2016–18 rosters never mark them, so those seasons
    aren't used.
- **Fit:** share active by weeks ahead, forced non-increasing (weighted pool-adjacent-violators). Horizons past the data keep the last value.
- **Cross-check:** an independent Python implementation gave identical counts (126,398 follow-ups of 17,567 anchors) and the same held-out
  scores for the healthy-player models.

## Limits

- **Weeks are treated independently.** An injury usually costs several weeks in a row, so a team's season total varies more than the
  simulation assumes. Means are right; playoff-odds ranges are a little narrow.
- **Weeks ahead are calendar weeks.** A bye in between means one game fewer at risk; that isn't modelled.
- **"Fantasy-relevant" filter:** deep players are scratched more often than the curve says. Their projections are small, so this matters
  little.
- **Benchings that keep a player active** (a QB demoted to backup) count as active. His projection would fall, but that's a projection
  question, not an availability one.
- **Not yet:** games-missed distributions by injury type and early-exit rates (PLAN §2, Injury context).

## Reproduce

```bash
# <dir>: injuries_YYYY.csv, roster_weekly_YYYY.csv, stats_player_week_YYYY.csv for 2019–2025 from
# https://github.com/nflverse/nflverse-data/releases (tags injuries, weekly_rosters, stats_player)
npx tsx scripts/calibrate/hazard.ts <dir> 2019 2020 2021 2022 --test 2023 2024 2025 --json hazard.json
npx tsx scripts/calibrate/hazard.ts <dir> 2019 2020 2021 2022 2023 --test 2024 2025
```

The curves fitted on all seasons are printed last (and written with `--json`); `app/src/analysis/ros.ts` carries them, rounded to 0.001.
