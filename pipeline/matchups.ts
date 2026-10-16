// Matchup context from nflverse (CC-BY 4.0), shown in the app as context only:
//  - defense vs position: PPR points each defense allowed at each position beyond what those players
//    score in their other games (leave-one-out), per game, shrunk toward zero while samples are small;
//  - secondaries: each defense's regular cornerbacks by snap share, so the app can flag the ones out.
import { DATA_SCHEMA_VERSION, type MatchupsFile } from '../app/src/data/contracts';
import { toSleeperTeam } from './lib';

const POSITIONS = ['QB', 'RB', 'WR', 'TE'] as const;
/** Pseudo-games of "average defense" added to every sample: at 4 games, half the observed edge shows. [design] */
export const PRIOR_GAMES = 4;
/** Fewest other games a player needs before his average counts as his usual. [design] */
const MIN_OTHER_GAMES = 2;
/** Cornerbacks kept per team, and the snap share that makes one a regular. [design] */
const TOP_CBS = 3;
const REGULAR_SNAPS = 0.5;
const CB_WEEKS = 4;

export interface MatchupInput {
  season: string;
  now: string;
  /** nflverse stats_player_week_<season>.csv rows. */
  stats: ReadonlyArray<Record<string, string>>;
  /** nflverse snap_counts_<season>.csv rows. */
  snaps: ReadonlyArray<Record<string, string>>;
  /** nflverse weekly rosters: pfr_id → gsis_id. */
  rosters: ReadonlyArray<Record<string, string>>;
  sleeperByGsis: ReadonlyMap<string, string>;
}

const regular = (r: Record<string, string>) => (r.game_type || r.season_type || 'REG') === 'REG';
const round1 = (x: number) => Math.round(x * 10) / 10;

export function buildMatchups(input: MatchupInput): MatchupsFile | null {
  const stats = input.stats.filter((r) => regular(r) && (POSITIONS as readonly string[]).includes(r.position ?? '') && r.opponent_team && r.player_id);
  if (!stats.length) return null;
  const weeks = [...new Set(stats.map((r) => Number(r.week)))].filter(Number.isInteger).sort((a, b) => a - b);

  // Leave-one-out: each game against the player's average in his other games.
  const byPlayer = new Map<string, Array<{ week: string; opp: string; pos: string; ppr: number }>>();
  for (const r of stats) {
    const games = byPlayer.get(r.player_id!) ?? [];
    games.push({ week: r.week!, opp: toSleeperTeam(r.opponent_team!), pos: r.position!, ppr: Number(r.fantasy_points_ppr) || 0 });
    byPlayer.set(r.player_id!, games);
  }
  const edge = new Map<string, Map<string, number>>(); // `${defense}:${pos}` → week → summed edge
  for (const games of byPlayer.values()) {
    if (games.length < MIN_OTHER_GAMES + 1) continue;
    const total = games.reduce((a, g) => a + g.ppr, 0);
    for (const g of games) {
      const usual = (total - g.ppr) / (games.length - 1);
      const key = `${g.opp}:${g.pos}`;
      const perWeek = edge.get(key) ?? new Map<string, number>();
      perWeek.set(g.week, (perWeek.get(g.week) ?? 0) + g.ppr - usual);
      edge.set(key, perWeek);
    }
  }
  const defense: MatchupsFile['defense'] = {};
  for (const [key, perWeek] of edge) {
    const [team, pos] = key.split(':') as [string, (typeof POSITIONS)[number]];
    const sum = [...perWeek.values()].reduce((a, x) => a + x, 0);
    (defense[team] ??= {})[pos] = { pg: round1(sum / (perWeek.size + PRIOR_GAMES)), n: perWeek.size };
  }

  // Regular cornerbacks: average defensive snap share over the games each played in the last few weeks.
  const gsisByPfr = new Map<string, string>();
  for (const r of input.rosters) if (r.pfr_id && r.gsis_id) gsisByPfr.set(r.pfr_id, r.gsis_id);
  const cbRows = input.snaps.filter((r) => regular(r) && r.position === 'CB');
  const lastWeek = Math.max(0, ...cbRows.map((r) => Number(r.week)).filter(Number.isInteger));
  const cbs = new Map<string, { team: string; week: number; shares: number[] }>();
  for (const r of cbRows) {
    const week = Number(r.week);
    if (week <= lastWeek - CB_WEEKS) continue;
    const gsis = gsisByPfr.get(r.pfr_player_id ?? '');
    const id = gsis ? input.sleeperByGsis.get(gsis) : undefined;
    if (!id) continue;
    const cb = cbs.get(id) ?? { team: '', week: 0, shares: [] };
    cb.shares.push(Number(r.defense_pct) || 0);
    if (week >= cb.week) Object.assign(cb, { team: toSleeperTeam(r.team ?? ''), week }); // latest team (trades)
    cbs.set(id, cb);
  }
  const secondary: MatchupsFile['secondary'] = {};
  for (const [id, cb] of cbs) {
    const snap = cb.shares.reduce((a, x) => a + x, 0) / cb.shares.length;
    if (snap >= REGULAR_SNAPS && cb.team) (secondary[cb.team] ??= []).push({ id, snap: Math.round(snap * 100) });
  }
  for (const team of Object.keys(secondary)) secondary[team] = secondary[team]!.sort((a, b) => b.snap - a.snap).slice(0, TOP_CBS);

  return { schemaVersion: DATA_SCHEMA_VERSION, generatedAt: input.now, season: input.season, weeks, priorGames: PRIOR_GAMES, defense, secondary };
}
