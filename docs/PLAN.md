# Fantasy Football Assistant — Plan & Roadmap

**Status:** v2, confirmed 2026-10-15 · Phase 0 done, Phase 1 MVP built and validated on real leagues, Phase 2 core built early (see "Progress" below) · **Repo:** RCJLabs/Fantasy-Football-App (public)

**Decisions (2026-10-15):**
- Free and non-commercial for 2026, mainly personal use, kept publishable.
- Effort: as many hours as needed; Claude implements, you review.
- Leagues are imported by Sleeper username.
- Stack: TypeScript (Vite + Preact); Node pipeline now, Python later if needed.
- `main` was created.
- The private archive repo couldn't be created by the integration, so the archive runs in this repo instead, age-encrypted (only the key holder can read it).

**Decisions (2026-10-16):**
- The ledger is scored automatically in Actions with the current archive key, accepting the single-key risk for now ([ledger.md](ledger.md)).
- The scored ledger goes on the About page once 3 weeks are in, with sample sizes.
- No historical props for now: the props blend gate waits for live weeks.

**Progress:**
- **Phase 0 — done.**
  - Archive running since Week 6 (pre-TNF).
  - Spikes recorded in [spikes.md](spikes.md): all Sleeper endpoints are CORS-open; projections cover all positions with past and future weeks.
- **Phase 1 MVP — built:**
  - username import and all-leagues dashboard
  - league rescoring and P(play) from designation plus practice report
  - two-stage optimizer with kickoff locks
  - K/DEF, win and median probability
  - waivers v0, explanations, PWA
  - CI and Pages deploy

  **Validated on the owner's leagues (2026-10-15):**
  - spikes (c)(h)(i) answered;
  - golden test: 1,706/1,706 player-weeks match Sleeper's points;
  - three real-data bugs fixed (spurious slot moves, kicker keys, no-playoff leagues).
