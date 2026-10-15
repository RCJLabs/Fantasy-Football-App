/** Stat key → value, using Sleeper's stat keys (e.g. `rec`, `rush_yd`, `pts_allow_14_20`). */
export type StatLine = Record<string, number>;

/** League scoring: stat key → points per unit (Sleeper `scoring_settings`). */
export type ScoringSettings = Record<string, number>;

export type InjuryStatus =
  | 'Questionable'
  | 'Doubtful'
  | 'Out'
  | 'IR'
  | 'PUP'
  | 'NA'
  | 'Sus'
  | 'DNR'
  | 'COV'
  | (string & {});

/** Final practice participation from the official report (nflverse injuries). */
export type PracticeStatus = 'Full' | 'Limited' | 'DNP';

export interface Player {
  id: string; // Sleeper player_id
  name: string;
  pos: string; // primary position (QB, RB, WR, TE, K, DEF, DL, LB, DB, …)
  fpos: string[]; // fantasy positions (slot eligibility)
  team: string | null;
  injury: InjuryStatus | null;
  injuryBody?: string;
  practice?: PracticeStatus;
  depthPos?: string;
  depthOrder?: number;
  rank?: number; // Sleeper search_rank (lower = more relevant)
  gsis?: string;
}

/** One source's projection for one player-week. Stats use Sleeper keys. */
export interface Projection {
  playerId: string;
  week: number;
  stats: StatLine;
  team?: string;
  opponent?: string;
  gameDate?: string; // YYYY-MM-DD from Sleeper
}

export interface Game {
  id: string; // nflverse game_id, e.g. 2026_06_SEA_DEN
  week: number;
  away: string; // Sleeper team codes (LAR, not LA)
  home: string;
  kickoff: string; // ISO UTC
  spread?: number; // nflverse spread_line: positive = home favored
  total?: number;
  homeImplied?: number;
  awayImplied?: number;
  roof?: string;
}

export interface LeagueRules {
  type: 'redraft' | 'keeper' | 'dynasty';
  bestBall: boolean;
  medianGame: boolean;
  numTeams: number;
  playoffWeekStart?: number;
  playoffTeams?: number;
  tradeDeadline?: number;
  waiverType?: number;
  waiverBudget?: number;
  reserveSlots: number;
  taxiSlots: number;
  reserveAllow: Record<string, boolean>;
}

export interface League {
  id: string;
  name: string;
  season: string;
  status: string; // pre_draft | drafting | in_season | complete
  rosterPositions: string[];
  scoring: ScoringSettings;
  rules: LeagueRules;
  avatar?: string | null;
}

export interface Roster {
  rosterId: number;
  ownerId: string | null;
  coOwners: string[];
  players: string[];
  starters: string[]; // aligned with the starting slots of rosterPositions ("0" = empty)
  reserve: string[];
  taxi: string[];
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
}

export interface Matchup {
  rosterId: number;
  matchupId: number | null;
  starters: string[];
  players: string[];
  points: number;
  playersPoints: Record<string, number>;
}

export interface LeagueUser {
  userId: string;
  displayName: string;
  teamName?: string;
}
