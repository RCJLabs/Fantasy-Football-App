# Trade ideas (trade finder)

Built 2026-10-16. Code: `app/src/analysis/tradeFinder.ts`; the Trade tab's "Trade ideas" card.

## What it does

It searches for trades with every other team that improve **both** teams' best lineups over the rest of the season. Results are ranked
by your gain. Trade deadlines make this most useful in the weeks before them; after a league's deadline the card is hidden.

## Search

- **Players:** each team's 8 most valuable QBs, RBs, WRs and TEs by rest-of-season points. Kickers and defenses are left out, since
  they're streamed. So are draft picks.
- **Shapes:**
  - one for one;
  - two of yours for one of theirs, or one of yours for two of theirs, only when the one is worth more than either of the two
    (a consolidation).
- **Scoring:** each side's weighted best-lineup points after the trade, from the same model as the trade tab. That includes playoff-week
  weights, availability and depth covering byes and absences. A side with too many players drops its cheapest.
  - Their side is scored first, so a candidate they'd lose on costs one valuation, not two.
- **Kept:** you gain at least 3 points and they don't lose any. At most two ideas per team and two per player you'd give up, for variety.
- **Reported:** the six best get the trade tab's full evaluation, and those are the numbers shown:
  - forced drops. A spot the trade opens isn't filled from free agency, since you could make that pickup anyway (see "No free-agent
    fills" below);
  - the 80% range and the chance it adds points;
  - playoff (or 1st-place) and title odds.

**Open in the builder** loads an idea into the trade builder, with its bye grid and both sides' details.

## Checked

- **Unit tests:**
  - every reported idea passes both thresholds and matches the trade tab's own evaluation of the same trade;
  - ideas are sorted by your gain;
  - the per-team cap holds;
  - two-for-ones are generated;
  - one-for-one only, when asked.
- **End-to-end:** a league where one team has four WRs and no RB gets ideas that send it a running back. Opening one fills the builder.
  The default test league, where no trade helps both sides, shows the empty message.
- **On the owner's 10-team keeper league** (week 6, Sleeper's projections for weeks 7–17): 6 ideas in about 1 second on a desktop.
  - One lineup valuation takes about 0.2 ms. The 1 second covers the search and the full evaluation of the shortlist.
  - Phones are slower; the card shows progress team by team.

## Limits

- **Lineup math only.** Managers judge trades by rankings and needs the model can't see. When FantasyCalc values load, each idea shows them,
  and flags it when you'd get 40% more market value than you give.
- **Ranges are wide.** Over most of a season a trade's change can land anywhere in a range of 100+ points. The ranking uses the expected
  change.
- **Not searched:** two-for-two and bigger trades, players outside a team's top 8, kickers, defenses, picks.
- **Their view uses your model.** Their gain is computed with the app's projections and their roster's weights, not theirs.

# What would it take (one player)

Built 2026-10-16, item 6 of the owner's assistance list: the trade finder turned around. Code: `findPackages` in
`app/src/analysis/tradeFinder.ts`; the Trade tab's "What would it take?" card.

## What it does

You pick a QB, RB, WR or TE on another team, from the card's list or with **What would it take?** on a buy-low player
([luck.md](luck.md)). It searches packages of your players for him.
- **Whether he'd start for you:** the weeks ahead he'd be in your best lineup if he joined your roster as it is.
- **Packages that help both lineups,** up to five, each with both sides' gains, your 80% range, the player they'd have to drop
  and market values. **Open in the builder** loads one into the trade builder.
- **When none does:** the three packages their lineup gains from that cost yours least. That's the price in lineup terms.

## Search

- **Packages:** every one or two of your 12 most valuable QBs, RBs, WRs and TEs that have any rest-of-season value, for him. That's
  up to 78.
- **Screening:** both rosters' weighted best-lineup points, as in trade ideas, their side first. Their lineup must not lose.
- **Kept:** packages that also gain you 1+ point, each of your players in at most two, for variety. The best ten get the trade tab's
  evaluation, and those are the numbers shown.
- **Order:** best for you first. With FantasyCalc values, packages that give his team under 1/1.4 of his market value go last
  (the same flag as trade ideas). Dynasty leagues use dynasty values; keeper and redraft leagues use this season's.

**No free-agent fills** `[design]`. A two-for-one opens a spot on your roster. A free agent could fill it, but you could make that
pickup anyway by dropping someone, so counting it would make two-for-ones look cheaper than they are. In the e2e league, counting
the fill turned a backup QB nobody would start into "+32 for you": the whole gain was the free agent. The trade builder and trade
ideas filled such spots until the owner's call on 2026-10-16; since then no trade evaluation does.

## Checked

- **Unit tests:**
  - packages help both lineups and match the trade tab's evaluation;
  - best for you first, with each of your players in at most two;
  - packages they'd see as lopsided go last;
  - the closest packages when none helps both;
  - a good free agent available doesn't change any package;
  - whether he'd start for you.
- **End-to-end:** a buy-low running back opens the card with packages, and one loads into the builder. The rival's QB, who'd sit
  behind yours, shows the closest packages.
- **On the owner's leagues** (week 6), targeting each rival's three most valuable QBs, RBs, WRs and TEs (27 and 33 targets):
  - Packages that help both lineups exist for 2 and 3 of them. Top players are worth more to their teams than one or two of yours.
  - For the rest, the cheapest package their lineup gains from costs yours a median 10.8 and 10.7 points over the rest of the season
    (quartiles −17 to −7 and −25 to −7). For 12 targets in each league it's within 10 points.
  - In the 12-team league, 8 of the 9 two-sided packages give under 1/1.4 of the target's market value. FantasyCalc prices a star
    above the sum of two lesser players.
  - 7 of the 33 targets in the 12-team league wouldn't start for the owner.
  - One search takes 120–210 ms here; phones are slower, and the card says it's searching.

## Limits

- **One or two of your players for him.** Not searched: three for one, getting a second player back, draft picks.
- **Lineup math,** as with trade ideas: their gain uses the app's projections. Market values are simple sums, and FantasyCalc's own
  calculator adds a premium for the best player in uneven trades.
