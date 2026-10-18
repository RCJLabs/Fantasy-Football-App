export const pts = (n: number | undefined): string => (n === undefined || !Number.isFinite(n) ? '–' : n.toFixed(1));
export const pct = (p: number | undefined): string => {
  if (p === undefined || !Number.isFinite(p)) return '–';
  if (p > 0 && p < 0.005) return '<1%';
  if (p < 1 && p > 0.995) return '>99%';
  return `${Math.round(p * 100)}%`;
};
export const signed = (n: number): string => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(1)}`;
export const ordinal = (n: number): string => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')}`;
export const roundName = (round: number, rounds: number): string => (round === rounds ? 'final' : round === rounds - 1 ? 'semifinals' : `round ${round}`);

const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const fullFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export function kickoffLabel(kickoff: number | null, now: number): string {
  if (kickoff === null) return 'BYE';
  const d = new Date(kickoff);
  if (kickoff <= now) return now - kickoff > 3.5 * 3_600_000 ? 'Final' : 'Live';
  return `${dayFmt.format(d)} ${timeFmt.format(d)}`;
}

export const dateTime = (ms: number): string => fullFmt.format(new Date(ms));

export function ago(ms: number, now = Date.now()): string {
  const m = Math.round((now - ms) / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

/** Friendly names for Sleeper stat keys in explanations. */
const STAT_LABELS: Record<string, string> = {
  pass_yd: 'pass yds',
  pass_td: 'pass TD',
  pass_int: 'INT',
  pass_2pt: 'pass 2-pt',
  pass_fd: 'pass 1st downs',
  rush_yd: 'rush yds',
  rush_td: 'rush TD',
  rush_fd: 'rush 1st downs',
  rush_att: 'carries',
  rec: 'receptions',
  rec_yd: 'rec yds',
  rec_td: 'rec TD',
  rec_fd: 'rec 1st downs',
  bonus_rec_te: 'TE premium',
  bonus_rec_rb: 'RB reception bonus',
  bonus_rec_wr: 'WR reception bonus',
  fum_lost: 'fumbles lost',
  fgm: 'FG made',
  xpm: 'XP made',
  sack: 'sacks',
  int: 'INTs',
  fum_rec: 'fumble rec',
  def_td: 'DEF TD',
};
export const statLabel = (key: string): string => STAT_LABELS[key] ?? key.replace(/_/g, ' ');

/** "J. Jefferson" (a defense by its team): short enough for two lineups side by side on a phone. */
export function shortName(row: { name: string; pos: string; team: string | null }): string {
  if (row.pos === 'DEF') return row.team ? `${row.team} DEF` : row.name;
  const [first, ...rest] = row.name.split(' ');
  return rest.length && first ? `${first[0]}. ${rest.join(' ')}` : row.name;
}
