# Fantasy Football Assistant

A Sleeper-first fantasy football decision engine, built as an installable PWA. Enter a Sleeper username and it:

- **imports every league** you play in this season;
- **rescores projections** to each league's exact scoring;
- **recommends your lineup** against your actual opponent, accounting for injuries, practice reports, byes and kickoff locks;
- **ranks free agents** by how much they'd improve this week.

**Status:** Phase 1 MVP. See [docs/PLAN.md](docs/PLAN.md) for the plan and roadmap, [docs/spikes.md](docs/spikes.md) for what the Sleeper endpoints actually return, and [docs/research/](docs/research/) for the research behind the design.

## How it works

| Piece | Where |
|---|---|
| League import (username → leagues → rosters, matchups) | `app/src/sleeper/` — browser calls Sleeper's read-only API directly (CORS-enabled) |
| Projections | RotoWire, via Sleeper's projections endpoint, fetched on the device |
| Scoring, availability, lineup optimizer, win probability | `app/src/engine/` (pure functions, unit-tested) |
| League analysis (problems, changes, waivers) | `app/src/analysis/` |
| Daily data (player DB + practice reports, kickoff times, implied totals) | `pipeline/` → `dist/data/*.json`, built by `.github/workflows/deploy.yml` |
| Encrypted input archive for backtesting | `.github/workflows/archive.yml`, `scripts/archive/` |

The lineup optimizer maximizes expected points. It also values the option to swap a Questionable starter for a later-kickoff backup if he's ruled inactive, and it never moves players whose games have started.

## Develop

```sh
npm ci                 # .npmrc sets legacy-peer-deps (works around an npm resolver bug)
npm run dev            # Vite dev server
npm test               # unit tests (engine, analysis, pipeline helpers)
npm run typecheck
npm run e2e            # Playwright against the built app, with Sleeper mocked
npm run data -- --out app/public/data   # build the data files locally (needs network access to Sleeper and GitHub)
```

Without the data files the app still works. It falls back to Sleeper's player dump and to approximate kickoff times, and shows a note saying so.

## Deploy

`deploy.yml` builds the app and the data files, then publishes them to GitHub Pages:

- on every push to `main`
- once a day at ~12:07 ET, to refresh injuries, practice reports and lines

One-time setup: **Settings → Pages → Build and deployment → Source: GitHub Actions**.

## Data and terms

- **Sleeper:** league, player and projection data are fetched from Sleeper's API for personal, non-commercial use. RotoWire is the projection provider.
- **nflverse:** schedule and practice reports, CC-BY 4.0.
- **Not affiliated** with Sleeper, RotoWire, the NFL or any team.
