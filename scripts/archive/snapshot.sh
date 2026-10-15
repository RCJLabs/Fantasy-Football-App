#!/usr/bin/env bash
# Snapshot fantasy-football inputs that can't be recreated later (in-week projection
# movement, daily injury states), encrypt them with age, and upload them to a monthly
# release. Only the holder of the age identity (private key) can read the snapshots;
# the raw third-party data is never published in readable form.
#
# Env: ARCHIVE_MODE=auto|full (full = all remaining weeks + players dump + injuries),
#      GH_TOKEN and GH_REPO (for `gh release`), GITHUB_STEP_SUMMARY (optional).
set -euo pipefail

SLEEPER=https://api.sleeper.app/v1
SLEEPER_WEB=https://api.sleeper.com
NFLVERSE=https://github.com/nflverse/nflverse-data/releases/download
UA="Fantasy-Football-App archive (+https://github.com/RCJLabs/Fantasy-Football-App)"
POSITIONS=(QB RB WR TE K DEF DL LB DB)
MODE="${ARCHIVE_MODE:-auto}"
LAST_REG_WEEK=18

here="$(cd "$(dirname "$0")" && pwd)"
recipient="$(cat "$here/recipient.txt")"
ts="$(date -u +%Y%m%dT%H%M%SZ)"
hour="$(date -u +%H)"
work="$(mktemp -d)"
out="$work/snap"
mkdir -p "$out"
manifest="$out/manifest.jsonl"
oks=0
fails=0

# fetch NAME URL — saves to $out/NAME and appends a manifest line. Never fails the script.
fetch() {
  local name="$1" url="$2" code bytes
  code=$(curl -sS -g -L --retry 3 --retry-delay 5 --max-time 180 -A "$UA" \
    -o "$out/$name" -w '%{http_code}' "$url" || true)
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

fetch state.json "$SLEEPER/state/nfl"
season=$(date -u +%Y); week=0; stype=regular
if [ -f "$out/state.json" ]; then
  season=$(jq -r '.season // empty' "$out/state.json")
  week=$(jq -r '.week // 0' "$out/state.json")
  stype=$(jq -r '.season_type // "regular"' "$out/state.json")
fi

# Projections: current + next week on every run; all remaining weeks once a day (12:xx UTC) or in full mode.
if [ "$week" -ge 1 ] && [ "$stype" = regular ]; then
  last=$((week + 1))
  if [ "$MODE" = full ] || [ "$hour" = 12 ]; then last=$LAST_REG_WEEK; fi
  [ "$last" -gt "$LAST_REG_WEEK" ] && last=$LAST_REG_WEEK
  qs=""
  for p in "${POSITIONS[@]}"; do qs="${qs}&position[]=${p}"; done
  for ((w = week; w <= last; w++)); do
    name="proj_w$(printf %02d "$w").json"
    fetch "$name" "$SLEEPER_WEB/projections/nfl/$season/$w?season_type=$stype$qs"
    # Fallback to the older v1 path if the web host fails or returns an empty list.
    if [ ! -f "$out/$name" ] || [ "$(jq 'length' "$out/$name" 2>/dev/null || echo 0)" = 0 ]; then
      fetch "proj_v1_w$(printf %02d "$w").json" "$SLEEPER/projections/nfl/$stype/$season/$w"
    fi
  done
fi

fetch trending_add.json "$SLEEPER/players/nfl/trending/add?lookback_hours=24&limit=200"
fetch trending_drop.json "$SLEEPER/players/nfl/trending/drop?lookback_hours=24&limit=200"

# Sleeper asks for the full players dump at most once a day: only the 12:xx UTC run fetches it.
if [ "$MODE" = full ] || [ "$hour" = 12 ]; then
  fetch players.json "$SLEEPER/players/nfl"
fi

# nflverse keeps only the latest row per player-week, so snapshot it twice a day.
if [ "$MODE" = full ] || [ "$hour" = 08 ] || [ "$hour" = 20 ]; then
  fetch "injuries_${season}.csv" "$NFLVERSE/injuries/injuries_${season}.csv"
fi

if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    echo "### Archive snapshot $ts (season $season, week $week, $stype, mode $MODE)"
    echo
    echo "| file | http | bytes |"
    echo "|---|---|---|"
    jq -r '"| \(.name) | \(.http) | \(.bytes) |"' "$manifest"
  } >>"$GITHUB_STEP_SUMMARY"
fi

if [ "$oks" -le 1 ]; then
  echo "Only $oks fetch(es) succeeded; not uploading." >&2
  exit 1
fi

asset="snap_${season}w$(printf %02d "$week")_${ts}.tar.gz.age"
tar -C "$work" -czf - snap | age -r "$recipient" -o "$work/$asset"

tag="archive-${season}-$(date -u +%m)"
if ! gh release view "$tag" >/dev/null 2>&1; then
  gh release create "$tag" --prerelease --title "Encrypted input archive $tag" \
    --notes "age-encrypted snapshots of fantasy inputs for private backtesting. Unreadable without the private key; not for redistribution." \
    || gh release view "$tag" >/dev/null # another run may have created it concurrently
fi
gh release upload "$tag" "$work/$asset"
echo "Uploaded $asset to $tag ($oks ok, $fails failed)"
