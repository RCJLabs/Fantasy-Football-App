import type { League, LeagueRules, LeagueUser, Matchup, Player, Projection, Roster } from '../domain/types';
import type { RawLeague, RawMatchup, RawPlayer, RawProjection, RawRoster, RawUser } from './raw';

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

export function parseLeagueRules(raw: RawLeague): LeagueRules {
  const s = raw.settings ?? {};
  const type = num(s.type) === 2 ? 'dynasty' : num(s.type) === 1 ? 'keeper' : 'redraft';
  const reserveAllow: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(s)) {
    if (k.startsWith('reserve_allow_')) reserveAllow[k.slice('reserve_allow_'.length)] = v === 1;
  }
  const rules: LeagueRules = {
    type,
    bestBall: num(s.best_ball) === 1,
    medianGame: num(s.league_average_match) === 1,
    numTeams: num(s.num_teams) ?? raw.total_rosters,
    reserveSlots: num(s.reserve_slots) ?? 0,
    taxiSlots: num(s.taxi_slots) ?? 0,
    reserveAllow,
    // Set in every league seen (0 in redraft); dynasty leagues trade picks when it's missing.
    pickTrading: s.pick_trading == null ? type === 'dynasty' : num(s.pick_trading) === 1,
  };
  const opt: Array<[keyof LeagueRules, string]> = [
    ['playoffWeekStart', 'playoff_week_start'],
    ['playoffTeams', 'playoff_teams'],
    ['playoffRoundType', 'playoff_round_type'],
    ['playoffSeedType', 'playoff_seed_type'],
    ['tradeDeadline', 'trade_deadline'],
    ['waiverType', 'waiver_type'],
    ['waiverBudget', 'waiver_budget'],
    ['waiverBidMin', 'waiver_bid_min'],
    ['lastScoredWeek', 'last_scored_leg'],
    ['maxKeepers', 'max_keepers'],
    ['draftRounds', 'draft_rounds'],
  ];
  for (const [key, rawKey] of opt) {
    const v = num(s[rawKey]);
    if (v !== undefined) (rules as unknown as Record<string, unknown>)[key] = v;
  }
  // Leagues without playoffs report playoff_week_start 0 (and no bracket).
  if (!rules.playoffWeekStart) delete rules.playoffWeekStart;
  return rules;
}

export function parseLeague(raw: RawLeague): League {
  return {
    id: raw.league_id,
    name: raw.name,
    season: raw.season,
    status: raw.status,
    rosterPositions: raw.roster_positions ?? [],
    scoring: raw.scoring_settings ?? {},
    rules: parseLeagueRules(raw),
    avatar: raw.avatar ?? null,
  };
}

export function parseRoster(raw: RawRoster): Roster {
  const s = raw.settings ?? {};
  return {
    rosterId: raw.roster_id,
    ownerId: raw.owner_id,
    coOwners: raw.co_owners ?? [],
    players: raw.players ?? [],
    starters: raw.starters ?? [],
    reserve: raw.reserve ?? [],
    taxi: raw.taxi ?? [],
    wins: s.wins ?? 0,
    losses: s.losses ?? 0,
    ties: s.ties ?? 0,
    pointsFor: (s.fpts ?? 0) + (s.fpts_decimal ?? 0) / 100,
    waiverBudgetUsed: s.waiver_budget_used ?? 0,
  };
}

export function parseMatchup(raw: RawMatchup): Matchup {
  return {
    rosterId: raw.roster_id,
    matchupId: raw.matchup_id,
    starters: raw.starters ?? [],
    players: raw.players ?? [],
    points: raw.points ?? 0,
    playersPoints: raw.players_points ?? {},
  };
}

export function parseUser(raw: RawUser): LeagueUser {
  const teamName = raw.metadata?.team_name?.trim();
  return { userId: raw.user_id, displayName: raw.display_name ?? raw.username ?? 'Unknown', ...(teamName ? { teamName } : {}) };
}

/** The roster the user manages (owner or co-owner). */
export function findUserRoster(rosters: readonly Roster[], userId: string): Roster | undefined {
  return rosters.find((r) => r.ownerId === userId) ?? rosters.find((r) => r.coOwners.includes(userId));
}

export interface ProjectionIndex {
  byPlayer: Map<string, Projection>;
  /** Player facts carried on projection rows (names, positions, injury) — a fallback player DB. */
  players: Map<string, Player>;
  /** Every stat key seen across rows (for scoring-coverage checks). */
  statKeys: Set<string>;
}

export function indexProjections(rows: readonly RawProjection[], week: number): ProjectionIndex {
  const byPlayer = new Map<string, Projection>();
  const players = new Map<string, Player>();
  const statKeys = new Set<string>();
  for (const r of rows) {
    const stats = r.stats ?? {};
    for (const k in stats) statKeys.add(k);
    byPlayer.set(r.player_id, {
      playerId: r.player_id,
      week,
      stats,
      ...(r.team ? { team: r.team } : {}),
      ...(r.opponent ? { opponent: r.opponent } : {}),
      ...(r.date ? { gameDate: r.date } : {}),
    });
    const p = r.player;
    if (p) {
      const pos = p.position ?? 'UNK';
      players.set(r.player_id, {
        id: r.player_id,
        name: `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || r.player_id,
        pos,
        fpos: p.fantasy_positions ?? [pos],
        team: p.team ?? r.team ?? null,
        injury: p.injury_status || null,
        ...(p.injury_body_part ? { injuryBody: p.injury_body_part } : {}),
      });
    }
  }
  return { byPlayer, players, statKeys };
}

/** Fallback when pipeline data is unavailable: build the player DB from Sleeper's full dump. */
export function parsePlayersDump(dump: Record<string, RawPlayer>): Map<string, Player> {
  const out = new Map<string, Player>();
  for (const [id, p] of Object.entries(dump)) {
    if (!p.team && !p.injury_status) continue;
    const pos = p.position ?? 'UNK';
    out.set(id, {
      id,
      name: p.full_name ?? (`${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || id),
      pos,
      fpos: p.fantasy_positions ?? [pos],
      team: p.team ?? null,
      injury: p.injury_status || null,
      ...(p.injury_body_part ? { injuryBody: p.injury_body_part } : {}),
      ...(p.depth_chart_position ? { depthPos: p.depth_chart_position } : {}),
      ...(typeof p.depth_chart_order === 'number' ? { depthOrder: p.depth_chart_order } : {}),
      ...(typeof p.search_rank === 'number' ? { rank: p.search_rank } : {}),
      ...(p.gsis_id ? { gsis: p.gsis_id.trim() } : {}),
    });
  }
  return out;
}
