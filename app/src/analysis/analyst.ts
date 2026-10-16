import type { League, Roster } from '../domain/types';
import type { LineupAnalysis, PlayerRow } from './analyze';
import type { LeagueOutlook, WaiverAdvice } from './outlook';

// Ask the analyst (docs/analyst.md): Claude answers questions from the app's own figures. Every number it may quote is a
// fact with an id; it writes "{F12}" and the app puts in the value, so the numbers on screen are the app's. Numbers it
// types itself are checked against the facts and marked when they don't match one.

/** A number the app computed. */
export interface Fact {
  id: string;
  /** What it measures, in words. */
  label: string;
  /** As the app shows it. */
  value: string;
  /** The number shown, for checking numbers the model types itself. */
  num: number;
}

export interface FactSheet {
  facts: Fact[];
  /** Statements without numbers: names, designations, the app's recommended moves. */
  notes: string[];
  /** Team and player names: digits inside them aren't numbers to check. */
  names: string[];
}

export interface FactInput {
  league: League;
  week: number;
  myRoster: Roster;
  rosters: readonly Roster[];
  teamName: (rosterId: number) => string;
  lineup: LineupAnalysis;
  /** Rest of season, when it loaded. */
  outlook?: LeagueOutlook;
  /** The free-agent board, best first, when it loaded. */
  waivers?: readonly WaiverAdvice[];
}

type Kind = 'pts' | 'pct' | 'int' | 'usd' | 'num';

function shown(x: number, kind: Kind): { value: string; num: number } {
  if (kind === 'pct') {
    if (x > 0 && x < 0.005) return { value: '<1%', num: 1 };
    if (x < 1 && x > 0.995) return { value: '>99%', num: 99 };
    const n = Math.round(x * 100);
    return { value: `${n}%`, num: n };
  }
  if (kind === 'pts') return { value: x.toFixed(1), num: Number(x.toFixed(1)) };
  if (kind === 'usd') return { value: `$${Math.round(x)}`, num: Math.round(x) };
  if (kind === 'int') return { value: String(Math.round(x)), num: Math.round(x) };
  return { value: String(x), num: x };
}

/** Free agents listed. [design] */
const WAIVER_ROWS = 8;

