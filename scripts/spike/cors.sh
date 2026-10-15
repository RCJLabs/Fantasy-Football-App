#!/usr/bin/env bash
# Spike (a): which endpoints a browser on our Pages origin may read (CORS response headers).
# Prints a markdown table; no response bodies.
set -uo pipefail
ORIGIN="${SPIKE_ORIGIN:-https://rcjlabs.github.io}"
UA="Fantasy-Football-App spike (+https://github.com/RCJLabs/Fantasy-Football-App)"

header() { printf '%s' "$1" | grep -i "^$2:" | head -1 | cut -d' ' -f2- | tr -d '\r'; }

check() {
  local label="$1" url="$2" h status
  h=$(curl -sS -g -D - -o /dev/null -H "Origin: $ORIGIN" -A "$UA" --max-time 90 "$url" 2>&1)
  status=$(printf '%s' "$h" | head -1 | tr -d '\r')
  echo "| $label | \`${url}\` | $status | $(header "$h" access-control-allow-origin) | $(header "$h" access-control-allow-credentials) | $(header "$h" cache-control) |"
}

echo "### CORS from \`$ORIGIN\`"
echo
echo "| check | url | status | allow-origin | allow-credentials | cache-control |"
echo "|---|---|---|---|---|---|"
check a1-state "https://api.sleeper.app/v1/state/nfl"
check a1-trending "https://api.sleeper.app/v1/players/nfl/trending/add?lookback_hours=24&limit=5"
check a2-projections-web "https://api.sleeper.com/projections/nfl/2026/7?season_type=regular&position[]=WR"
check a2-projections-v1 "https://api.sleeper.app/v1/projections/nfl/regular/2026/7"
check g-stats-web "https://api.sleeper.com/stats/nfl/2026/5?season_type=regular&position[]=WR"
check g-stats-v1 "https://api.sleeper.app/v1/stats/nfl/regular/2026/5"
check schedule-web "https://api.sleeper.com/schedule/nfl/regular/2026"
check nfldata-raw "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv"
echo
