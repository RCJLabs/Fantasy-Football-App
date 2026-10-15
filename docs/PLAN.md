# Fantasy Football Assistant — Plan & Roadmap

**Status:** DRAFT, awaiting your confirmation · **Date:** 2026-10-15 (NFL Week 6, TNF tonight) · **Repo:** RCJLabs/Fantasy-Football-App (public, empty)

Evidence labels used throughout:

| Label | Meaning |
|---|---|
| `[verified]` | Checked on 2026-10-15 against a primary source: live nflverse files, vendor docs repos, SDK source, or our own computation |
| `[reported]` | From a credible secondary source (third-party code, captured vendor pages, published analysis); not independently confirmed |
| `[unverified]` | Training knowledge or a single weak source; must be checked before we depend on it |
| `[design]` | My design choice or tuning assumption, not a fact |

Research notes with sources and fact-check verdicts: [`docs/research/`](research/).

---

## 0. Where the original vision needs to change (read first)

**1. "Expert consensus from all locations" is not available to a public app.** Nearly every expert source is paywalled, limited to non-commercial use, or forbids scraping.
- **FantasyPros ECR**: the real "consensus with accuracy weighting". Its API needs a Commercial licence to power an app that shows the data to other people, even a free one. The terms also bar products that "directly compete" with FantasyPros, and start/sit, trade and waiver tools do. `[reported]`
- **KeepTradeCut**: forbids scraping and reproducing its values. `[reported]`
- **PFF, 4for4, Footballguys, FantasyPoints, ETR**: behind logins, with no redistribution rights. `[reported]`
- **Scraping 10+ sites**: a ToS breach, and on Play it also violates the Device & Network Abuse policy (accessing third-party services against their terms). `[reported]`

**What we build instead:** a **calculated consensus**, the equal-weight average of every independent *stat-level* projection we can legally use, rescored to your league's exact scoring. The evidence says that is the right object anyway:
- Averaged projections beat every single source, and roughly double rankings on R². `[reported]`
- Equal weights are very hard to beat with small samples (the "forecast combination puzzle"). `[verified]`
- Licensed ECR (FantasyPros Commercial, or Fantasy Nerds at ~$400/yr) stays an optional input we can add later. `[reported]`

**2. CB matchups and "injury risk" are weak edges, and the free data mostly doesn't exist in-season.**
- **Free in-season coverage data:** none. nflverse's man/zone and coverage-shell data (from FTN) is published only after the Super Bowl; 2025 arrived 2026-02-10. `[verified]`
- **True WR-vs-CB alignment and shadow data:** PFF and FantasyPoints only, with no redistribution rights. `[reported]`
- **Predictive value:** shadow coverage averaged about +0.24 fantasy points vs. expectation across 35 corners (PFF), and no study shows man/zone splits predict anything. `[reported]`
- **Injuries:** a player's chance of *getting* hurt can't be estimated from public data. `[reported]` What *is* estimable, and valuable, is **availability probability**: P(plays | designation, practice status). Questionable players play about 70% of the time, Doubtful almost never. `[reported]`; roughly reproduced on 2026 Weeks 1–5 `[verified]`

→ Matchups lead with **Vegas implied team totals** plus opponent-adjusted, shrunk and capped defense data. CB and scheme signals become a clearly labelled, capped "estimate" layer, and injuries become "availability probability". No "shadow coverage" or "injury-prone" claims.

