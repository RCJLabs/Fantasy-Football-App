// Scoring plays for the app's players (docs/gameday.md, idea 7): ESPN's unofficial game summary, loaded by the browser
// and never republished. Plays carry no player ids, so they're tied to players by name: the summary's box score maps
// ESPN athlete ids (the player file's `espn`) to ESPN's own spelling of each name, and the scoring plays' text names
// the players in it ("Travis Kelce 12 Yd pass from Patrick Mahomes (Harrison Butker Kick)"). Checked from Actions on
// 2026-10-18 (scripts/spike/espn-plays-spike.mjs, run 39149248559): every scoring play named a box-score player.
import { getJson } from '../sleeper/api';
import { loadStored, saveStored } from './cache';

const SUMMARY_URL = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary';

export interface ScoringPlay {
  id: string;
  /** Quarter (5 and up: overtime). */
  period: number;
  /** Game clock when it happened, e.g. "8:43". */
  clock: string;
  /** ESPN's description, e.g. "Travis Kelce 12 Yd pass from Patrick Mahomes (Harrison Butker Kick)". */
  text: string;
  /** "TD", "FG", "SF" (safety) and the like. */
  type: string;
  /** When it happened (ESPN's wall clock), when known. */
  at?: number;
}

export interface GamePlays {
  event: string;
  /** The score this copy was loaded at: a new score means new plays. */
  version: string;
  plays: ScoringPlay[];
  /** ESPN athlete id → ESPN's spelling of his name, from the box score. */
  names: Record<string, string>;
}

interface RawPlay {
  id?: string | number;
  text?: string;
  period?: { number?: number };
  clock?: { displayValue?: string };
  type?: { abbreviation?: string };
  scoringType?: { abbreviation?: string };
  wallclock?: string;
  scoringPlay?: boolean;
}
export interface RawSummary {
  scoringPlays?: RawPlay[];
  drives?: { previous?: Array<{ plays?: RawPlay[] }>; current?: { plays?: RawPlay[] } };
  boxscore?: { players?: Array<{ statistics?: Array<{ athletes?: Array<{ athlete?: { id?: string | number; displayName?: string } }> }> }> };
}

/** The scoring plays in order, their times from the play-by-play, and the box score's names. */
export function parseSummary(body: RawSummary, event: string, version: string): GamePlays {
  const when = new Map<string, number>();
  for (const p of [...(body.drives?.previous ?? []).flatMap((d) => d.plays ?? []), ...(body.drives?.current?.plays ?? [])]) {
    const t = p.wallclock ? Date.parse(p.wallclock) : NaN;
    if (p.scoringPlay && p.id != null && Number.isFinite(t)) when.set(String(p.id), t);
  }
  const plays: ScoringPlay[] = (body.scoringPlays ?? []).flatMap((p) => {
    if (p.id == null || !p.text) return [];
    const play: ScoringPlay = {
      id: String(p.id),
      period: Number(p.period?.number) || 0,
      clock: p.clock?.displayValue ?? '',
      text: p.text,
      type: p.scoringType?.abbreviation ?? p.type?.abbreviation ?? '',
    };
    const at = when.get(play.id);
    if (at !== undefined) play.at = at;
    return [play];
  });
  const names: Record<string, string> = {};
  for (const team of body.boxscore?.players ?? []) {
    for (const group of team.statistics ?? []) {
      for (const a of group.athletes ?? []) if (a.athlete?.id != null && a.athlete.displayName) names[String(a.athlete.id)] = a.athlete.displayName;
    }
  }
  return { event, version, plays, names };
}

/** Lower case, no punctuation or name suffixes: "D.J. Moore Jr." and "DJ Moore" both read "dj moore". */
const plain = (s: string) =>
  s
    .toLowerCase()
    .replace(/[.'’]/g, '')
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** His scoring plays in this game, by ESPN's spelling of his name (his ESPN id), else the app's. */
export function playsFor(g: GamePlays, player: { name: string; espnId?: string }): ScoringPlay[] {
  const espnName = player.espnId ? g.names[player.espnId] : undefined;
  if (espnName) {
    const exact = g.plays.filter((p) => p.text.includes(espnName));
    if (exact.length) return exact;
  }
  const name = plain(espnName ?? player.name);
  if (!name.includes(' ')) return []; // one word could match anyone
  const re = new RegExp(`(^| )${name}( |$)`); // plain() leaves only letters, digits and spaces
  return g.plays.filter((p) => re.test(plain(p.text)));
}

/**
 * A game's scoring plays as of `version` (the score): kept on the device per game, and loaded again only when the score
 * has changed, since a summary is 200–650 KB before compression.
 */
export function loadGamePlays(event: string, version: string): Promise<GamePlays> {
  const id = `${event}@${version}`;
  let p = inflight.get(id);
  if (!p) {
    p = (async () => {
      const key = `espn:plays:${event}`;
      const held = await loadStored<GamePlays>(key);
      if (held?.version === version && Array.isArray(held.plays)) return held;
      const fresh = parseSummary(await getJson<RawSummary>(`${SUMMARY_URL}?event=${encodeURIComponent(event)}`, { retries: 1 }), event, version);
      await saveStored(key, fresh);
      return fresh;
    })();
    inflight.set(id, p);
    p.catch(() => inflight.delete(id));
  }
  return p;
}

/** One load per game and score at a time, however many players and feed entries ask. */
const inflight = new Map<string, Promise<GamePlays>>();

/** The score a game's plays are loaded at. */
export const playsVersion = (c: { homeScore: number; awayScore: number; state: string }) => `${c.state}:${c.awayScore}-${c.homeScore}`;
