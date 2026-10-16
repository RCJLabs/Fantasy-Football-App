#!/usr/bin/env bash
# Download one week's archive snapshots and keep only the predictions inside them (needs the private
# key). Writes <out>/<timestamp>.json for each snapshot that has predictions; skips ones already there.
#
# Usage: scripts/ledger/fetch.sh <season> <week> <age identity file> <out dir>
# Env:   GH_REPO (default RCJLabs/Fantasy-Football-App). Uses `gh api` (REST) and age.
set -euo pipefail

season="$1"
week="$(printf %02d "$2")"
identity="$3"
out="$4"
repo="${GH_REPO:-RCJLabs/Fantasy-Football-App}"
mkdir -p "$out"

# A week's snapshots can span two monthly releases (archive-YYYY-MM), each holding hundreds of assets: page them.
for tag in $(gh api --paginate "repos/$repo/releases?per_page=100" --jq ".[].tag_name | select(startswith(\"archive-$season\"))"); do
  rid="$(gh api "repos/$repo/releases/tags/$tag" --jq .id)"
  gh api --paginate "repos/$repo/releases/$rid/assets?per_page=100" --jq ".[] | select(.name | startswith(\"snap_${season}w${week}_\")) | \"\(.id) \(.name)\"" |
    while read -r id name; do
      ts="${name#"snap_${season}w${week}_"}"
      ts="${ts%.tar.gz.age}"
      [ -s "$out/$ts.json" ] && continue
      if ! gh api -H "Accept: application/octet-stream" "repos/$repo/releases/assets/$id" |
        age -d -i "$identity" | tar -xzOf - snap/predictions.json >"$out/$ts.json" 2>/dev/null; then
        rm -f "$out/$ts.json" # snapshot without predictions (before the ledger, or the hook failed)
      fi
    done
done
echo "$(find "$out" -name '*.json' | wc -l) prediction files in $out"
