#!/usr/bin/env bash
# Pull one Sleeper user's leagues (settings, rosters, matchups, transactions, brackets, drafts) plus past-week
# projections and stats, and last season's finished leagues (brackets, scores, playoff-week projections);
# encrypt the bundle with age and upload it as a release asset. Used for private
# testing against real leagues: the username comes from the workflow_dispatch payload (never from the
# workflow file), is masked before anything is printed, and the log only shows counts.
#
# Env: SLEEPER_USERNAME (local runs) or GITHUB_EVENT_PATH with inputs.username (Actions),
#      GH_TOKEN and GH_REPO (for `gh release`).
set -euo pipefail

SLEEPER=https://api.sleeper.app/v1
SLEEPER_WEB=https://api.sleeper.com
UA="Fantasy-Football-App league pull (+https://github.com/RCJLabs/Fantasy-Football-App)"
POSITIONS=(QB RB WR TE K DEF DL LB DB)
LAST_REG_WEEK=18
TAG=league-pull
ASSET=league.tar.gz.age

mask() { [ -n "${GITHUB_ACTIONS:-}" ] && [ -n "$1" ] && echo "::add-mask::$1"; return 0; }

username="${SLEEPER_USERNAME:-}"
if [ -z "$username" ] && [ -n "${GITHUB_EVENT_PATH:-}" ]; then
  username="$(jq -r '.inputs.username // empty' "$GITHUB_EVENT_PATH")"
fi
username="$(printf '%s' "$username" | tr -d '[:space:]')"
mask "$username"
mask "${username,,}"
[ -n "$username" ] || { echo "No username given." >&2; exit 1; }

here="$(cd "$(dirname "$0")" && pwd)"
recipient="$(cat "$here/../archive/recipient.txt")"
work="$(mktemp -d)"
out="$work/league"
mkdir -p "$out"
manifest="$out/manifest.jsonl"
oks=0
fails=0

# fetch NAME URL — saves to $out/NAME; the manifest stays inside the encrypted bundle.
fetch() {
  local name="$1" url="$2" code bytes
  mkdir -p "$(dirname "$out/$name")"
  code=$(curl -sS -g -L --retry 3 --retry-delay 5 --max-time 120 -A "$UA" \
    -o "$out/$name" -w '%{http_code}' "$url" 2>/dev/null || true)
  bytes=0
  [ -f "$out/$name" ] && bytes=$(stat -c %s "$out/$name")
  jq -nc --arg name "$name" --arg url "$url" --arg http "${code:-000}" --argjson bytes "$bytes" \
    --arg at "$(date -u +%FT%TZ)" '{name:$name,url:$url,http:$http,bytes:$bytes,fetched_at:$at}' >>"$manifest"
  if [ "${code:-000}" = 200 ] && [ "$bytes" -gt 1 ]; then
    oks=$((oks + 1))
  else
    fails=$((fails + 1))
    rm -f "$out/$name"
  fi
}
slim() {
  local f="$out/$1"
  [ -f "$f" ] || return 0
  if jq -c "$2" "$f" >"$f.slim" 2>/dev/null; then mv "$f.slim" "$f"; else rm -f "$f.slim"; fi
}
SLIM_ROWS='map({player_id, stats, team, opponent, game_id, date, company, updated_at,
  position: .player.position, injury_status: .player.injury_status})'

fetch state.json "$SLEEPER/state/nfl"
season=$(jq -r '.season // empty' "$out/state.json" 2>/dev/null || date -u +%Y)
week=$(jq -r '.week // 0' "$out/state.json" 2>/dev/null || echo 0)

fetch user.json "$SLEEPER/user/$username"
user_id=$(jq -r '.user_id // empty' "$out/user.json" 2>/dev/null || true)
mask "$user_id"
[ -n "$user_id" ] || { echo "User not found." >&2; exit 1; }

fetch leagues.json "$SLEEPER/user/$user_id/leagues/nfl/$season"
mapfile -t league_ids < <(jq -r '.[].league_id' "$out/leagues.json" 2>/dev/null || true)
for id in "${league_ids[@]}"; do mask "$id"; done

last_tx=$((week + 1))
[ "$last_tx" -gt "$LAST_REG_WEEK" ] && last_tx=$LAST_REG_WEEK
for id in "${league_ids[@]}"; do
  d="leagues/$id"
  fetch "$d/rosters.json" "$SLEEPER/league/$id/rosters"
  fetch "$d/users.json" "$SLEEPER/league/$id/users"
  fetch "$d/traded_picks.json" "$SLEEPER/league/$id/traded_picks"
  fetch "$d/winners_bracket.json" "$SLEEPER/league/$id/winners_bracket"
  fetch "$d/losers_bracket.json" "$SLEEPER/league/$id/losers_bracket"
  # Drafts and their picks: the draft helper's order, rounds and keeper costs (docs/draft.md).
  fetch "$d/drafts.json" "$SLEEPER/league/$id/drafts"
  mapfile -t draft_ids < <(jq -r '.[]?.draft_id // empty' "$out/$d/drafts.json" 2>/dev/null || true)
  for did in "${draft_ids[@]}"; do
    mask "$did"
    fetch "$d/draft_picks_$did.json" "$SLEEPER/draft/$did/picks"
    fetch "$d/draft_traded_$did.json" "$SLEEPER/draft/$did/traded_picks"
  done
  for ((w = 1; w <= LAST_REG_WEEK; w++)); do
    fetch "$d/matchups_w$(printf %02d "$w").json" "$SLEEPER/league/$id/matchups/$w"
  done
  for ((w = 1; w <= last_tx; w++)); do
    fetch "$d/transactions_w$(printf %02d "$w").json" "$SLEEPER/league/$id/transactions/$w"
  done
