# Input archive

`.github/workflows/archive.yml` runs `snapshot.sh` on this schedule:
- every 4 hours;
- before Thursday, Sunday and Monday night games;
- twice on Sunday mornings;
- once before Sunday's 4 pm games, after their inactives are announced.

Each run saves the inputs we can't recreate later:

- **Sleeper projections:** the current and next week on every run. All remaining weeks are also saved once a day, from 12:00 UTC.
- **Sleeper trending adds and drops.**
- **Sleeper players dump:** once a day, from 12:00 UTC.
- **nflverse injuries:** twice a day, from 08:00 and from 20:00 UTC. nflverse keeps only the latest row per player per week, so earlier rows
  are lost unless we snapshot them.
- **The app's deployed data files** (`site_players.json`, `site_schedule.json`, `site_baseline.json`): with the projections, exactly what the app showed at that moment.
- **Player props** from The Odds API (`props_events.json`, `props_event_<id>.json`): each game once, in the first run within 6 hours of its
  kickoff ([docs/props.md](../../docs/props.md)). The API key (Actions secret `ODDS_API_KEY`) reaches only `scripts/props/pull.ts`.
- **The app's predictions** (`predictions.json`, see below).

**Daily jobs.** GitHub starts scheduled runs up to an hour late, and sometimes skips them. A job tied to one exact hour missed days, so
each daily job runs in the first snapshot of the day at or after its hour.
- **Marker:** that run also uploads `daily_<timestamp>_<job>.json` **unencrypted**. It holds only the job's name (`weeks`, `players`,
  `injuries8` or `injuries20`) and the snapshot's timestamp, no data. Later runs that day see it and skip the job.
- **Failures:** a job whose fetch fails gets no marker, so the next run tries again.
- **Fallback:** if a run can't list the release's assets, each job runs only in its own hour, as before.

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
- the weekly spread;
- the in-house baseline's full-PPR points if active (`bl`), when the deployed `baseline.json` covers the week.

- the props shadow's full-PPR points if active (`pr`): props wherever they price a stat, Sleeper's line elsewhere. Only in the snapshot that
  fetched the game's props.

The run also uploads `commit_<season>w<week>_<timestamp>.json` **unencrypted**. It holds the SHA-256 of that `predictions.json` and the games it covers. GitHub records the asset's upload time, so it proves the predictions existed before kickoff. Nothing derived from RotoWire is published. If the hook fails, the snapshot is uploaded without it.

A run that fetched props also uploads `props_<season>w<week>_<timestamp>.json` **unencrypted**: the games fetched, their kickoffs and the
credits used, but no odds. Later runs read these to skip games already fetched. Dispatching the workflow with `props: test` fetches the next
game whatever its kickoff (about 6 credits), marked so it doesn't count as fetched.

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

## Scoring the ledger

After a week's games, with the private key:

```sh
scripts/ledger/fetch.sh 2026 6 ff-archive-identity.txt preds/w06     # decrypts only predictions.json from each snapshot
base=https://github.com/nflverse/nflverse-data/releases/download
curl -sSfLO "$base/weekly_rosters/roster_weekly_2026.csv"
curl -sSfLO "$base/stats_player/stats_player_week_2026.csv"
npx tsx scripts/ledger/score.ts preds/w06 roster_weekly_2026.csv stats_player_week_2026.csv 6 --json w06.json
```

For each player-game the scorer takes the **last prediction committed before kickoff** and checks it against what happened.
- **Chance to play:** scored on players tagged Questionable, Doubtful or Out. It reports Brier score, log loss, and calibration by tag (and by practice
  status, for final reports) against nflverse game-day actives.
- **Points if active:** scored on QB/RB/WR/TE projected 5+. It reports MAE, bias, and the share of results within ±1 and ±2 of the app's spread,
  against nflverse full-PPR points.
- **Shadow baseline:** each prediction also carries `bl`, the in-house baseline's points if active
  ([docs/baseline.md](../../docs/baseline.md)). The scorer compares its MAE with the app's on active QB/RB/WR/TE that either put at 5+.
- **Props shadow:** `pr` against the app's `mu` from the same snapshot (the one that fetched the props, usually not the last before
  kickoff), on the same population, plus a 50/50 blend ([docs/props.md](../../docs/props.md)).

Only games with stats count. Weekly rosters exist before kickoff too, so counting them early would score pre-game statuses. The output is
aggregates only.

**Automatically:** the workflow's `ledger` job runs `scripts/ledger/auto.sh` on every archive run.
- It scores each week once, two days after the last game, with the `ARCHIVE_AGE_KEY` secret.
- It publishes the aggregates to the `ledger` release, which the site copies as `data/ledger.json`.
- Details, and the risk of keeping the key in Actions: [docs/ledger.md](../../docs/ledger.md).


## Past seasons for backtests

`.github/workflows/history-pull.yml` (run by hand) fetches past seasons' weekly Sleeper projections and stats with
`scripts/history/pull.sh`, slims the rows, and uploads them encrypted to the same key in the `history` prerelease. The job summary shows row
counts only. The baseline blend gate ([docs/baseline.md](../../docs/baseline.md)) runs on it with `scripts/backtest/baseline.ts`.
