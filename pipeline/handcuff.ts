// The next man up (docs/handcuffs.md): how much of a starter's production his backup inherits in the games the starter
// misses. Measured on nflverse weekly stats and game-day rosters by scripts/calibrate/handcuff.ts; the app's handcuff
// values use the result (app/src/analysis/handcuffs.ts).

/** One player's game: usage (QB attempts + carries, RB carries + targets, WR/TE targets) and half-PPR points. */
export interface PlayerGame {
  week: number;
  team: string;
  player: string;
  pos: string;
  usage: number;
  points: number;
}

export interface SeasonData {
  season: number;
  games: readonly PlayerGame[];
  /** `${week}:${player}` → his team and game-day roster status (ACT, INA, RES, …). */
  status: ReadonlyMap<string, { team: string; status: string }>;
  /** First week whose rosters mark inactives. */
  fromWeek?: number;
}

/** A starter's game: he sat (the event) or played (the control), with his backup's numbers. */
export interface Absence {
  season: number;
  team: string;
  pos: string;
  week: number;
  starter: string;
  backup: string;
  out: boolean;
  /** Points per game over the team's previous games with the starter active: his, his backup's, and the rest of the position group's. */
  baseStarter: number;
  baseBackup: number;
  baseGroup: number;
  /** This game: the backup's points, and the position group's (starter aside). */
  backupPoints: number;
  groupPoints: number;
}

/** Previous team games that define the starter and backup [design]. */
export const WINDOW = 4;
/** Starters worth handcuffing: at least this many half-PPR points a game before the game [design]. */
export const MIN_STARTER = 8;
const POSITIONS = ['QB', 'RB', 'WR', 'TE'] as const;

const usageOf = (pos: string, r: { attempts: number; carries: number; targets: number }) =>
  pos === 'QB' ? r.attempts + r.carries : pos === 'RB' ? r.carries + r.targets : r.targets;

/** A PlayerGame from an nflverse `stats_player_week` row (regular season, QB/RB/WR/TE), or undefined. */
export function playerGame(r: Readonly<Record<string, string>>): PlayerGame | undefined {
  if (r.season_type !== 'REG' || !r.player_id || !POSITIONS.includes(r.position as (typeof POSITIONS)[number])) return undefined;
  const n = (k: string) => Number(r[k]) || 0;
  return {
    week: Number(r.week),
    team: r.team ?? '',
    player: r.player_id,
    pos: r.position!,
    usage: usageOf(r.position!, { attempts: n('attempts'), carries: n('carries'), targets: n('targets') }),
    points: (n('fantasy_points') + n('fantasy_points_ppr')) / 2,
  };
}

const mean = (xs: readonly number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/**
 * Every team game in which a starter (most usage at his position over the team's previous WINDOW games, active in at
 * least two of them, MIN_STARTER points a game) sat (INA or reserve list) or played. The backup is the player with the
 * next most usage over those games; for quarterbacks, who rarely play behind the starter, it's the one who threw most in
 * the game itself, so QBs have no control games.
 */
export function absences(data: SeasonData): Absence[] {
  const byTeam = new Map<string, Map<number, PlayerGame[]>>();
  for (const g of data.games) {
    const weeks = byTeam.get(g.team) ?? new Map<number, PlayerGame[]>();
    weeks.set(g.week, [...(weeks.get(g.week) ?? []), g]);
    byTeam.set(g.team, weeks);
  }
  const status = (week: number, player: string) => data.status.get(`${week}:${player}`);
  const out: Absence[] = [];
  for (const [team, weeks] of byTeam) {
    const order = [...weeks.keys()].sort((a, b) => a - b);
    const pts = (week: number, player: string) => weeks.get(week)?.find((g) => g.player === player)?.points ?? 0;
    for (let j = 0; j < order.length; j++) {
      const week = order[j]!;
      const prior = order.slice(Math.max(0, j - WINDOW), j).filter((w) => w >= (data.fromWeek ?? 1));
      if (week < (data.fromWeek ?? 1) || prior.length < 3) continue;
      for (const pos of POSITIONS) {
        const usage = new Map<string, number>();
        for (const w of prior) for (const g of weeks.get(w) ?? []) if (g.pos === pos) usage.set(g.player, (usage.get(g.player) ?? 0) + g.usage);
        const activeIn = (player: string, ws: readonly number[]) => ws.filter((w) => status(w, player)?.team === team && status(w, player)?.status === 'ACT');
        const ranked = [...usage].filter(([, u]) => u > 0).sort((a, b) => b[1] - a[1]);
        const starter = ranked.find(([p]) => activeIn(p, prior).length >= 2)?.[0];
        if (!starter) continue;
        const now = status(week, starter);
        if (now?.team !== team) continue;
        const sat = now.status === 'INA' || now.status === 'RES';
        if (!sat && now.status !== 'ACT') continue;
        const withStarter = activeIn(starter, prior);
        const baseStarter = mean(withStarter.map((w) => pts(w, starter)));
        if (baseStarter < MIN_STARTER) continue;
        let backup: string | undefined;
        if (pos === 'QB') {
          if (!sat) continue;
          backup = [...(weeks.get(week) ?? [])].filter((g) => g.pos === 'QB' && g.player !== starter).sort((a, b) => b.usage - a.usage)[0]?.player;
        } else {
          backup = ranked.find(([p]) => p !== starter)?.[0];
        }
        if (!backup || status(week, backup)?.team !== team || status(week, backup)?.status !== 'ACT') continue;
        const backupWeeks = activeIn(backup, withStarter);
        const group = (w: number) => (weeks.get(w) ?? []).filter((g) => g.pos === pos && g.player !== starter).reduce((s, g) => s + g.points, 0);
        out.push({
          season: data.season,
          team,
          pos,
          week,
          starter,
          backup,
          out: sat,
          baseStarter,
          baseBackup: mean(backupWeeks.map((w) => pts(w, backup))),
          baseGroup: mean(withStarter.map(group)),
          backupPoints: pts(week, backup),
          groupPoints: group(week),
        });
      }
    }
  }
  return out;
}

/** Share of the starter's points per game his backup gains when the starter sits: Σ(backup − his base) / Σ starter's base. */
export function inheritance(rows: readonly Absence[], pick: (a: Absence) => number = (a) => a.backupPoints - a.baseBackup): number {
  const den = rows.reduce((s, a) => s + a.baseStarter, 0);
  return den > 0 ? rows.reduce((s, a) => s + pick(a), 0) / den : 0;
}
