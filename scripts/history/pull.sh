#!/usr/bin/env bash
# Pull past seasons' weekly Sleeper projections (RotoWire) and stats for private backtesting (the
# baseline blend gate in docs/PLAN.md), encrypt the bundle with age and upload it as a release asset.
# The log shows only row counts per week: the third-party data is never published in readable form.
#
# Env: HISTORY_SEASONS (default "2022 2023 2024 2025"; 2022 warms up the baseline's first weeks),
#      HISTORY_LAST_WEEK (default 18), GH_TOKEN and GH_REPO (for `gh release`), GITHUB_STEP_SUMMARY.
set -euo pipefail

SLEEPER_WEB=https://api.sleeper.com
UA="Fantasy-Football-App history pull (+https://github.com/RCJLabs/Fantasy-Football-App)"
POSITIONS=(QB RB WR TE K DEF)
TAG=history
seasons="${HISTORY_SEASONS:-2022 2023 2024 2025}"
last="${HISTORY_LAST_WEEK:-18}"

here="$(cd "$(dirname "$0")" && pwd)"
recipient="$(cat "$here/../archive/recipient.txt")"
work="$(mktemp -d)"
out="$work/history"
mkdir -p "$out"
manifest="$out/manifest.jsonl"
oks=0
fails=0

# fetch NAME URL — saves to $out/NAME and appends a manifest line (kept inside the encrypted bundle).
fetch() {
  local name="$1" url="$2" code bytes
  mkdir -p "$(dirname "$out/$name")"
  code=$(curl -sS -g -L --retry 3 --retry-delay 5 --max-time 120 -A "$UA" \
    -o "$out/$name" -w '%{http_code}' "$url" 2>/dev/null || true)
  bytes=0
  [ -f "$out/$name" ] && bytes=$(stat -c %s "$out/$name")
  jq -nc --arg name "$name" --arg url "$url" --arg http "${code:-000}" --argjson bytes "$bytes" \
    --arg at "$(date -u +%FT%TZ)" '{name:$name,url:$url,http:$http,bytes:$bytes,fetched_at:$at}' >>"$manifest"
  if [ "${code:-000}" = 200 ] && [ "$bytes" -gt 2 ]; then
    oks=$((oks + 1))
  else
    fails=$((fails + 1))
    rm -f "$out/$name"
  fi
}

# Rows embed today's player object (current team and injury, not as of that week): keep only what
# the backtest reads, plus the update times (to check nothing was revised after kickoff).
SLIM='map(select((.stats // {}) | length > 0)
  | {player_id, game_id, date, team, opponent, company, updated_at, last_modified, position: .player.position, stats})'
slim() {
  local f="$out/$1"
  [ -f "$f" ] || return 0
  if jq -c "$SLIM" "$f" >"$f.slim" 2>/dev/null; then mv "$f.slim" "$f"; else rm -f "$f.slim"; fi
}

qs=""
for p in "${POSITIONS[@]}"; do qs="${qs}&position[]=${p}"; done
for season in $seasons; do
  for ((w = 1; w <= last; w++)); do
    ww=$(printf %02d "$w")
    fetch "$season/proj_w$ww.json" "$SLEEPER_WEB/projections/nfl/$season/$w?season_type=regular$qs"
    slim "$season/proj_w$ww.json"
    fetch "$season/stats_w$ww.json" "$SLEEPER_WEB/stats/nfl/$season/$w?season_type=regular$qs"
    slim "$season/stats_w$ww.json"
  done
done

rows() { [ -f "$out/$1" ] && jq 'length' "$out/$1" || echo 0; }
withpts() { [ -f "$out/$1" ] && jq '[.[] | select((.stats.pts_ppr // 0) != 0)] | length' "$out/$1" || echo 0; }
summary="${GITHUB_STEP_SUMMARY:-/dev/stdout}"
{
  echo "### History pull: seasons $seasons, weeks 1–$last ($oks ok, $fails failed)"
  echo
  echo "| season | week | projection rows | with PPR | stat rows | with PPR |"
  echo "|---|---|---|---|---|---|"
  for season in $seasons; do
    for ((w = 1; w <= last; w++)); do
      ww=$(printf %02d "$w")
      echo "| $season | $w | $(rows "$season/proj_w$ww.json") | $(withpts "$season/proj_w$ww.json") | $(rows "$season/stats_w$ww.json") | $(withpts "$season/stats_w$ww.json") |"
    done
  done
} >>"$summary"

if [ "$oks" -eq 0 ]; then
  echo "Nothing fetched; not uploading." >&2
  exit 1
fi

asset="history_$(date -u +%Y%m%dT%H%M%SZ).tar.gz.age"
tar -C "$work" -czf - history | age -r "$recipient" -o "$work/$asset"
if ! gh release view "$TAG" >/dev/null 2>&1; then
  gh release create "$TAG" --prerelease --title "Encrypted history for backtests" \
    --notes "age-encrypted past-season projections and stats for private backtesting. Unreadable without the private key; not for redistribution." \
    || gh release view "$TAG" >/dev/null
fi
gh release upload "$TAG" "$work/$asset"
echo "Uploaded $asset to $TAG ($oks ok, $fails failed)"
