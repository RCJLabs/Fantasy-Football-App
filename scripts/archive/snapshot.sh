#!/usr/bin/env bash
# Snapshot fantasy-football inputs that can't be recreated later (in-week projection
# movement, daily injury states), encrypt them with age, and upload them to a monthly
# release. Only the holder of the age identity (private key) can read the snapshots;
# the raw third-party data is never published in readable form.
#
# Env: ARCHIVE_MODE=auto|full (full = all remaining weeks + players dump + injuries),
#      GH_TOKEN and GH_REPO (for `gh release` and `gh api`), GITHUB_STEP_SUMMARY (optional),
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
repo="${GH_REPO:-RCJLabs/Fantasy-Football-App}"

here="$(cd "$(dirname "$0")" && pwd)"
recipient="$(cat "$here/recipient.txt")"
ts="$(date -u +%Y%m%dT%H%M%SZ)"
today="${ts%%T*}"
hour=$((10#${ts:9:2}))
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

# release_assets TAG — "<id> <name>" for each asset of a release, paged (a month holds hundreds). Fails if it can't be read.
release_assets() {
  local id
  id="$(gh api "repos/$repo/releases/tags/$1" --jq .id 2>/dev/null)" || return 1
  gh api --paginate "repos/$repo/releases/$id/assets?per_page=100" --jq '.[] | "\(.id) \(.name)"' 2>/dev/null
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
tag="archive-${season}-$(date -u +%m)"

# Daily jobs run in the first snapshot of the day (UTC) at or after their hour. GitHub starts scheduled runs up to an
# hour late and skips some, so a fixed hour missed days. A run that does a job at or after its hour uploads a public
# marker, daily_<timestamp>_<job>.json (no data), and later runs that day skip the job. If this month's markers can't
# be listed, a job runs only in its own hour, as before.
if names="$(release_assets "$tag")"; then
  done_today="$(sed -n "s/^[0-9]* daily_${today}T[0-9]*Z_\([a-z0-9]*\)\.json\$/\1/p" <<<"$names")"
else
  done_today="?"
fi
marks=()
# due JOB HOUR — whether this run does JOB (always, in full mode).
due() {
  [ "$MODE" = full ] && return 0
  if [ "$done_today" = "?" ]; then
    [ "$hour" -eq "$2" ]
  else
    [ "$hour" -ge "$2" ] && ! grep -qx "$1" <<<"$done_today"
  fi
}
# mark JOB HOUR — JOB succeeded: mark it done today, if this run is at or after its hour.
mark() { if [ "$hour" -ge "$2" ]; then marks+=("$1"); fi; }

# Projections: current + next week on every run; all remaining weeks once a day (from 12:00 UTC) or in full mode.
if [ "$week" -ge 1 ] && [ "$stype" = regular ]; then
  last=$((week + 1))
  if [ "$last" -lt "$LAST_REG_WEEK" ] && due weeks 12; then last=$LAST_REG_WEEK; fi
  [ "$last" -gt "$LAST_REG_WEEK" ] && last=$LAST_REG_WEEK
  qs=""
  for p in "${POSITIONS[@]}"; do qs="${qs}&position[]=${p}"; done
  saved=0
  for ((w = week; w <= last; w++)); do
    name="proj_w$(printf %02d "$w").json"
    fetch "$name" "$SLEEPER_WEB/projections/nfl/$season/$w?season_type=$stype$qs"
    # Fallback to the older v1 path if the web host fails or returns an empty list.
    if [ ! -f "$out/$name" ] || [ "$(jq 'length' "$out/$name" 2>/dev/null || echo 0)" = 0 ]; then
      name="proj_v1_w$(printf %02d "$w").json"
      fetch "$name" "$SLEEPER/projections/nfl/$stype/$season/$w"
    fi
    slim "$name" "$SLIM_PROJ"
    if [ -f "$out/$name" ]; then saved=$((saved + 1)); fi
  done
  if [ "$last" -gt $((week + 1)) ] && [ "$saved" -eq $((last - week + 1)) ]; then mark weeks 12; fi
fi

fetch trending_add.json "$SLEEPER/players/nfl/trending/add?lookback_hours=24&limit=200"
fetch trending_drop.json "$SLEEPER/players/nfl/trending/drop?lookback_hours=24&limit=200"

# Sleeper asks for the full players dump at most once a day: the first run from 12:00 UTC fetches it.
if due players 12; then
  fetch players.json "$SLEEPER/players/nfl"
  slim players.json "$SLIM_PLAYERS"
  if [ -f "$out/players.json" ]; then mark players 12; fi
fi

# nflverse keeps only the latest row per player-week, so snapshot it twice a day: from 08:00 and from 20:00 UTC.
if [ "$hour" -ge 20 ]; then inj=20; else inj=8; fi
if due "injuries$inj" "$inj"; then
  fetch "injuries_${season}.csv" "$NFLVERSE/injuries/injuries_${season}.csv"
  if [ -f "$out/injuries_${season}.csv" ]; then mark "injuries$inj" "$inj"; fi
fi

# The app's own data files as deployed (player DB with practice reports, schedule, the in-house
# baseline): with this week's projections, exactly what the app showed at this moment.
SITE="${ARCHIVE_SITE:-https://rcjlabs.github.io/Fantasy-Football-App}"
fetch site_players.json "$SITE/data/players.json"
fetch site_schedule.json "$SITE/data/schedule.json"
fetch site_baseline.json "$SITE/data/baseline.json"

# Player props (The Odds API; docs/props.md): each game once, in the first run within 6 hours of its kickoff.
# The raw odds stay in this encrypted snapshot. props_meta.json (games fetched, credits; no odds) is published,
# and the hook skips the games earlier runs published. Only this hook gets the API key.
if [ -n "${PROPS_HOOK:-}" ] && [ -n "${ODDS_API_KEY:-}" ] && [ "${PROPS_MODE:-auto}" != off ]; then
  seen="$work/props-seen"
  mkdir -p "$seen"
  for m in "$(date -u +%m)" "$(date -u -d "$(date -u +%Y-%m-15) -1 month" +%m)"; do
    { release_assets "archive-${season}-$m" || true; } | while read -r id name; do
      case "$name" in
        props_*.json) gh api -H "Accept: application/octet-stream" "repos/$repo/releases/assets/$id" >"$seen/$name" 2>/dev/null || rm -f "$seen/$name" ;;
      esac
    done
  done
  read -r -a hook <<<"$PROPS_HOOK"
  env -u GH_TOKEN "${hook[@]}" "$out" "$seen" || echo "Props hook failed; continuing without props." >&2
fi

# Optional hook (the prediction ledger): runs on the snapshot before it's encrypted, without the
# GitHub token or the odds key, and never blocks the upload.
if [ -n "${SNAPSHOT_HOOK:-}" ]; then
  read -r -a hook <<<"$SNAPSHOT_HOOK"
  env -u GH_TOKEN -u ODDS_API_KEY "${hook[@]}" "$out" || echo "Snapshot hook failed; uploading without it." >&2
fi

if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    echo "### Archive snapshot $ts (season $season, week $week, $stype, mode $MODE)"
    echo
    echo "| file | http | bytes |"
    echo "|---|---|---|"
    jq -r '"| \(.name) | \(.http) | \(.bytes) |"' "$manifest"
    echo
    if [ ${#marks[@]} -gt 0 ]; then echo "Daily jobs done: ${marks[*]}"; else echo "Daily jobs done: none"; fi
    echo "Done earlier today: $(if [ "$done_today" = "?" ]; then echo "unknown (markers not listed)"; else echo "${done_today:-none}" | paste -sd' ' -; fi)"
    if [ -f "$out/commitment.json" ]; then
      echo
      jq -r '"Predictions committed: \(.players) players in \(.games | length) games (week \(.week)), sha256 `\(.sha256)`"' "$out/commitment.json"
    fi
    if [ -f "$out/props_meta.json" ]; then
      echo
      jq -r '"Props: \(.events | length) game(s)\(if .test then " (test)" else "" end), \([.events[].credits // 0] | add) credits; \(.remaining // "?") left this month"' "$out/props_meta.json"
    fi
  } >>"$GITHUB_STEP_SUMMARY"
fi

if [ "$oks" -le 1 ]; then
  echo "Only $oks fetch(es) succeeded; not uploading." >&2
  exit 1
fi

asset="snap_${season}w$(printf %02d "$week")_${ts}.tar.gz.age"
tar -C "$work" -czf - snap | age -r "$recipient" -o "$work/$asset"

if ! gh release view "$tag" >/dev/null 2>&1; then
  gh release create "$tag" --prerelease --title "Encrypted input archive $tag" \
    --notes "age-encrypted snapshots of fantasy inputs for private backtesting. Unreadable without the private key; not for redistribution. Each commit_*.json is the public SHA-256 of the predictions.json inside the snapshot with the same timestamp. Each props_*.json lists the games whose player props that snapshot holds (no odds). Each daily_*.json marks a once-a-day fetch that snapshot holds (no data)." \
    || gh release view "$tag" >/dev/null # another run may have created it concurrently
fi
# The commitment (SHA-256 of the predictions inside the bundle) is public: its upload time proves when they were made.
assets=("$work/$asset")
if [ -f "$out/commitment.json" ]; then
  cp "$out/commitment.json" "$work/commit_${season}w$(printf %02d "$week")_${ts}.json"
  assets+=("$work/commit_${season}w$(printf %02d "$week")_${ts}.json")
fi
# Which games' props this snapshot holds (ids, kickoffs, credits; no odds): later runs skip them.
if [ -f "$out/props_meta.json" ]; then
  cp "$out/props_meta.json" "$work/props_${season}w$(printf %02d "$week")_${ts}.json"
  assets+=("$work/props_${season}w$(printf %02d "$week")_${ts}.json")
fi
# Today's daily jobs this snapshot holds (no data): later runs today skip them.
for job in ${marks[@]+"${marks[@]}"}; do
  jq -nc --arg job "$job" --arg snapshot "$ts" '{job:$job, snapshot:$snapshot}' >"$work/daily_${ts}_${job}.json"
  assets+=("$work/daily_${ts}_${job}.json")
done
gh release upload "$tag" "${assets[@]}"
echo "Uploaded ${assets[*]##*/} to $tag ($oks ok, $fails failed)"