- **Phase 2 — core built early (PR #2):**
  - ROS values from Sleeper's weekly projections for every remaining week;
  - season simulation over the real schedule: playoff, bye and 1st-place odds;
  - playoff weeks weighted by playoff odds;
  - waivers with ROS gain, drop suggestion and a FAAB bid priced from the league's own winning bids by position;
  - stripped trade analyzer (both sides' ROS and playoff odds, forced drops, refilled spots, deadline);
  - DEF/K streaming table;
  - public accuracy ledger v0: aggregate projection error by position plus a calibration check of the app's spread (kicker spread widened from it).

- **Playoff mode — built (2026-10-15):**
  - Lineups maximize P(win the round): two-week rounds count both weeks; in median leagues the regular-season objective is H2H plus median wins.
  - Same-game correlations come from 2026 weeks 1–5 projection misses: QB–WR +0.27, QB–TE +0.33, QB vs opposing DEF −0.37, same-team RBs −0.25.
  - Opponents are assumed to replace starters who can't play.
  - The win-chance lineup must beat the max-points lineup by ≥0.5 pp to be shown. On the owner's leagues in Week 6 it matched max points.

- **Trade bye grid and market values — built (2026-10-15):**
  - Week by week, lineup points before and after the trade, empty starting slots, and which regular starters are on bye. Byes come from teams missing in each week's projections.
  - FantasyCalc market value for each side, shown apart from the lineup verdict. It uses the league's format (redraft or dynasty, 1QB or superflex, team count, PPR) and is fetched and cached by the browser, with attribution.

- **Keeper/dynasty long-term view — built (2026-10-15):**
  - In keeper and dynasty leagues the Trade tab shows this-season (redraft) and long-term (FantasyCalc dynasty) market values side by side.
  - The Season tab ranks teams by the long-term value of what they carry forward (their best `max_keepers` in keeper leagues, whole rosters in dynasty) next to their strength this season, and lists your likely keepers with ages.
  - On the owner's keeper league the ranking matches intuition; the owner's team is 5th of 10.

- **P(play) calibration — built (2026-10-15):**
  - The designation × final-practice table is fit on 2023–2025.
    - Method: nflverse final injury reports joined by `gsis_id` to game-day active/inactive rosters, for fantasy-relevant players.
    - Questionable: 92%, 71% and 56% active after a full, limited or missed final practice (72% overall, n = 502).
    - Doubtful 1 of 69; Out 0 of 357.
    - Each season's Questionable rates fell within the fit's 95% intervals.
    - On held-out 2026 weeks 1–5 it expected 27.1 of 38 Questionable players active; 27 were. That's too few to beat the old table on Brier.
    - Details and limits: [calibration.md](calibration.md).
  - Fixed: the app combined mid-week practice statuses, or last week's early in the week, with a table that only fits final reports. Practice
    now sets the odds only from the player's final report of the current week. Before that, the overall Questionable rate applies and the
    player card says so.

- **Draft picks in dynasty trades — built (2026-10-15):**
  - **Ownership:** each team keeps its own picks for the next three drafts unless Sleeper's `traded_picks` lists them as moved. Traded rounds
    beyond `draft_rounds` extend the round count; a real keeper league has a traded 4th with `draft_rounds` = 3.
  - **Values:** FantasyCalc dynasty prices.
    - Next year's picks blend the Early/Mid/Late prices by the original team's finish in the season simulation.
    - Worst record picks first. That's an assumption `[design]`; leagues can set their own order.
    - Later years use the round's flat price. Rounds past the 4th have no price.
  - **UI:** the trade builder lists each side's picks in dynasty leagues with pick trading on.
    - Picks count only in the long-term market line, and picks-only trades work.
    - The Season tab's long-term ranking adds each team's pick value and lists your picks.
  - **Smoke test** on the owner's keeper league, run through the dynasty path:
    - The 5-0 team's 2027 1st prices at 2.5k (86% Late); the 1-4 team's at 4.5k (96% Early).
    - The six traded picks resolve to the right owners; the 2026 ones are already drafted.
    - The owner's dynasty league is still pre-draft, so nothing shows there yet.

- **Prediction ledger, commit step — built (2026-10-15):**
  - Each archive run (about 10 a day, plus before every slate) also runs a predict hook. The hook writes the app's own numbers into the
    encrypted snapshot for every player whose game hasn't started: chance to play, full-PPR points if active, and spread.
  - It uses the same code and the same inputs the app reads: Sleeper's projection rows and the deployed `players.json` and `schedule.json`.
    Those two files are now archived too.
  - A public `commit_*.json` asset carries the SHA-256 of those predictions; GitHub's upload time shows they predate kickoff.
  - Nothing RotoWire-derived is published. A hook failure never blocks the snapshot.
  - On today's real snapshot: 415 players in 14 week-6 games, in 0.6 s.

- **Prediction ledger, scoring step — built (2026-10-16):**
  - `scripts/ledger/fetch.sh` decrypts only the predictions from a week's snapshots.
  - `scripts/ledger/score.ts` takes the last prediction committed before each kickoff and checks it against nflverse outcomes:
    - chance to play: Brier, log loss, calibration by tag, against game-day actives;
    - points if active: MAE, bias, ±1/±2 SD coverage, against PPR results.
  - Only played games count. Since 2026-10-16 it runs in Actions on every archive run, once the key is a secret ([ledger.md](ledger.md)).
  - It's live-tested on the archive's real assets. The first committed set (00:03 UTC Friday, 418 players, 14 games) predates Thursday
    night's kickoff.

- **Usage trends, display only — built (2026-10-15):**
  - Usage covers the last four weeks of snap share, targets and carries, plus each player's share of team targets and carries.
    - Sources: nflverse snap counts (compiled by PFR) and weekly player stats.
    - Joins: PFR id → gsis via weekly rosters, then gsis → Sleeper via the pipeline's id map.
    - Coverage: 525 of 526 fantasy-relevant 2026 stat rows (10+ PPR) mapped.
  - It appears as a table in player details and as a one-line trend on the waiver board, for example "snaps 45→61→84% · 62% of carries".
    It doesn't change projections.
  - The archive also runs before Sunday's 4 pm games (after their inactives) and before SNF in EDT, so every slate gets a late prediction.

- **Live matchup — built (2026-10-18):** the owner's request.
  - **Lineups:** the Matchup tab shows both lineups slot by slot.
    - Yours is as set in Sleeper, since that's what scores; the recommended one stays on the Lineup tab.
    - The opponent's includes the model's fill-ins for starters who can't play, marked "assumed".
  - **Each starter:**
    - before his game: his projection;
    - once it starts: Sleeper's points so far against his projection, and his stat line from Sleeper's stats.
  - **Each side:** points so far, a projected final (points so far plus what's left of each starter's projection, by time played),
    and how many starters are playing or still to play.
  - **Win chance:** for the lineup as set, with the recommended lineup's beside it when they differ.
  - **Refresh:** while a starter's game is on and the page is open, the tab reloads scores and lineups from Sleeper every minute.
    Stat lines load about every 5 minutes, since Sleeper's CDN keeps a copy that long.
  - **Not verified yet:** whether Sleeper's stats endpoint updates during games. It was checked only on a finished week (spike (g)).
    If it doesn't, stat lines appear only once Sleeper fills them in; points still come from the matchups.

- **Matchup context, display only — built (2026-10-16):** this is roadmap item 7.
  - **Defense vs position:** each PPR game is compared with that player's average in his other games (leave-one-out, players with 3+ games).
    - The edges are summed per defense and position, per game, then shrunk toward zero with 4 pseudo-games of an average defense `[design]`.
    - Weeks 1–5 range from about −5.5 to +7.5 PPR per game. Game-level noise is 8–13 points, so most teams are within noise; the label says
      so.
  - **Cornerbacks out:** each defense's three regular corners (50%+ of defensive snaps over the last 4 weeks), checked against their current
    injury tags. For example, DEN's Pat Surtain (81% of snaps) was Out on Thursday.
  - Both appear in player details, with sample sizes. Projections are unchanged.

- **Matchup adjustment gate — decided (2026-10-16): no adjustment.** The Phase 3 DvP and CB-depletion backtests, brought forward;
  details in [matchups-gate.md](matchups-gate.md). On 11,094 QB/RB/WR/TE player-games (2022–25), against RotoWire alone:
  - **DvP** (what RotoWire missed against the opponent in earlier weeks, shrunk): tuned on 2022–23 and scored on 2024–25, MAE changed
    −0.04% (interval spans zero). At full strength it made every position worse. The earlier misses correlate 0.047 with the next.
  - **Cornerbacks out:** WRs beat RotoWire by about half a point when a regular corner sat (both season halves). But a factor for it beat a
    single factor by 0.12% at best and lost on the other half; by squared error the gain is nil.
  - Both stay context only.

- **Baseline blend gate — decided (2026-10-16): no blend.** This is roadmap item 4; details in [baseline.md](baseline.md).
  - **Data:** Sleeper's stored weekly projections and stats for 2022–25 and 2026 weeks 1–5. A dispatch-only workflow pulls them,
    age-encrypted.
  - **Baseline v0** as specified in §2: ffopportunity expected stats, recency-weighted and shrunk, times an implied-total factor.
  - **Out of sample (2024 – 2026 week 5):** baseline MAE is 1.05×, 1.03× and 1.01× RotoWire's for RB, WR and TE, which passes the bar.
    QB is 1.21×, which fails.
  - **But blending barely helps:** with weights fit on earlier seasons, MAE changes +0.1% (2024), −1.1% (2025) and −0.6% (2026, interval
    includes 0). The gate now also requires that direct test (§6).
  - **Then built (2026-10-16): v0 in shadow.** This is roadmap N4.
    - The pipeline publishes `baseline.json` daily (CC-BY-SA 4.0), using the backtest's code path.
    - Player details show it as a labelled second opinion.
    - It's the fallback for a week without Sleeper QB/RB/WR/TE projections.
    - The ledger commits it (`bl`) beside the app's numbers and scores both from week 7.
    - Known gap: it needs Sleeper's stats endpoint, so it doesn't survive a full `api.sleeper.com` outage.
  - **Found on the way:** Sleeper's stored 2022–25 projection rows count QB interceptions as +2 in their own `pts_ppr` (2026 rows are fine).
    The app rescores stat lines, so it was never affected; the accuracy shard now rescores too.

- **Pipeline hardening — built (2026-10-16):** roadmap Phase 2 item 8.
  - **nflverse → Sleeper stat mapping** ([stat-mapping.md](stat-mapping.md)). On 19,427 played QB/RB/WR/TE player-weeks (2023 – 2026 week 5),
    mapped nflverse lines score within 0.1 of Sleeper's own lines:
    - 99.99% in PPR;
    - 99.82% with half PPR, TE premium, first downs, bonuses and sacks.
  - **Three definitions it surfaced, now fixed:**
    - Sleeper doesn't count a touchdown as a first down; nflverse and ffopportunity do. The in-house baseline overstated first downs.
    - Sleeper's first-down bonus counts passing, rushing and receiving first downs.
    - Yardage bonus tiers are exclusive (86 of 86 games). The app priced them cumulatively, slightly overstating bonuses in leagues with
      two tiers.
  - **Ledger outcomes** now score the mapped line with the ledger's own scoring. nflverse's `fantasy_points_ppr` differs on 0.7% of
    player-weeks (return TDs, return fumbles).
  - **Shards:**
    - Each optional shard is validated before publishing: schema version, shape, minimum rows, finite values.
    - A failed or invalid build keeps the deployed copy while it's still current (same season; same week for the baseline). The manifest
      says so.
    - The job summary gets a shard health table, with a warning when rows fall by half.
    - This closes the baseline gap above for a one-day Sleeper outage.
  - **Not done:**
    - a Python package (the stack stayed TypeScript);
    - JSON-Schema files (the TypeScript validators cover the one consumer);
    - opening issues automatically (it needs a permission change in `deploy.yml`, whose cron lines this session must not touch).

- **Team defense v0 — built (2026-10-16):** roadmap N3; details in [dst.md](dst.md).
  - **Model:** the opponent's implied total for points allowed, adjusted to Sleeper's definition. Sleeper leaves out the opponent's
    defensive and return TDs; its points allowed differ from the final score in 8–14% of games. Sacks and takeaways are defense × opponent
    rates, shrunk to the league average, with home/away factors.
  - **Out of sample (2024 – 2026 week 5):** MAE 4.43 against RotoWire's 4.41. Blending changes MAE by +0.6%, −0.1% and −1.0%, so no blend.
  - **Finding:** team sack and turnover rates add nothing beyond league averages. A defense's week is the opponent's implied total plus
    noise (r ≈ 0.3 for both sources).
  - **Shipped** inside `baseline.json` (team codes): a labelled second opinion for defenses, and the DEF fallback for a week without Sleeper
    projections. Kickers stay Sleeper-only.

- **Trade ideas — built (2026-10-16):** not on the original roadmap; added for the trade deadlines (weeks 11–12 in the owner's leagues).
  Details in [trade-finder.md](trade-finder.md).
  - **Search:** one-for-one and two-for-one trades with every team, among each team's 8 most valuable QB/RB/WR/TE. Kept when both best
    lineups gain over the rest of the season. The best get the trade tab's full evaluation (range, odds).
  - **On the owner's 10-team keeper league:** 6 ideas in about 1 second on a desktop.
  - **Limit:** lineup math only; market values are shown beside each idea as a check on how the other manager may see it.

- **Team grades — built (2026-10-16):** asked for by the owner; details in [team-grades.md](team-grades.md).
  - **Parts:** this week's best lineup, the best lineup's points per week over the rest of the season, what the bench adds, and playoff
    (or title) odds. Each team is graded S–F on each part by its z-score within the league.
  - **Overall:** the parts weighted 45/25/15/15 `[design]`. Starters, weekly projections and rankings share one source, so they aren't
    added up separately.
  - **On the owner's leagues:** keeper league A (1st of 10), redraft C (4th of 12); the dynasty league is pre-draft, so it gets no grades.

- **Season so far and weeks ahead — built (2026-10-16):** item 1 of the owner's assistance list (see the roadmap, Phase 2); details in
  [season-review.md](season-review.md).
  - **Weeks ahead** (replaces "Your schedule"): each week to the end of the season, playoffs included. It shows the matchup, regular
    starters on bye or not projected, open slots, who's back, and in weeks with a hole, the free agent who adds most that week.
  - **Season so far:** the record, all-play and schedule luck, points against, and each week's best lineup in hindsight. Your
    lineups' share of it is compared with the league's.
  - **Players:** your players against their projections, flagged beyond weekly swings.
  - **The app's pick:** the app now saves its lineup pick on the device until the main Sunday kickoff, so later weeks show it next to
    yours.
  - **On the owner's leagues:** luck +0.6 and −0.4 wins. Lineups at 89% and 88% of the best possible, against league averages of 89%.
    Bye holes show in weeks 7–11 and 8–13.

- **Handcuffs — built (2026-10-16):** item 2 of the owner's assistance list; details in [handcuffs.md](handcuffs.md).
  - **Measured on 2019–2025:** in games a starter sat, his backup gained 0.76 of the starter's points (QBs) or 0.40 (RBs).
    - Fitted on 2019–22, both shares predicted the backup's 2023–25 points better than his own average. QB error fell from 11.8 to 6.4;
      RB from 6.7 to 6.1, with the 95% interval below zero.
    - TE (0.28) and WR (0.12) shares didn't pass held out, so those backups aren't valued.
  - **Waivers tab:** each regular QB/RB starter's depth-chart No. 2, who has him, his projection in a week the starter misses, and
    his insurance value.
    - Insurance is the chance the starter misses each week times what the backup adds beyond your bench and the best free agent at the
      position.
    - The free-agent board tags backups whose starter is out now.
  - **On the owner's leagues:** RB handcuffs worth +0.4 to +11 over the rest of the season. QB handcuffs are worth about +0.3, since
    a free-agent QB fills in nearly as well.

- **Waiver claim plan — built (2026-10-16):** item 4 of the owner's assistance list; details in [claims.md](claims.md).
  - **What it shows:** up to three claims in order, each with its cheapest drop for the roster the claims above would leave, and a
    backup for the same drop that lands only if its claim fails.
  - **FAAB:** each bid comes from the budget left after the claims above. A backup never bids more than its claim.
  - **On the owner's leagues:** three claims each. Bids total $23 of $25 and $9 of $22.

- **Before lock — built (2026-10-16):** item 8 of the owner's assistance list, as the in-app check (the owner's call); details in
  [before-lock.md](before-lock.md).
  - **Lineup tab:** the lineup set in Sleeper, kickoff by kickoff. Changes due before each lock; starters ruled out with nobody to
    fill in; and Questionable starters, with when inactives come out (90 minutes before kickoff) and the fill-in whose game is
    still open then, including one-move fill-ins through a flex spot.
  - **Home:** one line per league with the next lock and what's due before it.
  - **Push alerts** still need a server (the Cloudflare scheduler).

- **Draft helper, redraft and keeper — built (2026-10-17):** the owner's request, started now for the 2027 drafts; details in
  [draft.md](draft.md).
  - **Next season's projections,** in-house, published daily as `data/nextseason.json`:
    - each player's production a game this season and the two before, pulled toward his position's mean;
    - adjusted for age and contract status (OverTheCap via nflverse, fifth-year options included);
    - expected games from age, games missed this season, tier and contract.
  - **Held out on 2015–2025:** it ranks next season better than "same as this year" (Spearman 0.24–0.48 against 0.05–0.33), but
    a draftable player's season misses by 56–96 points on average. Contract status barely helps per game; it matters more for
    games.
  - **Rookies** of the next NFL draft are placeholders by the order their position is taken, named once nflverse lists the class.
  - **Draft tab:**
    - the board by value over replacement under league scoring;
    - predicted keepers, with the manager's cost rule;
    - a random, Sleeper or hand-set order, and which slot is best;
    - a mock draft against teams drafting from the board with noise.
  - **Mock draft grades (2026-10-17):** the owner's request. A finished mock grades every team S–F against the others on lineup
    value, in Team grades' bands. With keepers, the draft is graded on what the picks added, since a roster's grade is then mostly
    its keepers'. It also grades your lineup position by position, with your best value and biggest reach against the board.
    Following the suggestions ranked first or second in 204 of 208 mocks on the owner's leagues: the grade measures a draft
    against teams drafting from the board with noise, not against real managers.
  - **Live draft and Sleeper's draft data (2026-10-17):**
    - the tab follows Sleeper's draft pick by pick once it starts, with look-ahead suggestions for your next pick;
    - traded picks are applied to the pick order;
    - the order is read from `draft_order` (Sleeper left `slot_to_roster_id` empty);
    - on the owner's keeper league, keepers stayed off the 2026 draft board, so they cost nothing beyond the roster spot (the
      default rule).
  - **Not yet:** ADP, dynasty drafts.

- **Trades without free-agent fills (2026-10-16):** the owner's call. A spot a trade opens isn't filled from free agency in any
  trade evaluation (builder, trade ideas, packages), since that pickup is open without the trade too.

- **Ask the analyst — built (2026-10-16):** item 10 of the owner's assistance list, brought forward with bring-your-own-key; details
  in [analyst.md](analyst.md).
  - **League page, Ask tab:** plain-language questions, answered by Claude (Opus 5.5) from a fact sheet of the app's own figures.
  - **Numbers come from the app:** the model quotes facts by id and the app puts in the values. Numbers it types itself are checked
    against the facts and marked when they match none.
  - **The manager's own Anthropic key,** kept on the device, with calls straight from the browser. Each answer shows its cost;
    follow-ups reuse the cached fact sheet.
  - **Not yet run against the real API:** no key in this environment.

- **Across your leagues — built (2026-10-16):** item 7 of the owner's assistance list; details in
  [across-leagues.md](across-leagues.md).
  - **Home card**, with two or more in-season leagues:
    - players in the app's recommended lineup in more than one league;
    - NFL games holding three or more of your starter spots;
    - on request, free agents in the top 10 of two or more leagues' waiver boards, with each league's gain and bid.
  - **On the owner's leagues:** 2 players start in both, 1 game holds 3 of 19 spots. 4 free agents are top targets in both, one
    worth twice as much in one league.

- **What would it take — built (2026-10-16):** item 6 of the owner's assistance list; details in
  [trade-finder.md](trade-finder.md#what-would-it-take-one-player).
  - **What it does:** for a player on another team, packages of one or two of yours that help both best lineups, best for you
    first, with market values. Packages they'd see as lopsided go last. When none helps both, it shows the cheapest their lineup gains
    from, and it says whether he'd start for you.
  - **Free agents:** a two-for-one's open spot isn't filled from free agency. You could make that pickup anyway, and counting it
    made a backup QB look like +32. On the owner's call, trade ideas and the builder stopped counting fills too.
  - **On the owner's leagues:** for rivals' top three players, packages that help both exist for 2 of 27 and 3 of 33. For the rest,
    the cheapest their lineup gains from costs a median 11 points of the owner's.

- **Buy low / sell high — built, display only (2026-10-16):** item 5 of the owner's assistance list; details in [luck.md](luck.md).
  - **Backtest, 2022–2025:** a player's luck is his points a game over his last four games above what his usage was worth
    (ffopportunity). It didn't predict how players did against RotoWire's projection, this week or over the next four.
    - Every slope's interval includes zero.
    - Held out on 2024–25, adjusting the projection for luck changed MAE by +0.002 (−0.002 to +0.005). QBs got slightly worse.
    - Usage does predict the next four weeks better than recent points (correlation 0.564 against 0.529), but the projection beats both
      (0.687). It already prices streaks in.
  - **So no values change.** The usage file now carries each player's PPR points against what his usage was worth, and touchdowns
    against expected, over 3+ recent games.
    - Player details say "running hot" or "running cold" at a gap of 3+ a game.
    - A Trade-tab card lists your players running hot (sell high) and other teams' players running cold who'd start for you (buy low).
  - **On the owner's leagues:** 31 and 34 rostered players have a streak. The card shows 2 and 1 to sell, 5 and 10 to buy (four shown).

- **IR stash finder — built (2026-10-16):** item 3 of the owner's assistance list; details in [ir-stash.md](ir-stash.md).
  - **What it shows:** with an open IR slot, injured free agents the league allows on IR whom Sleeper projects back. Each comes with
    his return week, points a game once back, and his weighted rest-of-season gain (no drop while on IR), with the playoff part split
    out.
  - **On the owner's leagues:** 23 and 33 candidates. The best adds +21 and +26 over the rest of the season.

- **Phone layout — fixed (2026-10-16):** the standings table pushed the page sideways on a 412px phone. Grid columns now can't grow past
  the screen, tables are tighter on phones, and points for sits under W-L. An e2e test checks 412px and 360px.

- **P(play) v1 for Questionable players — built (2026-10-16):** the Phase 3 P(play) v1, brought forward; details in
  [calibration.md](calibration.md).
  - **Model:** a logistic regression on the final practice, whether he missed his last game, the injury (9 groups) and position.
    - Fitted on 1,326 relevant Questionable player-games, 2019–2025.
    - 2016–18 game-day statuses are unusable (99% active).
  - **Gate passed:** out-of-sample Brier score 0.1813 → 0.1677 with each season held out (−0.0136, interval −0.0201 to −0.0071). Fitted
    on 2019–22, scored on 2023–25: −0.0142 (−0.0241 to −0.0047).
    - Before the final report, a fit without practice: −0.0071 (−0.0114 to −0.0029).
  - **Largest effects:** missing the last game (Limited: 62% vs 81% active), hamstrings and concussions down, back injuries and illness up,
    QBs down.
  - **Pipeline:** `players.json` flags players who weren't active in their team's last game (`ml`, from nflverse weekly rosters).
  - **Shown:** player details name the factors. The ledger commits the new numbers from the next archive run.
  - **Not yet:** mid-week P(play) from the archive's snapshots, once a few weeks of final reports are in.

- **Playoffs from Sleeper's bracket — built (2026-10-16):** for the Phase 2 exit (running the fantasy playoffs on the app); details in
  [title-odds.md](title-odds.md).
  - **The gap:** once the regular season ended, the app stopped simulating. Every team, in the playoffs or out, kept the share of teams
    that make the playoffs as its weight for the playoff weeks, and no title odds showed.
  - **Now:** the odds play out Sleeper's `winners_bracket` from the games already decided.
    - Open games use final points for weeks already played, this week's lineups with points so far, then projected lineups with drift.
    - A team still alive counts each remaining round in full (a first-round bye week not at all); a team that's out counts nothing.
  - **Shown:** a Playoffs card in the Season tab (this round's games, chance to win them, title odds, who's out); trades show title odds.
  - **Checked:** the parser on the owner's two real 6-team brackets (pre-filled, week 6); unit tests for decided, live and two-week rounds;
    an end-to-end test of a final under way.
  - **Checked on a finished season (2026-10-16):** the owner's 2025 league, replayed from the start of each playoff week with later
    results hidden (`scripts/check/bracket-replay.ts`). Every check passed:
    - Sleeper's recorded winners had the higher score in all 7 games.
    - The app's seeding matched the bracket.
    - At every week the app had the right teams alive and the decided rounds at their final points.
    - The weights covered only teams still alive, and the champion was at 100% after the final.
  - **Unverified:** how soon Sleeper records each round's winners after the games (points from weeks already played cover it), the tie
    rule, two-week rounds and re-seeding in real data.

- **Archive and ledger hardening — built (2026-10-16):**
  - **Daily archive jobs survive late runs.** On Oct 16 GitHub started the 12:17 UTC run at 13:16 and skipped the 08:17 one.
    - The day's all-weeks projections and players dump were tied to the 12:xx hour, so they were missed. Only a manual run saved them.
    - Each daily job now runs in the first snapshot at or after its hour. Public no-data markers in the release track what's done
      ([scripts/archive/README.md](../scripts/archive/README.md)).
    - If the markers can't be read, the old hour rule applies.
  - **The props "already fetched" list** pages through release assets too. Whether GitHub's release object truncates its asset list is
    unverified; paging removes the question.
  - **Ledger key check:** the job derives the secret's public key and compares it with `recipient.txt`. A wrong key now fails at once,
    not when a week comes due.

- **Daily data build: a fallback, and a note when it's stale — built (2026-10-16):**
  - **The gap:** GitHub never ran the deploy's 16:07 UTC schedule, its first since the cron lines were re-authored. The same day it
    skipped the archive's 08:17 and 16:17 runs.
    - The deploy rebuilds the app's data files: practice reports, the official injury report, last-game flags, usage, lines.
    - Nothing in the app showed their age.
  - **Fallback:** from 16:00 UTC, each archive run on `main` starts the day's deploy if none has started since 16:00
    ([scripts/archive/README.md](../scripts/archive/README.md)). After a failure it retries once.
  - **Note:** when `players.json` is more than 36 hours old, the league page says the daily update is overdue and chances to play may
    be off. Injury tags themselves come live from Sleeper's projection rows.
  - **Still exposed:** both depend on GitHub's scheduler. If it skips every archive run after 16:00 as well, the day is missed, and the
    note shows it. A second deploy time in the cron lines, edited from the owner's account, would add cover that doesn't depend on the
    archive.
  - **First weekend:** this session also checks Saturday's deploy and Sunday's archive and deploy slots, and starts any run GitHub
    skipped.

- **Realization of rest-of-season values — measured (2026-10-16), open:** details in [ros-uncertainty.md](ros-uncertainty.md).
  - **Measured on a flat proxy** (this week's projection for every later week, times availability), 2022–25:
    - from next week on, values came true at 0.89 of expected (QB 0.84, RB 0.93, WR 0.88, TE 0.94);
    - this week's came true at about 1.0.
  - **Unknown for the app's own values:** the app uses Sleeper's future-week projections. In the one full 2026 snapshot they average 0.97
    of next week's, with players ranging from 0.87 to 1.09. So the app's lean is probably smaller, and the ranges and drift, also sized on
    the proxy, need a recheck.
  - **No correction yet.** The archive's daily all-weeks snapshots will measure it on the app's real values.

- **Ranges on a trade's points — built (2026-10-16):** details in [ros-uncertainty.md](ros-uncertainty.md).
  - **Measured on 14,623 player-anchors (2022–25):** the app's weekly variance alone held only 39–69% of rest-of-season totals in 80%
    ranges. A season-long miss of 0.41 of each player's expected points brings it to 80.8% (77–85% by position and horizon, about 80% on
    both season halves). A fixed offset fits better than a random walk at the player level.
  - **App:** each trade side shows the 80% range of its change and the chance it adds points. Example: two similar starters swapped for
    +8.5 can land anywhere from −55 to +72, 57% to help.
  - **Team level stays a random walk:** a fixed offset predicted standings worse in the season backtest.

- **Persistent projection error in the season odds — built (2026-10-16):** the Full trade analyzer's "ranges" groundwork, brought forward;
  details in [ros-uncertainty.md](ros-uncertainty.md).
  - **Measured, 2022–25:** against the rate projected at week w, the next 8–12 weeks' average misses by an SD of 4.5–5.4 points per game.
    Independent weekly noise alone would give about 2.3. The error drifts (it grows with time) rather than staying fixed.
  - **Backtest** (synthetic 10-team leagues drafted by ADP from real seasons, scored with the app's own simulation):
    - The old odds were too sure: teams given 1% made the top 4 6% of the time, teams given 88% made it 78%.
    - A drift of 0.3 of each starter's rate per week cut log loss from 0.520 to 0.484 (Brier 0.167 → 0.161). It held on both season
      halves, and with waiver pickups in the leagues.
  - **App:** every team now drifts in the season simulation (playoff, bye, 1st-place and title odds, trades). Rest-of-season point values
    don't change.

- **Ledger scoring automated, and shown on About — built (2026-10-16):** details in [ledger.md](ledger.md).
  - **Job:** the archive workflow's `ledger` job scores each finished week once, two days after its last game, and publishes the aggregates
    to the `ledger` release. The site copies them as `data/ledger.json`. It skips until the `ARCHIVE_AGE_KEY` secret exists.
  - **About page:** a card with chance to play by tag, points-if-active error and sample sizes, once 3 weeks are scored.
  - **Dry run on the real archive:** week 6 so far (Thursday's game) scored 29 player-games: 6 tagged players, all Out and all inactive;
    12 points-if-active predictions with an average miss of 4.6.
  - **Fixed on the way:** `fetch.sh` now pages through release assets, since a monthly archive release will hold several hundred.

- **Title odds — built (2026-10-16):** part of the Phase 3 full trade analyzer, brought forward; details in [title-odds.md](title-odds.md).
  - **Bracket:** each simulated season plays on through the winners' bracket.
    - Top seeds get byes. Each round goes to the higher score from that week's projected lineups; two-week rounds add both weeks.
    - Sleeper's fixed pairing (seed 1 meets the 4/5 winner) matched a real league's pre-filled bracket.
    - Re-seeding follows `playoff_seed_type` `[unverified]`.
  - **Shown:** a Title column in the Season tab, and both trade sides' title odds before and after.
  - **Playoff-week weights:** each playoff week counts by the playoff odds; a first-round week counts by the chance of playing it (playoff
    odds minus bye odds).
    - The first version weighted each round by the chance of reaching it. It was dropped.
    - Simulated title-odds gains from extra points are as large in the final as in round 2, and smaller in round 1.
  - **Noise:** at 4,000 simulations, a trade-sized change in title odds varies by about ±0.4 points. A change of a point or less can be
    noise.
  - **Since added (same day):**
    - uncertainty in team strength ([ros-uncertainty.md](ros-uncertainty.md));
    - odds once the playoffs start, from Sleeper's own bracket (below).

- **Injury absences by type — built (2026-10-16):** the rest of the Phase 3 injury-context item; details in [injuries.md](injuries.md).
  - **Data:** 1,538 QB/RB/WR/TE absences in 2019–2025, with Kaplan–Meier shares because absences running at a season's end are censored.
  - **Results:**
    - knee: 28% lasted one game, 46% two or fewer, 13% of those starting by week 10 lasted the season;
    - hamstring: 35% / 61% / 6%;
    - concussion: 50% / 70% / 6%;
    - all injuries: 37% / 57% / 9%.
  - **Shown:** in player details for Out, Doubtful and IR players, as labelled history. It doesn't change projections.
  - **Found on the way:** players Out at their first missed game were back for the next one 28% of the time. Rest-of-season values give
    an Out player 80% in the weeks Sleeper projects him. How often the projected ones actually play needs the archive's records: P(play) v1.

- **Player props (The Odds API) — pull built (2026-10-16), in shadow:** roadmap Phase 2 item 6; details in [props.md](props.md).
  - **Pull:** inside the archive runs, each game once in the first run within 6 hours of kickoff. Six markets, about 6 credits a game, within
    the free plan. Raw odds stay in the encrypted snapshot; only game ids and credits are published.
  - **Conversion:** no-vig chances. Lines become means through outcome shapes measured on 2022–25 projections against results. Yardage is
    right-skewed, so a WR's 45.5-yard line at even money means about 51 yards. Touchdowns are Poisson.
  - **Shadow:** each prediction made with props carries `pr`, scored against the app's number from the same snapshot, plus a 50/50 blend.
    The blend gate (§6) decides after several weeks.

- **Future-week availability (injury hazard) — built (2026-10-16):** the Phase 3 hazard backtest, brought forward; details in
  [hazard.md](hazard.md).
  - **Before:** rest-of-season values used flat guesses in every future week (QB 95%, RB 91%, WR and TE 93%).
  - **Data (2019–2025 game-day rosters):** a healthy QB/RB/WR/TE is active 94% of the time a week later, 85% eight weeks later and 76–80%
    thirteen to fifteen weeks later.
  - **Held out (2023–25):** the old constants expected 7% too many active player-weeks. The curve was within 1% and cut log loss from 0.409
    to 0.364.
  - **Left out:** separate position curves and age bands scored no better out of sample.
  - **Questionable players:** about 82% in later weeks.
  - **No double counting:** RotoWire's future weeks carry no injury discount; a healthy player's projection is flat across the season.
  - **On the owner's leagues:**
    - best-lineup points per future week fell 2–4.5%;
    - playoff odds moved by 3 points or less;
    - depth is worth more: one team's gain from adding a free-agent TE rose 15–50%.

  **Not yet:**
  - usage adjustments to projections — only if a backtest shows they beat RotoWire alone (matchup adjustments were tested and don't:
    [matchups-gate.md](matchups-gate.md));
  - a correction for the lean in rest-of-season values, once the archive's own future-week projections can measure it
    ([ros-uncertainty.md](ros-uncertainty.md));
  - scheme matchups (coverage shells, man/zone): FTN charting has them (CC-BY-SA), not yet joined;
  - the first scored week. The scorer (`scripts/ledger/score.ts`, below) is built. Week 6 can be scored once its games are in nflverse.
    Thursday's game alone is enough for a first check;
  - keeper-league picks: Sleeper lets them be traded, but FantasyCalc's rookie-pick prices don't fit a keeper draft;
  - draft order from playoff results or a league-set order (picks follow reverse regular-season standings);
  - keeper costs: draft-round prices aren't in Sleeper's API;
  - mid-week P(play) (practice before the final report, Sleeper's pre-report tags), from the archive's twice-daily snapshots once a few weeks are final;
  - position-specific P(play): done in the v1 model (2026-10-16), where position earned its place out of sample over 2019–2025.

v2 incorporates an adversarial review of v1 by four independent critics: evidence consistency, solo-dev feasibility, completeness, and football methodology.

**Evidence labels**

| Label | Meaning |
|---|---|
| `[verified]` | Checked on 2026-10-15 against a primary source: live nflverse files, vendor docs repos, SDK source |
| `[own calc]` | Computation on downloaded nflverse data. Research-time numbers are small samples whose scripts aren't in the repo; re-run them before relying on them. Numbers that cite a script in `scripts/` (e.g. [calibration.md](calibration.md)) are reproducible |
| `[reported]` | Credible secondary source (maintained third-party code, captured vendor pages, published analysis); not independently confirmed |
| `[unverified]` | Training knowledge or a single weak or unopened source. Check before depending on it |
| `[design]` | My design choice or estimate, not a fact |

Research notes with sources and fact-check verdicts: [`docs/research/`](research/).

---

## 0. Where the original vision needs to change (read first)

**1. "Expert consensus from all locations" is not legally available to a public app.**
- **FantasyPros ECR**, the real expert consensus (built from an accuracy-filtered expert pool), needs a **Commercial** licence for any app that shows it to other people, free apps included. Its terms also bar products that "directly compete" with FantasyPros, and start/sit, trade and waiver tools do. `[reported]`
- **KeepTradeCut** forbids scraping and reproducing its values. `[reported]`
- **Paywalled sites** (PFF, 4for4, Footballguys, FantasyPoints, ETR) give no redistribution rights. `[unverified]`
- **Scraping** breaks those sites' terms and also Google Play's Device & Network Abuse policy. `[reported]`

What we build instead is a **calculated consensus**: an average of independent *stat-level* projections we may legally use, rescored to your league's exact scoring.
- Blending projections generally beats single sources `[unverified: FFA 2016 analysis, not re-read]`.
- Equal weights are hard to beat when sources are similarly accurate `[reported]`.
- Caveat: at launch we have **one** external source, Sleeper's (RotoWire). A second, in-house source joins only after it passes a backtest gate (§2), so early on the app is "rescored single source" and says so.
- Licensed ECR stays a later option. FantasyPros Commercial is priced by quote. Fantasy Nerds is ~$400/yr for personal use `[unverified]`; showing it to others needs written permission at an unknown price.

**2. CB matchups and "injury risk" are weak edges, and most of the free data for them doesn't exist in-season.**
- **Coverage data is published after the season.** nflverse's man/zone and coverage-shell data (FTN) arrives only after the Super Bowl; the 2025 data landed on 2026-02-10. `[verified]`
- **WR-vs-CB alignment and shadow data is paid.** Sources are PFF, FantasyPoints, SIS and TruMedia, all without redistribution rights. `[reported]`
- **Shadow coverage barely moves results.** The cited figure is ~+0.24 pts vs expectation (PFF, 2019) `[unverified]`, and we found no study showing man/zone splits predict performance `[unverified]`.
- **What does work:** *CB depletion* (a starting corner out, backup playing) is a plausible free signal we can test. Population **injury base rates** by position and age are estimable, and the trade and ROS math needs them. **Availability probability** is estimable and valuable: in 2026 Weeks 1–5, Questionable players were active 181 of 259 times (70%) and Doubtful players 0 of 24 `[own calc: exact gsis join on weekly rosters]`.
- **Not supportable:** a player-specific "injury-prone" score `[reported]`.

→ Matchups will lead with Vegas implied totals. CB and scheme signals become a labelled, capped "estimate" layer that is backtested before it affects recommendations.

**3. Monetizing conflicts with Sleeper's terms, and with GitHub Pages.**
- **Sleeper:** the API is free for **non-commercial** use. Its general Terms bar third-party commercial products that display Sleeper data without written consent `[reported]`.
- **Other inputs:** RotoWire (the actual source of Sleeper's projections) grants us nothing at all. FantasyCalc and Open-Meteo are non-commercial `[reported]`.
- **GitHub Pages:** its terms forbid using it mainly for commercial SaaS `[verified]`.

→ Ship **free and non-commercial for 2026**; ask about licences only if you decide to monetize.

**4. "Most efficient analyst" has to be measured, not claimed.**
- FantasyPros already offers a free "Gameday Win %" and an LLM assistant ("Coach AI", in its top HOF tier) `[reported]`, so neither "win %" nor "AI analyst" is a differentiator on its own.
- What we can prove is an **accuracy ledger**: timestamped snapshots of every input and recommendation, scored after games.
- That needs an archive starting **this week**, unless spike (e) shows Sleeper serves past weeks' projections.

**5. Timing and capacity.**
- It's Week 6. Fantasy playoffs usually run Weeks 15–17, and trade deadlines come from each league's `settings.trade_deadline`.
- At 10–20 hours a week, the v1 scope was 2–3× too big `[design estimate]`. v2 cuts the season to:
  - a client-side lineup and waiver MVP by **~Week 8–9**
  - a stripped trade analyzer and playoff mode before the playoffs
- Everything else moves to the offseason for a 2027 launch.

---

## 1. Product definition

**One-liner:** A Sleeper-first, league-specific decision engine. It rescores every usable projection to *your* league's rules and optimizes *your* lineup against *your* actual opponent, then shows exactly where each number came from.

**What we can credibly own:**
1. **Exact rescoring** of stat-level projections to any `scoring_settings`, including TE premium, superflex, first downs, bonuses and IDP. Bonuses are computed from per-stat distributions, not means.
2. **Inactive-aware start/sit.**
   - A Questionable starter is valued *with* the option to swap him out once inactives post (≈90 min before kickoff).
   - Players whose games have kicked off are locked, and their actual points are used.
3. **League-aware value.** Replacement level comes from *your league's* free agents: the weekly best for positions you stream (K, DST, often TE/QB), the best rest-of-season otherwise. Trades include the roster spot freed or the forced drop.
4. **Honest reasoning.** We show the source blend as sources and decompose only our own model into factors, with a timestamped accuracy ledger behind it.

**Primary user:** Sleeper players in custom-scoring redraft leagues first. Dynasty and keeper leagues get "2026 impact" and "long-term market value" shown side by side with no combined verdict until dynasty mode lands (Phase 3).

**Format handling, decided now:**
- **Supported:** H2H redraft, keeper and dynasty, superflex, TE premium, IDP (single source, labelled), median-game leagues.
- **Best ball:** waivers and trades only, valued by Δ E[max lineup], since there are no lineup decisions.
- **Unknown league types:** read-only with a banner.

**Non-goals for 2026:**
- DFS or betting features, and sportsbook links
- scraping expert sites
- "injury-prone" scores or shadow-coverage claims
- accounts
- an iOS App Store wrapper (iOS is PWA-only; see §4)

---

## 2. Feature methodology

| Feature | Method | Evidence / caveats | Phase |
|---|---|---|---|
| **Projection blend** | Average **per stat**, using only the sources that project that stat. Each source declares an **availability convention** (conditional-on-playing / already discounted / unknown). Everything is converted to conditional-on-playing before blending, and **P(play) is applied exactly once**. A missing projection counts only as P(play) evidence, never as a 0. Every number shows its source count; with <2 sources it's labelled "single source". | Mixing conventions would discount Questionable players twice (~15% low) `[design]`. Phase 0 spike checks RotoWire's convention. | MVP (Sleeper only) |
| **In-house baseline** | **v0 (shadow):** shrunk trailing mean of ffopportunity expected-stat components (`*_exp`) × (this week's implied team total ÷ the team's season-average implied total). **v1:** a team model fitted on 2018–25: plays = f(pace, spread); pass rate = neutral PROE + f(spread); TDs split between pass and rush and given to players by xTD share, inside-10 carries, end-zone targets and QB sneaks (FTN `is_qb_sneak`). Player shares come from the **current configuration** (same starting QB and key teammates active, backing off to all games), with **vacated-share redistribution rates fitted** from with/without splits and recency weighting chosen by backtest. A QB change is detected from `games.csv` QB IDs. Shares reset after role breaks and NFL trades. | Trailing xFP beat trailing actual points: MAE 5.6–6.4 vs 6.4–6.9, 2026 Weeks 3–5, PPR `[own calc]`. 8 of 32 teams have started more than one QB in 2026 `[own calc]`. **Blend gate:** joins the blend only when its walk-forward MAE is within ~5–10% of RotoWire's for that position (backtest on 2023–25 plus live shadow weeks) **and** a blend with weights fit on earlier seasons lowers MAE out of sample. Before that it is a labelled second opinion and the fallback if Sleeper projections go dark. **v0 result** ([baseline.md](baseline.md)) `[own calc]`: MAE 1.05/1.03/1.01× RotoWire's for RB/WR/TE, QB 1.21× (2024 – 2026 wk 5); blending changes MAE +0.1% to −1.1% by season, so no blend. | v0 shadow: Phase 2 · v1: Phase 3 |
| **Distributions** | **Per-stat marginals** (yards, receptions, TDs) with a position- and mean-dependent CV fitted on nflverse; long-TD rates from pbp. **v2:** a shared bank of joint stat-residual vectors per position/tier, so the device draws, applies league scoring, and gets mean, quantiles and bonus expectations in one pass. Same-game correlation via a team-game factor. | Point-level σ can't price yardage bonuses and differs by scoring format `[design]`. CV depends on the mean `[own calc]`. | MVP (simple parametric) → Phase 3 (bank) |
| **P(play)** | **v0:** table of designation × final practice status. The **final report is keyed to each game's day** (Wednesday, Friday or Saturday games exist in 2026 Weeks 12, 15 and 16) `[verified]`. Explicit states: IR/PUP/suspended (0 until activated), activated or elevated (≈1, role uncertain), rest days (own category). Collapses to 0 or 1 once inactives post. **v1:** logistic model trained on weekly-roster ACT/INA labels joined exactly by gsis_id. **v1 built 2026-10-16 for Questionable players** (practice, missed last game, injury, position; [calibration.md](calibration.md)). | Calibrated on 2023–2025, fantasy-relevant players ([calibration.md](calibration.md)) `[own calc]`: Questionable 92/71/56% active after a full/limited/missed final practice, 72% overall; Doubtful 1 of 69. Practice sets the odds only from the final report. Whether and how fast Sleeper's `injury_status` reflects game-day inactives is unknown `[unverified]`; spike (j). | v0 MVP · v1 Phase 3 |
| **Start/sit optimizer** | Two-stage expected points. For each candidate lineup, enumerate the inactive scenarios for Q/D starters (2^k, k usually ≤4). In each scenario, re-optimize only the slots whose replacements kick off after that player's inactive reveal (kickoff − 90 min). FLEX/SUPER_FLEX placement falls out of this rather than a rule. **Locks:** a player whose game has started stays put and his actual points replace his distribution. An "I won't check inactives" toggle falls back to P·μ. | Example: P=0.7, μ_Q=15, bench μ=10. The swap option values starting him at 13.5 vs 10, where P·μ gives 10.5 vs 10 `[design]`. A pure variance swap is worth only ~0.2–0.7 pp of win probability (SD 5→9), up to ~1.5 pp (SD 4→12, 30-point underdog), ignoring correlation `[own calc]`. So expected points drives the decision, and P(win) is a tiebreaker. | MVP |
| **Win probability / playoff mode** | Analytic normal approximation vs. the actual opposing lineup (median game counted as a second result). **Playoff mode** maximizes P(win) for the round, summed across multi-week rounds. | Monte Carlo needs common random numbers: 10k draws ≈ 0.5 pp standard error `[verified: arithmetic]` | Display: Phase 1 stretch · playoff mode: Phase 2 |
| **K / DST** | Rescored Sleeper projections (spike b confirms they exist). DST in-house v0 = f(opponent implied total, opponent sack and turnover rates, home/away); 2-week DST streaming view. K: Sleeper only. | DST points vs. opponent implied total r = −0.32 (n=544); kicker vs own implied total r = 0.13 (2025, approximate scoring) `[own calc]` | MVP (Sleeper) · DST v0: Phase 1 stretch |
| **Waiver board** | Gain in this week's (and next week's, if projected) optimal lineup, plus "ROS-lite" value. Opportunity-shock flag from Sleeper depth order + injury status. Trending adds as a *demand* signal (with Sleeper attribution). | ROS-lite: Sleeper future-week projections if they exist (spike f), bye-aware; otherwise per-game value × remaining non-bye games, labelled "flat ROS estimate" `[design]` | MVP stretch → Phase 2 |
| **FAAB** | Value-based max bid: dollars per unit of ROS value, calibrated from the league's own *winning* bids and scaled by remaining budget and weeks. Runner-up-bid model only if failed claims expose `waiver_bid`. | Losing-bid visibility unconfirmed `[unverified]`; spike (c). No cross-league prior (no league sample; §8). | Phase 2 |
| **Trade analyzer** | **Stripped (Phase 2):** your optimal-lineup points by remaining week (regular season + playoffs) with ROS-lite, a bye grid, roster spots filled or dropped on both sides, and FantasyCalc market value shown separately. **Full (Phase 3):** future implied totals from team ratings fitted to market lines (plus win totals as a prior); a weekly injury hazard by position × age (built as one curve by weeks ahead, since position and age didn't hold up: [hazard.md](hazard.md)); weeks weighted by leverage from the season sim; playoff and title odds; ranges, not points. **Title odds and bye-aware playoff-week weights built 2026-10-16** ([title-odds.md](title-odds.md)). **Persistent drift in the season odds, and ranges on a trade's points, built 2026-10-16** ([ros-uncertainty.md](ros-uncertainty.md)). | `games.csv` currently has lines only through Week 7 `[verified]`, which is why ROS needs the team-rating model | Stripped: Phase 2 · title odds: built · rest of Full: Phase 3 |
| **Matchup layer** | Vegas implied team total and spread are the primary environment signal (`home_itt = (total_line + spread_line)/2`; nflverse spread is positive when the **home** team is favored `[verified]`, unit-tested). **DvP:** the residual of position-level xFP allowed after conditioning on the opponent's implied total, used *only inside the in-house baseline*, never on the blend. Shrunk toward the league mean, with weight on last season equal to its measured year-over-year r. **CB depletion** flag (starting LCB/RCB/NB out, from injuries + depth chart). **Wind** only shifts the pass/rush split and K inside the baseline. Everything is display-only until a walk-forward backtest shows lift; DvP and CB depletion showed none on 2022–25 ([matchups-gate.md](matchups-gate.md)). | Defense-vs-position barely repeats (WR r≈0) `[reported]`. Vegas dominating feature importance comes from one unreviewed 2026 thesis `[unverified]`. Strong wind is already priced into game totals (residual +0.7 ± 2.0 pts at ≥20 mph, n=47) `[own calc]`. PFR per-CB stats are used only if their split-half reliability holds up `[design]`. | CB depletion + DvP display: Phase 2 stretch · rest: Phase 3 backtest |
| **Injury context** | Population base rates: weekly hazard of a new missed-game injury by position × age, early-exit rates, games-missed distributions by injury type, all shown as labelled ranges. They feed the ROS availability multiplier. | Individual proneness isn't estimable `[reported]`. The cited hamstring recurrence rate (38%) conflicts with the most-cited study (16.5%), so trace it before showing it `[unverified]`. **Future-week availability built 2026-10-16** ([hazard.md](hazard.md)) `[own calc]`: a healthy QB/RB/WR/TE is active 94% a week later and 85% eight weeks later. One curve by weeks ahead; position and age didn't hold up on held-out seasons. **Games missed by injury built 2026-10-16** ([injuries.md](injuries.md)): shown in player details. | ROS availability, games missed: built (Phase 2) · early exits: Phase 3 |
| **Explanations** | Show the blend as sources (RotoWire X, in-house Y → Z), then rescoring and P(play) applied visibly. Only the in-house component is broken into factors. An LLM, later, narrates this JSON only. | Breaking down RotoWire's black box would invent reasoning `[design]` | MVP |
| **Accuracy ledger** | Walk-forward scoring of archived inputs and our recommendations: MAE by position, Spearman, interval coverage, Brier for P(play) and win probability. Before each lock, a SHA-256 of our prediction file is committed publicly (commit-reveal) so timestamps can be checked. Public comparisons only against sources we're allowed to name. A FantasyPros benchmark stays private unless licensed. | `[design]` | Archive: Phase 0 · ledger: Phase 2 private → Phase 3 public |

---

## 3. Data sources

### Use

| Source | Used for | Access | Terms posture | Status |
|---|---|---|---|---|
| **Sleeper API** `api.sleeper.app/v1` (user, leagues, league, rosters, users, matchups, transactions, traded_picks, state, trending) | League import, opponents, waivers | **Browser-direct**, keyless, <1000 calls/min | Non-commercial; trending requires attribution `[reported]` | Endpoints `[reported]` (ffscrapr source, unmaintained since 2024-10; `/state/nfl` from training knowledge). CORS `ACAO: *` `[reported]`. **Spike (a1)** |
| **Sleeper `/players/nfl`** | Player DB, injury status, depth order, cross-IDs | Pipeline ≤1×/day, trimmed | Same | Size "~5 MB" `[unverified]`; measured in spike |
| **Sleeper projections** (undocumented): `api.sleeper.com/projections/nfl/{season}/{week}?season_type=regular&position[]=…` and `api.sleeper.app/v1/projections/nfl/{season_type}/{season}/{week}` | MVP projection source (rows carry `company: "rotowire"` `[reported]`), incl. K/DEF/IDP if present | **On the device** for users. The private pipeline also stores snapshots for backtesting `[design; licensing untested]` | RotoWire's data; never republished | Report that the v1 path went empty in 2026 `[unverified]`. CORS on `api.sleeper.com` unknown. **Spikes (a2), (b), (e), (f)** |
| **Sleeper stats** (undocumented) `api.sleeper.com/stats/nfl/{season}/{week}?season_type=regular` | Engine golden test; possible snap fallback; the Matchup tab's stat lines (display only, since 2026-10-18) | Pipeline / dev; **on the device** for stat lines | Same | Fields and team snap totals `[unverified]`; **spike (g)**. CORS `*`, CDN copy up to 5 min `[verified: spike (a)]`; updates during games `[unverified]` |
| **nflverse** releases: pbp, stats_player, injuries, depth_charts, ftn_charting, pfr_advstats, nextgen_stats, weekly rosters, snap_counts | Usage, environment, P(play) training, ID joins, backtests | Pipeline (release assets send no CORS headers `[verified]`) | Broadly CC-BY 4.0; FTN data CC-BY-SA 4.0 ("FTN Data via nflverse") `[verified]`. Underlying NFL, PFR and NGS data "belong to their respective owners" `[verified: nflreadr Terms]`, so we publish derived aggregates only | Updated 10-15; ftn_charting 10-14; snap_counts 10-13 (lags ~2 days) `[verified]` |
| **ffopportunity** (`ep_weekly`, stat-level `*_exp` incl. first downs) | Baseline, usage/regression | Pipeline | **CC-BY-SA 4.0** `[verified]`; published derivatives carry it (§4 rule 6) | 2026 Weeks 1–5 present; trained 2006–20, recalibrate `[verified]` |
| **nfldata `games.csv`** | Kickoff times (locks), lines → implied totals, QB IDs, rest/roof | Pipeline | **No licence file; line provenance unknown** `[verified]`. Publish derived implied totals only | Commits every ~10–30 min; lines only for near weeks `[verified]` |
| **Player IDs**: Sleeper cross-IDs + nflverse weekly rosters (`sleeper_id`, gsis, pfr, espn) | Public `players.json` | Pipeline | CC-BY / Sleeper terms | — |
| **DynastyProcess `db_playerids`** | `fantasypros_id`/`mfl_id` joins, **pipeline-only** | Pipeline | Repo is GPL-3.0 `[verified]`, so **nothing derived from it is published** `[design]` | Weekly; partial coverage `[verified]` |
| **The Odds API** v4 (player props) | Second independent stat-level source (props → conditional medians → means) | Pipeline, key in secrets | Terms (updated 2026-08-31) allow storing the data, showing it in an app and "calculating and displaying values you derive"; no redistribution "as a standalone data product", downloadable files included, so publish derived means only (no lines, prices or books, nothing raw in logs or artifacts); attribution not required `[reported: third-party captures of the terms page, 2026]` | Free 500 credits/mo incl. props; an event-odds call costs markets × regions, so 16 games × 6 markets ≈ 96 a week (≤ 480 in a five-Sunday month: fits, with nothing to spare); $30 for 20K. Historical props from 2023-05-03, paid plans only, 10× the cost: ≈ 49K credits for 2023–25, one $59 month `[reported: copies of the official pages, 2026; the live site wasn't reachable]`. **Pull built 2026-10-16**, in shadow ([props.md](props.md)): once per game before kickoff, ~6 credits a game |
| **FantasyCalc** | Trade "market value", dynasty | Pipeline ≤ hourly | Non-commercial with attribution and link `[reported]` | Phase 2 |
| **NWS** api.weather.gov | Wind/precip for pass/rush split and K | Pipeline | Public domain `[unverified]` | Phase 3 |
| **FantasyPros ECR via DynastyProcess** (`fp_latest_weekly.csv`) | **Private benchmark only** | Private pipeline | FantasyPros' scraped data; never shown publicly unless licensed | PPR-only for RB/WR/TE `[verified]` |

### Later or optional
- **ESPN:** projections and league import. Public leagues may work from the browser `[reported]`. Private leagues need a cookie pass-through, and Disney's ToS plus Play's Device & Network Abuse policy make that a review risk. ESPN stays **out of the Play build** until reviewed.
- **Yahoo:** reportedly approval-gated since 2026-07-22 `[unverified]`.
- **MFL:** later, through the Worker.
- **Licensed feeds** (FantasyPros Commercial, Fantasy Nerds, RotoWire): only if you monetize.

### Not using
KeepTradeCut, scraped expert sites, PFF/SumerSports/StatRankings pages, X API, Underdog/DFS data, sportsbook links.

**Calendar facts the design must handle** `[verified: games.csv]`:
- **Unusual game days:** Wednesday–Friday games in Week 12; Saturday games in Week 15; Christmas Friday games in Week 16 (fantasy playoffs); 9:30 ET international games in Weeks 6, 7, 9 and 10.
- **Season start:** 2026 opened on a Wednesday, so week and season come from `games.csv`, never from date heuristics.
- **Injury data:** nflverse injuries update once a day (~07:07 UTC) as **one row per player-week**, so the daily trend has to be snapshotted.
- **Stat corrections:** they land Monday–Wednesday.

---

## 4. Architecture — "client-first MVP, static pipeline, thin edge later"

```
 PRIVATE repo (ff-archive)                         PUBLIC repo (this one)
 ┌───────────────────────────────┐   ┌──────────────────────────────────────────────────────────┐
 │ curl + jq + gzip workflows     │   │ GitHub Actions (Node 22; Python from Phase 2)             │
 │ every 4h Tue–Mon + game-lock   │   │  players.json (Sleeper DB trimmed + nflverse IDs)          │
 │ slots from games.csv; Sleeper  │   │  schedule.json (kickoffs → locks, implied totals, QB IDs)  │
 │ projections/players/trending,  │   │  later: usage, env, baseline, DST v0 shards (stat-level)   │
 │ nflverse injuries (daily)      │   │  → content-hashed shards + manifest.json → GitHub Pages    │
 │ → weekly release assets        │   └──────────────────────────────────────────────────────────┘
 └───────────────────────────────┘                          │
                                                            ▼
   Browser / installed PWA (later TWA)
   Vite + TypeScript + Preact · vite-plugin-pwa · IndexedDB (idb) · Comlink Web Worker
   • Sleeper import + Sleeper projections fetched on-device   • ONE scoring engine (TS) — also run by the pipeline in Node
   • two-stage optimizer, locks, win prob in a Worker         • source-level explanations, data-as-of badges
                                                            │ (Phase 3)
                                                            ▼
   Cloudflare Worker: Cron Trigger (reliable game-day scheduler) · /llm proxy · /espn pass-through (if ever) · push (if chosen)
```

### Engineering rules (decided up front)

1. **Stat-level everywhere.** The pipeline publishes per-stat means, multipliers and residual banks, never fantasy points (scoring only exists on the device). The single exception is one declared reference scoring for the public ledger.
2. **One scoring engine** in TypeScript, shared by the app and pipeline via a Node CLI. Python (from Phase 2) only produces stat lines and features.
3. **Projection contract:** `{source, stat_line, availability_convention, fetched_at, as_of_week}`. P(play) is applied once, and per-stat averaging only uses the sources that project that stat.
4. **Locks and refresh timing come from `games.csv` kickoffs**, not fixed Sunday crons.
5. **`LeagueRules`** captures what changes decisions: median game, playoffs `{startWeek, teams, roundLength}`, trade deadline, roster `{max, IR slots + eligible statuses, taxi}`, best ball, waiver type and budget. A `userTeam` resolver checks `owner_id` and `co_owners`. Exact Sleeper field names are `[unverified]` and confirmed in spike (i).
6. **Licensing per shard:**
   - Each manifest entry carries `license` and `credits`.
   - Shards with FTN- or ffopportunity-derived values are published **CC-BY-SA 4.0** and kept separate so share-alike doesn't spread.
   - Nothing derived from DynastyProcess is published, and no raw third-party data is published.
   - Whether pure numeric aggregates are even copyrightable is `[unverified]`; we comply anyway.
7. **Versioning:**
   - `manifest.json` carries `schemaVersion`, `minAppVersion`, `dataAsOf` and per-source kill switches.
   - The previous major schema keeps publishing for ≥7 days.
   - On mismatch the app shows "Update available" and reloads.
   - IndexedDB upgrades are versioned; on failure the app drops its caches and rebuilds from the Sleeper username.
8. **No accounts in 2026.** All state stays on the device and can be rebuilt from a Sleeper username, with settings export/import. Nothing about users is stored on a server until a feature needs it, and each such feature is documented in the data inventory first.
9. **Security baseline:**
   - The archive runs *inside* the private repo, so the public repo holds no cross-repo token.
   - Actions are pinned to commit SHAs with Dependabot; default `permissions: contents: read`; no `pull_request_target`.
   - Installs come from lockfiles.
   - A meta CSP allows `connect-src 'self' api.sleeper.app api.sleeper.com` (plus the Worker later), and no third-party runtime scripts are loaded.
10. **Hosting:** GitHub Pages at `rcjlabs.github.io/Fantasy-Football-App` for 2026. A custom domain (needed for TWA asset links at the origin root) is added when the Play closed test starts. At that point, deploy with `upload-pages-artifact` v5 using `include-hidden-files: true`, since v4+ drops `/.well-known/assetlinks.json` `[reported]`. Move to Cloudflare before any monetization.
    - **Moved to `ff.rcjlabs.com` (2026-10-16), ahead of Play.** On the owner's phone, Chrome said the app was "already installed" at
      the github.io address, then "Could not open app". No installed WebAPK covered it (`chrome://webapks`): a stale install record
      Chrome keeps for that address. Clearing it means clearing data for all of `rcjlabs.github.io`, where the owner's other apps share
      one storage bucket.
    - **Its own origin** gives the app a fresh install identity and its own storage, and is ready for TWA asset links. The build uses
      relative paths, so it works at both addresses while the old one redirects.
    - **Live the same day:** the archive and the data build read the deployed files from `ff.rcjlabs.com`.
    - **Caveat:** a browser that opened the old address keeps a cached copy of the app there. Its service worker serves the page
      from cache and can't update, because browsers reject a service worker script served through a redirect. The new address is
      the one to use.
11. **No DuckDB-WASM.** Client data is <1 MB/week. Measured in V8 `[own calc]`: 50k matchup simulations ≈ 36 ms; 10k 8-week rest-of-season simulations ≈ 0.3 s. Phones are probably several times slower `[unverified]`.
12. **No logos or headshots.** Team abbreviations only, and "Not affiliated with or endorsed by Sleeper, the NFL or any team."
13. **iOS is PWA-only.** Storage is treated as a rebuildable cache, the app calls `navigator.storage.persist()` and shows in-app Add-to-Home-Screen instructions, and it is tested on a real iPhone in both Safari and home-screen mode.
14. **Budgets:** JS ≤ ~150 KB gzipped, first-load data ≤ ~1 MB, simulations ≤ 2 s on a throttled mid-tier Android (Lighthouse CI). WCAG 2.2 AA basics: no color-only signals, 48dp touch targets, axe in CI.

### Repo layout
```
app/          Vite PWA (TS + Preact): src/adapters/sleeper.ts · src/engine/{scoring,availability,lineup,winprob,waiver,trade}.ts · src/workers/
pipeline/     Node jobs now (players, schedule); Python package from Phase 2 (features, baseline, backtests)
contracts/    JSON Schemas (Phase 2, once >2 shards exist)
fixtures/     anonymized league JSON only (hashed IDs, no names or avatars)
.github/      deploy.yml · pipeline.yml · keepalive.yml
docs/         PLAN.md · research/ · spikes.md · privacy.md
```

---

## 5. Roadmap

Week N's first game ≈ Oct 15 + 7·(N−6). Hour figures are `[design estimates]` for human-paced work. With me writing most of the code, your binding constraint becomes review, real-league testing and decisions, so tell me your weekly hours.

### Phase 0 — De-risk and start the archive · **Oct 15 – 21**
- [ ] **Spikes**, run from a browser console and curl (my sandbox can't reach Sleeper, so either you run them or you allow `api.sleeper.app` and `api.sleeper.com` in this environment's network settings). Results go in `docs/spikes.md`. ~2 h.
  - **(a1)** CORS on `api.sleeper.app/v1/state/nfl`
  - **(a2)** CORS on `api.sleeper.com/projections/nfl/2026/7?season_type=regular&position[]=WR`
  - **(b)** which positions projections cover (K, DEF, IDP?) and the `company` field
  - **(c)** whether failed waiver claims carry `waiver_bid` (needs a FAAB league)
  - **(e)** whether past weeks' projections still come back, and whether they are pre-game snapshots
  - **(f)** whether Weeks 8–17 projections exist
  - **(g)** whether `/stats` returns stat lines in scoring keys
  - **(h)** whether future-week `matchups/{week}` returns pairings
  - **(i)** `trade_deadline`, `playoff_week_start` and median/IR/taxi settings in your leagues
  - **(j)** on Sunday Oct 25 (Week 7), when Questionable players' Sleeper status flips to Out
  - RotoWire availability convention: compare projections for Q/D players with their prior week
- [ ] **Archive** (private repo, curl + jq + gzip, no stack decision needed). ~2–3 h.
  - **Every 4 h, Tuesday–Monday:** Sleeper projections (current and future weeks), trending adds.
  - **Daily:** `/players/nfl` injury and depth fields (1×/day, including a Sunday ~11:00 ET slot); nflverse injuries twice a day Wednesday–Sunday, because that file keeps only the latest row per player-week.
  - **Not archived:** nflverse depth charts and weekly rosters already keep their own history `[verified]`.
  - **Storage:** partitioned by `season/week/source/fetched_at` as weekly release assets, with a second copy.
  - **Scheduling:** duplicate staggered Sunday runs. The "as of" value for any kickoff is the last snapshot before it.
  - If spike (e) shows past weeks are served, the archive is less urgent and Weeks 1–6 are backfilled.
- [ ] **Scaffold.** Vite + TS + Preact + vite-plugin-pwa, deployed to Pages; CI runs typecheck, tests and the build; pinned actions. Pipeline skeleton: a Node job emitting `players.json` + `schedule.json` daily. ~6–9 h.
- [ ] **Decisions §8 #1–#4.**

**Exit:** spikes recorded; archive running; empty app deploys; pipeline publishes `players.json`/`schedule.json`.

**If (a2) fails** (Sleeper projections not reachable from the browser), choose before Phase 1: pass them through a minimal Cloudflare Worker (~3–4 h, and our infrastructure would then serve RotoWire data, with that written down), or launch on in-house + props sources only.

### Phase 1 — MVP "Lineups" · **Oct 22 – Nov 8** (end-to-end by **Oct 29 / Week 8**, hardened by Nov 8)

**Must-have** (~35–50 h):
1. Sleeper import: username → leagues → league, rosters, users, matchups; `LeagueRules` + `userTeam`; IndexedDB cache.
2. **All-leagues home screen** listing problems per league: empty slot, bye, OUT starter, better bench option, IR-eligible player using a bench spot.
3. On-device Sleeper projections, both hosts, sanity-checked. Bye week = missing, not 0. Includes K/DEF/IDP if present.
4. **Scoring engine** over any `scoring_settings` key and `roster_positions` slot, with yardage bonuses from simple per-stat distributions. **Engine golden test:** score Sleeper's own weekly stat lines (spike g) with each league's rules and match `players_points` to 0.01 on weeks ≥7 days old. Any key we can't reproduce is listed in a **scoring coverage panel** and shown as a warning.
5. **Two-stage optimizer** with inactive scenarios, kickoff locks (actual points for started players), and FLEX/late-swap by construction. Fixtures: Friday-after-TNF, a London 9:30 ET game, Week 16 Christmas.
6. P(play) v0 table driven by Sleeper `injury_status`, keyed to each game's day.
7. UI: source-level explanation (Sleeper base → rescore → P(play)), data-as-of badge, a state matrix with copy for every case (username not found, pre-draft, not on a roster, Sleeper down, projections empty), last recommendations readable offline, installable PWA, attribution + `/privacy` page with a data inventory, local error log + "Report a problem" (pre-filled GitHub issue, user-initiated).

**Stretch, in order** (only after 1–7 are live):
- N1. Analytic win probability vs. the actual opponent (median game included).
- N2. Waiver board v0: this week's and next week's lineup gain + trending adds + opportunity-shock flag (Sleeper data only).
- N3. DST v0 + 2-week DST streaming view (needs implied totals from `schedule.json`). **DST v0 built 2026-10-16** ([dst.md](dst.md)): about as accurate as RotoWire (MAE ratio 1.005), no gain from blending, so it ships as a second opinion and the DEF fallback inside `baseline.json`.
- N4. In-house baseline v0 running in **shadow**: archived and scored, not blended. **Built 2026-10-16** ([baseline.md](baseline.md#shadow-live)).

**Checkpoints:**
- **Oct 29:** if the end-to-end lineup isn't live, drop N1–N4 from Phase 1.
- **Nov 8:** if the waiver board isn't live, ship trending adds + this-week gain only.

**Exit:** the engine reproduces Sleeper points on 3 past weeks in each of your leagues (or the gaps are listed); you'd act on its Week 10 lineup; tested on Android and a real iPhone.

### Phase 2 — "Before the playoffs" · **Nov 9 – Dec 13**, ordered by value
1. **Stripped trade analyzer** by **~Nov 16**, or earlier if your earliest `trade_deadline` requires it. Weekly own-lineup change with ROS-lite, a bye grid, roster spots filled or dropped, FantasyCalc value shown separately. Dynasty/keeper: "2026 impact" and "long-term market" side by side.
2. **Playoff mode:** maximize P(win) per round, including multi-week rounds.
3. **FAAB max bid** (value-based, calibrated on the league's winning bids).
4. **Baseline blend gate:** backtest v0 on 2023–25 plus shadow weeks; blend only if it passes. **Done 2026-10-16:** no blend, v0 goes to shadow ([baseline.md](baseline.md)).
5. **Accuracy ledger v0** (private) + commit-reveal hashes start.
6. **Odds API props** as a second stat-level source, once its ToS is checked. **Pull built 2026-10-16** ([props.md](props.md)): props are fetched once per game, converted to stat means and scored in shadow in the ledger until they pass the gate.
7. If time remains: DvP residual and CB-depletion flag, **display-only**, labelled. **Done 2026-10-16**; their backtest found no lift, so
   they stay display-only ([matchups-gate.md](matchups-gate.md)).
8. Pipeline grows: Python package, usage/env shards, JSON-Schema contracts, nflverse→Sleeper stat-mapping test (tolerance 0.1 pt; DEF/K/IDP and distance tiers excluded from the gate). **Done 2026-10-16** in TypeScript: usage shard, shard validators, last-good shards, stat mapping ([stat-mapping.md](stat-mapping.md)).

**The owner's assistance list (2026-10-16), in order.** Item 1, the season review and weeks-ahead planner, is built
([season-review.md](season-review.md)). Whatever isn't live by the freeze moves to Phase 3.
2. **Handcuffs and next man up.** **Built 2026-10-16** ([handcuffs.md](handcuffs.md)).
   - QB and RB backups are valued with the share they inherited in 2019–2025 games the starter sat. That share passed a held-out test;
     TE and WR backups didn't, so they aren't valued.
   - The free-agent board tags backups whose starter is out now.
3. **IR stash finder.** **Built 2026-10-16** ([ir-stash.md](ir-stash.md)).
   - Shown only with an open IR slot. It ranks IR-eligible free agents by what they add once back, using Sleeper's return week; the
     playoff part is shown.
   - Injury-type durations stay in the player details as context.
4. **Waiver claim plan.** **Built 2026-10-16** ([claims.md](claims.md)).
   - Ordered claims with drops and bids, each assuming the ones above went through.
   - A backup per claim for the same drop.
5. **Buy low / sell high.** **Built 2026-10-16, display only** ([luck.md](luck.md)).
   - Points against what usage was worth (ffopportunity), with touchdowns against expected, in player details and a Trade-tab card.
   - The backtest found no lift over RotoWire's projections, which already price streaks in, so it doesn't feed values or trade ideas.
6. **"What would it take" for one player.** **Built 2026-10-16** ([trade-finder.md](trade-finder.md#what-would-it-take-one-player)).
   - Packages of one or two of your players that help both lineups, best for you first. Lopsided ones on market value go last.
   - When none helps both, the cheapest package their lineup gains from.
7. **Across all your leagues (Home).** **Built 2026-10-16** ([across-leagues.md](across-leagues.md)).
   - Players you start in several leagues, and NFL games where your starters bunch up.
   - The same waiver target in two leagues, with where he adds more.
8. **Game-day inactive alerts.** **Built 2026-10-16 as the in-app "before lock" check** ([before-lock.md](before-lock.md)), the
   owner's call. Push alerts still need a server: the Cloudflare scheduler plus Web Push, with the push subscription in the data
   inventory first (rule 8; §8 decision 6).
9. **Dynasty startup draft assistant.** **Moved to Phase 3:** the startup draft is the week before the 2027 season (the owner,
   2026-10-16), after the freeze. A live board from Sleeper's draft picks that ranks the best available by league scoring,
   FantasyCalc dynasty values and roster needs. Sleeper's draft data is untested here. The redraft and keeper draft helper it
   can build on was built 2026-10-17 ([draft.md](draft.md)).
10. **Ask the analyst.** **Built 2026-10-16** with bring-your-own-key ([analyst.md](analyst.md)).
    - Plain-language questions answered only from the app's computed numbers, which the app puts in and checks.
    - **Risk:** confidently wrong prose, which the number check reduces but doesn't remove.

**Checkpoint:** **Dec 6 feature freeze.** After that, only fixes until Week 17.

**Exit:** you run your fantasy playoffs on it; the ledger shows whether any second source beats Sleeper-only.

*Optional:* if you want Play in 2026, start the closed test now: custom domain, assetlinks, 12 testers × 14 days for a new personal account `[reported]`, target API 36 `[reported]`. Otherwise this moves to Phase 3.

### Phase 3 — Offseason · **Jan – Jul 2027**
- **Backtests** (walk-forward, as of each lock) on the archive + nflverse 2018–25:
  - in-house baseline v1 (team model, configuration-aware shares, vacated-share redistribution)
  - P(play) v1. **Questionable model built 2026-10-16** ([calibration.md](calibration.md)); mid-week statuses wait on the archive.
  - injury hazard. **Future-week availability and games missed by injury type built 2026-10-16** ([hazard.md](hazard.md), [injuries.md](injuries.md)); early exits remain.
  - DvP / CB depletion / coverage priors, each kept only if it shows residual lift. **DvP and CB depletion tested 2026-10-16 on 2022–25:
    no lift** ([matchups-gate.md](matchups-gate.md)); coverage priors remain.
  - Then publish the calibration page and the public ledger.
- **Full trade analyzer:** team-rating ROS projections, hazard, season sim, leverage-weighted playoff and title odds. Hazard, title odds, persistent drift and ranges built 2026-10-16; team ratings and leverage beyond bye weeks remain. **Dynasty mode.** **Best-ball valuation** (Δ E[max lineup]).
- **Cloudflare Worker:** Cron Trigger scheduler; `/llm` proxy with Turnstile + an anonymous per-install quota (declared).
- **LLM layer**, grounded in computed JSON with every number post-checked:
  - pipeline blurbs (no point values, since scoring lives on the device)
  - "Ask the analyst" with tool use and a bring-your-own-key option. **Built 2026-10-16 with bring-your-own-key** ([analyst.md](analyst.md)): a
    fact sheet with app-inserted numbers, no tools yet.
  - Play's AI-content policy needs an in-app report button `[reported]`
- **Draft assistant** for Aug 2027 (ADP + value-based drafting under league scoring), including the **dynasty startup draft
  assistant**: the owner's startup draft is the week before the 2027 season. **Redraft and keeper helper built 2026-10-17**
  ([draft.md](draft.md)): next season's projections, board, keepers, orders, slot comparison and mock draft with grades.
  Remaining:
  - ADP for the other teams' picks;
  - a live board that follows Sleeper's draft (built 2026-10-17; first real use in 2027);
  - rookies named after the NFL draft (built, checked offline on the 2026 class);
  - the mock draft's noise calibrated on real drafts;
  - dynasty startup and rookie drafts.
- **Monetization decision.** If yes: licence requests (Sleeper, RotoWire, FantasyCalc, FantasyPros via support@/api@fantasypros.com), move to Cloudflare, Play Billing.
- **More platforms:** MFL, Yahoo if approved, ESPN only after the policy review.

### Phase 4 — 2027 launch · **Aug – Sep 2027**
Play production release, public ledger, draft tools, more platforms; a paid tier only if licences allow.

---

## 6. Testing and validation

- **Engine golden test** (Phase 1 gate), as above. Engine bugs are separated from stat-source differences: the nflverse→Sleeper mapping test is Phase 2 and logged separately.
- **Optimizer fixtures:** every slot type (SUPER_FLEX, REC_FLEX, WRRB_FLEX, IDP_FLEX), locks, the inactive-swap value, median games, best ball (no lineup output).
- **Unit tests for conventions:** spread sign / implied totals, availability conversion, bye-as-missing.
- **Pipeline:** validates its outputs before publishing, keeps the last good shard on failure, opens an issue on row-count drops or column changes (nflverse injuries already lost `date_modified` in 2026 `[verified]`), and runs idempotently by polling nflverse `timestamp.json`. Built so far: validation, last-good shards and a health table with row-drop warnings in the job summary (`pipeline/shards.ts`); issues and `timestamp.json` polling are not.
- **Backtests** (Phase 2–3) with pre-registered bars `[design]`:
  - a source joins the blend only if within ~5–10% of RotoWire's MAE **and** blending it, with weights fit on earlier seasons, lowers MAE out of sample (pooled 95% interval below zero). The second test was added 2026-10-16: baseline v0 passed the first for RB/WR/TE but blending gained only 0–1% ([baseline.md](baseline.md))
  - P(play) Brier score better than the v0 table
  - each matchup adjustment shows positive residual lift over the blend, or stays display-only. DvP and CB depletion showed none
    (2026-10-16, [matchups-gate.md](matchups-gate.md))
- **Fixtures:** your leagues plus public Sleeper leagues covering missing formats (IDP, 2QB, best ball, median), stored anonymized. Raw league JSON stays in the private repo.

---

## 7. Top risks

| Risk | Sev. | Mitigation |
|---|---|---|
| Season clock beats the roadmap | High | Phase 1 cut to must-haves; dated checkpoints (Oct 29, Nov 8, Nov 16, Dec 6 freeze); the archive runs regardless |
| `api.sleeper.com` projections blocked or gone, leaving the MVP with **one** external source and no fallback | High | Spikes a2/e/f day 1; shadow baseline + props as fallbacks; "single source" labelling; Worker pass-through decision written down |
| False precision (matchups, win %, injuries) | High | Display-only until backtested; labels; ranges; published calibration |
| Sleeper terms or CORS change; licensing blocks monetization | High | Non-commercial launch; one fetch wrapper (proxy can be switched on); value comes from computation, not republished data |
| Scoring mismatches in exotic leagues | Medium | Golden test + scoring coverage panel shown to users |
| GitHub cron drops game-day runs (seen 2026-10-16: the deploy's first scheduled run and 2 of 4 archive runs skipped) | Medium | Duplicate staggered runs; daily archive jobs run in the first run after their hour; archive runs start a skipped deploy; the app flags data over 36 h old (all 2026-10-16); Cloudflare Cron Trigger in Phase 3 |
| PFR-sourced nflverse data stalls (nflverse adopted a paid third-party scraping proxy 2026-09-10; workflows failed repeatedly that month, causes mixed `[verified]`) | Medium | Freshness badges; usage metrics that don't need snaps; Sleeper stats fallback only after spike (g) |
| Play policy (ESPN access, AI content, gambling references) | Medium | ESPN out of the Play build; AI report button; implied totals only, no sportsbook anything |

---

## 8. Decisions I need from you

**Needed now (they block Phase 0–1):**
1. **Monetization.** Recommendation: free and non-commercial for 2026, decide in spring 2027.
2. **Your hours per week**, and whether I should implement while you review and test. This sets the real dates.
3. **Leagues and formats.** Which Sleeper leagues do you play in (usernames or league IDs)? Any IDP, superflex, TE-premium, best ball, median, dynasty? Fixtures get anonymized.
4. **Stack.** Vite + **TypeScript** + Preact, with Node pipeline jobs now and Python from Phase 2. Or a stack you already use for your other PWAs?
5. **Private archive repo.** OK to create `RCJLabs/ff-archive` (private)? You can create it, or approve me doing it. Also: will you run spike (a)/(e)/(f) in a browser, or allow `api.sleeper.app` and `api.sleeper.com` in this environment so I can?

**Can wait (Phase 2–3):**

6. **Notifications.** (A) none in 2026: rely on Sleeper's alerts plus an in-app Sunday checklist (recommended). (B) Web Push via the Worker in Phase 3, storing only {subscription, rostered player IDs}.
7. **Play in 2026, or wait for 2027?** Personal or organization developer account? You'd also need a custom domain then.
8. **Budget.**
   - **MVP:** $0.
   - **Phase 2:** The Odds API, $0 on the free tier or $30/mo.
   - **Phase 3 LLM, per-million-token prices** `[verified: Anthropic pricing reference 2026-10-06]`: Haiku 5.5 $0.10/$0.50 (prompts ≤100K tokens), Sonnet 5.5 $2/$10, Opus 5.5 $4/$20.
   - **Rough cost per 5-turn chat** `[design estimate]`: Haiku ≈ $0.005–0.01, Sonnet ≈ $0.05–0.15, Opus ≈ $0.10–0.30.
   - The default model is your call. I'd suggest Opus 5.5 for quality, with Haiku for pipeline blurbs and a BYOK option.
9. **Cross-league data.** A FAAB prior and win-probability calibration beyond your own leagues need a sample of public Sleeper leagues fetched by the private pipeline (no usernames stored). Recommendation: skip in 2026.
10. **Other platforms.** Do ESPN or Yahoo matter to you or your league-mates?

When you confirm #1–#5, I'll start Phase 0 with the spikes and the archive.
