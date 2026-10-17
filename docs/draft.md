# Draft helper

Built 2026-10-17 at the owner's request: a draft helper for redraft and keeper leagues, started now for the 2027 drafts. It covers
rookies, predicted keepers, random and changing draft orders, and projections from this season's production, free agency and
contract extensions. Dynasty startup and rookie drafts stay in Phase 3.

Code:
- `pipeline/next-season.ts`: the model and the published file.
- `scripts/calibrate/next-season.ts`: the fit and backtest. Its constants are in `pipeline/next-season-fit.json`.
- `app/src/analysis/draft.ts`: board, keepers, pick order and mock draft.
- `app/src/ui/DraftTab.tsx`: the league page's Draft tab.

## What it does

- **Board:**
  - every player projected for next season that the league can start, scored by its own scoring settings;
  - ranked by value over replacement (below), with position rank, expected season points and a likely range.
  - Flags:
    - players with no contract for next season on record, with how often players like him changed teams;
    - rookie placeholders;
    - predicted keepers.
- **Keepers** (keeper leagues):
  - each team's likely keepers, with the league's keeper count (Sleeper's `max_keepers`, changeable);
  - a cost rule the manager sets, since Sleeper doesn't store one:
    - one of the team's last picks;
    - the round he was drafted in last year (from Sleeper's last finished draft);
    - one round earlier than that.
- **Draft order:**
  - Sleeper's order once the commissioner sets it. Until then, a random order (fixed per league, so it doesn't change between
    visits).
  - The manager can randomize it again, sort it worst record first, or move teams up and down. Saved on the device.
  - Snake, linear or third-round reversal; rounds default to the roster size.
- **Which slot is best?** Your lineup value after a simulated draft from each first-round slot, for an order not yet set.
- **Mock draft:**
  - the other teams pick; you're shown the players who add most to your lineup, with the chance each is still there at your
    next pick;
  - draft one of them or anyone by name;
  - undo, finish the draft for you, or restart. Predicted keepers take their picks first.

## Next season's projections `[own calc]`

Fitted on nflverse weekly stats for 2012–2025 by `scripts/calibrate/next-season.ts`, with target seasons 2015–2025. Each target
season's previous season is cut at 3, 6, 9, 12 or 15 weeks, or left complete, to match how far the current season has gone. The
pipeline uses the fit for the closest week count.

- **Production a game,** per stat (Sleeper stat keys, so any league's scoring prices it). A Marcel-style average:
  - this season's games so far, last season's at weight a2 and the season before at a3;
  - pulled toward a fitted position mean by k pseudo-games.
  - The weights are fit to PPR points a game; the means are solved exactly per stat, so the points of the projected line equal the
    fitted points.
  - After a complete season: QB a2 0.5, a3 0.4, k 4; RB 0.2, 0.2, 3; WR 0.4, 0, 3; TE 0.3, 0.1, 4. This season's games count
    most even six weeks in.
- **Age:** a factor peaking at 26 (QB, RB) or 27 (WR, TE).
  - Younger players gain about 4% a year toward the peak (RBs 4–6%).
  - After it, RBs and WRs lose 3–4% a year, TEs 1%, QBs nothing measurable.
  - Players coming off their first season get another 0–10%.
- **Contract status:** contract years from OverTheCap, via nflverse's `historical_contracts.parquet` (the CSV copy stopped in
  2022).
  - A player with no contract past this season on record is "pending". Extensions already signed count, since they move the end
    year.
  - A first-round rookie deal's fifth-year option counts once exercised. OTC keeps those deals at 4 years and lists the option year
    only in the cap history, which also holds void years, so the history isn't used for anything else.
  - Pending players scored 2–9% less a game than projected (by position, and how far the season had gone), signed ones about
    the same to 3% more.
  - **What it can't do:** say where a free agent signs, or which extensions are coming. Instead it uses how often players like him
    changed teams (table below), and the measured effect on production. Both come from 2015–2025.
- **Games:** a linear model of the share of next season's games played. Inputs:
  - age band;
  - the share of his team's games he has played this season;
  - whether he's in the draftable tier at his position (top 24 QB/TE, 48 RB, 60 WR by projected points a game);
  - contract status.
  - Players who have missed over half their team's games this season play about a third of a season less of the next one.
  - No contract next season: 3–10% of a season less, besides the per-game factor.
- **Rookies of the next NFL draft:** placeholders by the order their position is taken (the first RB taken, the second, …). Each is
  the average rookie season of the players taken at that spot in 2012–2025 (table below). Once nflverse lists the class (late April),
  the pipeline names them by Sleeper id. That part is built but untested until April.
- **Kickers:** the same average on kicking stats (nflverse), heavily pulled to the mean: k 20–40 pseudo-games.
  - Held out after a complete season, the per-game miss is 1.53 points (2.04 for "same as this year"). The spread between kickers
    is 1.68, so kickers are nearly unpredictable a season ahead.
  - Games: 81% of the season, the top 16 kickers' share.
- **Team defenses:** Sleeper's DEF lines this season and last, last season's games at half weight, pulled toward the league by 32
  pseudo-games. `[design]` That is DST v0's shrinkage ([dst.md](dst.md)), where team rates added little week to week; not backtested
  a season ahead.

### Held out, 2015–2025

Each target season is left out of the fit in turn. Per-game PPR is for players with 4+ games the next season, weighted by games.

Per-game PPR, after six weeks of the season:

| pos | RMSE, same as this year | Marcel | + age | + contract |
|---|---|---|---|---|
| QB | 5.98 | 4.38 | 4.29 | 4.30 |
| RB | 5.01 | 4.26 | 4.10 | 4.10 |
| WR | 4.43 | 3.64 | 3.47 | 3.46 |
| TE | 3.63 | 2.97 | 2.93 | 2.91 |

After a complete season the same order holds: all positions 3.86 → 3.46 → 3.38 → 3.38.

**Contract status barely moves the per-game accuracy** (3.657 → 3.651 at six weeks). It matters more for games: players without a
contract played 3–10% of a season less, in the fitted games model.

Season PPR points, games included, for the draftable tier. The pool is the top players by the model, by the baseline or by the
outcome, so neither method picks its own test set. The baseline is this season's points a game times the tier's average games.

| pos | MAE baseline (6 wk) | MAE model (6 wk) | Spearman baseline (6 wk) | Spearman model (6 wk) | MAE model (full) | Spearman model (full) |
|---|---|---|---|---|---|---|
| QB | 100 | 96 | 0.19 | 0.31 | 93 | 0.34 |
| RB | 80 | 73 | 0.20 | 0.35 | 70 | 0.39 |
| WR | 78 | 69 | 0.23 | 0.43 | 65 | 0.48 |
| TE | 64 | 58 | 0.05 | 0.24 | 56 | 0.29 |

**Calibration** (actual ÷ projected season points, by projected rank, six weeks in):

| pos | 1–6 | 7–12 | 13–24 | 25–48 |
|---|---|---|---|---|
| QB | 0.96 | 1.04 | 1.05 | 1.00 |
| RB | 1.00 | 0.99 | 0.98 | 1.05 |
| WR | 0.97 | 1.10 | 1.06 | 0.98 |
| TE | 0.97 | 1.00 | 1.02 | 1.11 |

Exploratory fits without the tier in the games model under-projected the draftable tier's games, which is why the model has it.

**Likely range:** the 10th to 90th percentile of actual ÷ projected season points for the draftable tier, after a complete
season:

| pos | 10th | 90th |
|---|---|---|
| QB | 0.18 | 1.61 |
| RB | 0.06 | 1.93 |
| WR | 0.29 | 1.64 |
| TE | 0.25 | 1.75 |

The low end is mostly lost seasons (injury, release).

**Players who changed teams** the next season (of those who played it), after a complete season:

| pos | no contract, draftable | no contract, others | signed, draftable | signed, others |
|---|---|---|---|---|
| QB | 23% | 68% | 10% | 32% |
| RB | 56% | 48% | 9% | 19% |
| WR | 50% | 54% | 10% | 20% |
| TE | 36% | 51% | 6% | 15% |

The backtest's contract status can't see fifth-year options (the cap history shows only today's), so a few players it counted as
pending were under contract. The pending effects are slightly diluted.

**Rookies by the order their position was taken,** in their rookie season, draft classes 2012–2025 (14 each):

| pos | taken | PPR a game | games share | season PPR (17 games) | 90th percentile |
|---|---|---|---|---|---|
| QB | 1st | 14.6 | 85% | 211 | 313 |
| QB | 2nd | 16.3 | 71% | 197 | 343 |
| QB | 3rd | 14.9 | 57% | 143 | 233 |
| RB | 1st | 15.7 | 84% | 224 | 346 |
| RB | 2nd | 12.6 | 80% | 171 | 243 |
| RB | 3rd | 8.1 | 84% | 115 | 205 |
| RB | 4th | 9.5 | 70% | 113 | 207 |
| WR | 1st–3rd | 10.9–11.6 | 81–84% | 154–160 | 224–260 |
| WR | 4th–6th | 9.0–10.1 | 68–80% | 105–131 | 217–240 |
| TE | 1st, 2nd | 7.7–7.8 | 81–84% | 105–111 | 177–189 |

The first RB taken lands among the top five RBs on a board of projected (pulled-in) veterans. That's what the averages say, but
those 14 seasons range from lost years to stars.

## The published file

`data/nextseason.json` holds:
- by Sleeper id: name, position, the projected per-game line, expected games, age, a no-contract flag and the chance of a team
  change;
- the rookie placeholders and the likely-range factors.

About 150 KB for about 550 players: QB/RB/WR/TE projected for 10+ PPR points, the top 40 kickers and all 32 defenses. Derived values
only: no stats, contract terms or draft data are republished. It's rebuilt daily with the other data files. If a build fails, the
deployed copy is kept while Sleeper's season is the same.

## Value and drafting `[design]`

- **Value over replacement:** (points a game − the replacement's points a game) × expected games.
  - Missed games are valued at replacement level, so a durable player is worth more than one with the same points a game.
  - The replacement at a position is the best player left once every team's starting slots are filled: dedicated slots first, then
    flex slots with the best remaining eligible players.
  - IDP slots are left out; IDP isn't projected.
- **Lineup value** (suggestions, slot comparison):
  - the starters' value over replacement, filling dedicated slots first;
  - plus 30% of the bench's positive value, since a bench player plays when a starter is hurt or on a bye.
- **Keepers:** each team keeps the players whose value beats the cost by the most, up to the count.
  - The cost is the average value of a pick in the round he costs.
  - Two keepers costing the same round: the later one takes the team's nearest free earlier round.
  - Managers who keep for other reasons (a favourite, the long view) will differ.
- **The other teams:**
  - They draft from the board with noise: each simulation moves every player's rank by a log-normal factor (SD 0.3, so a player
    ranked 40th typically goes 30th–54th).
  - They keep two QBs at most in a one-QB league (three with a superflex), two TEs, and one kicker and one defense, taken last.
  - They fill their starting slots by the end.
  - **No ADP:** with no 2027 ADP or draft data yet, the noise is a design value, not fitted to real drafts.
- **Your picks in simulations** (slot comparison, "finish for me"): the player who adds most to your lineup value among the best
  available.
- **Chance he's back at your next pick:** 150 simulations of the picks in between, with your current pick left open.

## Checked

- **Unit tests:**
  - **Pipeline:**
    - season totals and kicking stats;
    - contract end years with options;
    - the rate model, age, games and the draftable tier;
    - defenses;
    - the published file with placeholder and named rookies;
    - the shard check.
  - **App:**
    - scoring by league settings;
    - positions a league can't start left out;
    - replacement levels with flex slots;
    - lineup value;
    - the drafting limits;
    - keepers by cost rule, and keepers placed in clashing rounds;
    - snake, linear and third-round reversal orders;
    - full mock drafts that fill every team's lineup;
    - suggestions and slot comparison.
- **End to end:** board flags and filter; keepers by cost rule; reordering, the slot comparison and a mock draft from the 4th slot
  through to the end, with undo; dynasty leagues get a note instead. On a desktop and a phone, with no sideways scrolling.
- **The full data build,** offline with week 6's inputs: 546 players (148 KB), with the usual shards unchanged.
- **On the owner's leagues** (settings and rosters only; projections from that offline build):
  - **Keeper league, 10 teams, 5 keepers:**
    - 50 keepers predicted;
    - 44 of the board's top 50 players are among them, so this league's draft is mostly rookies and depth.
  - **Redraft league, 12 teams, no kicker slot:** 530 players on the board, no kickers.
  - **Speed:**
    - the board builds in under 20 ms;
    - suggestions take 30–60 ms and a full mock draft about 5 ms;
    - the slot comparison takes about 1.5 s at 40 simulations a slot (the app runs 30).
- **Not yet checked:** Sleeper's draft endpoints (`/league/{id}/drafts`, `/draft/{id}/picks`). The fields follow Sleeper's docs.
  The private league pull now fetches them, for a check on its next run.

## Limits

- **It's early:** built six weeks into the 2026 season and updated daily. By August it rests on the complete season.
- **A season's total is mostly noise a year out:** misses average 56–96 points for draftable players. The ranking beats "same as this
  year", but not by a lot.
- **Free agency:**
  - Players are on their current teams until they sign elsewhere (March). The pipeline picks moves up from Sleeper's player data.
  - The model doesn't know a player's landing spot or new competition, including the rookies a team drafts.
- **Market:** no ADP yet, so the mock draft shows likely outcomes under these projections, not under the market's. When the
  market and the board disagree, the board isn't necessarily right.
- **Keeper rules** beyond the count aren't in Sleeper's data; the cost rule is the manager's to set.
- **Not covered:** IDP, auction drafts, and dynasty startup and rookie drafts.

## Next, for August 2027

- Named rookies after the NFL draft (built; check it then).
- Sleeper's 2027 ADP for the other teams' picks, once published.
- A live board that follows Sleeper's draft as picks are made.
- Calibrate the noise on real drafts.
- Dynasty startup and rookie drafts (Phase 3).
