// Mock draft grades (app/src/analysis/draft.ts draftGrades, valueAndReach) on real leagues' settings and rosters: how
// grades spread when every team drafts by the noisy board, how "finish for me" grades against those teams, the SD
// floor's role, keepers against the picks' grade, and value and reach. Results in docs/draft.md.
//
// Usage: tsx scripts/check/draft-grades.ts <pull dir> <data dir> [drafts]
//   pull dir: the decrypted bundle from scripts/league/pull.sh (leagues.json, leagues/<id>/rosters.json)
//   data dir: the data build's output (nextseason.json, players.json)
//   drafts:   mock drafts per league and check (default 100)
// Prints grade shares, ranks, sizes and timings only: no team or player names.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildBoard, draftGrades, type DraftSetup, lineupValue, pickOrder, placeKeepers, predictKeepers, simulateRest, valueAndReach, withSlot } from '../../app/src/analysis/draft';
import { zScale } from '../../app/src/analysis/grades';
import type { NextSeasonFile, PlayersFile } from '../../app/src/data/contracts';
import { playersFromFile } from '../../app/src/data/repo';
import { parseLeague, parseRoster } from '../../app/src/sleeper/parse';
import type { RawLeague, RawRoster } from '../../app/src/sleeper/raw';

const [dir, dataDir, draftsArg] = process.argv.slice(2);
if (!dir || !dataDir) {
  console.error('Usage: tsx scripts/check/draft-grades.ts <pull dir> <data dir> [drafts]');
  process.exit(2);
}
const DRAFTS = Number(draftsArg ?? 100);
const json = <T>(file: string): T => JSON.parse(readFileSync(file, 'utf8')) as T;
const next = json<NextSeasonFile>(join(dataDir, 'nextseason.json'));
const playersFile = json<PlayersFile>(join(dataDir, 'players.json'));
const players = playersFromFile(playersFile, playersFile.week);

const GRADES = ['S', 'A', 'B', 'C', 'D', 'F'];
const shares = (c: Map<string, number>) => {
  const total = [...c.values()].reduce((a, b) => a + b, 0);
  return GRADES.map((g) => `${g} ${Math.round((100 * (c.get(g) ?? 0)) / total)}%`).join(', ');
};
const count = (c: Map<string, number>, g: string) => c.set(g, (c.get(g) ?? 0) + 1);
const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const median = (xs: readonly number[]) => [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) / 2)]!;
const corr = (x: readonly number[], y: readonly number[]) => {
  const mx = mean(x);
  const my = mean(y);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  x.forEach((v, i) => {
    sxy += (v - mx) * (y[i]! - my);
    sxx += (v - mx) ** 2;
    syy += (y[i]! - my) ** 2;
  });
  return sxy / Math.sqrt(sxx * syy);
};

