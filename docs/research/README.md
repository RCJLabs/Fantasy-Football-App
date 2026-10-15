# Research notes (2026-10-15)

Raw output of the research pass behind [`../PLAN.md`](../PLAN.md). Each file has the same layout:

1. **SUMMARY**: the researcher's conclusions.
2. **VERIFICATION**: an independent fact-checker tried to refute the load-bearing claims. Each check has a verdict: `confirmed`, `corrected`, `refuted` or `unverifiable`. **Where a verdict conflicts with the summary or findings, trust the verdict.**
3. **FINDINGS / RECOMMENDATIONS / RISKS / OPEN QUESTIONS**: the researcher's itemized notes, each with source and confidence.

| File | Topic |
|---|---|
| [platforms.md](platforms.md) | League import: Sleeper, ESPN, Yahoo, MFL, Fleaflicker, player ID mapping |
| [sources.md](sources.md) | Expert consensus, projections, betting markets, trade values, news, licensing |
| [data.md](data.md) | nflverse datasets, usage metrics, matchup/scheme data availability (free vs paid) |
| [methods.md](methods.md) | Consensus, distributions, start/sit, usage, matchups, injuries, trades, FAAB, validation |
| [architecture.md](architecture.md) | Hosting, pipeline, Cloudflare edge, LLM costs, Google Play/TWA, competitors |
| [plan-review.md](plan-review.md) | Four critics' review of plan v1 (evidence, feasibility, completeness, football methodology): the reasons for v2's changes |

## Limits of this research

- **Live sports hosts were blocked.** The sandbox blocked direct requests to api.sleeper.app, ESPN, FantasyPros and others.
- **Web search budget ran out.** It was exhausted partway through, so several fact-checks fell back to other sources:
  - GitHub repositories, including vendor docs repos (`github/docs`, `cloudflare/cloudflare-docs`)
  - downloaded nflverse files
  - third-party captures of vendor pages
- **What is solid vs. what still needs checking.**
  - **Primary-source checks are strongest.** Everything about nflverse data (timestamps, columns, sizes, CORS headers) was verified against live files on 2026-10-15.
  - **Needs a browser check before we depend on it.** Vendor prices and terms (FantasyPros, The Odds API, FantasyCalc, Fantasy Nerds, PFF) come from third-party captures. Several 2026 platform changes are single-source: the Yahoo API approval gate, NFL.com Fantasy moving to ESPN, and the Sleeper projections path breaking.