/** The facts and notes behind the analyst's answers for one league this week. Deterministic: the same input gives the same sheet. */
export function buildFacts(input: FactInput): FactSheet {
  const { league, week, myRoster, lineup: a, outlook: o } = input;
  const facts: Fact[] = [];
  const notes: string[] = [];
  const names = new Set<string>();
  const add = (label: string, x: number | undefined, kind: Kind) => {
    if (x === undefined || !Number.isFinite(x)) return;
    facts.push({ id: `F${facts.length + 1}`, label, ...shown(x, kind) });
  };
  const me = input.teamName(myRoster.rosterId);
  names.add(me);
  const who = (p: PlayerRow) => {
    names.add(p.name);
    return `${p.name} (${p.pos}${p.team ? `, ${p.team}` : ''})`;
  };

  // The league.
  notes.push(`League: ${league.name}, a ${league.rules.type} league. The manager asking is "${me}".`);
  names.add(league.name);
  add('Teams in the league', league.rules.numTeams, 'int');
  add('Current NFL week', week, 'int');
  add('Points per reception in this league', league.scoring.rec ?? 0, 'num');
  add(`${me}: wins so far`, myRoster.wins, 'int');
  add(`${me}: losses so far`, myRoster.losses, 'int');
  if (myRoster.ties) add(`${me}: ties so far`, myRoster.ties, 'int');

  // This week.
  add(`This week: ${me}'s expected points with the app's recommended lineup`, a.expectedRecommended, 'pts');
  if (a.gain >= 0.05) {
    add(`This week: ${me}'s expected points with the lineup currently set in Sleeper`, a.expectedCurrent, 'pts');
    add('This week: expected points the recommended changes add', a.gain, 'pts');
  } else notes.push('The lineup set in Sleeper already matches the recommendation.');
  if (a.opponent) {
    names.add(a.opponent.name);
    notes.push(`This week's opponent: ${a.opponent.name}.`);
    add(`This week: ${a.opponent.name}'s expected points`, a.opponent.dist.mean, 'pts');
    add(`This week: chance ${me} wins with the recommended lineup`, a.winProbRecommended, 'pct');
    if (a.gain >= 0.05) add(`This week: chance ${me} wins with the current lineup`, a.winProbCurrent, 'pct');
  }
  add(`This week: chance ${me} beats the league median score`, a.medianProb, 'pct');
  notes.push(`The recommendation maximizes ${a.objective === 'win' ? 'the chance to win this week' : 'expected points this week'}.`);
  for (const c of a.changes) {
    if (c.kind === 'swap') notes.push(`Recommended: start ${c.in!.name} over ${c.out!.name}.`);
    else if (c.kind === 'start') notes.push(`Recommended: start ${c.in!.name} in an empty spot.`);
    else if (c.kind === 'bench') notes.push(`Recommended: bench ${c.out!.name}.`);
    else notes.push(`Recommended: move ${c.in!.name} to another lineup spot.`);
  }
  const player = (p: PlayerRow, role: string) => {
    const w = who(p);
    add(`${w}, ${role}: chance to play this week`, p.p, 'pct');
    add(`${w}, ${role}: points this week if he plays`, p.mu, 'pts');
    add(`${w}, ${role}: expected points this week (chance to play × points if he plays)`, p.ev, 'pts');
    const status = [
      p.injury ? `listed ${p.injury}${p.injuryBody ? ` (${p.injuryBody})` : ''}` : '',
      p.practice ? `${p.practice === 'DNP' ? 'did not practice' : `${p.practice.toLowerCase()} practice`} on the ${p.practiceFinal ? 'final' : 'latest'} injury report` : '',
      p.locked ? "his game has started, so he's locked" : '',
      p.opponent ? `plays ${p.home ? 'at home against' : 'away at'} ${p.opponent}` : 'has no game this week',
    ].filter(Boolean);
    notes.push(`${p.name}: ${status.join('; ')}.`);
  };
  a.recommended.forEach((p, i) => {
    if (p) player(p, `recommended starter at ${a.slots[i]}`);
  });
  for (const p of a.bench) player(p, 'bench');

  // Rest of season.
  if (o) {
    const span = o.weeks.length ? `weeks ${o.weeks[0]}–${o.weeks.at(-1)}` : '';
    const mine = o.odds?.get(myRoster.rosterId);
    if (mine) {
      add(`${me}: chance to make the playoffs`, mine.pPlayoffs, 'pct');
      if (mine.pBye > 0) add(`${me}: chance of a first-round playoff bye`, mine.pBye, 'pct');
      add(`${me}: expected wins at the end of the regular season`, mine.expWins, 'pts');
      if (mine.pTitle !== undefined) add(`${me}: chance to win the title`, mine.pTitle, 'pct');
    }
    const bracket = o.bracket?.odds.get(myRoster.rosterId);
    if (bracket) add(`${me}: chance to win the title, from the bracket as it stands`, bracket.pTitle, 'pct');
    for (const t of [...o.teams.values()].sort((x, y) => y.roster.wins - x.roster.wins || y.roster.pointsFor - x.roster.pointsFor)) {
      if (t.rosterId === myRoster.rosterId) continue;
      names.add(t.name);
      add(`${t.name}: wins so far`, t.roster.wins, 'int');
      add(`${t.name}: losses so far`, t.roster.losses, 'int');
      add(`${t.name}: points scored so far`, t.roster.pointsFor, 'pts');
      const odds = o.odds?.get(t.rosterId);
      if (odds) add(`${t.name}: chance to make the playoffs`, odds.pPlayoffs, 'pct');
    }
    add(`${me}: points scored so far`, myRoster.pointsFor, 'pts');
    if (span) {
      const team = o.teams.get(myRoster.rosterId);
      for (const id of team ? team.roster.players.filter((x) => !team.roster.taxi.includes(x)) : []) {
        const p = o.model.player(id);
        if (!p || !o.weeks.length) continue;
        names.add(p.name);
        add(`${p.name} (${p.pos}${p.team ? `, ${p.team}` : ''}): expected points a week over the rest of the season (${span}, byes and injury risk included)`, o.model.total(id) / o.weeks.length, 'pts');
      }
    }
  }

  // Free agents.
  for (const w of (input.waivers ?? []).slice(0, WAIVER_ROWS)) {
    const p = w.player;
    const label = `Free agent ${who(p)}`;
    add(`${label}: points he adds to ${me}'s lineup this week`, w.gainThisWeek, 'pts');
    add(`${label}: points he adds to ${me}'s lineups over the rest of the season`, w.rosGain, 'pts');
    if (w.bid) add(`${label}: suggested FAAB bid`, w.bid.bid, 'usd');
    if (w.drop) {
      names.add(w.drop.name);
      notes.push(`To add ${p.name}, the app would drop ${w.drop.name}.`);
    }
  }

  return { facts, notes, names: [...names].filter(Boolean) };
}

