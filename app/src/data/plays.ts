// Scoring plays for the app's players (docs/gameday.md, idea 7): ESPN's unofficial game summary, loaded by the browser
// and never republished. Plays carry no player ids, so they're tied to players by name: the summary's box score maps
// ESPN athlete ids (the player file's `espn`) to ESPN's own spelling of each name, and the scoring plays' text names
// the players in it ("Travis Kelce 12 Yd pass from Patrick Mahomes (Harrison Butker Kick)"). Checked from Actions on
// 2026-10-18 (scripts/spike/espn-plays-spike.mjs, run 39149248559): every scoring play named a box-score player.
import { getJson } from '../sleeper/api';
import { loadStored, saveStored } from './cache';

const SUMMARY_URL = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary';
/** A copy behind the scoreboard's score is loaded again after this long, at most this many times per score. [design] */
const RETRY = 30_000;
const MAX_TRIES = 4;

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
  /** The score this copy's scoring plays reach, with the game's state (`playsVersion`): a new score means new plays. */
  version: string;
  plays: ScoringPlay[];
  /** ESPN athlete id → ESPN's spelling of his name, from the box score. */
  names: Record<string, string>;
  /** The scoreboard's version it was loaded for, how many loads that has taken, and when the last one was. */
  asked?: string;
  tries?: number;
  at?: number;
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
  /** The score after a scoring play. */
  awayScore?: number;
  homeScore?: number;
}
export interface RawSummary {
  scoringPlays?: RawPlay[];
  drives?: { previous?: Array<{ plays?: RawPlay[] }>; current?: { plays?: RawPlay[] } };
  boxscore?: { players?: Array<{ statistics?: Array<{ athletes?: Array<{ athlete?: { id?: string | number; displayName?: string } }> }> }> };
}

/** "away-home" after the summary's last scoring play ("0-0" before any); undefined when its plays carry no score. */
export function summaryScore(body: RawSummary): string | undefined {
  const last = body.scoringPlays?.at(-1);
  if (!last) return '0-0';
  return typeof last.awayScore === 'number' && typeof last.homeScore === 'number' ? `${last.awayScore}-${last.homeScore}` : undefined;
}

/**
 * The scoring plays in order, their times from the play-by-play, and the box score's names. `asked` is the scoreboard's
 * version; the copy's own version has the score its scoring plays reach (the asked one when they don't say).
 */
export function parseSummary(body: RawSummary, event: string, asked: string): GamePlays {
  const own = summaryScore(body);
  const version = own === undefined ? asked : `${asked.split(':')[0]}:${own}`;
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
 * Whether a game's plays held on the device need loading again for the scoreboard's `version`. A summary loaded just as a
 * score lands can trail the scoreboard: it's loaded again after a pause, a few times at most, until its plays reach the score.
 */
export function needsLoad(held: GamePlays, version: string, now: number): boolean {
  if (!Array.isArray(held.plays)) return true;
  if (held.version === version) return false;
  if (held.asked === version) return (held.tries ?? 1) < MAX_TRIES && now - (held.at ?? 0) >= RETRY;
  return true;
}

/**
 * A game's scoring plays as of `version` (the scoreboard's score): kept on the device per game, and loaded again only when
 * the score has changed (or the copy held trails it), since a summary is 200–650 KB before compression.
 */
export function loadGamePlays(event: string, version: string): Promise<GamePlays> {
  const id = `${event}@${version}`;
  let p = inflight.get(id);
  if (!p) {
    p = (async () => {
      const key = `espn:plays:${event}`;
      const held = (await loadStored<GamePlays>(key)) ?? kept.get(event);
      if (held && !needsLoad(held, version, Date.now())) return held;
      const fresh = parseSummary(await getJson<RawSummary>(`${SUMMARY_URL}?event=${encodeURIComponent(event)}`, { retries: 1 }), event, version);
      const out: GamePlays = { ...fresh, asked: version, tries: held?.asked === version ? (held.tries ?? 1) + 1 : 1, at: Date.now() };
      kept.set(event, out);
      await saveStored(key, out);
      return out;
    })();
    inflight.set(id, p);
    p.then(
      () => inflight.delete(id),
      () => inflight.delete(id),
    );
  }
  return p;
}

/** One load per game and score at a time, however many players and feed entries ask. */
const inflight = new Map<string, Promise<GamePlays>>();
/** The last copy of each game, for when the device can't store it (private mode). */
const kept = new Map<string, GamePlays>();

/** The score a game's plays are loaded at. */
export const playsVersion = (c: { homeScore: number; awayScore: number; state: string }) => `${c.state}:${c.awayScore}-${c.homeScore}`;
