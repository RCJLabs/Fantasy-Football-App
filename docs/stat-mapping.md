# nflverse → Sleeper stat mapping

Can a player's nflverse weekly line be scored the way Sleeper scores its own? Roadmap Phase 2 item 8 sets the test: within 0.1 points,
QB/RB/WR/TE only, with K, DEF, IDP and distance tiers left out.

The ledger needs it: it scores outcomes from nflverse. So does anything that scores nflverse lines in a league's own format. Checked
2026-10-16 with [`scripts/check/stat-mapping.ts`](../scripts/check/stat-mapping.ts). The mapping is in
[`pipeline/nflverse-stats.ts`](../pipeline/nflverse-stats.ts).

## Result

On 19,427 played QB/RB/WR/TE player-weeks (2023 – 2026 week 5) that both sources have, each line is scored both ways:

| scoring | within ±0.1 | what's left |
|---|---|---|
| Sleeper default PPR (with return and fumble-recovery TDs) | 99.99% | 1 fumble-recovery TD, 1 yard |
| The ledger's PPR (INT −2) | 99.99% | 1 yard |
| Half PPR, TE premium, first downs, yardage bonuses, sacks | 99.82% | position history: a few fullbacks listed as TEs at game time are RBs now |

- Another 3,215 played player-weeks have no nflverse row. All scored 0 in Sleeper, so a missing row is a zero line.
- 95 player-weeks have no GSIS id.
- Against Sleeper's own `pts_ppr` the match is 99.62%. Its default scoring also counts a few return and defensive keys that this mapping
  leaves out.

## Three definitions that differ

**First downs.** Sleeper doesn't count a touchdown as a first down; nflverse and ffopportunity do.
- Subtracting TDs reproduces Sleeper's counts in 99.8–100% of player-weeks for both sources.
- Taken as they come, nflverse's counts would put a "half point per first down" league off in 25% of player-weeks.
- Now fixed in the mapping and in the in-house baseline (expected first downs less expected touchdowns). The baseline overstated first
  downs by about one per expected touchdown. That doesn't change the blend-gate numbers: that scoring has no first downs.

**First-down bonus.** Sleeper's `bonus_fd_<pos>` counts every first down the player produced: passing, rushing and receiving.
- QBs match 100%; RBs, WRs and TEs 99.7–99.9%.
- The app derived it from QB passing plus rushing, and from rushing plus receiving otherwise. Only trick plays differ, but it now uses all
  three.

**Yardage bonus tiers are exclusive.** A game that reaches the upper tier gets only that bonus: 400+ passing yards gets the 400-yard bonus,
not also the 300-yard one. The same holds for 200+ rushing, receiving and combined yards.
- In Sleeper's own lines for 2022–26 this held in all 86 such games.
- The app's projections priced both tiers cumulatively. In a league paying both a 300- and a 400-yard bonus, that overstated a typical QB by
  about 0.1 points.
- Fixed: the lower tier is now priced as P(reach it) − P(reach the next).

## Ledger outcomes

nflverse's own `fantasy_points_ppr` differs from the ledger's scoring of the mapped line on 0.7% of player-weeks:
- +2: nflverse ignores fumbles lost on returns, which Sleeper counts;
- +6: nflverse counts return touchdowns, which the ledger's scoring has no key for.

The scorer now scores the mapped line with the ledger's own scoring, so outcomes and predictions use one definition.

## Reproduce

```bash
# history: the decrypted bundle from scripts/history/pull.sh (only <season>/stats_wNN.json is read)
# data:    stats_player_week_<season>.csv and roster_weekly_<season>.csv from the nflverse-data releases
npx tsx scripts/check/stat-mapping.ts history <data dir> --json mapping.json
```
