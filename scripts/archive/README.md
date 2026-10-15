# Input archive

`.github/workflows/archive.yml` runs `snapshot.sh` on this schedule:
- every 4 hours;
- before Thursday, Sunday and Monday night games;
- twice on Sunday mornings;
- once before Sunday's 4 pm games, after their inactives are announced.

Each run saves the inputs we can't recreate later:

- **Sleeper projections:** the current and next week on every run. All remaining weeks are also saved on the 12:xx UTC run.
- **Sleeper trending adds and drops.**
- **Sleeper players dump:** once a day.
- **nflverse injuries:** twice a day. nflverse keeps only the latest row per player per week, so earlier rows are lost unless we snapshot them.
- **The app's deployed data files** (`site_players.json`, `site_schedule.json`): with the projections, exactly what the app showed at that moment.
- **The app's predictions** (`predictions.json`, see below).

Each run's files are bundled as a `tar.gz`, encrypted with [age](https://age-encryption.org) to the public key in `recipient.txt`, and uploaded to a monthly prerelease (`archive-YYYY-MM`).

**Only the holder of the private key can read the snapshots.** That keeps third-party data (Sleeper, RotoWire projections) unpublished even though this repo is public.

## Reading a snapshot

```sh
gh release download archive-2026-10 --pattern 'snap_*.tar.gz.age' --dir snaps
for f in snaps/*.age; do d="snaps/$(basename "$f" .tar.gz.age)"; mkdir -p "$d"; age -d -i ff-archive-identity.txt "$f" | tar -xzf - -C "$d"; done
```

Each snapshot holds a `manifest.jsonl` listing every fetch: URL, HTTP status, size and timestamp.

## Prediction ledger

On each run, `scripts/ledger/predict.ts` writes `predictions.json` into the snapshot before it's encrypted. It covers every QB, RB, WR, TE, K and DEF whose game hasn't started, using the same code and inputs as the app:
- chance to play;
- full-PPR points if active;
- the weekly spread.

The run also uploads `commit_<season>w<week>_<timestamp>.json` **unencrypted**. It holds the SHA-256 of that `predictions.json` and the games it covers. GitHub records the asset's upload time, so it proves the predictions existed before kickoff. Nothing derived from RotoWire is published. If the hook fails, the snapshot is uploaded without it.

To verify a snapshot's predictions (with the private key):

```sh
ts=20261018T154712Z  # the shared timestamp
gh release download archive-2026-10 --pattern "*_${ts}*" --dir check
age -d -i ff-archive-identity.txt check/snap_*_${ts}.tar.gz.age | tar -xzf - -C check
sha256sum check/snap/predictions.json            # must equal .sha256 in the commit file
jq .sha256 check/commit_*_${ts}.json
gh api repos/RCJLabs/Fantasy-Football-App/releases/tags/archive-2026-10 \
  --jq ".assets[] | select(.name | contains(\"${ts}\")) | [.name, .created_at]"  # upload times vs kickoffs
```

Scoring the committed predictions against what happened (game-day actives, PPR points) is the next step.

