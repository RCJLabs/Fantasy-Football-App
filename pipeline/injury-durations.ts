// How long injury absences last (docs/injuries.md): runs of team games a QB/RB/WR/TE missed, starting after a game he
// played and with an injury on that week's final report, measured on nflverse game-day rosters. Absences still running
// at the season's end are censored, so the shares come from a Kaplan–Meier estimate.
import { injuryCategory } from '../app/src/engine/injuries';
import { CENSORED_CODES, FIRST_USABLE_WEEK, type RosterRow } from './hazard';

export interface Absence {
  season: number;
  /** First game missed. */
  week: number;
  player: string;
  pos: string;
  category: string;
  /** Final report status that week. */
  status: string;
  /** Team games missed in a row (until he played again, or the season ended). */
  games: number;
  /** He played again that season; otherwise `games` is a lower bound. */
  returned: boolean;
}

export interface AbsenceInput {
  season: number;
  rosters: readonly RosterRow[];
  /** Final report by `${week}:${gsis}`: game status, position and primary injury. */
  reports: ReadonlyMap<string, { status: string; pos: string; injury: string }>;
  /** Team-weeks that were played, `${week}:${team}`. */
  played: ReadonlySet<string>;
  firstWeek?: number;
}

const SKILL = new Set(['QB', 'RB', 'WR', 'TE']);
const GAME_STATUS = new Set(['Out', 'Doubtful', 'Questionable']);

/** Every absence of a QB/RB/WR/TE that began after a game he played, with an injury on the report. Final week left out. */
export function absences(input: AbsenceInput): Absence[] {
  const { season, played, reports } = input;
  const firstWeek = input.firstWeek ?? FIRST_USABLE_WEEK[season] ?? 1;
  let lastWeek = 0;
  for (const tw of played) lastWeek = Math.max(lastWeek, Number(tw.split(':')[0]));
  const byPlayer = new Map<string, Map<number, RosterRow>>();
  for (const r of input.rosters) {
    let weeks = byPlayer.get(r.gsis);
    if (!weeks) byPlayer.set(r.gsis, (weeks = new Map()));
    weeks.set(r.week, r);
  }

  const out: Absence[] = [];
  for (const [gsis, weeks] of byPlayer) {
    // His team's games, in order (his current team; his last team while he's on no roster). The final week is
    // left out: rested starters.
    const games: Array<{ week: number; status: string; row?: RosterRow }> = [];
    let team: string | undefined;
    for (let w = 1; w < lastWeek; w++) {
      const row = weeks.get(w);
      if (row) team = row.team;
      if (!team || !played.has(`${w}:${team}`)) continue;
      games.push({ week: w, status: row?.status ?? 'none', ...(row ? { row } : {}) });
    }
    for (let i = 1; i < games.length; i++) {
      const prev = games[i - 1]!;
      const cur = games[i]!;
      if (prev.week < firstWeek || prev.status !== 'ACT' || cur.status === 'ACT' || !prev.row) continue;
      const report = reports.get(`${cur.week}:${gsis}`);
      const pos = report?.pos || prev.row.pos;
      const category = injuryCategory(report?.injury);
      if (!report || !SKILL.has(pos) || !GAME_STATUS.has(report.status) || !category || category === 'Not injury') continue;
      let missed = 0;
      let j = i;
      let covid = false;
      for (; j < games.length && games[j]!.status !== 'ACT'; j++) {
        if (CENSORED_CODES.has(games[j]!.row?.code ?? '')) covid = true;
        missed++;
      }
      if (covid) continue;
      out.push({ season, week: cur.week, player: gsis, pos, category, status: report.status, games: missed, returned: j < games.length });
    }
  }
  return out;
}

/**
 * Kaplan–Meier survival of absence length: `s[k]` = P(missed more than k games), k = 0..maxK, with Greenwood
 * variances. Absences that hadn't ended by the season's end leave the risk set when censored.
 */
export function kaplanMeier(list: readonly Absence[], maxK: number): { s: number[]; variance: number[] } {
  const ended = new Map<number, number>();
  const censored = new Map<number, number>();
  for (const a of list) (a.returned ? ended : censored).set(a.games, ((a.returned ? ended : censored).get(a.games) ?? 0) + 1);
  const s = [1];
  const variance = [0];
  let atRisk = list.length;
  let surv = 1;
  let greenwood = 0;
  for (let k = 1; k <= maxK; k++) {
    const d = ended.get(k) ?? 0;
    if (atRisk > 0 && d > 0) {
      surv *= 1 - d / atRisk;
      if (atRisk > d) greenwood += d / (atRisk * (atRisk - d));
    }
    s.push(surv);
    variance.push(surv * surv * greenwood);
    atRisk -= d + (censored.get(k) ?? 0);
  }
  return { s, variance };
}

export interface DurationSummary {
  n: number;
  /** Shares of absences that lasted one game, two or fewer, four or fewer. */
  oneGame: number;
  twoOrFewer: number;
  fourOrFewer: number;
  /** 95% interval of `twoOrFewer` (Greenwood). */
  twoOrFewerCi: [number, number];
  /** Of absences that began by week 10, the share that lasted the rest of the season. */
  seasonEnding: number;
  seasonEndingN: number;
}

export function summarize(list: readonly Absence[]): DurationSummary {
  const { s, variance } = kaplanMeier(list, 4);
  const half = 1.96 * Math.sqrt(variance[2]!);
  const early = list.filter((a) => a.week <= 10);
  return {
    n: list.length,
    oneGame: 1 - s[1]!,
    twoOrFewer: 1 - s[2]!,
    fourOrFewer: 1 - s[4]!,
    twoOrFewerCi: [Math.max(0, 1 - s[2]! - half), Math.min(1, 1 - s[2]! + half)],
    seasonEnding: early.length ? early.filter((a) => !a.returned).length / early.length : 0,
    seasonEndingN: early.length,
  };
}
