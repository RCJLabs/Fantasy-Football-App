// Replays a finished season's playoffs through the app's bracket code (app/src/analysis/bracket.ts and the bracket
// mode of outlook.ts). At the start of each playoff week it rebuilds the bracket as it stood then, with later results
// masked, and checks what the app would have shown: who's alive, title odds, the points of rounds already played,
// and the weights of the weeks ahead. It also checks Sleeper's recorded winners against the matchups' points, and
// the seeding. Results in docs/title-odds.md.
//
// Usage: tsx scripts/check/bracket-replay.ts <pull dir> <games.csv>
//   pull dir:  prev/ in the decrypted bundle from scripts/league/pull.sh (leagues.json, leagues/<id>/, proj_wNN.json)
//   games.csv: nflverse nfldata games.csv, for kickoffs (a player whose team has no game counts as on bye)
// Prints roster ids and numbers only. Exits 1 if a check fails.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gamesByTeam, type WeekContext } from '../../app/src/analysis/analyze';
import { bracketState, titlePath } from '../../app/src/analysis/bracket';
import { buildOutlook } from '../../app/src/analysis/outlook';
import { playoffByes, playoffWeekInfo, seasonEnd } from '../../app/src/analysis/ros';
import type { BracketMatch, BracketSlot, Matchup, Roster } from '../../app/src/domain/types';
import { indexProjections, parseBracket, parseLeague, parseMatchup, parseRoster, parseUser, type ProjectionIndex } from '../../app/src/sleeper/parse';
import type { RawBracketMatch, RawLeague, RawMatchup, RawProjection, RawRoster, RawUser } from '../../app/src/sleeper/raw';
import { csvRecords, gamesFromCsv } from '../../pipeline/lib';

