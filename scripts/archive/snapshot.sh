#!/usr/bin/env bash
# Snapshot fantasy-football inputs that can't be recreated later (in-week projection
# movement, daily injury states), encrypt them with age, and upload them to a monthly
# release. Only the holder of the age identity (private key) can read the snapshots;
# the raw third-party data is never published in readable form.
#
# Env: ARCHIVE_MODE=auto|full (full = all remaining weeks + players dump + injuries),
#      GH_TOKEN and GH_REPO (for `gh release`), GITHUB_STEP_SUMMARY (optional),
#      SNAPSHOT_HOOK (optional command run on the snapshot dir before encryption; the prediction ledger),
#      ARCHIVE_SITE (the deployed app, default https://rcjlabs.github.io/Fantasy-Football-App).
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

# slim FILE JQ_FILTER — rewrite FILE through jq to drop fields we don't need (keeps the archive small).
slim() {
  local f="$out/$1"
  [ -f "$f" ] || return 0
  if jq -c "$2" "$f" >"$f.slim" 2>/dev/null; then mv "$f.slim" "$f"; else rm -f "$f.slim"; fi
}
# Projection rows embed a full player object; keep the fields that change week to week.
SLIM_PROJ='map({player_id, stats, team, opponent, game_id, date, status, company, updated_at, last_modified,
  position: .player.position, injury_status: .player.injury_status,
  injury_body_part: .player.injury_body_part, news_updated: .player.news_updated})'
# Players dump: only rostered or injured players, and only status/depth/ID fields.
SLIM_PLAYERS='with_entries(select(.value.team != null or .value.injury_status != null)
  | .value |= {player_id, full_name, position, fantasy_positions, team, status, active, years_exp, age,
    injury_status, injury_body_part, injury_start_date, injury_notes, practice_participation,
    practice_description, depth_chart_position, depth_chart_order, news_updated, search_rank,
    team_changed_at, gsis_id, espn_id, sportradar_id, rotowire_id, yahoo_id})'

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
      name="proj_v1_w$(printf %02d "$w").json"
      fetch "$name" "$SLEEPER/projections/nfl/$stype/$season/$w"
    fi
    slim "$name" "$SLIM_PROJ"
  done
fi

fetch trending_add.json "$SLEEPER/players/nfl/trending/add?lookback_hours=24&limit=200"
fetch trending_drop.json "$SLEEPER/players/nfl/trending/drop?lookback_hours=24&limit=200"

# Sleeper asks for the full players dump at most once a day: only the 12:xx UTC run fetches it.
if [ "$MODE" = full ] || [ "$hour" = 12 ]; then
  fetch players.json "$SLEEPER/players/nfl"
  slim players.json "$SLIM_PLAYERS"
fi

# nflverse keeps only the latest row per player-week, so snapshot it twice a day.
if [ "$MODE" = full ] || [ "$hour" = 08 ] || [ "$hour" = 20 ]; then
  fetch "injuries_${season}.csv" "$NFLVERSE/injuries/injuries_${season}.csv"
fi

# The app's own data files as deployed (player DB with practice reports, schedule, the in-house
# baseline): with this week's projections, exactly what the app showed at this moment.
SITE="${ARCHIVE_SITE:-https://rcjlabs.github.io/Fantasy-Football-App}"
fetch site_players.json "$SITE/data/players.json"
fetch site_schedule.json "$SITE/data/schedule.json"
fetch site_baseline.json "$SITE/data/baseline.json"

# Optional hook (the prediction ledger): runs on the snapshot before it's encrypted, without the
# GitHub token, and never blocks the upload.
if [ -n "${SNAPSHOT_HOOK:-}" ]; then
  read -r -a hook <<<"$SNAPSHOT_HOOK"
  env -u GH_TOKEN "${hook[@]}" "$out" || echo "Snapshot hook failed; uploading without it." >&2
fi

if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    echo "### Archive snapshot $ts (season $season, week $week, $stype, mode $MODE)"
    echo
    echo "| file | http | bytes |"
    echo "|---|---|---|"
    jq -r '"| \(.name) | \(.http) | \(.bytes) |"' "$manifest"
    if [ -f "$out/commitment.json" ]; then
      echo
      jq -r '"Predictions committed: \(.players) players in \(.games | length) games (week \(.week)), sha256 `\(.sha256)`"' "$out/commitment.json"
    fi
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
    --notes "age-encrypted snapshots of fantasy inputs for private backtesting. Unreadable without the private key; not for redistribution. Each commit_*.json is the public SHA-256 of the predictions.json inside the snapshot with the same timestamp." \
    || gh release view "$tag" >/dev/null # another run may have created it concurrently
fi
# The commitment (SHA-256 of the predictions inside the bundle) is public: its upload time proves when they were made.
assets=("$work/$asset")
if [ -f "$out/commitment.json" ]; then
  cp "$out/commitment.json" "$work/commit_${season}w$(printf %02d "$week")_${ts}.json"
  assets+=("$work/commit_${season}w$(printf %02d "$week")_${ts}.json")
fi
gh release upload "$tag" "${assets[@]}"
echo "Uploaded ${assets[*]##*/} to $tag ($oks ok, $fails failed)"
