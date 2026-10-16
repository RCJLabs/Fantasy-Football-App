#!/usr/bin/env bash
# Starts the daily deploy (the app's data build) when GitHub drops its schedule. Each archive run on main calls this;
# from 16:00 UTC it checks whether deploy.yml has started on main since 16:00 UTC today, and dispatches it if not.
# GitHub's scheduler skips runs under load: on 2026-10-16 the deploy's 16:07 UTC run never came.
#
# Needs GH_TOKEN (actions: write) and GH_REPO. NOW (epoch seconds) stands in for the clock in tests.
set -euo pipefail

now="${NOW:-$(date -u +%s)}"
day="$(date -u -d "@$now" +%F)"
hour="$((10#$(date -u -d "@$now" +%H)))"
summary="${GITHUB_STEP_SUMMARY:-/dev/null}"

if [ "$hour" -lt 16 ]; then
  echo "Before 16:00 UTC: today's deploy isn't due yet."
  exit 0
fi
since="${day}T16:00:00Z"

# deploy.yml runs on main created since then (a handful a day at most).
runs="$(gh api -X GET "repos/$GH_REPO/actions/workflows/deploy.yml/runs" -f branch=main -f "created=>=$since" -F per_page=50)"
total="$(jq '.workflow_runs | length' <<<"$runs")"
# Queued, waiting, in progress or succeeded: today's data build is done or on its way.
live="$(jq '[.workflow_runs[] | select(.status != "completed" or .conclusion == "success")] | length' <<<"$runs")"

if [ "$live" -gt 0 ]; then
  echo "Deploy started since $since ($total run(s)): nothing to do."
elif [ "$total" -ge 2 ]; then
  # Two failed attempts today: a third won't fix what broke them, and each failure emails the owner.
  echo "::warning::$total deploys since $since, none succeeded; not starting another."
  echo "Deploy watchdog: $total deploys since $since failed; not retrying." >>"$summary"
else
  gh workflow run deploy.yml --ref main
  if [ "$total" -eq 0 ]; then why="no deploy since $since"; else why="the deploy since $since failed"; fi
  echo "Started deploy.yml: $why."
  echo "Deploy watchdog: $why, so this run started one." >>"$summary"
fi