const [dir, gamesCsv] = process.argv.slice(2);
if (!dir || !gamesCsv) {
  console.error('Usage: tsx scripts/check/bracket-replay.ts <pull dir> <games.csv>');
  process.exit(2);
}
const pad = (w: number) => String(w).padStart(2, '0');
const json = <T>(file: string): T => JSON.parse(readFileSync(file, 'utf8')) as T;
const pct = (x: number) => `${(100 * x).toFixed(1)}%`;
let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`);
};

// The pull slims projection rows (position flattened); the app reads Sleeper's rows with a `player` object. Their
// injury status is the player's today, not that week's, so it's dropped: everyone counts as healthy.
type SlimRow = RawProjection & { position?: string };
const projRows = new Map<number, RawProjection[]>();
for (let w = 1; w <= 18; w++) {
  const file = join(dir, `proj_w${pad(w)}.json`);
  if (!existsSync(file)) continue;
  const rows = json<SlimRow[]>(file).map((r) => ({
    ...r,
    player: { position: r.position ?? r.player?.position, fantasy_positions: r.position ? [r.position] : null, team: r.team ?? null, injury_status: null },
  }));
  projRows.set(w, rows);
}
const csv = csvRecords(readFileSync(gamesCsv, 'utf8'));

/** Regular-season finish as the app ranks it (outlook.ts): wins, ties counting half, then points for. */
const finish = (rosters: readonly Roster[]) =>
  [...rosters].sort((a, b) => b.wins + b.ties / 2 - (a.wins + a.ties / 2) || b.pointsFor - a.pointsFor).map((r) => r.rosterId);

/** The bracket as it stood once `lastDecided` rounds were played: later results and the teams they put in slots removed. */
function asOf(bracket: readonly BracketMatch[], lastDecided: number): BracketMatch[] {
  const open = new Set(bracket.filter((m) => m.round > lastDecided).map((m) => m.id));
  return bracket.map((m) => {
    const slots = m.slots.map((s): BracketSlot => (s.from && open.has(s.from.match) ? { ...s, rosterId: null } : s)) as [BracketSlot, BracketSlot];
    return m.round > lastDecided ? { ...m, slots, winner: null, loser: null } : { ...m, slots };
  });
}

const leagues = json<RawLeague[]>(join(dir, 'leagues.json'));
for (const [li, raw] of leagues.entries()) {
  const ldir = join(dir, 'leagues', raw.league_id);
  const league = parseLeague(raw);
  const rules = league.rules;
  const start = rules.playoffWeekStart;
  const bracket = parseBracket(json<RawBracketMatch[]>(join(ldir, 'winners_bracket.json')));
  if (!start || !bracket.length) {
    console.log(`League ${li + 1}: no playoffs or no bracket; skipped`);
    continue;
  }
  const rosters = json<RawRoster[]>(join(ldir, 'rosters.json')).map(parseRoster);
  const users = json<RawUser[]>(join(ldir, 'users.json')).map(parseUser);
  const matchups = new Map<number, Matchup[]>();
  const points = new Map<number, Map<number, number>>();
  for (let w = 1; w <= 18; w++) {
    const file = join(ldir, `matchups_w${pad(w)}.json`);
    if (!existsSync(file)) continue;
    const ms = (json<RawMatchup[] | null>(file) ?? []).map(parseMatchup);
    matchups.set(w, ms);
    points.set(w, new Map(ms.map((m) => [m.rosterId, m.points])));
  }
  const games = gamesFromCsv(csv, league.season);
  const end = seasonEnd(league);
  const roundWeeks = (r: number) => Array.from({ length: end - start + 1 }, (_, i) => start + i).filter((w) => playoffWeekInfo(league, w)?.round === r);
  const roundPoints = (t: number, r: number) => roundWeeks(r).reduce((s, w) => s + (points.get(w)?.get(t) ?? 0), 0);
  console.log(
    `League ${li + 1}: ${rules.numTeams} teams, ${rules.playoffTeams} in the playoffs from week ${start} (round type ${rules.playoffRoundType ?? 0}, seed type ${rules.playoffSeedType ?? 0}), season ends week ${end}; ${bracket.length} bracket games`,
  );

  // 1. Sleeper's recorded winners against the matchups' points, round by round (placement games too).
  const won = new Map<number, number>();
  const lost = new Map<number, number>();
  const team = (s: BracketSlot) => (s.from ? (s.from.take === 'winner' ? won : lost).get(s.from.match) : undefined) ?? s.rosterId;
  let agree = 0;
  let ties = 0;
  let slotsAgree = true;
  for (const m of bracket) {
    const [a, b] = [team(m.slots[0]), team(m.slots[1])];
    if (m.slots.some((s) => s.from && s.rosterId !== null && s.rosterId !== team({ ...s, rosterId: null }))) slotsAgree = false;
    if (a === null || b === null || m.winner === null) continue;
    const [pa, pb] = [roundPoints(a, m.round), roundPoints(b, m.round)];
    if (pa === pb) ties++;
    if ((pa > pb ? a : pb > pa ? b : null) === m.winner) agree++;
    else console.log(`  game ${m.id} (round ${m.round}${m.place ? `, for place ${m.place}` : ''}): ${a} ${pa.toFixed(2)} v ${b} ${pb.toFixed(2)}, Sleeper's winner ${m.winner}`);
    won.set(m.id, m.winner);
    lost.set(m.id, m.loser ?? (m.winner === a ? b : a));
  }
  const decidedGames = bracket.filter((m) => m.winner !== null).length;
  check(agree === decidedGames, `Sleeper's winner had more points in the round's weeks: ${agree} of ${decidedGames} games (${ties} tied)`);
  check(slotsAgree, 'slots Sleeper filled in agree with the games they come from');

  // 2. Seeding: points for are regular-season points, and the app's finish order gives the bracket's teams and byes.
  const regular = new Map<number, number>();
  for (const [w, pts] of points) if (w < start) for (const [t, p] of pts) regular.set(t, (regular.get(t) ?? 0) + p);
  const pfGap = Math.max(...rosters.map((r) => Math.abs((regular.get(r.rosterId) ?? 0) - r.pointsFor)));
  check(pfGap < 0.02, `roster points for are the regular season's (largest gap ${pfGap.toFixed(2)})`);
  const final = bracketState(bracket);
  const order = finish(rosters);
  const n = rules.playoffTeams ?? 0;
  const byes = playoffByes(n);
  const seedOf = new Map(order.map((t, i) => [t, i + 1]));
  const inBracket = new Set(final.games.flatMap((g) => g.teams).filter((t): t is number => t !== null));
  check([...inBracket].every((t) => (seedOf.get(t) ?? 99) <= n) && inBracket.size === n, `the bracket's ${inBracket.size} teams are the top ${n} by the app's finish order`);
  check([...final.byes].every((t) => (seedOf.get(t) ?? 99) <= byes) && final.byes.size === byes, `byes go to the top ${byes} seeds`);
  if ((rules.playoffSeedType ?? 0) === 0) {
    const firstRound = bracket.filter((m) => m.round === 1 && m.place === undefined);
    const pairs = firstRound.map((m) => m.slots.reduce((s, x) => s + (seedOf.get(x.rosterId ?? -1) ?? 0), 0));
    check(pairs.every((s) => s === n + byes + 1), `first-round games pair seeds that add up to ${n + byes + 1}`);
  }
  const finalGame = titlePath(bracket).find((m) => m.place === 1);
  const champion = finalGame?.winner ?? null;
  check(champion !== null && final.champion === champion && final.alive.size === 1, `the final bracket: ${champion} champion, the only team alive`);

  // 3. The start of each playoff week, then after the final.
  const scenarios = [...Array.from({ length: end - start + 1 }, (_, i) => ({ week: start + i, scored: start + i - 1 })), { week: end, scored: end }];
  for (const { week, scored } of scenarios) {
    const decided = Math.max(0, ...[1, 2, 3, 4, 5].filter((r) => roundWeeks(r).length > 0 && Math.max(...roundWeeks(r)) <= scored));
    const live = scored < week;
    const label = live ? `start of week ${week}` : `after week ${week}`;
    const thisWeek = (matchups.get(week) ?? []).map((m) => (live ? { ...m, points: 0, playersPoints: {} } : m));
    const byWeek = new Map<number, ProjectionIndex>();
    for (const [w, rows] of projRows) if (w > week && w <= end) byWeek.set(w, indexProjections(rows, w));
    const projections = indexProjections(projRows.get(week) ?? [], week);
    const players = new Map(projections.players);
    for (const idx of byWeek.values()) for (const [id, p] of idx.players) if (!players.has(id)) players.set(id, p);
    // Before the week's first kickoff, so nothing is locked.
    const kickoffs = games.filter((g) => g.week === week).map((g) => Date.parse(g.kickoff));
    const now = kickoffs.length ? Math.min(...kickoffs) - 3_600_000 : Date.UTC(Number(league.season), 11, 1);
    const ctx: WeekContext = { season: league.season, week, now, players, projections, gamesByTeam: gamesByTeam(games, week) };
    const o = buildOutlook({
      league: { ...league, rules: { ...rules, lastScoredWeek: scored } },
      rosters,
      users,
      matchups: thisWeek,
      ctx,
      byWeek,
      schedule: new Map(),
      bracket: asOf(bracket, decided),
      played: new Map([...points].filter(([w]) => w < week)),
      sims: 4000,
    });
    const b = o.bracket;
    console.log(` ${label} (${decided} round${decided === 1 ? '' : 's'} decided)`);
    check(b !== undefined, 'bracket mode');
    if (!b) continue;
    const out = new Set([...final.outIn].filter(([, r]) => r <= decided).map(([t]) => t));
    const alive = [...inBracket].filter((t) => !out.has(t)).sort((x, y) => x - y);
    check([...b.state.alive].sort((x, y) => x - y).join() === alive.join(), `alive: ${alive.join(', ')}`);
    const odds = [...b.odds.values()];
    const sum = odds.reduce((s, x) => s + x.pTitle, 0);
    check(Math.abs(sum - 1) < 1e-9 && odds.every((x) => b.state.alive.has(x.rosterId) || x.pTitle === 0), 'title odds add up to 1, none for teams that are out');
    let fixedOk = true;
    for (const [t, ds] of b.fixed)
      for (let r = 1; r <= decided; r++) if (Math.abs(ds[r - 1]!.mean - roundPoints(t, r)) > 1e-6 || ds[r - 1]!.variance !== 0) fixedOk = false;
    check(fixedOk, 'rounds already played count their final points');
    const ahead = o.weeks.map((w, i) => (w >= start ? i : -1)).filter((i) => i >= 0);
    const weightsOk = [...o.teams.values()].every((t) => ahead.every((i) => (b.state.alive.has(t.rosterId) ? t.weights[i]! > 0 : t.weights[i] === 0)));
    check(weightsOk, `weeks ahead (${o.weeks.join(', ') || 'none'}) count for teams alive, not for teams out`);
    const shown = odds.filter((x) => b.state.alive.has(x.rosterId)).sort((x, y) => y.pTitle - x.pTitle);
    console.log(`   title odds: ${shown.map((x) => `${x.rosterId} ${pct(x.pTitle)}`).join(', ')}`);
    if (!live && scored === end && champion !== null) check(b.odds.get(champion)?.pTitle === 1, 'after the final: the champion is certain');
  }
}
console.log(failures ? `${failures} check(s) failed` : 'All checks passed.');
process.exit(failures ? 1 : 0);