**3. Monetizing collides with Sleeper's terms, and with GitHub Pages.**
- Sleeper's API is free for **non-commercial** use. Its general Terms bar third-party products that access or display Sleeper data for commercial purposes without written consent. `[reported]` League import is the core feature, so ads, subscriptions or a paid Play listing need Sleeper's permission first.
- Other inputs with non-commercial terms: FantasyCalc values, Open-Meteo, and RotoWire (the actual source behind Sleeper's projections). `[reported]`
- GitHub Pages terms forbid using it mainly for commercial SaaS. `[verified]`

→ Ship **free and non-commercial** for 2026, and open licensing conversations in parallel.

**4. "Most efficient analyst" has to be measured, not claimed.** FantasyPros already ships a free "Gameday Win %" and an LLM assistant ("Coach AI", HOF tier) `[reported]`, so "win %" and "AI analyst" are not differentiators on their own. What sets us apart has to be provable: an open, timestamped **accuracy ledger**. That needs an archive of every input, starting **this week**. Every week we don't snapshot is lost backtest data. Free multi-source projection archives barely exist. `[reported]`

**5. Timing.** We're at Week 6. Fantasy playoffs are usually Weeks 15–17 (~Dec 17 – Jan 3), and many Sleeper trade deadlines fall around Weeks 11–13.
- **Realistic this season:** a lineup + waiver MVP by ~Week 9, then trades, FAAB and matchups before the playoffs.
- **Next season:** the rest (multi-platform, LLM chat, Play production, dynasty depth) is a 2027 preseason launch.

---

## 1. Product definition

**One-liner:** A Sleeper-first, league-specific decision engine. It turns every legally usable projection and usage signal into start/sit, waiver, FAAB and trade decisions for *your* scoring, *your* roster and *your* opponent, and shows its work.

**What we can credibly own** (incumbents don't do these well):

1. **Exact rescoring.** Every source's raw stat line is re-scored to your league's `scoring_settings`: TE premium, superflex, first downs, yardage bonuses, IDP. Bonus thresholds are computed as expectations over the outcome distribution, not the mean. `[design]`
2. **Availability-aware projections.** Each projection is P(play) × outcome distribution, so Questionable players aren't treated as full projections or zeros. `[design]`
3. **Decisions against your actual opponent.** Lineups maximize expected points (with availability built in), and win probability against the real opposing lineup breaks ties. Late-swap and FLEX placement handle Questionable players in late games. `[design]`
4. **League-aware value.** Replacement level is the best *actual free agent in your league*, not a formula. Trades and waivers are scored by the change in your optimal lineup over the rest of the season, with playoff weeks weighted. `[design]`
5. **Shown reasoning plus a public accuracy ledger.** Every number decomposes into factors, source disagreement is visible, and calibration (MAE, Brier) is published weekly. `[design]`

**Primary user:** Sleeper redraft and dynasty players, especially custom-scoring leagues, where generic rankings are visibly wrong.

**Non-goals for 2026:**
- daily fantasy (DFS) or betting features
- sportsbook links of any kind
- scraping expert sites
- an "injury-prone" score
- shadow-coverage claims
- iOS App Store wrapper (the PWA works on iOS)

---

## 2. Feature methodology (what each feature actually computes)

| Feature | Method | Key inputs | Evidence strength | Phase |
|---|---|---|---|---|
| **Consensus projection** | Equal-weight mean of *stat-level* projections from independent sources, rescored with league `scoring_settings`. Nonlinear bonuses come from the distribution. A source that drops a player counts as weak evidence he won't play. | Sleeper projections (RotoWire), in-house baseline, props-implied (v1), ESPN projections (optional) | Strong for blending `[reported]`; equal weights `[verified]` | MVP |
| **In-house baseline projection** | Team environment (Vegas implied team total, pace, PROE) × player usage share (shrunk snap, target, air-yards and carry shares; ffopportunity expected points) → stat line | nflverse pbp/stats, ffopportunity, schedules/lines | Medium; v0 is simple, refined by backtests | MVP v0 → v1 |
| **Outcome distribution** | Mixture: P(inactive)·0 + P(active)·skewed distribution, with σ = f(position, projected mean) fitted on residuals; QB–pass-catcher and game-level correlation via a team-game factor | Projection, P(play), historical residuals | CV depends on the mean `[verified]` on 2026 data | MVP (simple) → v2 (quantile model) |
| **P(play) / availability** | v0: base-rate table of designation × final practice status. v1: logistic model (+ position, injury type, team effect, Thursday game). Game-day layer from Sleeper injury status. | nflverse injuries (daily snapshots), Sleeper players | Q≈70%, D≈single digits `[reported]` + roughly reproduced `[verified]`. Combine designation *jointly* with practice status; don't stack the two rates. | MVP v0 → v1 |
| **Start/sit optimizer** | Maximize expected points over legal slot assignments (brute force is fine). FLEX/SUPER_FLEX gets the latest-kickoff eligible player, and Questionable late-game players go in FLEX. Analytic win-prob display. v1: P(win) tiebreaker using common random numbers. | Distributions, opponent lineup from Sleeper matchups | A same-mean variance swap is worth only ~0.2–0.7 pp of win prob `[verified]` (own calc, reproduced), so expected points does almost all the work | MVP → v1 |
| **Waiver board** | Gain in the user's optimal lineup over the next N weeks plus rest of season (ROS) vs. their current bench and the league's replacement level; opportunity-shock flag (starter injured → backup's share); shrunk usage trend; Sleeper trending adds used as a *demand* signal | All of the above | Medium | MVP |
| **FAAB bid recommender** | Bid = min(your value-based max, predicted runner-up bid + ε), fitted on the league's own processed waivers; cross-league prior early in the season | Sleeper transactions (`waiver_bid`) | **Losing-bid visibility in Sleeper's data is unconfirmed** `[unverified]`; check on a live league first | v1 |
| **Trade analyzer** | Week-by-week ROS optimal-lineup change for both teams (byes, playoff weeks weighted) + season Monte Carlo of playoff and title odds before and after. Shown separately: "helps you" vs. "fair" (market value from FantasyCalc) | ROS projections, schedule, FantasyCalc | Sound design; ROS weekly projections are the weak link (lines exist only 1–2 weeks ahead) | v1 |
| **Usage and regression** | xFP/xTD over expected (TD luck), shrinkage weights from in-house split-half reliability; buy-low/sell-high only when usage is stable or rising | ffopportunity, stats_player | xTD stickier than TDs; big overperformers regress `[reported]` | v1 |
| **Matchup layer** | (1) Vegas implied team total and spread as the primary signal. (2) Opponent-adjusted xFP allowed by position, shrunk toward last season, capped at ±10–15%. (3) CB room vulnerability: PFR per-defender targets, yards per target and passer rating allowed, ESPN LCB/RCB/nickel roles, CB injuries ("estimate"). (4) FTN blitz and pass-rush rates. (5) 2023–25 coverage-shell priors, labelled "historical tendency" and reset on defensive-coordinator change. (6) Weather (NWS). Never stack a Vegas adjustment on projections that already include it. | nflverse schedules, stats, pfr_advstats, depth_charts, ftn_charting, participation 2023–25 | Defense vs. position barely repeats year to year (WR r≈0) `[reported]`; Vegas dominates `[reported]`; per-defender PFR stats exist in-season `[verified]` | MVP (1–2) → v1 (3–6), each capped until backtested |
| **Injury context** | Games-missed distributions by injury type with wide intervals; same-season hamstring re-injury prior; ACL year-one efficiency discount. No "injury-prone" score. | nflverse injuries history | Mixed. The published hamstring rate conflicts with the most-cited study (38% vs 16.5%); trace it before showing it `[unverified]` | v2 |
| **Explanations** | Deterministic factor breakdown that sums to the final number (base, rescore, P(play), usage, matchup, variance), plus source spread. LLM only narrates it later. | Engine outputs | — | MVP |
| **Accuracy ledger** | Walk-forward scoring of every input and our outputs: MAE by position on the FantasyPros-style pool (top-N projected + top-N actual), Spearman, interval coverage, Brier for P(play) and win prob | Archive | — | Archive MVP; dashboard v1 |

---

## 3. Data sources

### Use

| Source | Used for | How we access it | Cost | Terms posture | Status |
|---|---|---|---|---|---|
| **Sleeper API** `api.sleeper.app/v1` (user, leagues, league, rosters, users, matchups, transactions, traded_picks, state, trending) | League import, opponents, waivers | **Browser-direct**: keyless and read-only, under 1000 calls/min | Free | Non-commercial; trending data needs attribution `[reported]` | Endpoints `[verified]` via maintained wrappers; CORS `ACAO: *` `[reported]` by several 2026 checks; **re-test day 1** |
| **Sleeper `/players/nfl`** (~5 MB) | Player DB, injury status, depth order, cross-IDs | Pipeline, ≤1×/day, trimmed to a few hundred KB | Free | Same | `[reported]` |
| **Sleeper projections** (undocumented: `api.sleeper.com/projections/nfl/{season}/{week}?season_type=regular&position[]=…`) | One projection source (each row carries `company: "rotowire"`) | **On the device, per user**; never republished | Free | RotoWire's data; undocumented and can break mid-season | `[reported]` |
| **nflverse** releases: pbp, stats_player, snap_counts, injuries, depth_charts, ftn_charting, pfr_advstats, nextgen_stats, weekly rosters | Usage, environment, matchup, P(play) training, ID joins | Pipeline (release assets send **no CORS** headers) `[verified]` | Free | CC-BY 4.0; FTN data CC-BY-SA 4.0, credited "FTN Data via nflverse" `[verified]` | All updated 2026-10-15 `[verified]` |
| **ffopportunity** (xFP components, incl. first-down expectations) | Usage and regression, baseline projection | Pipeline (`ep_weekly_{season}.csv`) | Free | **CC-BY-SA 4.0** (share-alike on redistributed derivatives) `[verified]` | 2026 Weeks 1–5 present `[verified]`; trained 2006–2020, so recalibrate |
| **nfldata `games.csv`** (spread, total, moneylines, rest, roof, surface) | Implied team totals, schedule | Pipeline (or raw GitHub, CORS-open) | Free | **No licence file; line provenance unknown** `[verified]` | Week 6 lines present `[verified]` |
| **The Odds API** v4 | Player props → implied player projections; live lines | Pipeline (key in Actions secrets) | Free 500 credits/mo, props included, ~1 credit per market per region per game; $30/mo for 20K `[reported]` | Display/redistribution ToS **unchecked**; show derived numbers, not odds tables | v1 |
| **FantasyCalc** `/values/current?isDynasty&numQbs&numTeams&ppr` | Trade "fairness"/market value, dynasty | Pipeline, ≤ hourly | Free | Non-commercial with attribution and link; commercial needs written permission `[reported]` | v1 |
| **Player ID map**: nflverse weekly rosters (`sleeper_id`, daily) + DynastyProcess `db_playerids` (weekly, adds `fantasypros_id`, `mfl_id`) | Joining Sleeper ↔ GSIS ↔ PFR ↔ FantasyPros | Pipeline | Free | DynastyProcess repo is GPL-3.0; the data licence is ambiguous, so **use it in the pipeline and don't ship the raw file** `[verified]` | Partial coverage (~6.4k of 12.5k rows have `sleeper_id`) `[verified]`; name+team fallback |
| **NWS** `api.weather.gov` | Game forecasts (US venues) | Pipeline | Free | Public domain `[unverified]` | v1. International games: met.no. Open-Meteo is non-commercial `[reported]` |
| **FantasyPros ECR via DynastyProcess scrape** (`fp_latest_weekly.csv`) | **Development only**: a benchmark to calibrate and backtest our consensus | Pipeline → private archive | Free | FantasyPros' data, scraped; **never shipped** `[verified]` | PPR-only for RB/WR/TE `[verified]` |

### Later or optional
- **ESPN projections** (`kona_player_info`): browser-direct may work `[reported]`. Disney ToS is grey territory, so it would be an optional toggle only.
- **FantasyPros Commercial API, or Fantasy Nerds** (~$400/yr, commercial needs permission): licensed ECR, subject to quotes and terms. `[reported]`
- **RotoWire / PFF licensed feeds:** after there is revenue.

### Not using
KeepTradeCut, scraped expert sites, PFF/SumerSports/StatRankings pages, X API (pay-per-use, too costly before revenue), Underdog/DFS data, sportsbook links.

**Data freshness facts the design must respect** `[verified]`:
- **Injuries** update once a day (~07:07 UTC) as **one row per player-week**, with no Wednesday/Thursday/Friday practice trend. Snapshot them daily to rebuild the trend. They miss game-day inactives (~90 min before kickoff).
- **PFR-sourced snap counts and advanced stats** depend on a paid scraping proxy that nflverse runs, and that proxy failed repeatedly in September 2026. Fallback: Sleeper's undocumented stats endpoint.
- **Depth charts** are ESPN snapshots with no week field. Keep only the latest snapshot.
- **The 2026 season opened on a Wednesday.** Derive week and season from `games.csv`, never from date heuristics.
- **Stat corrections** land Monday–Wednesday, so re-pull on Thursday.

---

## 4. Architecture — "static-first, thin edge"

```
             ┌──────────────────── GitHub Actions (public repo, free minutes) ───────────────────┐
             │  Python ETL (pinned: nflreadpy 0.1.5 or polars/duckdb on parquet URLs)             │
             │  polls nflverse timestamp.json → rebuilds only what changed (idempotent)           │
 nflverse ──▶│  players.json (trimmed Sleeper DB + ID map) · usage/xFP · env (implied totals,     │──▶ content-hashed JSON shards
 Sleeper  ──▶│  pace, PROE) · matchup tables · P(play) table · props-implied (v1) · weather (v1)  │    + manifest.json
 OddsAPI  ──▶│                                                                                    │    → GitHub Pages (custom domain)
             │  archive job → PRIVATE repo/bucket (raw inputs incl. third-party data; never public)│
             └────────────────────────────────────────────────────────────────────────────────────┘
                                                   │
   Browser / TWA (PWA)                             ▼
   Vite + TypeScript + Preact · vite-plugin-pwa (Workbox) · IndexedDB (idb) · Comlink Web Worker
   • Sleeper league import direct from api.sleeper.app (CORS)       • Sleeper projections fetched on-device
   • scoring engine + optimizer + Monte Carlo in a Worker            • factor-breakdown explanations
                                                   │ (v1+)
                                                   ▼
   Cloudflare Worker (free tier): /espn (stateless private-league cookie pass-through) · /llm (Claude proxy,
   Turnstile + per-user quota) · /yahoo/oauth · Cron Trigger → repository_dispatch for game-day refreshes
```

Key decisions and why:

- **Custom domain from day 1, with DNS on Cloudflare.**
  - The TWA's `/.well-known/assetlinks.json` must sit at the origin root, which a `user.github.io/repo` project site can't provide. `[verified]`
  - It lets us move hosting to Cloudflare before monetizing without breaking users. Cost: ~$10–15/yr. `[design]`
- **Deploy with `actions/upload-pages-artifact` v5 using `include-hidden-files: true`.** v4+ silently drops dotfiles, and with them `assetlinks.json`. Add a post-deploy check. `[reported]`
- **No JSON committed to git.** Deploy artifacts instead of committing data, which would bloat history.
- **Content-hashed shards + a `manifest.json` fetched with `cache: 'no-cache'`.** This works around Pages' fixed 10-minute cache. `[reported]`
- **Odd-minute crons with an IANA `timezone`.** Scheduled jobs can run late or be **dropped** under load `[verified]`. So:
  - show a "data as of" banner in the app
  - add `workflow_dispatch` for manual runs
  - in v1, use a Cloudflare Cron Trigger as the reliable game-day scheduler
- **Keep-alive.** Public-repo crons are disabled after 60 days without repo activity, which would hit in the offseason. `[verified]`
- **Archive in a private repo or bucket.** This repo is public `[verified]`, and the raw archive holds RotoWire, ESPN and FantasyPros-derived data. Only our own derived outputs, plus CC-BY data with attribution, go on the public site.
- **Licensing rule:** the public site gets derived numbers only. FTN- and ffopportunity-derived **datasets** are CC-BY-SA, so we publish aggregates with attribution and don't publish them as a dataset product. `[design]`
- **No DuckDB-WASM.** The client data is <1 MB/week of JSON. Monte Carlo is fast enough in JS: 50k matchup sims ≈ 36 ms, and 10k full 12-team seasons ≈ 0.3 s in V8 `[verified]` (benchmark). Expect phones to be 3–5× slower.
- **Internal data model** (platform-neutral, modelled on ffscrapr's outputs):
  - **League:** settings, `ScoringRules` (map of stat key → points), `RosterSlots`
  - **Team, Roster:** starters / bench / IR / taxi
  - **Player:** `sleeper_id` key + gsis / pfr / espn / fantasypros IDs
  - **Projection:** stat line per source
  - **Distribution:** mean, P(play), quantiles, factor breakdown
  - **Transaction**

  Platform adapters (Sleeper now; ESPN, Yahoo, MFL later) map into it.

**Proposed repo layout:**
```
app/                 Vite PWA (TS + Preact)
  src/adapters/      sleeper.ts (espn.ts later)
  src/engine/        scoring.ts · projection.ts · availability.ts · lineup.ts · winprob.ts · waiver.ts · trade.ts
  src/workers/       sim.worker.ts
pipeline/            Python ETL (uv + lockfile), jobs/{players,nflverse,odds,weather,archive}.py
contracts/           JSON Schemas shared by pipeline and app (validated on both sides)
.github/workflows/   deploy.yml · etl.yml · gameday.yml · archive.yml · keepalive.yml
docs/                PLAN.md · research/
```

---

## 5. Roadmap (anchored to the NFL calendar)

Weeks below are NFL weeks (Week N's Thursday game ≈ Oct 15 + 7·(N−6)). Effort assumes one developer working part-time; tell me your real weekly hours and I'll re-cut it.

### Phase 0 — Foundations and de-risking · **Oct 15 – 21 (before Week 7)**
- [ ] Decisions in §8 confirmed.
- [ ] **Start the archive cron immediately** (the highest-urgency item). Weekly snapshots of Sleeper projections, `/players/nfl` injury fields, nflverse injuries (daily), lines, and DynastyProcess ECR (dev benchmark), saved to a private repo.
- [ ] Scaffold the repo (app + pipeline + contracts), CI (lint, typecheck, tests), custom domain, and a Pages deploy with hidden files and an assetlinks check.
- [ ] **Spikes**, each answered with a recorded result:
  - (a) Sleeper CORS from the deployed origin
  - (b) Sleeper projections shape and the `company` field
  - (c) whether failed waiver claims carry `waiver_bid` (needs one of your FAAB leagues)
  - (d) ESPN public-league CORS (for later)
- [ ] Only if monetizing is a goal: emails to Sleeper (commercial licence), FantasyCalc, and FantasyPros (Commercial API quote). File the Yahoo application only if Yahoo matters.

**Exit:** the archive is running; the deploy pipeline is green; spike results are written into `docs/research/spikes.md`.

### Phase 1 — MVP "Lineups and Waivers" · **Oct 22 – Nov 8 (usable for Week 10)**
- [ ] Sleeper import: username → leagues → league, rosters, users, matchups. IndexedDB cache and multi-league switcher.
- [ ] Pipeline outputs:
  - `players.json` (trimmed Sleeper DB joined to the ID map)
  - usage (shares, xFP)
  - environment (implied team totals, pace, PROE)
  - P(play) table v0
  - daily injury snapshot
  - latest depth chart
- [ ] **Scoring engine**, generic over any `scoring_settings` key and any `roster_positions` slot.
  - **Golden test:** recompute past weeks' player points from nflverse stats with the league's rules, and match Sleeper's `players_points` from matchups. Every mismatch is a scoring bug we find before users do.
- [ ] Projections v0 = mean of Sleeper (RotoWire) and the in-house baseline, rescored. Distribution = P(play) mixture × σ(position, μ).
- [ ] Start/sit: optimal lineup, gain vs. current lineup, FLEX/late-swap hint, analytic win prob vs. actual opponent.
- [ ] Waiver board: lineup gain over the next 3 weeks plus ROS-lite, opportunity-shock flag, usage trend, trending adds (with Sleeper attribution).
- [ ] Factor-breakdown explanations; freshness badges; attribution and licence page; offline shell.

**Exit:**
- the scoring engine matches Sleeper points on ≥3 past weeks for every league you play in
- the app gives a lineup for Week 10 that you'd act on
- installable PWA

### Phase 2 — v1 "Trades, FAAB, Matchups" · **Nov 9 – Dec 13 (ready before Week 15 playoffs)**
- [ ] Trade analyzer: week-by-week ROS lineup change for both sides, a season sim for playoff and title odds (Web Worker, common random numbers), FantasyCalc market value shown separately. Target: before typical trade deadlines (~Weeks 11–13).
- [ ] FAAB recommender, if spike (c) passed; otherwise a value-based max bid only.
- [ ] Usage and regression module: xTD, buy-low/sell-high flags.
- [ ] Matchup layer v1: opponent-adjusted xFP allowed (shrunk, capped), CB room vulnerability (labelled "estimate"), FTN blitz and pressure rates, NWS weather, 2023–25 coverage priors (labelled "historical"). Each one is capped until backtested.
- [ ] Odds API props → implied player projections added as a consensus input.
- [ ] P(win) lineup tiebreaker; **playoff mode**, where a single-elimination week maximizes P(win) outright.
- [ ] P(play) v1 logistic model trained on 2017–2025 injuries joined to snaps; game-day layer from Sleeper injury status.
- [ ] Accuracy ledger v0: weekly MAE vs. the Sleeper-only and FantasyPros ECR baselines, kept private while it stabilizes.
- [ ] *Optional:* ESPN **public**-league import (browser-direct), if spike (d) passed.
- [ ] *Optional, Play:* start the closed test (12 testers × 14 days for a new personal developer account `[reported]`) with league-mates; target API 36 `[reported]`.

**Exit:**
- you can run your fantasy playoffs on it
- the ledger shows our consensus at least matching the Sleeper-only baseline (otherwise we find out why)

### Phase 3 — Offseason build · **Jan – Jul 2027**
- [ ] **Backtest everything** on the 2026 archive plus nflverse 2021–2025 (walk-forward, as-of Sunday morning). Fit σ(position, μ), shrinkage *k* per metric, matchup caps and P(play). Publish the calibration page.
- [ ] Cloudflare Worker: ESPN private leagues (stateless cookie pass-through; 401 → prompt for cookies), LLM proxy, Cron Trigger scheduler.
- [ ] **LLM layer**, grounded only in computed JSON with a post-check of every number:
  - (1) blurbs generated in the pipeline via the Batch API
  - (2) "Ask the analyst" chat via tool use (`get_projection`, `simulate_lineup`, `compare_trade`), with a bring-your-own-key option
  - Play's AI-content policy requires an in-app report/flag button. `[reported]`
- [ ] Dynasty mode (FantasyCalc market + ROS lineup value, contender/rebuilder fit); superflex, TE-premium and IDP replacement levels; K and DST.
- [ ] Draft assistant for Aug 2027 (ADP from the FFC API, value-based drafting under league scoring).
- [ ] **Monetization decision** based on licensing replies. If yes: move the app shell to Cloudflare Workers static assets and data to R2, add Play Billing (Digital Goods API) with server-side verification, and compare against Play's US alternative-billing programs.
- [ ] More platforms: MFL (Worker; 60 calls/min), Yahoo (only if approved; OAuth via the Worker), Fleaflicker.

### Phase 4 — 2027 season launch · **Aug – Sep 2027**
Play production release, public accuracy ledger, multi-platform import, draft tools, and possibly a paid tier if licensing allows.

---

## 6. Testing and validation

- **Scoring golden tests** against Sleeper's own computed points (see above). This is the strongest correctness check we have.
- **Contract tests:** JSON Schemas in `contracts/` validated in the pipeline before publishing and in the app on load. The pipeline fails soft (keeps the last good shard) and opens an issue when row counts drop by more than X% or columns change. nflverse schemas *have* changed: injuries lost `date_modified` in 2026 `[verified]`.
- **Engine unit tests:** lineup legality for every slot type (SUPER_FLEX, REC_FLEX, WRRB_FLEX, IDP_FLEX); bonus-threshold expectations; Monte Carlo seeded and reproducible.
- **Backtest harness** (pipeline, Python), walk-forward, with no leakage:
  - MAE and RMSE by position
  - Spearman correlation
  - 80% interval coverage and pinball loss
  - Brier score and log-loss for P(play) and win probability
  - start/sit accuracy on contested pairs vs. the Sleeper-only and ECR baselines
- **Pre-registered success bars** `[design]`, written down before we look at results:
  - consensus MAE ≤ the best single source
  - P(play) Brier score better than the base-rate table
  - each matchup adjustment shows a positive residual lift over consensus, or it stays off

---

## 7. Top risks

| Risk | Severity | Mitigation |
|---|---|---|
| Sleeper changes terms or CORS, or objects to the app | High | Non-commercial launch; one fetch wrapper so a proxy can be switched on; Sleeper import isolated behind an adapter; manual roster paste as a fallback |
| Undocumented Sleeper projections break mid-season (one community report already says the v1 path went empty in 2026 `[reported]`) | Medium | Try both hosts; check responses actually contain stats; the in-house baseline and props keep the consensus alive; health badge |
| PFR-sourced nflverse data (snaps, advanced stats) goes stale | Medium | Freshness badges; Sleeper stats fallback for snaps; usage metrics that don't need snaps (target, air-yards and xFP shares) |
| GitHub cron delays or drops on Sunday | Medium | "Data as of" banner; Cloudflare Cron Trigger (v1); Questionable players in FLEX by default |
| False precision (matchups, win %, injuries) erodes trust | High | Caps, labels ("estimate", "historical"), intervals, published calibration; adjustments stay off until backtests show lift |
| Licensing blocks monetization (Sleeper, FantasyPros "competes" clause, FantasyCalc, RotoWire) | High | Ask early; a source-agnostic engine; value comes from computation, not from republished data |
| Solo-dev time: the season clock beats the roadmap | High | Phase 1 scope is fixed; anything slipping past Week 13 moves to the offseason; the archive keeps running regardless |
| ESPN cookie handling (full-account session credential) | Medium (v1+) | Stateless pass-through, no logging, host allowlist, on-device storage with a "forget" button, Play Data-safety disclosure |

---

## 8. Decisions I need from you (please confirm or change)

1. **Monetization intent.** My recommendation: free and non-commercial for 2026, decide by spring 2027 after licensing replies. This drives hosting, licences and billing.
2. **League formats to prioritize.** Redraft vs. dynasty/keeper; superflex, TE premium, IDP, best ball? I'll build the engine generically, but tests and UI polish follow your priorities. *Which leagues do you play in on Sleeper?* I'd like to use them as the golden-test fixtures.
3. **Stack.** Vite + **TypeScript** + Preact for the app and **Python** for the pipeline (parquet and stats tooling are far better there). Or do your other PWAs use a stack you'd rather keep (e.g., vanilla JS or Svelte)?
4. **Custom domain.** Do you have one to use, ideally with DNS on Cloudflare? It's needed for the TWA's asset links.
5. **Budget.** $0 for the MVP. v1: The Odds API ($0 on the free tier with a weekly prop snapshot, or $30/mo), and Claude API usage if you want the LLM layer before 2027. The verified per-million-token prices are Haiku 5.5 $0.10/$0.50, Sonnet 5.5 $2/$10, Opus 5.5 $4/$20 (input/output). The model choice per feature is yours; I'd default the analyst chat to Opus 5.5 and let you trade down for cost.
6. **Play account.** Personal or organization? A personal account created after Nov 2023 needs the 12-tester/14-day closed test.
7. **Platforms after Sleeper.** Does ESPN or Yahoo matter to you or your league-mates this season?

When you confirm, I'll start Phase 0. The archive cron is the first thing I'll ship, because it loses value every week it waits.
