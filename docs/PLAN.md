# Fantasy Football Assistant — Plan & Roadmap

**Status:** DRAFT v2, awaiting your confirmation · **Date:** 2026-10-15 (NFL Week 6, TNF tonight) · **Repo:** RCJLabs/Fantasy-Football-App (public)

v2 incorporates an adversarial review of v1 by four independent critics: evidence consistency, solo-dev feasibility, completeness, and football methodology.

**Evidence labels**

| Label | Meaning |
|---|---|
| `[verified]` | Checked on 2026-10-15 against a primary source: live nflverse files, vendor docs repos, SDK source |
| `[own calc]` | Quick computation during research on downloaded nflverse data. Small samples, scripts not yet in the repo; re-run in Phase 2 before relying on the number |
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
| **In-house baseline** | **v0 (shadow):** shrunk trailing mean of ffopportunity expected-stat components (`*_exp`) × (this week's implied team total ÷ the team's season-average implied total). **v1:** a team model fitted on 2018–25: plays = f(pace, spread); pass rate = neutral PROE + f(spread); TDs split between pass and rush and given to players by xTD share, inside-10 carries, end-zone targets and QB sneaks (FTN `is_qb_sneak`). Player shares come from the **current configuration** (same starting QB and key teammates active, backing off to all games), with **vacated-share redistribution rates fitted** from with/without splits and recency weighting chosen by backtest. A QB change is detected from `games.csv` QB IDs. Shares reset after role breaks and NFL trades. | Trailing xFP beat trailing actual points: MAE 5.6–6.4 vs 6.4–6.9, 2026 Weeks 3–5, PPR `[own calc]`. 8 of 32 teams have started more than one QB in 2026 `[own calc]`. **Blend gate:** joins the blend only when its walk-forward MAE is within ~5–10% of RotoWire's for that position (backtest on 2023–25 plus live shadow weeks). Before that it is a labelled second opinion and the fallback if Sleeper projections go dark. | v0 shadow: Phase 2 · v1: Phase 3 |
| **Distributions** | **Per-stat marginals** (yards, receptions, TDs) with a position- and mean-dependent CV fitted on nflverse; long-TD rates from pbp. **v2:** a shared bank of joint stat-residual vectors per position/tier, so the device draws, applies league scoring, and gets mean, quantiles and bonus expectations in one pass. Same-game correlation via a team-game factor. | Point-level σ can't price yardage bonuses and differs by scoring format `[design]`. CV depends on the mean `[own calc]`. | MVP (simple parametric) → Phase 3 (bank) |
| **P(play)** | **v0:** table of designation × final practice status. The **final report is keyed to each game's day** (Wednesday, Friday or Saturday games exist in 2026 Weeks 12, 15 and 16) `[verified]`. Explicit states: IR/PUP/suspended (0 until activated), activated or elevated (≈1, role uncertain), rest days (own category). Collapses to 0 or 1 once inactives post. **v1:** logistic model trained on weekly-roster ACT/INA labels joined exactly by gsis_id. | Questionable 70%, Doubtful ≈0% (2026 Weeks 1–5) `[own calc]`. Whether and how fast Sleeper's `injury_status` reflects game-day inactives is unknown `[unverified]`; spike (j). | v0 MVP · v1 Phase 3 |
| **Start/sit optimizer** | Two-stage expected points. For each candidate lineup, enumerate the inactive scenarios for Q/D starters (2^k, k usually ≤4). In each scenario, re-optimize only the slots whose replacements kick off after that player's inactive reveal (kickoff − 90 min). FLEX/SUPER_FLEX placement falls out of this rather than a rule. **Locks:** a player whose game has started stays put and his actual points replace his distribution. An "I won't check inactives" toggle falls back to P·μ. | Example: P=0.7, μ_Q=15, bench μ=10. The swap option values starting him at 13.5 vs 10, where P·μ gives 10.5 vs 10 `[design]`. A pure variance swap is worth only ~0.2–0.7 pp of win probability (SD 5→9), up to ~1.5 pp (SD 4→12, 30-point underdog), ignoring correlation `[own calc]`. So expected points drives the decision, and P(win) is a tiebreaker. | MVP |
| **Win probability / playoff mode** | Analytic normal approximation vs. the actual opposing lineup (median game counted as a second result). **Playoff mode** maximizes P(win) for the round, summed across multi-week rounds. | Monte Carlo needs common random numbers: 10k draws ≈ 0.5 pp standard error `[verified: arithmetic]` | Display: Phase 1 stretch · playoff mode: Phase 2 |
| **K / DST** | Rescored Sleeper projections (spike b confirms they exist). DST in-house v0 = f(opponent implied total, opponent sack and turnover rates, home/away); 2-week DST streaming view. K: Sleeper only. | DST points vs. opponent implied total r = −0.32 (n=544); kicker vs own implied total r = 0.13 (2025, approximate scoring) `[own calc]` | MVP (Sleeper) · DST v0: Phase 1 stretch |
| **Waiver board** | Gain in this week's (and next week's, if projected) optimal lineup, plus "ROS-lite" value. Opportunity-shock flag from Sleeper depth order + injury status. Trending adds as a *demand* signal (with Sleeper attribution). | ROS-lite: Sleeper future-week projections if they exist (spike f), bye-aware; otherwise per-game value × remaining non-bye games, labelled "flat ROS estimate" `[design]` | MVP stretch → Phase 2 |
| **FAAB** | Value-based max bid: dollars per unit of ROS value, calibrated from the league's own *winning* bids and scaled by remaining budget and weeks. Runner-up-bid model only if failed claims expose `waiver_bid`. | Losing-bid visibility unconfirmed `[unverified]`; spike (c). No cross-league prior (no league sample; §8). | Phase 2 |
| **Trade analyzer** | **Stripped (Phase 2):** your optimal-lineup points by remaining week (regular season + playoffs) with ROS-lite, a bye grid, roster spots filled or dropped on both sides, and FantasyCalc market value shown separately. **Full (Phase 3):** future implied totals from team ratings fitted to market lines (plus win totals as a prior); a weekly injury hazard by position × age; weeks weighted by leverage from the season sim; playoff and title odds; ranges, not points. | `games.csv` currently has lines only through Week 7 `[verified]`, which is why ROS needs the team-rating model | Stripped: Phase 2 · Full: Phase 3 |
| **Matchup layer** | Vegas implied team total and spread are the primary environment signal (`home_itt = (total_line + spread_line)/2`; nflverse spread is positive when the **home** team is favored `[verified]`, unit-tested). **DvP:** the residual of position-level xFP allowed after conditioning on the opponent's implied total, used *only inside the in-house baseline*, never on the blend. Shrunk toward the league mean, with weight on last season equal to its measured year-over-year r. **CB depletion** flag (starting LCB/RCB/NB out, from injuries + depth chart). **Wind** only shifts the pass/rush split and K inside the baseline. Everything is display-only until a walk-forward backtest shows lift. | Defense-vs-position barely repeats (WR r≈0) `[reported]`. Vegas dominating feature importance comes from one unreviewed 2026 thesis `[unverified]`. Strong wind is already priced into game totals (residual +0.7 ± 2.0 pts at ≥20 mph, n=47) `[own calc]`. PFR per-CB stats are used only if their split-half reliability holds up `[design]`. | CB depletion + DvP display: Phase 2 stretch · rest: Phase 3 backtest |
| **Injury context** | Population base rates: weekly hazard of a new missed-game injury by position × age, early-exit rates, games-missed distributions by injury type, all shown as labelled ranges. They feed the ROS availability multiplier. | Individual proneness isn't estimable `[reported]`. The cited hamstring recurrence rate (38%) conflicts with the most-cited study (16.5%), so trace it before showing it `[unverified]`. | Phase 3 |
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
| **Sleeper stats** (undocumented) `api.sleeper.com/stats/nfl/{season}/{week}?season_type=regular` | Engine golden test; possible snap fallback | Pipeline / dev | Same | Fields and team snap totals `[unverified]`; **spike (g)** |
| **nflverse** releases: pbp, stats_player, injuries, depth_charts, ftn_charting, pfr_advstats, nextgen_stats, weekly rosters, snap_counts | Usage, environment, P(play) training, ID joins, backtests | Pipeline (release assets send no CORS headers `[verified]`) | Broadly CC-BY 4.0; FTN data CC-BY-SA 4.0 ("FTN Data via nflverse") `[verified]`. Underlying NFL, PFR and NGS data "belong to their respective owners" `[verified: nflreadr Terms]`, so we publish derived aggregates only | Updated 10-15; ftn_charting 10-14; snap_counts 10-13 (lags ~2 days) `[verified]` |
| **ffopportunity** (`ep_weekly`, stat-level `*_exp` incl. first downs) | Baseline, usage/regression | Pipeline | **CC-BY-SA 4.0** `[verified]`; published derivatives carry it (§4 rule 6) | 2026 Weeks 1–5 present; trained 2006–20, recalibrate `[verified]` |
| **nfldata `games.csv`** | Kickoff times (locks), lines → implied totals, QB IDs, rest/roof | Pipeline | **No licence file; line provenance unknown** `[verified]`. Publish derived implied totals only | Commits every ~10–30 min; lines only for near weeks `[verified]` |
| **Player IDs**: Sleeper cross-IDs + nflverse weekly rosters (`sleeper_id`, gsis, pfr, espn) | Public `players.json` | Pipeline | CC-BY / Sleeper terms | — |
| **DynastyProcess `db_playerids`** | `fantasypros_id`/`mfl_id` joins, **pipeline-only** | Pipeline | Repo is GPL-3.0 `[verified]`, so **nothing derived from it is published** `[design]` | Weekly; partial coverage `[verified]` |
| **The Odds API** v4 (player props) | Second independent stat-level source (props → conditional medians → means) | Pipeline, key in secrets | Display ToS **unchecked**; show derived numbers only | Free 500 credits/mo incl. props; ~1 credit per market per region per event; $30/mo for 20K `[reported]`. One weekly snapshot fits the free tier. Phase 2 |
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
- N3. DST v0 + 2-week DST streaming view (needs implied totals from `schedule.json`).
- N4. In-house baseline v0 running in **shadow**: archived and scored, not blended.

