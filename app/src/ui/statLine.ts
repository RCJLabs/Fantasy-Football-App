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
