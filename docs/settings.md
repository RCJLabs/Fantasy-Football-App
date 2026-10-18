# Settings

Built 2026-10-18 at the owner's request: one page for every per-device choice the app has, with room for new ones. It's at
`#/settings`, behind the sliders button in the top bar, signed in or not.

Code: `app/src/ui/Settings.tsx` (the page) and `app/src/ui/prefs.ts` (every stored preference, read and written there).

## What it holds

| Section | Setting | Stored as | Also set from |
|---|---|---|---|
| Game day | Buzz on big plays | `localStorage` `ff:buzz` (`off` when off) | the Matchup tab's live feed |
| Lineups | What each league's advice aims for, regular season and playoffs: default, max points or win chance | `ff:objective:{league}:{regular\|playoffs}` | the Lineup tab's Max points / Win chance switch |
| Ask the analyst | The Anthropic API key: saved or not (last 4 characters), and Remove | `ff:anthropic-key` | the Ask tab (where it's added) |
| Draft helper | Leagues with saved draft settings, each with Reset | `ff:draft:{league}` | the Draft tab |
| Data on this device | Clear saved data (IndexedDB: loaded data, live feeds, scoring plays); Reset settings (the rows above, not the key or the season review's saved picks); Switch Sleeper user; Report a problem | — | About keeps Report a problem and points here for the rest |

- **Lineups** lists leagues with lineups to advise on now (in season or in the playoffs, best ball aside).
- **Draft helper** shows only when a league has saved draft settings.
- Signed out, the page shows the sections that don't need your leagues.

## Adding a setting

1. Read and write it in `prefs.ts`, with a default when storage is unavailable (private mode, blocked site data).
2. Add it to a section of `Settings.tsx` (or a new section card), and keep any control where the setting is used: both write the
   same stored value.
3. If it should go back to its default on Reset settings, add its key to `resetPrefs`.
4. Add a row to the table above.
