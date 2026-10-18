// The live game clock (docs/gameday.md): ESPN's unofficial NFL scoreboard, loaded by the browser while games are on and
// never fetched or republished by the pipeline. Checked from Actions on 2026-10-18 (scripts/spike/live-gameday-spike.mjs,
// run 39145816042): `access-control-allow-origin: *`, `cache-control: max-age=2`; period, clock and state in `status`;
// down, distance, possession and red zone in `competitions[0].situation`; ESPN's own team codes (WSH for Sleeper's WAS).
import type { GameClock } from '../domain/types';
import { getJson } from '../sleeper/api';
import { cached } from './cache';

const SCOREBOARD_URL = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';
/** Kept this long, so a manual refresh right after the automatic one doesn't ask again. [design] */
const TTL = 30_000;
/** An older copy (ESPN down) would show stale clocks: none then. [design] */
const MAX_STALE = 5 * 60_000;
const QUARTER = 15 * 60;
const GAME = 4 * QUARTER;

/** ESPN team codes that differ from Sleeper's. */
const TO_SLEEPER: Record<string, string> = { WSH: 'WAS' };
const sleeperTeam = (espn: string) => TO_SLEEPER[espn] ?? espn;

interface RawCompetitor {
  homeAway?: string;
  score?: string;
  team?: { id?: string; abbreviation?: string };
}
interface RawEvent {
  id?: string;
  status?: { clock?: number; displayClock?: string; period?: number; type?: { name?: string; state?: string } };
  competitions?: Array<{
    competitors?: RawCompetitor[];
    situation?: { possession?: string; downDistanceText?: string; isRedZone?: boolean };
  }>;
}
export interface RawScoreboard {
  week?: { number?: number };
  season?: { type?: number; year?: number };
  events?: RawEvent[];
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** Share of the hour played: quarters count down from 15:00; overtime's clock counts against the same hour. */
export function gameProgress(state: GameClock['state'], period: number, clock: number, halftime = false): number {
  if (state === 'pre') return 0;
  if (state === 'post') return 1;
  if (halftime) return 0.5;
  const left = Math.min(QUARTER, Math.max(0, clock));
  if (period > 4) return Math.max(0, Math.min(1, 1 - left / GAME));
  return Math.max(0, Math.min(1, ((Math.max(1, period) - 1) * QUARTER + (QUARTER - left)) / GAME));
}

function clockLabel(state: GameClock['state'], period: number, clock: number, display: string | undefined, halftime: boolean): string {
  if (state === 'pre') return '';
  if (state === 'post') return period > 4 ? 'Final/OT' : 'Final';
  if (halftime) return 'Half';
  const time = display || mmss(clock);
  if (period > 4) return `OT ${time}`;
  return clock <= 0 ? `End Q${period}` : `Q${period} ${time}`;
}

/** This scoreboard's games by Sleeper team code (both teams of each game); none when it shows another week. */
export function parseScoreboard(body: RawScoreboard, week?: number): Map<string, GameClock> {
  const out = new Map<string, GameClock>();
  if (week !== undefined && body.week?.number !== undefined && body.week.number !== week) return out;
  for (const e of body.events ?? []) {
    const c = e.competitions?.[0];
    const home = c?.competitors?.find((t) => t.homeAway === 'home');
    const away = c?.competitors?.find((t) => t.homeAway === 'away');
    if (!home?.team?.abbreviation || !away?.team?.abbreviation) continue;
    const raw = e.status?.type?.state;
    const state: GameClock['state'] = raw === 'in' || raw === 'post' ? raw : 'pre';
    const period = Number(e.status?.period) || 0;
    const clock = Number(e.status?.clock) || 0;
    const halftime = e.status?.type?.name === 'STATUS_HALFTIME';
    const g: GameClock = {
      state,
      period,
      clock,
      label: clockLabel(state, period, clock, e.status?.displayClock, halftime),
      progress: gameProgress(state, period, clock, halftime),
      home: sleeperTeam(home.team.abbreviation),
      away: sleeperTeam(away.team.abbreviation),
      homeScore: Number(home.score) || 0,
      awayScore: Number(away.score) || 0,
    };
    if (e.id) g.event = String(e.id);
    const s = c?.situation;
    if (state === 'in' && s) {
      const holder = [home, away].find((t) => t.team?.id !== undefined && t.team.id === s.possession);
      if (holder?.team?.abbreviation) g.possession = sleeperTeam(holder.team.abbreviation);
      if (s.downDistanceText) g.down = s.downDistanceText;
      if (s.isRedZone) g.redZone = true;
    }
    out.set(g.home, g);
    out.set(g.away, g);
  }
  return out;
}

/** Live game clocks for `week`, by Sleeper team code; kept 30 seconds. */
export async function loadScoreboard(week: number, force = false): Promise<Map<string, GameClock>> {
  const res = await cached('espn:scoreboard', TTL, () => getJson<RawScoreboard>(SCOREBOARD_URL, { retries: 1 }), { force });
  return res.stale && Date.now() - res.savedAt > MAX_STALE ? new Map() : parseScoreboard(res.value, week);
}
