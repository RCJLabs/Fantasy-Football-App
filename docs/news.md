# Player news

Built 2026-10-18 at the owner's request: recent news in player details (option 1 of the four weighed that day).

Code:
- `app/src/data/news.ts`: the request, parsing and 15-minute cache.
- `app/src/ui/components.tsx` (`PlayerNews`): the section in player details.
- `scripts/spike/espn-news-spike.mjs`: the endpoint check, run from Actions (`spike.yml`).

## What it does

- **Where:** opening a player's details loads his recent news: up to 4 items, newest first, each with:
  - its age and source;
  - the headline, linked to the story on espn.com when there is one;
  - a second line when it says more than the headline.
- **More:** a "More on ESPN" link goes to his ESPN player page.
- **Source:** ESPN's fantasy news for one player,
  `site.api.espn.com/apis/fantasy/v2/games/ffl/news/players?playerId={espn id}` (unofficial, undocumented).
  - Items of type `Rotowire` are RotoWire's blurbs, which ESPN licenses. They're labelled "RotoWire via ESPN" and have no
    espn.com link.
  - The rest are ESPN's own stories.
- **Players:** matched through Sleeper's `espn_id`, which the daily player file now carries (`espn`). Players without one,
  team defenses among them, get no news section.

## Data rules

- **Browser only:** the browser loads the news straight from ESPN. The pipeline never fetches it, and the site never stores or
  republishes it. That's the same rule as RotoWire's projections via Sleeper.
- **Headline and snippet only:** the full story text in the response isn't shown.
- **Links:** only https links to espn.com are followed.
- **Privacy:** the request carries the player's ESPN id, nothing about the user or their leagues. The About page says so.
- **Not affiliated with ESPN.** No licence: fine for a free, non-commercial app, to be revisited before any monetization (along
  with a licensed feed such as RotoWire's).

## Checked

- **Spike from Actions,** 2026-10-18 15:21 UTC (run 39140136382; metadata only, no text):
  - **Per-player fantasy news:** HTTP 200 and `access-control-allow-origin: *`, so browsers may read it; `cache-control: max-age=1`.
    - The response holds `feed`, `resultsCount` and paging fields.
    - Ten items per player, from 2026-10-04 to that morning. The two players checked had 5 and 8 RotoWire items.
    - Items carry `headline`, `description`, `story` (full text), `published`, `type`, `links` and `playerId`.
    - Responses were 80–155 KB for 10 items, so the app asks for 6.
  - **Not usable:**
    - the same endpoint without a player (HTTP 500);
    - ESPN's general NFL news with `athlete=`, which returned the same 10 articles for both players (the filter looks ignored);
    - `common/v3/.../athletes/{id}/news` (HTTP 404).
- **Unit tests:** newest first, source labels, duplicates and empty headlines dropped, HTML entities decoded, non-espn.com links
  refused, error bodies tolerated; the player file's ESPN id.
- **End to end:** ESPN mocked:
  - a Questionable WR's details show a RotoWire blurb without a link and an ESPN story with one;
  - "More on ESPN" goes to his player page;
  - a player without an ESPN id has no news section;
  - the production build's Content Security Policy allows `site.api.espn.com`.

## Limits

- **Unofficial:** the endpoint can change or disappear without notice. Then the section says the news didn't load and still
  links to ESPN.
- **Freshness:** up to 15 minutes old on this device.
- **Coverage:** ESPN's feed, not a consensus. Breaking news from beat reporters (X, Bluesky) isn't included.
