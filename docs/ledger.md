# Prediction ledger

The app's own predictions, saved before each kickoff and scored after the games. Built 2026-10-15; automatic scoring and the About page
card 2026-10-16. The mechanics of the commit step and the scorer are in [scripts/archive/README.md](../scripts/archive/README.md).

## What's published

- **Before kickoff:** each archive run saves `predictions.json` (chance to play, points if active) inside the encrypted snapshot.
  - It also publishes the file's SHA-256 as `commit_<season>wNN_<timestamp>.json` in that month's archive release.
  - GitHub's upload time proves when the predictions were made.
- **After a week:** the `ledger` release gets two files:
  - `ledger_<season>wNN.json`, that week's aggregate scores;
  - `ledger.json`, the whole season so far.

  The site's data build copies `ledger.json` to `data/ledger.json`, keeping the last good copy if the release can't be reached.
- **Nothing per player is published.** The predictions are built from RotoWire's projections (via Sleeper), so they stay encrypted.

## Automatic scoring

- **When it runs:** the archive workflow's `ledger` job runs alongside every archive run: every 4 hours, plus the pre-game slots.
  - GitHub runs schedules best-effort, so a missed run only delays scoring to the next one.
- **When a week is scored:** once. Every game must have nflverse stats and its last kickoff must be 2 days old, which is usually Wednesday
  after Monday night `[design]`. After 7 days the week is scored with whatever was played.
- **What it scores:**
  - chance to play for injury-tagged players: Brier score, log loss, and calibration by tag and final practice;
  - points if active for QB/RB/WR/TE projected 5+: MAE, bias, and coverage of the app's ±1/±2 SD range;
  - the baseline and props shadows.
- **Without the secret** `ARCHIVE_AGE_KEY` it logs one line and skips.
- **With the wrong secret** the job fails on every run, before any download:
  - a value with no `AGE-SECRET-KEY-1…` line;
  - a key whose public key isn't `scripts/archive/recipient.txt`, the key the snapshots are encrypted to.

  Otherwise a wrong key would surface only when a week came due.

### The key `[decided 2026-10-16]`

You chose to use the current archive key in Actions "for now", which carries a known risk:
- The same key decrypts every archive asset: Sleeper/RotoWire projections, raw props odds, the history pulls and your private league pulls.
  All of those files are public downloads.
- If the key leaked through Actions, they would all become readable. Copies already downloaded couldn't be recalled.
- Rotating the key wouldn't help with what's already uploaded.

**How exposure is limited:**
- **Scope:** only the `ledger` job receives the secret.
- **Handling:** `scripts/ledger/auto.sh` moves it into an unexported shell variable, so child processes never see it.
- **On disk:** the key is written to a private temp file (mode 600) only when a week is due, and deleted on exit along with the decrypted
  predictions. Only `predictions.json` is extracted from each snapshot.
- **Output:** the log and the uploads carry aggregates only.
- **Forks:** workflows from forks never get repository secrets.

**The safer alternative, if this changes:**
- encrypt a copy of the predictions to a second, scoring-only key and put only that key in Actions;
- then a leak would expose the per-player predictions and nothing else.

**Adding the secret:**
1. Open Settings → Secrets and variables → Actions → New repository secret.
2. Name it `ARCHIVE_AGE_KEY`.
3. For the value, paste the whole identity file: the `AGE-SECRET-KEY-1…` line (comment lines are fine).

## About page

- **When it appears:** the card "How did the app's own predictions do?" appears once 3 weeks are scored `[design]`. One week holds only a
  few dozen tagged players.
- **What it shows:** weeks pooled by their counts.
  - Chance to play by tag and final practice: players, predicted, played.
  - Points-if-active error and range coverage.
  - The number of games, and a link to the public files.
- **Not on the card:** the shadows (baseline, props). They're in the weekly files and in the job's summary.

## Checking it

- **Actions → archive → `ledger` job:**
  - before a week is ready, the log says "not finished and settled yet";
  - after scoring, the job summary shows the week's aggregates.
- **Releases → `ledger`:** the weekly files and `ledger.json`.
- **Locally:** run with the key and the dry-run flag (it writes files instead of uploading):

  ```sh
  ARCHIVE_AGE_KEY="$(cat ff-archive-identity.txt)" LEDGER_DRY_RUN=1 LEDGER_WEEKS=6 bash scripts/ledger/auto.sh
  ```
