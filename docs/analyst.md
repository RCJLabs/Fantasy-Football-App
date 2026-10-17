# Ask the analyst

Built 2026-10-16, item 10 of the owner's assistance list: the Phase 3 language layer, brought forward with bring-your-own-key.
Code: `app/src/analysis/analyst.ts` (fact sheet, number check, cost) and `app/src/ui/AskTab.tsx` (key, request, answers); the
league page's Ask tab.

## What it does

You ask about the league in plain words, and Claude (Opus 5.5) answers from the app's own figures.

- **The numbers come from the app.** The model gets a fact sheet: every number the app computed for this league, each with an id.
  - It must write `{F12}` instead of typing a number, and the app puts in the value as it shows it elsewhere.
  - A number the model types itself is checked against the facts and marked when it matches none. So is a reference to a fact
    that doesn't exist.
  - Each answer says whether every number came from the app, and what it cost.
- **What the facts cover:**
  - the league: teams, week, reception points, records;
  - this week: expected points with the recommended and current lineups, win and median odds, and each player's chance to play,
    points if he plays and expected points, with designations, practice and the recommended moves as notes;
  - once they load: playoff, bye and title odds, every team's record, points and playoff odds, your players' expected points a
    week for the rest of the season, and the top eight free agents with their gains and bids.
- **What it won't do:** use outside knowledge or news (the rules forbid it, since the manager can't check it here), or run a
  trade search. It points to the tab that might help instead.

## Bring your own key `[design]`

- **The key** is entered in the Ask tab and kept in this browser's local storage (`ff:anthropic-key`); **Remove key** deletes it.
- **The browser calls Anthropic directly,** through the official SDK in browser mode, which is loaded only when you ask. The
  page's content security policy allows `api.anthropic.com` alongside Sleeper and FantasyCalc. No server of ours sees the key or
  the questions.
- **What leaves the device:** under your Anthropic account, each question sends
  - the fact sheet: this league's team and player names, projections, odds and free agents;
  - the question, and up to four earlier questions and answers from the visit.
- **Risk:** a key in local storage can be read by any script running on the site. The app loads no third-party scripts, and the
  content security policy allows scripts only from the app's own files. A key with a spend limit caps the damage.

## The request `[design]`

- **Model:** `claude-opus-5-5`.
  - Effort is set to `medium` explicitly (the model's default). Thinking is adaptive and always on for this model.
  - `max_tokens` is 16000, without streaming: answers are short.
- **Refusal fallback:** `fallbacks: "default"` with the `server-side-fallback-2026-07-01` beta. If Opus 5.5 declines,
  Anthropic retries on its default fallback model within the same call.
- **Prompt caching:**
  - The rules and the fact sheet go in the system prompt, with a cache breakpoint on the sheet.
  - The sheet is built once per visit to the tab and is deterministic, so follow-ups within five minutes read it from Anthropic's
    prompt cache at a twentieth of the input price.
  - Opus 5.5 caches prompts from 512 tokens; the sheet is about 3,600.
- **Follow-ups:** earlier questions and answers go in as context inside the new question. Every request is a single user turn, so
  no model turn ever has to be replayed.
- **Errors:** each of these gets a plain message:
  - a rejected key;
  - a key without access to the model;
  - rate limits;
  - a request Anthropic won't take, such as no credit;
  - no connection.

## Cost

List prices for Opus 5.5 (October 2026) per million tokens:
- input $4;
- output $20, with thinking counted as output;
- cache writes $5;
- cache reads $0.20.

On the owner's leagues the rules and fact sheet are about 3,600 tokens:
- **First question:** about $0.02 to write the cache, plus the answer.
- **A follow-up within five minutes:** under $0.001 for the sheet, plus the answer.

`[estimate]`: the answer's output tokens, thinking included, haven't been measured on the real API. Each answer shows its actual
cost from Anthropic's token counts.

## Checked

- **Unit tests:**
  - the fact sheet: ids in order, the same sheet for the same input, values as the app shows them, and no numbers in notes
    except inside names;
  - the answer check: values put in, typed numbers matched or marked, digits inside names ignored, unknown ids marked;
  - the cost at list prices.
- **End-to-end, with Anthropic's API mocked:**
  - the key form: saving the key, and removing it;
  - the request: the key header, the browser-access header, the model, the effort, the fallback beta, and the cache breakpoint
    on the fact sheet;
  - the answer: fact values put in, an unknown id and a typed number marked, and the cost line;
  - a follow-up: the first exchange sent as context, with the identical fact sheet so the cache can be reused.
- **On the owner's leagues** (week 6, counts only):
  - 126 and 129 facts and 26–27 notes, about 3,600 tokens;
  - no note carries a number outside a name;
  - built in under 1 ms.
- **Not yet run against the real API**, since this environment has no key. The first real questions are the live test.

## Limits

- **The check covers numbers, not reasoning.** A sentence can still misread a fact or draw the wrong conclusion from it.
- **A typed number that equals some fact's value counts as matched,** even if it belongs to a different fact.
- **Not in the sheet:** trade ideas, the season review and team grades.
- **Team names are other managers' text,** passed to the model as data. A hostile name could try to steer an answer. The model has
  no tools and the app shows its answer as plain text, so the worst case is a misleading answer.
