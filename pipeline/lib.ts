// Pure helpers for the data pipeline (tested in lib.test.ts).
import type { CompactPlayer } from '../app/src/data/contracts';
import type { Game, PracticeStatus } from '../app/src/domain/types';
import type { RawPlayer } from '../app/src/sleeper/raw';

/** RFC 4180-ish CSV parser: quoted fields, escaped quotes, CRLF. Returns rows of strings. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** CSV text → array of objects keyed by header. */
export function csvRecords(text: string): Array<Record<string, string>> {
  const [header, ...rows] = parseCsv(text);
  if (!header) return [];
  return rows
    .filter((r) => r.length > 1 || (r[0] ?? '') !== '')
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

/** nflverse team codes → Sleeper team codes. */
const TEAM_MAP: Record<string, string> = { LA: 'LAR', OAK: 'LV', SD: 'LAC', STL: 'LAR' };
export const toSleeperTeam = (team: string): string => TEAM_MAP[team] ?? team;

/** Nth weekday of a month (UTC date parts). weekday: 0 = Sunday. */
function nthWeekday(year: number, month: number, weekday: number, n: number): number {
  const first = new Date(Date.UTC(year, month, 1)).getUTCDay();
  return 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
}

/** True when a calendar date in US Eastern time is in daylight saving (2nd Sun Mar → 1st Sun Nov). */
export function isEasternDst(year: number, month: number, day: number): boolean {
  const start = nthWeekday(year, 2, 0, 2);
  const end = nthWeekday(year, 10, 0, 1);
  if (month > 2 && month < 10) return true;
  if (month === 2) return day >= start;
  if (month === 10) return day < end;
  return false;
}

/** nflverse gameday (YYYY-MM-DD) + gametime (HH:MM, US Eastern) → ISO UTC. */
export function easternToUtcIso(gameday: string, gametime: string): string {
  const [y, m, d] = gameday.split('-').map(Number) as [number, number, number];
  const [hh, mm] = (gametime || '13:00').split(':').map(Number) as [number, number];
  const offset = isEasternDst(y, m - 1, d) ? 4 : 5;
  return new Date(Date.UTC(y, m - 1, d, hh + offset, mm)).toISOString();
}

const optNum = (s: string | undefined): number | undefined => {
  if (s === undefined || s === '' || s === 'NA') return undefined;
  const v = Number(s);
  return Number.isFinite(v) ? v : undefined;
};

/** nfldata games.csv records → games for one season. */
export function gamesFromCsv(records: Array<Record<string, string>>, season: string): Game[] {
  return records
    .filter((r) => r.season === season && r.gameday)
    .map((r) => {
      const spread = optNum(r.spread_line);
      const total = optNum(r.total_line);
      const game: Game = {
        id: r.game_id ?? '',
        week: Number(r.week),
        away: toSleeperTeam(r.away_team ?? ''),
        home: toSleeperTeam(r.home_team ?? ''),
        kickoff: easternToUtcIso(r.gameday ?? '', r.gametime ?? ''),
      };
      if (spread !== undefined) game.spread = spread;
      if (total !== undefined) game.total = total;
      if (spread !== undefined && total !== undefined) {
        // nflverse spread_line is positive when the HOME team is favored.
        game.homeImplied = Math.round(((total + spread) / 2) * 100) / 100;
        game.awayImplied = Math.round(((total - spread) / 2) * 100) / 100;
      }
      if (r.roof) game.roof = r.roof;
      return game;
    })
    .sort((a, b) => a.kickoff.localeCompare(b.kickoff));
}

export function practiceStatus(text: string | undefined): PracticeStatus | undefined {
  const t = (text ?? '').toLowerCase();
  if (t.startsWith('full')) return 'Full';
  if (t.startsWith('limited')) return 'Limited';
  if (t.startsWith('did not')) return 'DNP';
  return undefined;
}

export interface InjuryReport {
  week: number;
  byGsis: Map<string, { prac?: PracticeStatus; rpt?: string; body?: string }>;
}

/** Latest week (≤ maxWeek) of the official injury report from nflverse injuries_<season>.csv. */
export function latestInjuryReport(records: Array<Record<string, string>>, maxWeek: number): InjuryReport | undefined {
  const reg = records.filter((r) => (r.game_type ?? r.season_type ?? 'REG').toUpperCase().startsWith('REG'));
  const weeks = reg.map((r) => Number(r.week)).filter((w) => Number.isFinite(w) && w <= maxWeek);
  if (weeks.length === 0) return undefined;
  const week = Math.max(...weeks);
  const byGsis = new Map<string, { prac?: PracticeStatus; rpt?: string; body?: string }>();
  for (const r of reg) {
    if (Number(r.week) !== week || !r.gsis_id) continue;
    const prac = practiceStatus(r.practice_status);
    const rpt = r.report_status && r.report_status !== 'NA' ? r.report_status : undefined;
    const body = r.report_primary_injury || r.practice_primary_injury || undefined;
    byGsis.set(r.gsis_id, { ...(prac ? { prac } : {}), ...(rpt ? { rpt } : {}), ...(body && body !== 'NA' ? { body } : {}) });
  }
  return { week, byGsis };
}

/**
 * Sleeper player_id → nflverse gsis_id. Sleeper's own `gsis_id` covers only ~20% of active players,
 * so we also use nflverse weekly rosters (which carry `sleeper_id`) and an ESPN-id cross-match.
 */
export function sleeperToGsis(dump: Record<string, RawPlayer>, rosterRecords: Array<Record<string, string>>): Map<string, string> {
  const out = new Map<string, string>();
  const byEspn = new Map<string, string>();
  for (const [id, p] of Object.entries(dump)) {
    const g = p.gsis_id?.trim();
    if (g) out.set(id, g);
    if (p.espn_id !== null && p.espn_id !== undefined && p.espn_id !== '') byEspn.set(String(p.espn_id), id);
  }
  for (const r of rosterRecords) {
    const g = r.gsis_id;
    if (!g || g === 'NA') continue;
    const sid = r.sleeper_id && r.sleeper_id !== 'NA' ? r.sleeper_id : r.espn_id && r.espn_id !== 'NA' ? byEspn.get(r.espn_id) : undefined;
    if (sid && !out.has(sid)) out.set(sid, g);
  }
  return out;
}

/** Sleeper players dump → compact records for rostered/injured players, joined with the injury report. */
export function compactPlayers(dump: Record<string, RawPlayer>, report?: InjuryReport, gsisBySleeper?: Map<string, string>): CompactPlayer[] {
  const out: CompactPlayer[] = [];
  for (const [id, p] of Object.entries(dump)) {
    if (!p.team && !p.injury_status) continue;
    const pos = p.position ?? 'UNK';
    const name = pos === 'DEF' ? `${p.first_name ?? id} ${p.last_name ?? ''}`.trim() : p.full_name ?? `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim();
    const cp: CompactPlayer = { id, n: name, pos };
    const fp = p.fantasy_positions ?? [];
    if (fp.length && !(fp.length === 1 && fp[0] === pos)) cp.fp = fp;
    if (p.team) cp.t = p.team;
    if (p.injury_status) cp.inj = p.injury_status;
    if (p.injury_body_part) cp.body = p.injury_body_part;
    if (p.depth_chart_position) cp.dp = p.depth_chart_position;
    if (typeof p.depth_chart_order === 'number') cp.do = p.depth_chart_order;
    if (typeof p.search_rank === 'number' && p.search_rank < 9_999_999) cp.rk = p.search_rank;
    const gsis = p.gsis_id?.trim() || gsisBySleeper?.get(id);
    if (gsis) {
      cp.gsis = gsis;
      const inj = report?.byGsis.get(gsis);
      if (inj?.prac) cp.prac = inj.prac;
      if (inj?.rpt) cp.rpt = inj.rpt;
      if (!cp.body && inj?.body) cp.body = inj.body;
    }
    out.push(cp);
  }
  return out.sort((a, b) => (a.rk ?? 1e9) - (b.rk ?? 1e9) || a.id.localeCompare(b.id));
}