for (const raw of json<RawLeague[]>(join(dir, 'leagues.json'))) {
  const league = parseLeague(raw);
  if (league.rules.type === 'dynasty') continue;
  const rosters = json<RawRoster[]>(join(dir, 'leagues', raw.league_id, 'rosters.json')).map(parseRoster);
  const board = buildBoard(league, next, players);
  const n = league.rules.numTeams;
  const rounds = league.rosterPositions.length;
  const keepers = league.rules.type === 'keeper' ? predictKeepers(board, rosters, { count: league.rules.maxKeepers ?? 3, cost: 'last' }, rounds) : [];
  const order = rosters.map((r) => r.rosterId);
  const byId = new Map(board.players.map((p) => [p.id, p]));
  // `me` undefined: every team drafts by the noisy board, in the league's own order.
  const draft = (me: number | undefined, slot: number, seed: number) => {
    const picks = pickOrder(me === undefined ? order : withSlot(order, me, slot), rounds, 'snake');
    const fixed = placeKeepers(picks, n, keepers);
    const kept = new Set(fixed.keys());
    const taken = simulateRest({ board, picks, numTeams: n, taken: picks.map((_, i) => fixed.get(i)) }, me ?? -1, { seed });
    return { s: { board, picks, numTeams: n, taken } as DraftSetup, kept };
  };
  console.log(`\n${league.rules.type} league: ${n} teams, ${rounds} rounds, ${keepers.length} keepers`);

  // Every team by the noisy board: a typical manager in the mock (no team picks by lineup gain).
  const rosterGrades = new Map<string, number>();
  const pickGrades = new Map<string, number>();
  const steps = { team: [] as number[], picks: [] as number[] };
  const sds: number[] = [];
  const keptValue: number[] = [];
  const pickValue: number[] = [];
  const teamValue: number[] = [];
  const value: number[] = [];
  const reach: number[] = [];
  let floorSets = 0;
  let ms = 0;
  for (let k = 0; k < DRAFTS; k++) {
    const { s, kept } = draft(undefined, 1, 1000 + k);
    const t0 = performance.now();
    const g = draftGrades(s, kept)!;
    const vr = order.map((r) => valueAndReach(s, r, kept));
    ms += performance.now() - t0;
    for (const t of g.teams) {
      count(rosterGrades, t.grade);
      if (t.picks) count(pickGrades, t.picks.grade);
      const keep = s.picks.flatMap((r, i) => (r === t.rosterId && kept.has(i) && byId.get(s.taken[i]!) ? [byId.get(s.taken[i]!)!] : []));
      keptValue.push(lineupValue(keep, board.slots));
      pickValue.push(t.picks?.value ?? t.value);
      teamValue.push(t.value);
    }
    for (const x of vr) {
      if (x.value) value.push(x.value.gain);
      if (x.reach) reach.push(x.reach.gain);
    }
    const sd = zScale(g.teams.map((t) => t.value), 0);
    sds.push(sd);
    if (2 * g.step.team > sd + 1e-9) floorSets++;
    steps.team.push(g.step.team);
    if (g.step.picks !== undefined) steps.picks.push(g.step.picks);
  }
  console.log(` every team by the noisy board, ${DRAFTS} drafts:`);
  console.log(`  rosters: ${shares(rosterGrades)}`);
  if (pickGrades.size) console.log(`  picks alone: ${shares(pickGrades)}`);
  console.log(`  rosters' SD ${mean(sds).toFixed(0)} (${Math.min(...sds).toFixed(0)}–${Math.max(...sds).toFixed(0)}); the floor sets the scale in ${floorSets} of ${DRAFTS}`);
  console.log(`  grade step: rosters ${mean(steps.team).toFixed(0)}${steps.picks.length ? `, picks alone ${mean(steps.picks).toFixed(0)}` : ''}`);
  if (keepers.length) console.log(`  keepers' value against the picks' ${corr(keptValue, pickValue).toFixed(2)}, against the roster's ${corr(keptValue, teamValue).toFixed(2)}`);
  console.log(`  best value: ${value.length} of ${DRAFTS * n} teams, median ${median(value).toFixed(0)} points; reach: ${reach.length}, median ${median(reach).toFixed(0)}`);
  console.log(`  grading and value/reach for every team: ${(ms / DRAFTS).toFixed(1)} ms a draft`);

  // "Finish for me" from the first pick, at every slot: you pick by lineup gain, the others by the noisy board.
  const mine = new Map<string, number>();
  const ranks: number[] = [];
  let runs = 0;
  let values = 0;
  let reaches = 0;
  const me = order[0]!;
  for (let slot = 1; slot <= n; slot++) {
    for (let k = 0; k < Math.ceil(DRAFTS / n); k++) {
      const { s, kept } = draft(me, slot, 5000 + 97 * slot + k);
      const t = draftGrades(s, kept)!.teams.find((x) => x.rosterId === me)!;
      const graded = t.picks ?? t;
      count(mine, graded.grade);
      ranks.push(graded.rank);
      const vr = valueAndReach(s, me, kept);
      values += vr.value ? 1 : 0;
      reaches += vr.reach ? 1 : 0;
      runs++;
    }
  }
  console.log(` "finish for me" from every slot, ${runs} drafts (the draft's grade: picks alone with keepers):`);
  console.log(`  ${shares(mine)}; average rank ${mean(ranks).toFixed(2)} of ${n}, 1st in ${ranks.filter((r) => r === 1).length}, top two in ${ranks.filter((r) => r <= 2).length}`);
  console.log(`  best value shown in ${values}, biggest reach in ${reaches}`);
}
