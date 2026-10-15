# Input archive

`.github/workflows/archive.yml` runs `snapshot.sh` every 4 hours, before Thursday and Monday night games, and twice on Sunday mornings. Each run saves the inputs we can't recreate later:

- **Sleeper projections:** the current and next week on every run. All remaining weeks are also saved on the 12:xx UTC run.
- **Sleeper trending adds and drops.**
- **Sleeper players dump:** once a day.
- **nflverse injuries:** twice a day. nflverse keeps only the latest row per player per week, so earlier rows are lost unless we snapshot them.

Each run's files are bundled as a `tar.gz`, encrypted with [age](https://age-encryption.org) to the public key in `recipient.txt`, and uploaded to a monthly prerelease (`archive-YYYY-MM`).

**Only the holder of the private key can read the snapshots.** That keeps third-party data (Sleeper, RotoWire projections) unpublished even though this repo is public.

## Reading a snapshot

```sh
gh release download archive-2026-10 --pattern 'snap_*.tar.gz.age' --dir snaps
for f in snaps/*.age; do d="snaps/$(basename "$f" .tar.gz.age)"; mkdir -p "$d"; age -d -i ff-archive-identity.txt "$f" | tar -xzf - -C "$d"; done
```

Each snapshot holds a `manifest.jsonl` listing every fetch: URL, HTTP status, size and timestamp.
