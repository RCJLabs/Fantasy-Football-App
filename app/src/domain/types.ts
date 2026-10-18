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
  /** Latest practice status on this week's official report. */
  practice?: PracticeStatus;
  /** The report is the week's final one for this player (a game status was given). */
  practiceFinal?: boolean;
  /** Not active in his team's last game (inactive, or on a reserve list). */
  missedLast?: boolean;
  depthPos?: string;
  depthOrder?: number;
  rank?: number; // Sleeper search_rank (lower = more relevant)
  gsis?: string;
  /** ESPN athlete id, for his news. */
  espnId?: string;
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

/** Where an NFL game stands right now, from ESPN's scoreboard (the Matchup tab's game clock). */
export interface GameClock {
  state: 'pre' | 'in' | 'post';
  /** Quarter (5 and up: overtime); 0 before kickoff. */
  period: number;
  /** Seconds left in the period. */
  clock: number;
  /** "Q2 8:43", "Half", "End Q3", "OT 4:10", "Final", "Final/OT"; empty before kickoff. */
  label: string;
  /** Share of a 60-minute game played, 0–1. Overtime counts its clock against the same hour, so little remains. */
  progress: number;
  home: string; // Sleeper team codes
  away: string;
  homeScore: number;
  awayScore: number;
  /** Team with the ball (Sleeper code), while the game is on. */
  possession?: string;
  /** ESPN's down and distance, e.g. "3rd & 4 at BUF 18". */
  down?: string;
  /** The team with the ball is inside the opponent's 20. */
  redZone?: boolean;
}

export interface LeagueRules {
  type: 'redraft' | 'keeper' | 'dynasty';
  bestBall: boolean;
  medianGame: boolean;
  numTeams: number;
  /** First playoff week; absent when the league has no playoffs. */
  playoffWeekStart?: number;
  playoffTeams?: number;
  /** 0 = one week per round, 1 = two-week final, 2 = two weeks per round. [unverified] Sleeper codes */
  playoffRoundType?: number;
  /** 0 = fixed bracket (Sleeper's default), 1 = re-seed each round. [unverified] Sleeper codes */
  playoffSeedType?: number;
  /** Last week trades are allowed. */
  tradeDeadline?: number;
  /** 2 = FAAB; 0/1 = rolling / reverse-standings priority. */
  waiverType?: number;
  waiverBudget?: number;
  waiverBidMin?: number;
  /** Last week whose results are in the standings. */
  lastScoredWeek?: number;
  /** Keeper leagues: players each team may keep into next season. */
  maxKeepers?: number;
  /** Future draft picks can be traded. */
  pickTrading: boolean;
  /** Rounds of future drafts (the rookie draft in dynasty leagues). */
  draftRounds?: number;
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
  /** Last season's league, when Sleeper renewed this one from it. */
  previousLeagueId?: string;
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
  waiverBudgetUsed: number;
}

/** A slot in a playoff game: the team once it's known, and until then the earlier game that decides it. */
export interface BracketSlot {
  rosterId: number | null;
  from?: { match: number; take: 'winner' | 'loser' };
}

/** A game of Sleeper's winners' bracket. */
export interface BracketMatch {
  id: number;
  /** From 1. */
  round: number;
  slots: [BracketSlot, BracketSlot];
  winner: number | null;
  loser: number | null;
  /** Placement game (1 = championship, 3 = third place, …); absent for the games that lead to the final. */
  place?: number;
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
