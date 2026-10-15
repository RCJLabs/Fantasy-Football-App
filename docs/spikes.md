# Phase 0 spike results — 2026-10-15

These checks ran from GitHub Actions on 2026-10-15 at ~20:31 UTC (Week 6, before Thursday Night Football), using `scripts/spike/` and workflow run 38802620042. A full run of the input archive was also decrypted and inspected.

## (a) CORS: the browser can call Sleeper directly ✅

Every endpoint below returns `access-control-allow-origin: *` (with `allow-credentials: true`) to an `https://rcjlabs.github.io` origin. No proxy is needed.

| Endpoint | Cache |
|---|---|
| `api.sleeper.app/v1/state/nfl` | `s-maxage=60` |
| `api.sleeper.app/v1/players/nfl/trending/add` | `s-maxage=600` |
| `api.sleeper.com/projections/nfl/{season}/{week}?season_type=regular&position[]=…` | `s-maxage=600` |
| `api.sleeper.app/v1/projections/nfl/regular/{season}/{week}` | `s-maxage=600` |
| `api.sleeper.com/stats/nfl/{season}/{week}?season_type=regular&position[]=…` | `s-maxage=300` |
| `api.sleeper.app/v1/stats/nfl/regular/{season}/{week}` | `s-maxage=600` |
| `api.sleeper.com/schedule/nfl/regular/{season}` | `s-maxage=600` |
| `raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv` | `max-age=300` |

## (b) Projection coverage

- **Size:** 7,658 rows per week (~4.7 MB raw).
- **Provider:** every row has `company: "rotowire"`, so this is **one source**, not a consensus.
- **Positions covered:** QB, RB, WR, TE, FB, **K**, **DEF**, and IDP (DL/DE/DT/NT, LB, CB/S/DB).
- **Row fields:** `player_id, stats, team, opponent, game_id, date, status, company, updated_at, last_modified, week, week_shard, category, player{…}`. The embedded `player` object carries `injury_status`, `position` and `team`.
- **Offensive stat keys are stat-level**, including reception-distance buckets (`rec_0_4` … `rec_40p`), first downs (`*_fd`), `bonus_rec_te|rb|wr`, `bonus_rush_td_qb`, 2-pt conversions and `pts_ppr/half_ppr/std`.
  - **Not projected:** yardage-threshold bonuses (`bonus_rec_yd_100`, `bonus_pass_yd_300`, …). The engine prices these from a yards distribution.
- **DEF:** `pts_allow` and `yds_allow` are **means**. The bucket keys (`pts_allow_14_20`, …) are **one-hot** on the bucket containing the mean, not probabilities, so the engine derives bucket probabilities from a distribution around the mean.

## (conv) Injury convention

- **Out, Doubtful, IR, PUP and NA players are projected at 0.**
- **Questionable** players are ambiguous. Two small-sample checks:

  | Comparison | Questionable | Healthy |
  |---|---|---|
  | This week ÷ last week, same player | 0.94 (n=15) | 0.94 (n=153) |
  | This week ÷ next week | 0.86 (n=22) | 1.00 (n=125) |

- **Engine treatment:** Questionable rows are treated as **roughly conditional on playing**, with a configurable factor (`ROTOWIRE_Q_FACTOR`, default 1.0). We apply our own P(play) exactly once. The archive will measure the factor properly.

## (e) Past weeks are served

- Weeks 1–5 return full projection sets.
- These are not actuals overwritten in place: 0% exactly equal the actual points, and the correlation with actuals is 0.61–0.67.
- `updated_at` runs from the week's start to Tuesday 04:00 UTC, so rows appear to freeze around their games. That makes them usable as **approximate as-of-kickoff** projections for backtesting Weeks 1–5. The archive adds true intra-week snapshots from Week 6 on.

## (f) Future weeks are projected

Weeks 7–18 each return ~7,660 rows with stats, so rest-of-season values can use real weekly projections instead of a flat estimate.

## (g) Stats endpoint

- 1,778 rows for Week 5, the same row shape as projections.
- Stat keys include everything needed to score any league:
  - computed bonuses: `bonus_rec_yd_100`, `bonus_rush_yd_100`, `bonus_pass_yd_300`, `bonus_fd_*`, `bonus_tkl_10p`, `bonus_sack_2p`
  - long-TD keys: `pass_td_40p`, `rec_td_40p`, `rush_td_40p` …
  - full DEF buckets
  - snaps: `off_snp`, `def_snp`, `tm_off_snp`, `tm_def_snp`, `gms_active`
- So the engine golden test (score Sleeper's own stat lines and compare to `players_points`) is feasible, and the stats also give a free snap-share source.

## Players dump

- **Size:** 12,229 players, 14.7 MB raw, 2.2 MB gzipped. 2,750 are active with a team.
- **Fields:** include `injury_status`, `injury_body_part`, `injury_start_date`, `depth_chart_position/order` and cross-IDs (`gsis_id`, `espn_id`, `yahoo_id`, `sportradar_id`, `rotowire_id`, …).
- **`practice_participation` is populated for only 1 player**, so practice status must come from nflverse injuries (joined on `gsis_id`).
- **Injury status counts:** Questionable 387, IR 278, NA 97, Out 51, PUP 32, Doubtful 17, Sus 7, DNR 2, COV 2.

## Schedule

`api.sleeper.com/schedule/nfl/regular/2026` has 272 games with `away, home, date, game_id, status, week`, but **no kickoff time**. Kickoff times (needed for lock handling) come from nflverse `games.csv` (`gameday` + `gametime`, ET), processed by the pipeline.

## League checks (c)(h)(i) and the scoring golden test

Run on 2026-10-15 against the owner's three Sleeper leagues (two in season, one dynasty still `pre_draft`). `league-pull.yml` fetched them, encrypted the bundle to the archive key and uploaded it to the `league-pull` prerelease; the checks ran locally on the decrypted copy. Only aggregates are recorded here.

- **(c) Failed waiver claims expose `waiver_bid` ✅** 118 of 118 failed claims carry `settings.waiver_bid`, as do completed ones. League-specific FAAB pricing (what it took to win a player, what lost) is possible.
- **(h) Future matchups are paired ✅** Weeks 7–18 return every roster with a `matchup_id`, so the rest-of-season opponent schedule is known.
- **(i) Settings that change decisions:**
  - A 12-team redraft has a median game, no K slot, daily waivers, and `playoff_week_start: 0` with no brackets. That means **no playoffs**, so the parser now treats 0 as "none".
  - FAAB is used everywhere ($100–$150).
  - Trade deadlines are week 11 or 12.
  - Playoffs start in week 15 where they exist.
- **Golden test ✅** For weeks 1–5, scoring every rostered player's Sleeper stat line with the engine and each league's `scoring_settings` reproduces Sleeper's `players_points` for 1,706 of 1,706 player-weeks (within 0.01) and 110 of 110 team totals (within 0.05).
- **Projection gaps found:** kicker projections lack `fgmiss`, `fgm_50_59` and `fgm_60p`, which these leagues score. They are now derived (`fga − fgm`, and a 94/6 split of `fgm_50p`). Special-teams return and fumble-recovery TDs (`def_st_td`, `st_td`, `fum_rec_td`, …) stay unprojected. They're worth a few tenths of a point a game and no longer trigger a warning.

## Still open

- **(j) When does Sleeper's `injury_status` flip for game-day inactives?** Check on Sunday 10-18 using the archive snapshots.