done

# Past weeks: pre-game projections (approximate as-of-kickoff, see docs/spikes.md (e)) and actual stats,
# for the scoring golden test and the accuracy ledger.
qs=""
for p in "${POSITIONS[@]}"; do qs="${qs}&position[]=${p}"; done
for ((w = 1; w <= week; w++)); do
  ww=$(printf %02d "$w")
  fetch "proj_w$ww.json" "$SLEEPER_WEB/projections/nfl/$season/$w?season_type=regular$qs"
  slim "proj_w$ww.json" "$SLIM_ROWS"
  fetch "stats_w$ww.json" "$SLEEPER_WEB/stats/nfl/$season/$w?season_type=regular$qs"
  slim "stats_w$ww.json" "$SLIM_ROWS"
done

# Last season's leagues, finished: brackets with every round decided, weekly scores, and projections for the weeks
# around the playoffs, to replay the playoffs through the app's bracket code (docs/title-odds.md).
prev=$((season - 1))
fetch "prev/leagues.json" "$SLEEPER/user/$user_id/leagues/nfl/$prev"
mapfile -t prev_ids < <(jq -r '.[].league_id' "$out/prev/leagues.json" 2>/dev/null || true)
for id in "${prev_ids[@]}"; do mask "$id"; done
for id in "${prev_ids[@]}"; do
  d="prev/leagues/$id"
  fetch "$d/rosters.json" "$SLEEPER/league/$id/rosters"
  fetch "$d/users.json" "$SLEEPER/league/$id/users"
  fetch "$d/winners_bracket.json" "$SLEEPER/league/$id/winners_bracket"
  fetch "$d/losers_bracket.json" "$SLEEPER/league/$id/losers_bracket"
  for ((w = 1; w <= LAST_REG_WEEK; w++)); do
    fetch "$d/matchups_w$(printf %02d "$w").json" "$SLEEPER/league/$id/matchups/$w"
  done
done
if [ "${#prev_ids[@]}" -gt 0 ]; then
  for ((w = 13; w <= LAST_REG_WEEK; w++)); do
    ww=$(printf %02d "$w")
    fetch "prev/proj_w$ww.json" "$SLEEPER_WEB/projections/nfl/$prev/$w?season_type=regular$qs"
    slim "prev/proj_w$ww.json" "$SLIM_ROWS"
  done
fi

# FantasyCalc market values in each league's format, redraft and dynasty (public data, for local tests).
nearest() { jq -nr --argjson x "$1" --argjson opts "$2" '$opts | min_by((. - $x) | fabs)'; }
mapfile -t formats < <(jq -r '.[] | "\(.total_rosters // 12) \(.scoring_settings.rec // 0) \([.roster_positions[]? | select(. == "QB" or . == "SUPER_FLEX")] | length)"' "$out/leagues.json" 2>/dev/null | sort -u)
for f in "${formats[@]}"; do
  read -r teams rec qbslots <<<"$f"
  teams=$(nearest "$teams" '[8,10,12,14]')
  ppr=$(nearest "$rec" '[0,0.5,1]')
  qbs=1
  [ "$qbslots" -ge 2 ] && qbs=2
  for dyn in false true; do
    fetch "fantasycalc/${dyn}_${qbs}_${teams}_${ppr}.json" \
      "https://api.fantasycalc.com/values/current?isDynasty=$dyn&numQbs=$qbs&numTeams=$teams&ppr=$ppr"
  done
done

echo "Fetched $oks files ($fails failed) for ${#league_ids[@]} league(s), season $season week $week, and ${#prev_ids[@]} from $prev."
[ "$oks" -gt 3 ] || { echo "Too few fetches succeeded; not uploading." >&2; exit 1; }

tar -C "$work" -czf - league | age -r "$recipient" -o "$work/$ASSET"
if ! gh release view "$TAG" >/dev/null 2>&1; then
  gh release create "$TAG" --prerelease --title "Encrypted league pull" \
    --notes "age-encrypted private data pull used for testing. Unreadable without the private key; replaced on every run." \
    || gh release view "$TAG" >/dev/null
fi
gh release upload "$TAG" "$work/$ASSET" --clobber
echo "Uploaded encrypted bundle ($(stat -c %s "$work/$ASSET") bytes)."
