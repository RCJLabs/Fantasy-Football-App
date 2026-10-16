# Player props (The Odds API)

Betting-market player props, turned into stat-level projections: the plan's second independent source (PLAN §2–3, roadmap Phase 2 item 6).
Built 2026-10-16. Props run **in shadow**: fetched, archived, converted and scored in the prediction ledger next to the app's own numbers.
They aren't shown in the app or blended until they pass the blend gate (PLAN §6).

## What runs

- **When:** inside the archive workflow (`scripts/archive/snapshot.sh`, hook `scripts/props/pull.ts`). It adds no schedule of its own.
  - Each game is fetched **once**, in the first archive run within 6 hours of its kickoff. That's usually 1–6 hours before: Sunday early games
    around 8 am ET, late games around noon, night games mid-afternoon.
  - Nothing is requested unless the app's own schedule has a game inside the window that no earlier run fetched. So the event list is
    called about once per slate, not on every run.
- **What:** one region (US books), six markets per game: passing yards, passing TDs, rushing yards, receptions, receiving yards and anytime
  TD. The free event list comes first.
- **Budget:**
  - The API bills one credit per market a book offers, per game and region: at most 6 a game, about 90 a week.
  - The rest of 2026 needs roughly 1,000 credits over three months, within the free plan's 500 a month.
  - Each fetch checks the credits left and fetches only the games they cover, nearest kickoff first.
- **Storage:** the raw responses (`props_events.json`, `props_event_<id>.json`) go into the encrypted snapshot only.
- **Published:** `props_<season>w<week>_<timestamp>.json` per run, holding game ids, kickoffs, team names, credits used and counts of books,
  markets and players. No lines, prices or book names.
  - Later runs read these files to skip games already fetched.
  - The job summary shows the same counts.
- **Key:** the Actions secret `ODDS_API_KEY` reaches only the props hook. The ledger hook runs without it. Requests never log their URL.
- **Testing:** dispatch the archive workflow with `props: test`. It fetches the next game whatever its kickoff (about 6 credits) and marks it
  as a test, so the real run still fetches that game.

## From prices to projections (`pipeline/props.ts`)

1. **Remove the vig.** Each over/under pair becomes the no-vig chance of the over: both implied probabilities rescaled to sum to 1.
   - Anytime-TD markets quote only Yes: in the live test, none of 6 books offered No. A one-sided Yes price has 8% of its implied chance
     removed `[design]`: a typical two-way hold of 6–8%, falling mostly on the popular side. Calibrate on scored weeks.
2. **Line → mean.** A line sits near the median of the outcome, and yardage is right-skewed, so the mean is above the line.
   - The shapes come from 2022–25 regular seasons: actual ÷ RotoWire's projection for players who played, rescaled to mean 1, in bands of the
     projection (`pipeline/prop-shapes.ts`, from `scripts/calibrate/prop-shapes.ts`).
   - The mean μ is the one at which the shape puts the line at quantile 1 − P(over): μ × Q(1 − P(over) | μ) = line.

   | stat (position) | projection band | median ÷ mean | mean for an even-money line |
   |---|---|---|---|
   | passing yards (QB) | 203–254 | 0.99 | line + 1% |
   | rushing yards (RB) | 39 / 56 / 75 | 0.86 / 0.92 / 0.93 | line + 17% / 8% / 7% |
   | receiving yards (WR) | 30 / 41 / 55 / 74 | 0.75 / 0.87 / 0.90 / 0.93 | line + 33% / 15% / 11% / 8% |
   | receiving yards (TE) | 30 / 48 | 0.83 / 0.90 | line + 20% / 12% |
   | receptions (WR) | 3.4 / 4.3 / 5.7 | 0.92 / 0.96 / 0.97 | line + 9% / 4% / 3% |

   Examples: a WR's 45.5-yard line at even money means about 51 yards, a 72.5-yard line about 78, a 245.5-yard passing line about 248.
3. **Touchdowns are Poisson.**
   - A passing-TD line at even money: P(X ≥ 2) = 0.5, so λ = 1.68.
   - Anytime TD: λ = −ln(1 − P(yes)). It's split between rushing and receiving as RotoWire's line splits them; without one, QBs get all
     rushing, RBs 75% rushing, WRs 5%, TEs none.