/** The analyst's standing instructions (cached with the fact sheet). */
export const ANALYST_RULES = `You are the analyst inside a fantasy football app. You answer the manager's questions about their league using only the app's figures, which follow.

Rules:
- Use only the facts and notes below: the app's own calculations for this league. Don't use outside knowledge about players, teams or news. It may be out of date, and the manager can't check it here.
- Never type a number. Write each number as its fact id in braces, like {F12}, and the app puts in the value. If a number you'd need isn't a fact, say the app doesn't have it rather than estimate it.
- If the facts don't answer the question, say so in a sentence and name the app tab that might help: Lineup, Matchup, Waivers, Trade or Season.
- Lead with the answer, then the reason from the facts. Keep it under 120 words unless the manager asks for more. Plain sentences; a short list is fine. No headings, tables or bold.
- Explain the app's recommendations rather than overruling them. If the facts show a close call, say it's close.`;

/** The fact sheet as the model reads it. */
export function sheetText(sheet: FactSheet, asOf: string): string {
  return [
    `The app's figures, as of ${asOf}.`,
    '',
    'Facts (quote by id):',
    ...sheet.facts.map((f) => `{${f.id}} ${f.label}: ${f.value}`),
    '',
    'Notes:',
    ...sheet.notes.map((n) => `- ${n}`),
  ].join('\n');
}

/** Part of an answer: plain text, a fact the app put in, a reference to no fact, or a number the model typed that matches no fact. */
export type AnswerPiece = { kind: 'text'; text: string } | { kind: 'fact'; text: string; fact: Fact } | { kind: 'unknown'; text: string } | { kind: 'unchecked'; text: string };

export interface CheckedAnswer {
  pieces: AnswerPiece[];
  /** Numbers the app put in. */
  quoted: number;
  /** Numbers the model typed that match a fact's value. */
  matched: number;
  /** Numbers the model typed that match none, and references to no fact. */
  unchecked: number;
}

const NUMBER = /\d+(?:[.,]\d+)*/g;

/** Puts the facts' values into an answer and marks every number that doesn't come from one. */
export function checkAnswer(raw: string, sheet: FactSheet): CheckedAnswer {
  const byId = new Map(sheet.facts.map((f) => [f.id, f]));
  const values = sheet.facts.map((f) => Math.abs(f.num));
  // Longest names first, so "Team 12" isn't half-masked by "Team 1".
  const names = [...sheet.names].filter((n) => /\d/.test(n)).sort((x, y) => y.length - x.length);
  const out: CheckedAnswer = { pieces: [], quoted: 0, matched: 0, unchecked: 0 };
  const text = (t: string) => {
    if (!t) return;
    // Digits inside a name aren't numbers: mask them while scanning.
    let masked = t;
    for (const n of names) masked = masked.split(n).join(n.replace(/\d/g, '#'));
    let at = 0;
    for (const m of masked.matchAll(NUMBER)) {
      const n = Number(m[0].replace(/,/g, ''));
      if (values.some((v) => Math.abs(v - n) < 1e-9)) {
        out.matched++;
        continue;
      }
      if (m.index! > at) out.pieces.push({ kind: 'text', text: t.slice(at, m.index) });
      out.pieces.push({ kind: 'unchecked', text: t.slice(m.index, m.index! + m[0].length) });
      out.unchecked++;
      at = m.index! + m[0].length;
    }
    if (at < t.length) out.pieces.push({ kind: 'text', text: t.slice(at) });
  };
  let last = 0;
  for (const m of raw.matchAll(/\{(F\d+)\}/g)) {
    text(raw.slice(last, m.index));
    const fact = byId.get(m[1]!);
    if (fact) {
      out.pieces.push({ kind: 'fact', text: fact.value, fact });
      out.quoted++;
    } else {
      out.pieces.push({ kind: 'unknown', text: m[0] });
      out.unchecked++;
    }
    last = m.index! + m[0].length;
  }
  text(raw.slice(last));
  return out;
}

/** Token usage of one answer. */
export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

/** US dollars per million tokens for Claude Opus 5.5 (list prices, October 2026): input, output, cache write (5 minutes), cache read. */
const PRICE = { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 };

/** What one answer cost on the manager's API key, in US dollars. Thinking is billed as output. */
export function answerCost(u: Usage): number {
  return (
    (u.input_tokens * PRICE.input + u.output_tokens * PRICE.output + (u.cache_creation_input_tokens ?? 0) * PRICE.cacheWrite + (u.cache_read_input_tokens ?? 0) * PRICE.cacheRead) /
    1e6
  );
}
