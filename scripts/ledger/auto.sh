#!/usr/bin/env bash
# Score each finished week of the prediction ledger and publish the aggregates (docs/ledger.md). Run by the
# archive workflow's ledger job after every archive run: a quick no-op until a committed week has finished and
# settled (scripts/ledger/due.ts), then each week is scored once.
#
# Publishes to the `ledger` prerelease: ledger_<season>wNN.json for each scored week, and ledger.json with the
# whole season, which the data build copies to the site. Aggregates only: the decrypted predictions and the key
# stay in a private temp dir on the runner and are deleted on exit; nothing per player is printed.
#
# Env: ARCHIVE_AGE_KEY  the archive's age identity (an Actions secret). Without it the job skips.
#      GH_TOKEN, GH_REPO (default RCJLabs/Fantasy-Football-App). Lookups use REST (`gh api`) only.
#      LEDGER_DRY_RUN=1 writes the files to $LEDGER_OUT (default ./ledger-out) instead of uploading, and
#      LEDGER_WEEKS then picks the weeks to score regardless of the due check (local tests).
set -euo pipefail

repo="${GH_REPO:-RCJLabs/Fantasy-Football-App}"
export GH_REPO="$repo"
here="$(cd "$(dirname "$0")" && pwd)"
TAG=ledger
nflverse=https://github.com/nflverse/nflverse-data/releases/download
dry="${LEDGER_DRY_RUN:-}"

# Keep the key in an unexported variable: child processes (npx, curl, gh) never see it.
identity="${ARCHIVE_AGE_KEY:-}"
unset ARCHIVE_AGE_KEY
if [ -z "$identity" ]; then
  echo "ARCHIVE_AGE_KEY isn't set, so the ledger isn't scored (docs/ledger.md)."
  exit 0
fi
case "$identity" in
  *AGE-SECRET-KEY-1*) ;;
  *)
    echo "ARCHIVE_AGE_KEY has no AGE-SECRET-KEY-1… line: paste the whole identity file (docs/ledger.md)." >&2
    exit 1
    ;;
esac

umask 077
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# "<id> <name>" for each asset of a release (paginated); nothing when the release doesn't exist.
assets() {
  local id
  id="$(gh api "repos/$repo/releases/tags/$1" --jq .id 2>/dev/null)" || return 0
  gh api --paginate "repos/$repo/releases/$id/assets?per_page=100" --jq '.[] | "\(.id) \(.name)"'
}
get() { curl -sSfL --retry 3 --retry-delay 5 --max-time 300 -o "$2" "$1"; }

# Committed weeks: every snapshot with predictions has a public commit_<season>wNN_<ts>.json.
for tag in $(gh api --paginate "repos/$repo/releases?per_page=100" --jq '.[].tag_name | select(startswith("archive-"))'); do
  assets "$tag"
done | sed -n 's/^[0-9]* commit_\([0-9]\{4\}\)w\([0-9]\{2\}\)_.*\.json$/\1 \2/p' | sort -u >"$work/committed"
season="$(cut -d' ' -f1 "$work/committed" | sort -u | tail -n 1)"
if [ -z "$season" ]; then
  echo "Ledger: no committed predictions yet."
  exit 0
fi

assets "$TAG" >"$work/ledger_assets"
scored="$(sed -n "s/^[0-9]* ledger_${season}w\([0-9]\{2\}\)\.json$/\1/p" "$work/ledger_assets" | sed 's/^0//' | sort -n)"
todo=()
for w in $(awk -v s="$season" '$1 == s { print $2 + 0 }' "$work/committed" | sort -n | uniq); do
  grep -qx "$w" <<<"$scored" || todo+=("$w")
done

if [ -n "$dry" ] && [ -n "${LEDGER_WEEKS:-}" ]; then
  due="$LEDGER_WEEKS"
  get "$nflverse/stats_player/stats_player_week_${season}.csv" "$work/stats.csv"
else
  if [ ${#todo[@]} -eq 0 ]; then
    echo "Ledger: every committed $season week is scored ($(paste -sd, - <<<"$scored"))."
    exit 0
  fi
  get https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv "$work/games.csv"
  get "$nflverse/stats_player/stats_player_week_${season}.csv" "$work/stats.csv"
  due="$(npx --no-install tsx "$here/due.ts" "$season" "$work/games.csv" "$work/stats.csv" "${todo[@]}")"
  if [ -z "$due" ]; then
    echo "Ledger: $season week(s) ${todo[*]} not finished and settled yet."
    exit 0
  fi
fi

get "$nflverse/weekly_rosters/roster_weekly_${season}.csv" "$work/rosters.csv"
printf '%s\n' "$identity" >"$work/key"
unset identity
mkdir -p "$work/out"
for w in $due; do
  ww="$(printf %02d "$w")"
  bash "$here/fetch.sh" "$season" "$w" "$work/key" "$work/pred_$ww"
  npx --no-install tsx "$here/score.ts" "$work/pred_$ww" "$work/rosters.csv" "$work/stats.csv" "$w" --json "$work/out/ledger_${season}w${ww}.json" |
    tee -a "${GITHUB_STEP_SUMMARY:-/dev/null}"
  rm -rf "$work/pred_$ww"
done
rm -f "$work/key"

# The weeks scored before (public aggregates), so ledger.json carries the whole season.
while read -r id name; do
  case "$name" in
    "ledger_${season}w"[0-9][0-9].json)
      [ -f "$work/out/$name" ] || gh api -H "Accept: application/octet-stream" "repos/$repo/releases/assets/$id" >"$work/out/$name"
      ;;
  esac
done <"$work/ledger_assets"
npx --no-install tsx "$here/combine.ts" "$work/out" "$season" "$work/out/ledger.json"

files=("$work/out/ledger.json")
for w in $due; do files+=("$work/out/ledger_${season}w$(printf %02d "$w").json"); done
if [ -n "$dry" ]; then
  mkdir -p "${LEDGER_OUT:-ledger-out}"
  cp "${files[@]}" "${LEDGER_OUT:-ledger-out}/"
  echo "Dry run: wrote ${#files[@]} file(s) to ${LEDGER_OUT:-ledger-out}."
  exit 0
fi
if ! gh release view "$TAG" >/dev/null 2>&1; then
  gh release create "$TAG" --prerelease --title "Prediction ledger scores" \
    --notes "Weekly scores of the app's prediction ledger: aggregates only (docs/ledger.md). The predictions were committed before each kickoff; their SHA-256 fingerprints are the commit_*.json assets in the archive releases. ledger.json holds the whole season and is what the site publishes." \
    || gh release view "$TAG" >/dev/null # another run may have created it concurrently
fi
gh release upload "$TAG" "${files[@]}" --clobber
echo "Ledger: scored $season week(s) $due and published ledger.json."