4. **Books are combined** by the median of each book's mean.
5. **Players are matched** by name within the game's two teams.
   - The order: exact normalized name (no accents, punctuation or Jr/III suffixes; initials joined), then first initial and last name, then
     a unique last name.
   - Players eligible at QB/RB/WR/TE count, including a two-way DB/WR, read at his skill position.
   - Team-defense TD props ("… D/ST") are skipped.
   - Unmatched names are counted, not guessed.

Props are void when a player doesn't play, so these are means *if he plays*, the same convention as the app's projections.

## Live check (2026-10-16)

A `props: test` run fetched HOU at JAX (week 6, Sunday):
- **Cost:** 6 books (DraftKings, FanDuel, BetMGM, Bovada, BetOnline, BetRivers) and all 6 markets, for 6 credits. The event list cost 0.
- **Format:** as the code expects: outcomes `{name: Over|Under|Yes, description: player, price, point}`. Some books post Over-only reception
  lines; those are skipped.
- **Matching:** 29 of 30 names. The 30th has a different team in Sleeper's player data.
- **Against RotoWire** (the same 29 players, before scoring):

  | stat | props ÷ RotoWire |
  |---|---|
  | receiving yards | 1.05 |
  | rushing yards | 1.06 |
  | passing yards | 0.96 |
  | rushing and receiving TDs | 1.04 |
  | receptions | 1.17 |

  - Most of the receptions gap is depth receivers RotoWire puts under 1.1 catches, which books price at 1.5 near even money (about 1.8–2.1).
    That's the market disagreeing, not the method: a plain Poisson inversion gives nearly the same.
  - Both QBs' passing-TD lines also sit above RotoWire's projections.
  - Full-PPR points if active differ from the app's by 0.9 on average (props +0.4).

## Scoring in the ledger

- **What's recorded:** in the snapshot that fetched a game's props, each prediction also carries `pr`. It's full-PPR points if active,
  using the props wherever they price a stat and Sleeper's line for the rest (interceptions, fumbles, two-point plays).
  - For Questionable players, Sleeper's discount is undone first, as the app does for `mu`.
- **What the scorer reports** (`scripts/ledger/score.ts`): `pr` against the app's `mu` *from the same snapshot*, plus a 50/50 blend. It uses
  active QB/RB/WR/TE that either source put at 5+, the backtest's population.
- **Gate:** the same as the baseline's.
  - Props must be within ~5–10% of RotoWire's MAE.
  - A blend with weights fit on earlier weeks must lower MAE out of sample, with the pooled 95% interval below zero.
  - That needs several weeks. Historical props (paid plans only) would shorten it: about 49,000 credits for 2023–25, one month of the $59
    plan. Not bought for now (2026-10-16), so the gate waits for live weeks.

## Limits

- **Shapes:** they're measured around RotoWire's projections. If the market knows more than RotoWire, the true spread around its line is
  narrower, and the means for low lines (where the shape adjustment is largest) come out too high. The ledger will show it as a bias by
  line size.
- **Free-plan coverage:** one snapshot per game, close to kickoff. There are no early-week props for Tuesday–Friday decisions.
- **Matching:** nicknames that differ from Sleeper's names (e.g. "Hollywood" Brown) stay unmatched, as do players whose team in Sleeper's
  data lags a signing.
- **Receptions:** low lines (0.5–2.5) are read through the same measured shapes as yardage. Those carry the spread seen around projections,
  so at a 1.5 line they imply about 0.3 more catches than a Poisson model would.
- **Not priced by these markets:** interceptions, attempts, two-point plays, kickers and defenses.
- **Terms:** the Odds API terms (2026-08-31, as reported) allow derived values in an app but not redistributing the data. Only aggregates
  and the shadow scores are published; per-player prop projections aren't, until the gate decides they belong in the app.

## Reproduce

```bash
# Shapes (needs the decrypted history bundle, docs/baseline.md):
npx tsx scripts/calibrate/prop-shapes.ts history          # prints the table; --write regenerates pipeline/prop-shapes.ts
# Shadow scores: scripts/archive/README.md, "Scoring the ledger".
```
