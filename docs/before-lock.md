# Before lock

Built 2026-10-16, item 8 of the owner's assistance list, as the in-app check (the owner's call). Real alerts need a server: an
installed web app can't wake itself at a set time, so push alerts wait for the Cloudflare scheduler. Code:
`app/src/analysis/beforeLock.ts`; the Lineup tab's "Before lock" card and the "Next lock" line on each Home league card.

## What it shows

The lineup as set in Sleeper, kickoff by kickoff, for each game time that still locks a starter:
- **Now:** empty spots and starters without a game this week, with the app's fix. These can't wait for a kickoff.
- **Each kickoff:** how many of your starters lock then, and what's due before it.
  - **Changes:** the app's recommended changes, each placed before the earlier kickoff of the two players involved. After that,
    one of them is locked. A starter who's ruled out gets the reason.
  - **Stranded:** a starter ruled out, or an empty spot, that nobody on the bench can fill. It points to the Waivers tab.
  - **Questionable starters** (under 95% to play): when inactives come out, 90 minutes before his kickoff, and what to do if he's
    out:
    - the best fill-in whose game is still open then, either straight into his spot or with one move (a starter who can play his
      spot moves over, and the bench player takes the move-out's spot, such as FLEX);
    - and, when a better fill-in locks before the news, that it has to be decided by then.
- **Home:** each league card gets one line: the next lock, how many changes are due before it, and how many Questionable starters
  to check at inactives.

**Timing `[reported]`:** NFL teams announce their inactive players 90 minutes before kickoff.

## Limits

- **No alerts:** you have to open the app. The card says when to look again.
- **One move at most** for a fill-in. Longer chains of moves aren't searched.
- **Fill-ins are ranked by their own expected points.** The app's lineup engine already prices the option to swap a
  Questionable starter, so its recommended lineup can differ.
- **Best-ball leagues** set their own lineups and get no card.

## Checked

- **Unit tests:** windows in kickoff order with their starters; changes placed before the earlier kickoff; empty spots and
  starters without a game in "Now"; stranded starters and spots; Questionable starters with a fill-in after the news and a better
  one locking earlier; one-move fill-ins through a flex spot, including when the moved starter locks first.
- **End-to-end:** the test league's Lineup tab shows the change due now, the Out RB's swap before his kickoff, the Questionable WR
  with no fill-in on the bench, and a window with nothing to change. The Home card shows "2 changes due, 1 Questionable to check
  at inactives".
- **On the owner's leagues** (week 6, Saturday, counts only): 5 and 4 lock windows, 1 starter already locked in each, no changes
  due. One Questionable starter in each: in one league the fill-in comes through a one-move chain; in the other nobody on the
  bench can fill his spot.
