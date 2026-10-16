# Waiver claim plan

Built 2026-10-16, item 4 of the owner's assistance list. Code: `app/src/analysis/claims.ts` (the plan) and `claimPlan` in
`app/src/analysis/outlook.ts` (wired to the waiver board); shown at the top of the Waivers tab (`ClaimPlanCard` in
`app/src/ui/SeasonTabs.tsx`).

## What the app shows

Up to three claims, in order. Each comes with its drop and, in FAAB leagues, a bid, plus a backup in case the claim fails:
1. **Claim 1:** the free agent who adds most to your best lineups (weighted rest-of-season points plus this week's gain, as on the
   board), with the drop that costs least. The cheapest three droppable players are tried, as the board does.
2. **Claims 2 and 3:** the same, for the roster as it would be after the claims above: the new player in, the drop gone. Two players
   competing for one slot don't both get credit. Each claim's this-week gain is worked out against that roster too.
3. **Backups:** for each claim with a drop, the best player who isn't one of the claims, for **the same drop**. Once the claim above it
   goes through, the drop is gone, so the backup can't go through. It lands only if the claim above it fails.
   - A claim into an open roster spot gets no backup, since a second add would simply go through too.
4. **Bids** (FAAB): the board's league-priced bid (position, tier, your budget against the league's).
   - Each bid is worked out from **the budget left after the claims above**.
   - A backup bids from the same budget as its claim and **never more than its claim**, so it can't be processed ahead of it.

A claim needs a gain of at least 2 points `[design]`. Below that, the board bids the minimum anyway.

## Limits

- **Sleeper's processing order:** claims are written down in priority order. I haven't checked exactly how Sleeper orders one manager's
  claims against each other under FAAB, which is why a backup's bid is capped at its claim's. `[unverified]`
- **Greedy:** each claim is the best one given the claims above. A different set of three could add slightly more together.
- **Waiver competition** isn't modelled beyond the league-priced bids: whether you'd actually win a player isn't predicted.
- **Candidates** are the board's top 15. A player outside them never enters the plan.

## On the owner's leagues (2026-10-16, week 6)

Aggregates only; positions instead of names.
- **10-team keeper league** ($25 of FAAB left; prices from 49 winning claims):
  1. TE +26.7, dropping a TE, $22. Backup: another TE (+20.3) for $10.
  2. DEF +12.0, dropping an RB, $1. Backup: a K for $1.
  3. WR, +1.5 over the season and +3.9 this week, for the minimum.
  Bids total $23 of $25.
- **12-team redraft league** ($22 left; prices from 85 claims):
  1. TE +31.6, $4.
  2. DEF +24.3, $3.
  3. TE +14.5, $2.
  Each has a backup. Bids total $9: this league's going rates are low.
- **Time:** 50–55 ms per league on a desktop, on top of the board's 130–160 ms.
