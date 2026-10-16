# IR stash finder

Built 2026-10-16, item 3 of the owner's assistance list. Code: `app/src/analysis/irStash.ts`; shown in the Waivers tab
(`app/src/ui/SeasonTabs.tsx`, `IrStashCard`).

## What the app shows

When you have an open IR slot, an **IR stash** card lists injured free agents who could go straight into it. They're ranked by what
each adds to your best lineups once he's back:
- **Back:** the first week ahead Sleeper projects him again. That's RotoWire's return estimate, the same one the rest-of-season values
  use (`ros.ts`). A player Sleeper doesn't project again this season isn't listed.
- **Points:** his points per game if he plays, from then on.
- **ROS:** the weighted rest-of-season points he adds to your best lineups. Playoff weeks count at your playoff odds, as in the other
  rest-of-season values. No drop is needed while he sits on IR.
- **Playoffs:** the part of ROS from playoff weeks, shown when there is any.

**Eligible** means the league allows his status in an IR slot. IR and PUP are always allowed; Out, Doubtful, suspended, NA, DNR and COVID
follow the league's `reserve_allow_*` settings. The Home screen's "could move to IR" hint uses the same check (`irEligible` in
`analyze.ts`).

When your IR slots are full, the card stays hidden.

## Limits

- **The return week is Sleeper's estimate.** It moves with news, and some players are projected back on time and then aren't. For how
  long absences with the same injury lasted in 2019–2025, see the player details ([injuries.md](injuries.md)).
- **His chance to play once back** is the "returning" one in the rest-of-season model: at most 80% a week, not calibrated
  ([hazard.md](hazard.md)).
- **Activation needs a bench spot,** and that drop isn't counted. The card says so.
- **Adding a free agent and moving him to IR** may need a free bench spot for a moment in Sleeper. `[unverified]`
- **Waiver competition** (order, FAAB) isn't modelled. The waiver board's bid suggestion still applies to him.

## On the owner's leagues (2026-10-16, week 6)

Aggregates only.
- **10-team keeper league:** 3 IR slots, 1 used, so the card shows.
  - 23 eligible free agents with a projected return.
  - Top: a TE who's Out this week and back next (10.5 a game, +21.1 ROS, +2.8 of it in the playoffs). Then +5.4 and smaller.
- **12-team redraft league:** 2 IR slots, 1 used.
  - 33 candidates.
  - Top: a TE back next week (+26.1), then WRs back in weeks 8–9 (+21.8, +15.0, +13.7).
  - This league's weeks ahead have no playoff weeks, so there's no playoff split.
- **Time:** 14–17 ms per league after the season simulation.
