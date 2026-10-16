# Across your leagues

Built 2026-10-16, item 7 of the owner's assistance list. Code: `app/src/analysis/across.ts`; the Home page's "Across your
leagues" card (`app/src/ui/Home.tsx`). No new data: it reuses each league's lineup analysis and waiver board.

## What it shows

The card appears on Home when you have a team in two or more in-season leagues. Best-ball leagues are left out, since Sleeper
sets those lineups.
- **In more than one lineup:** players in the app's recommended lineup in two or more leagues.
  - Most leagues first, then the likeliest to miss. The chance to play is shown when it's under 95%.
  - Up to six, then "and N more".
- **Games with several of your starters:** NFL games holding three or more of your starter spots across leagues, most first, with
  kickoff times. A player starting in two leagues counts twice. Up to three games.
- **Free agents for more than one league:** free agents in the top 10 of two or more leagues' waiver boards. This part runs on
  request, because it values every league's free agents.
  - Each must add 2+ points in each league: this week plus the weighted rest of the season, after that league's suggested drop.
  - Each league's gain and suggested FAAB bid are shown, with where he adds more ("about the same" within a point).

## Why `[design]`

- **Overlap and game stacks are information, not advice.** One injury or one bad game moves those spots together. The lineup
  recommendations don't change.
- **Shared free agents:** waiver order and FAAB are per league. Claim him where he adds more, or in both.

## Checked

- **Unit tests:**
  - overlap: order by leagues, then chance to play;
  - game stacks: players without a game left out, and the three-spot minimum;
  - shared free agents: the top-10 cut, the 2-point minimum, order by gain, and bids.
- **End-to-end:** the test user's keeper and dynasty leagues share one roster.
  - Every starter shows in both lineups, the Questionable one first.
  - CCC@DDD holds 8 starter spots.
  - Free Agent Runner is a shared free agent worth about the same in each.
- **On the owner's two in-season leagues** (week 6, aggregates only):
  - 10 and 9 recommended starters. Two players, a WR and a DEF, start in both.
  - One game holds 3 of the 19 starter spots.
  - Four free agents are top-10 targets in both leagues. One adds twice as much in one league (24.2 against 12.0); the others are
    within 5 points of each other.
  - Each waiver board takes about 150–170 ms here, on top of each league's rest-of-season load.

## Limits

- **Recommended lineups,** not the ones set in Sleeper.
- **The free-agent comparison runs on request,** since it loads rest-of-season projections for every league.
- **Game stacks count spots, not correlation.** Two players in one game can rise together or move against each other (a QB and the
  opposing defense).