**Checkpoints:**
- **Oct 29:** if the end-to-end lineup isn't live, drop N1–N4 from Phase 1.
- **Nov 8:** if the waiver board isn't live, ship trending adds + this-week gain only.

**Exit:** the engine reproduces Sleeper points on 3 past weeks in each of your leagues (or the gaps are listed); you'd act on its Week 10 lineup; tested on Android and a real iPhone.

### Phase 2 — "Before the playoffs" · **Nov 9 – Dec 13**, ordered by value
1. **Stripped trade analyzer** by **~Nov 16**, or earlier if your earliest `trade_deadline` requires it. Weekly own-lineup change with ROS-lite, a bye grid, roster spots filled or dropped, FantasyCalc value shown separately. Dynasty/keeper: "2026 impact" and "long-term market" side by side.
2. **Playoff mode:** maximize P(win) per round, including multi-week rounds.
3. **FAAB max bid** (value-based, calibrated on the league's winning bids).
4. **Baseline blend gate:** backtest v0 on 2023–25 plus shadow weeks; blend only if it passes.
5. **Accuracy ledger v0** (private) + commit-reveal hashes start.
6. **Odds API props** as a second stat-level source, once its ToS is checked.
7. If time remains: DvP residual and CB-depletion flag, **display-only**, labelled.
8. Pipeline grows: Python package, usage/env shards, JSON-Schema contracts, nflverse→Sleeper stat-mapping test (tolerance 0.1 pt; DEF/K/IDP and distance tiers excluded from the gate).

**Checkpoint:** **Dec 6 feature freeze.** After that, only fixes until Week 17.

**Exit:** you run your fantasy playoffs on it; the ledger shows whether any second source beats Sleeper-only.

*Optional:* if you want Play in 2026, start the closed test now: custom domain, assetlinks, 12 testers × 14 days for a new personal account `[reported]`, target API 36 `[reported]`. Otherwise this moves to Phase 3.

### Phase 3 — Offseason · **Jan – Jul 2027**
- **Backtests** (walk-forward, as of each lock) on the archive + nflverse 2018–25:
  - in-house baseline v1 (team model, configuration-aware shares, vacated-share redistribution)
  - P(play) v1
  - injury hazard
  - DvP / CB depletion / coverage priors, each kept only if it shows residual lift
  - Then publish the calibration page and the public ledger.
- **Full trade analyzer:** team-rating ROS projections, hazard, season sim, leverage-weighted playoff and title odds. **Dynasty mode.** **Best-ball valuation** (Δ E[max lineup]).
- **Cloudflare Worker:** Cron Trigger scheduler; `/llm` proxy with Turnstile + an anonymous per-install quota (declared).
- **LLM layer**, grounded in computed JSON with every number post-checked:
  - pipeline blurbs (no point values, since scoring lives on the device)
  - "Ask the analyst" with tool use and a bring-your-own-key option
  - Play's AI-content policy needs an in-app report button `[reported]`
- **Draft assistant** for Aug 2027 (ADP + value-based drafting under league scoring).
- **Monetization decision.** If yes: licence requests (Sleeper, RotoWire, FantasyCalc, FantasyPros via support@/api@fantasypros.com), move to Cloudflare, Play Billing.
- **More platforms:** MFL, Yahoo if approved, ESPN only after the policy review.

### Phase 4 — 2027 launch · **Aug – Sep 2027**
Play production release, public ledger, draft tools, more platforms; a paid tier only if licences allow.

---

## 6. Testing and validation

- **Engine golden test** (Phase 1 gate), as above. Engine bugs are separated from stat-source differences: the nflverse→Sleeper mapping test is Phase 2 and logged separately.
- **Optimizer fixtures:** every slot type (SUPER_FLEX, REC_FLEX, WRRB_FLEX, IDP_FLEX), locks, the inactive-swap value, median games, best ball (no lineup output).
- **Unit tests for conventions:** spread sign / implied totals, availability conversion, bye-as-missing.
- **Pipeline:** validates its outputs before publishing, keeps the last good shard on failure, opens an issue on row-count drops or column changes (nflverse injuries already lost `date_modified` in 2026 `[verified]`), and runs idempotently by polling nflverse `timestamp.json`.
- **Backtests** (Phase 2–3) with pre-registered bars `[design]`:
  - a source joins the blend only if within ~5–10% of RotoWire's MAE
  - P(play) Brier score better than the v0 table
  - each matchup adjustment shows positive residual lift over the blend, or stays display-only
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
| GitHub cron drops game-day runs | Medium | Data-as-of banner; duplicate staggered runs; Cloudflare Cron Trigger in Phase 3 |
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
