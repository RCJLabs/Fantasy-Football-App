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
  draft_id?: string | null;
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

/**
 * Row of /league/{id}/winners_bracket (seen on real leagues 2026-10-15: during the regular season it's pre-filled
 * with the current seeds). Later rounds name their teams by the match they come from until it's decided.
 */
export interface RawBracketMatch {
  /** Round, from 1. */
  r: number;
  /** Match id. */
  m: number;
  /** Roster ids, once known. */
  t1: number | null;
  t2: number | null;
  /** The slot's team is the winner (w) or loser (l) of match `w`/`l`. */
  t1_from?: { w?: number; l?: number } | null;
  t2_from?: { w?: number; l?: number } | null;
  /** Winner and loser roster ids, once decided. */
  w: number | null;
  l: number | null;
  /** Placement game: 1 = championship, 3 = third place, 5 = fifth place. Absent for the bracket's other games. */
  p?: number | null;
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
  /** When Sleeper last saved the row (ms since 1970). */
  updated_at?: number | null;
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
  birth_date?: string | null;
  years_exp?: number | null;
}

export interface RawTrending {
  player_id: string;
  count: number;
}

/**
 * Row of /league/{id}/drafts and /draft/{id} (checked on real drafts 2026-10-17). The order is `draft_order`, user →
 * slot, once the commissioner sets or randomizes it; `slot_to_roster_id` stayed empty even on finished drafts.
 */
export interface RawDraft {
  draft_id: string;
  season: string;
  status: 'pre_draft' | 'drafting' | 'complete' | (string & {});
  type: 'snake' | 'linear' | 'auction' | (string & {});
  start_time?: number | null;
  settings?: { rounds?: number; teams?: number; reversal_round?: number } | null;
  /** user id → first-round slot. */
  draft_order?: Record<string, number> | null;
  /** First-round slot → roster id. */
  slot_to_roster_id?: Record<string, number> | null;
}

/**
 * Row of /draft/{id}/picks (checked on real drafts 2026-10-17): `pick_no` counts from 1 over the whole draft;
 * `roster_id` is the team that made the pick, which differs from the slot's when the pick was traded; `is_keeper` was
 * null on every pick of a keeper league whose keepers weren't drafted.
 */
export interface RawDraftPick {
  round: number;
  pick_no: number;
  draft_slot?: number | null;
  roster_id?: number | null;
  picked_by?: string | null;
  player_id: string;
  is_keeper?: boolean | null;
  metadata?: { first_name?: string; last_name?: string; position?: string; team?: string } | null;
}
