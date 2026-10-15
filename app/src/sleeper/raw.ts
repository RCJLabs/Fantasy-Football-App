// Shapes of Sleeper API responses (only the fields we read). Verified against live responses in
// docs/spikes.md where noted; league/roster/matchup fields follow Sleeper's docs and ffscrapr.

export interface RawState {
  week: number;
  leg: number;
  season: string;
  season_type: 'pre' | 'regular' | 'post' | 'off' | string;
  display_week: number;
  league_season?: string;
}

export interface RawUser {
  user_id: string;
  username?: string;
  display_name?: string;
  avatar?: string | null;
  metadata?: { team_name?: string } | null;
}

export interface RawLeague {
  league_id: string;
  name: string;
  season: string;
  status: string;
  total_rosters: number;
  roster_positions: string[] | null;
  scoring_settings: Record<string, number> | null;
  settings: Record<string, number | null | undefined> | null;
  avatar?: string | null;
  previous_league_id?: string | null;
}

export interface RawRoster {
  roster_id: number;
  owner_id: string | null;
  co_owners?: string[] | null;
  players: string[] | null;
  starters: string[] | null;
  reserve?: string[] | null;
  taxi?: string[] | null;
  settings?: {
    wins?: number;
    losses?: number;
    ties?: number;
    fpts?: number;
    fpts_decimal?: number;
    waiver_budget_used?: number;
    waiver_position?: number;
  } | null;
}

/** Row of /league/{id}/transactions/{week} (verified on real leagues 2026-10-15). */
export interface RawTransaction {
  type: 'waiver' | 'free_agent' | 'trade' | (string & {});
  status: 'complete' | 'failed' | (string & {});
  leg: number;
  adds?: Record<string, number> | null;
  drops?: Record<string, number> | null;
  roster_ids?: number[] | null;
  settings?: { waiver_bid?: number; seq?: number } | null;
  metadata?: { notes?: string } | null;
}

/** Row of /league/{id}/traded_picks (verified on a real league 2026-10-15). Only picks that changed hands are listed. */
export interface RawTradedPick {
  season: string;
  round: number;
  /** The pick's original team: its finish sets the draft slot. */
  roster_id: number;
  /** Current owner (roster id). */
  owner_id: number;
  previous_owner_id?: number | null;
}

export interface RawMatchup {
  roster_id: number;
  matchup_id: number | null;
  starters: string[] | null;
  players: string[] | null;
  points: number | null;
  players_points?: Record<string, number> | null;
}

/** Row of api.sleeper.com/projections (verified 2026-10-15). */
export interface RawProjection {
  player_id: string;
  stats: Record<string, number> | null;
  team?: string | null;
  opponent?: string | null;
  game_id?: string | null;
  date?: string | null;
  company?: string;
  player?: {
    first_name?: string;
    last_name?: string;
    position?: string;
    fantasy_positions?: string[] | null;
    team?: string | null;
    injury_status?: string | null;
    injury_body_part?: string | null;
  } | null;
}

/** Entry of api.sleeper.app/v1/players/nfl (verified field list 2026-10-15). */
export interface RawPlayer {
  player_id: string;
  full_name?: string;
  first_name?: string;
  last_name?: string;
  position?: string | null;
  fantasy_positions?: string[] | null;
  team?: string | null;
  active?: boolean;
  injury_status?: string | null;
  injury_body_part?: string | null;
  depth_chart_position?: string | null;
  depth_chart_order?: number | null;
  search_rank?: number | null;
  gsis_id?: string | null;
  espn_id?: string | number | null;
}

export interface RawTrending {
  player_id: string;
  count: number;
}
