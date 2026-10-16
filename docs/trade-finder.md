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
  - forced drops and free-agent fills;
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
