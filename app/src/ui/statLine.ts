import type { StatLine } from '../domain/types';

// A player's stat line so far this week, as box scores print it (the Matchup tab). Display only.

const n = (s: StatLine, k: string) => s[k] ?? 0;
const tds = (count: number, label = 'TD') => (count ? `, ${count > 1 ? `${count} ` : ''}${label}` : '');

function passing(s: StatLine): string | undefined {
  if (!n(s, 'pass_att')) return undefined;
  const ints = n(s, 'pass_int');
  return `${n(s, 'pass_cmp')}/${n(s, 'pass_att')}, ${n(s, 'pass_yd')} yd${tds(n(s, 'pass_td'))}${ints ? `, ${ints} INT` : ''}`;
}
const rushing = (s: StatLine) => (n(s, 'rush_att') ? `${n(s, 'rush_att')} car, ${n(s, 'rush_yd')} yd${tds(n(s, 'rush_td'))}` : undefined);
const receiving = (s: StatLine) =>
  n(s, 'rec_tgt') || n(s, 'rec') ? `${n(s, 'rec')}/${n(s, 'rec_tgt')} rec, ${n(s, 'rec_yd')} yd${tds(n(s, 'rec_td'))}` : undefined;

function kicking(s: StatLine): string | undefined {
  const parts = [n(s, 'fga') ? `FG ${n(s, 'fgm')}/${n(s, 'fga')}` : '', n(s, 'xpa') ? `XP ${n(s, 'xpm')}/${n(s, 'xpa')}` : ''].filter(Boolean);
  return parts.length ? parts.join(', ') : undefined;
}

function defense(s: StatLine): string | undefined {
  const parts = [
    `${n(s, 'pts_allow')} pts allowed`,
    n(s, 'sack') ? `${n(s, 'sack')} sack${n(s, 'sack') === 1 ? '' : 's'}` : '',
    n(s, 'int') ? `${n(s, 'int')} INT` : '',
    n(s, 'fum_rec') ? `${n(s, 'fum_rec')} fum rec` : '',
    n(s, 'def_td') ? `${n(s, 'def_td')} TD` : '',
  ].filter(Boolean);
  return parts.join(', ');
}

function idp(s: StatLine): string | undefined {
  const tackles = n(s, 'idp_tkl_solo') + n(s, 'idp_tkl_ast');
  const parts = [tackles ? `${tackles} tkl` : '', n(s, 'idp_sack') ? `${n(s, 'idp_sack')} sack` : '', n(s, 'idp_int') ? `${n(s, 'idp_int')} INT` : ''].filter(Boolean);
  return parts.length ? parts.join(', ') : undefined;
}

const ORDER: Record<string, Array<(s: StatLine) => string | undefined>> = {
  QB: [passing, rushing, receiving],
  RB: [rushing, receiving, passing],
  WR: [receiving, rushing, passing],
  TE: [receiving, rushing, passing],
};

/** e.g. "5/7 rec, 89 yd, TD" or "21/30, 248 yd, 2 TD · 4 car, 12 yd"; undefined with nothing to show. */
export function statLine(pos: string, s: StatLine | undefined): string | undefined {
  if (!s || !Object.keys(s).length) return undefined;
  let parts: Array<string | undefined>;
  if (pos === 'K') parts = [kicking(s)];
  else if (pos === 'DEF') parts = [defense(s)];
  else if (ORDER[pos]) parts = ORDER[pos].map((f) => f(s));
  else parts = [idp(s)];
  const fumbles = n(s, 'fum_lost');
  if (fumbles && pos !== 'DEF') parts.push(`${fumbles} fum lost`);
  const line = parts.filter(Boolean).join(' · ');
  return line || undefined;
}

/** Counts that only go up during a game: a drop means Sleeper corrected the stat line. */
const COUNTS = ['pass_att', 'pass_cmp', 'pass_td', 'pass_int', 'rush_att', 'rush_td', 'rec', 'rec_td', 'fgm', 'xpm', 'fum_lost', 'sack', 'int', 'fum_rec', 'def_td'];

/** What a change in a stat line says, e.g. "TD catch, 34 yd", "2 catches, 21 yd" or "FG, 52 yd" (the live feed). */
export function statChange(pos: string, d: StatLine | undefined): string | undefined {
  if (!d || !Object.keys(d).length) return undefined;
  if (COUNTS.some((k) => n(d, k) < 0)) return 'stat correction';
  const parts: string[] = [];
  const add = (k: string, one: string, many: string) => {
    const c = n(d, k);
    if (c > 0) parts.push(c > 1 ? `${c} ${many}` : one);
  };
  add('pass_td', 'TD pass', 'TD passes');
  add('rush_td', 'rushing TD', 'rushing TDs');
  add('rec_td', 'TD catch', 'TD catches');
  add('pass_2pt', '2-pt pass', '2-pt passes');
  add('rush_2pt', '2-pt run', '2-pt runs');
  add('rec_2pt', '2-pt catch', '2-pt catches');
  add('pass_int', 'INT thrown', 'INTs thrown');
  add('fum_lost', 'fumble lost', 'fumbles lost');
  if (pos === 'K') {
    add('fgm', 'FG', 'FGs');
    if (n(d, 'fgm') === 1 && n(d, 'fgm_yds') > 0) parts.push(`${n(d, 'fgm_yds')} yd`);
    add('xpm', 'extra point', 'extra points');
    add('fgmiss', 'missed FG', 'missed FGs');
    add('xpmiss', 'missed XP', 'missed XPs');
  } else if (pos === 'DEF') {
    add('def_td', 'defensive TD', 'defensive TDs');
    add('def_st_td', 'return TD', 'return TDs');
    add('int', 'INT', 'INTs');
    add('fum_rec', 'fumble recovery', 'fumble recoveries');
    add('sack', 'sack', 'sacks');
    add('safe', 'safety', 'safeties');
    add('blk_kick', 'blocked kick', 'blocked kicks');
    if (n(d, 'pts_allow') > 0) parts.push(`${n(d, 'pts_allow')} pts allowed`);
  } else if (ORDER[pos]) {
    // Plain gains: say what kind, unless a score already does.
    if (!parts.length) {
      if (n(d, 'rec') > 0) parts.push(n(d, 'rec') > 1 ? `${n(d, 'rec')} catches` : 'catch');
      else if (n(d, 'rush_att') > 0) parts.push(n(d, 'rush_att') > 1 ? `${n(d, 'rush_att')} carries` : 'carry');
      else if (n(d, 'pass_cmp') > 0) parts.push(n(d, 'pass_cmp') > 1 ? `${n(d, 'pass_cmp')} completions` : 'completion');
    }
    const yd = n(d, 'pass_yd') + n(d, 'rush_yd') + n(d, 'rec_yd');
    if (yd) parts.push(`${yd} yd`);
  } else {
    const tackles = n(d, 'idp_tkl_solo') + n(d, 'idp_tkl_ast');
    if (tackles > 0) parts.push(tackles > 1 ? `${tackles} tackles` : 'tackle');
    add('idp_sack', 'sack', 'sacks');
    add('idp_int', 'INT', 'INTs');
    add('idp_ff', 'forced fumble', 'forced fumbles');
  }
  return parts.length ? parts.join(', ') : undefined;
}
