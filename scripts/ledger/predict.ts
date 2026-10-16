// Archive hook (scripts/archive/snapshot.sh runs it on each snapshot before encrypting it): writes the
// app's predictions for games not yet started to predictions.json, which is encrypted with the
// snapshot, and commitment.json (its SHA-256), which is uploaded publicly next to the bundle.
// Exits 0 without output files when there's nothing to predict.
//
// Usage: tsx scripts/ledger/predict.ts <snapshot dir>
// Reads state.json, proj_wNN.json (this week), site_players.json, site_schedule.json and, when archived,
// site_baseline.json and the player props this run fetched (props_event_*.json, scripts/props/pull.ts).
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BaselineFile, PlayersFile, ScheduleFile } from '../../app/src/data/contracts';
import type { StatLine } from '../../app/src/domain/types';
import type { RawState } from '../../app/src/sleeper/raw';
import { buildPredictions, commitment, type ArchivedProjection } from '../../pipeline/ledger';
import { type OddsEvent, propsStatLines } from '../../pipeline/props';

const dir = process.argv[2];
if (!dir) throw new Error('usage: predict.ts <snapshot dir>');
const path = (name: string) => join(dir, name);
const read = <T>(name: string): T => JSON.parse(readFileSync(path(name), 'utf8')) as T;

const done = (why: string) => {
  console.log(`No predictions: ${why}.`);
  process.exit(0);
};

const state = read<RawState>('state.json');
if (state.season_type !== 'regular' || !(state.week >= 1)) done(`season type ${state.season_type}, week ${state.week}`);
const proj = `proj_w${String(state.week).padStart(2, '0')}.json`;
for (const name of ['site_players.json', 'site_schedule.json']) if (!existsSync(path(name))) done(`${name} missing`);
// Without this week's projections the app falls back to the baseline, and so do the predictions.
const hasBaseline = existsSync(path('site_baseline.json'));
if (!existsSync(path(proj)) && !hasBaseline) done(`${proj} missing`);

const projections = existsSync(path(proj)) ? read<ArchivedProjection[]>(proj) : [];
const players = read<PlayersFile>('site_players.json');

// Player props this run fetched, as stat means for the players they name.
let props: Map<string, StatLine> | undefined;
const propFiles = readdirSync(dir).filter((f) => /^props_event_.+\.json$/.test(f));
if (propFiles.length) {
  const base = new Map(projections.map((r) => [r.player_id, r.stats ?? undefined]));
  const result = propsStatLines(
    propFiles.map((f) => read<OddsEvent>(f)),
    players.players.map((p) => ({ id: p.id, name: p.n, pos: p.pos, ...(p.t ? { team: p.t } : {}) })),
    (id) => base.get(id),
  );
  props = new Map([...result.lines].map(([id, line]) => [id, line.stats]));
  console.log(`Props: ${result.lines.size} players priced from ${propFiles.length} game(s); ${result.unmatched} names unmatched.`);
}

const file = buildPredictions({
  season: state.season,
  week: state.week,
  now: Date.now(),
  projections,
  players,
  schedule: read<ScheduleFile>('site_schedule.json'),
  ...(hasBaseline ? { baseline: read<BaselineFile>('site_baseline.json') } : {}),
  ...(props ? { props } : {}),
  ...(process.env.GITHUB_SHA ? { code: process.env.GITHUB_SHA } : {}),
});
if (!file.players.length) done(`no games left in week ${state.week}`);

const text = JSON.stringify(file);
const commit = commitment(file, text);
writeFileSync(path('predictions.json'), text);
writeFileSync(path('commitment.json'), `${JSON.stringify(commit, null, 2)}\n`);
console.log(`Predicted ${commit.players} players in ${commit.games.length} games (week ${commit.week}); sha256 ${commit.sha256}`);
