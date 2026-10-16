# Handcuffs: the next man up

Built 2026-10-16, item 2 of the owner's assistance list. Measurement: `pipeline/handcuff.ts` and `scripts/calibrate/handcuff.ts`.
App: `app/src/analysis/handcuffs.ts`, shown in the Waivers tab (`app/src/ui/SeasonTabs.tsx`, `Handcuffs`).

## What the app shows

- **Handcuffs card** (Waivers tab), one line per regular QB or RB starter of yours who heads his team's depth chart:
  - his backup, the depth chart's No. 2, and who has him: you, a free agent, or another team;
  - what the backup projects in a week the starter misses, against his projection now;
  - **insurance:** what he's worth over the rest of the season (below).
- **"Next up" tag** on the free-agent board: a QB, RB or TE whose team's starter at his position is out now (Out, Doubtful, IR, PUP,
  suspended). Context only: Sleeper's projections usually move once the starter is ruled out.

## How much does the backup inherit? `[measured]`

**Data:** nflverse weekly stats and game-day rosters, 2019–2025 regular seasons. 2019 counts from week 5, the first week its rosters
mark inactives.
- **Starter:** most usage at his position over the team's previous four games, active in at least two of them, and 8+ half-PPR points a
  game in them. Usage is QB attempts plus carries, RB carries plus targets, WR and TE targets.
- **Backup:** the next most usage over those games. QB backups rarely play, so for QBs it's the one who threw most in the game.
- **Event:** a game the starter sat (inactive or on a reserve list) and the backup was active.
- **Control:** a game the starter played (not available for QBs).
- **Share:** the backup's points above his own average, summed, over the starter's average, summed. Net share is that minus the same in
  control games, which corrects for the backup's average being a noisy base.

Fitted on 2019–2025:

| Pos | Games sat | Starter | Backup's usual | Backup when he sat | Net share (95%) | Whole position group |
|---|---|---|---|---|---|---|
| QB | 232 | 14.9 | 1.0 | 12.3 | 0.76 (0.69–0.84) | 0.78 |
| RB | 210 | 13.7 | 5.4 | 10.9 | 0.40 (0.31–0.49) | 0.76 |
| TE | 86 | 11.0 | 2.3 | 5.3 | 0.28 (0.18–0.40) | 0.53 |
| WR | 143 | 13.0 | 7.9 | 9.0 | 0.12 (0.04–0.21) | 0.57 |

- **Points:** half-PPR per game. The 95% intervals are a bootstrap over team-seasons.
- **Whole position group:** what all the starter's teammates at his position recovered together. An RB backup gets 40% of the starter's
  points, the rest of the room another 36%.
- **Control drift** was 0.00 for RBs and −0.02 to −0.03 for TEs and WRs: the backup's own average is an unbiased base.
- **By season,** the RB share ran 0.19–0.50 and the QB share 0.69–0.83.

**Held out:** fitted on 2019–22, then used to predict the backup's points in the 2023–25 games the starter sat. Each line compares the
backup's own average, adjusted for drift, with that plus the fitted share of the starter's points.

| Pos | Games | MAE, own average | MAE, with the share | MAE, all of the starter's | ΔMSE (95%) |
|---|---|---|---|---|---|
| QB | 106 | 11.77 | 6.35 | 6.85 | −126.9 (−166.4 to −91.2) |
| RB | 87 | 6.68 | 6.06 | 7.51 | −28.6 (−47.6 to −10.9) |
| TE | 37 | 4.39 | 4.04 | 6.88 | −8.0 (−16.7 to 2.1) |
| WR | 74 | 5.14 | 5.01 | 7.58 | −3.3 (−7.7 to 0.6) |

**QBs and RBs pass; TEs and WRs don't.** The app uses 0.76 for QBs and 0.40 for RBs, from the full fit. TE and WR backups aren't valued
as handcuffs. Their gain is smaller and didn't improve predictions reliably out of sample, and Sleeper's receiver depth charts are split
by alignment (LWR, RWR, SWR) and patchy. 2026's first five weeks (6 QB and 4 RB games) agree with the fit.

## The insurance value `[design]`

For each week ahead in which Sleeper projects the starter:
- **Miss chance:** 1 − his chance to be active ([hazard.md](hazard.md)). For a healthy player that's 6% next week, rising to about 24%
  fifteen weeks out; for one returning from Out or IR, at least 20%.
- **The backup in the bigger role:** his own points if he plays, plus 0.76 (QB) or 0.40 (RB) of the starter's, times his own chance to
  play.
- **What he adds:** the week's best lineup without the starter, with the backup in that role, against the same lineup without him.
  Both lineups get your bench plus **the best free agent at the position**, because you could add that player instead when the starter
  goes down.
- **Weights:** like the rest-of-season values; playoff weeks count by your playoff odds.

**Insurance** is the sum of miss chance × what he adds, over the weeks. Weeks Sleeper doesn't project the starter (a bye, or out
already) add nothing. The backup's own projection carries them, and the free-agent board values that.

**Why against the best free agent:** without one, the starter's absence leaves an empty slot, and the backup looks worth everything he
scores. The test league has no free-agent QB, and its QB handcuff shows +15. Real leagues have free-agent QBs you'd pick up instead:
against them, the QB handcuffs on the owner's leagues are worth +0.1 to +0.3.

## Limits

- **Waiver competition** isn't modelled. The best free agent is assumed to be yours for the taking, which understates a handcuff in
  leagues where good pickups go fast.
- **Depth charts** are Sleeper's and can lag a real change. A starter who doesn't head his chart gets no handcuff.
- **Backup selection:** history picks the backup by usage (QBs by who played), while the app uses the depth chart. For QBs the measured
  backup is the one who actually started, so 0.76 is a little optimistic when the depth chart's No. 2 isn't the one who plays.
- **The share is an average:** committee backfields split the work. The room as a whole recovered 76%, the No. 2 alone 40%.
- **Miss chance** counts every absence (injury, illness, suspension, benching). In some of those the No. 2 isn't the one who steps in.
- **No playoff stash logic yet.** Insurance follows the season's weights; it doesn't single out the playoff weeks.

## On the owner's leagues (2026-10-16, week 6)

Aggregates only.
- **10-team keeper league:**
  - Handcuffs for three RBs and two QBs.
  - **RB backups:** one is on another team (insurance +6.3); two are free agents, worth +4.6 and +0.4.
  - **QB backups:** both free agents, about +0.3 each, since a comparable free-agent QB is available.
  - **Weekly miss chance:** 13–18% averaged over the weeks ahead.
- **12-team redraft league:**
  - The owner's RB handcuff is already on the roster (+11.0).
  - Another RB's backup is on another team (+10.2).
  - The QB's backup is worth +0.1.
- **Next-up tags:** two league-wide today (a QB and a TE backup behind starters who are out), both free agents.
- **Time:** 20–26 ms per league after the season simulation.
