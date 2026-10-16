// Which committed weeks of the prediction ledger are ready to score (scripts/ledger/auto.sh): every game played
// and settled (pipeline/ledger-score.ts, dueWeeks). Prints the weeks space-separated, or nothing.
//
// Usage: tsx scripts/ledger/due.ts <season> <games.csv> <stats_player_week_YYYY.csv> <week>...
// The CSVs come from nflverse/nfldata (games.csv) and the nflverse-data stats_player release.
// Env: LEDGER_NOW (ISO time) replaces the clock, for tests.
import { readFileSync } from 'node:fs';
import { dueWeeks, playedGames } from '../../pipeline/ledger-score';
import { csvRecords, gamesFromCsv } from '../../pipeline/lib';

const [season, gamesCsv, statsCsv, ...weeks] = process.argv.slice(2);
if (!season || !gamesCsv || !statsCsv || !weeks.length) throw new Error('usage: due.ts <season> <games.csv> <stats.csv> <week>...');
const schedule = gamesFromCsv(csvRecords(readFileSync(gamesCsv, 'utf8')), season);
const played = playedGames(csvRecords(readFileSync(statsCsv, 'utf8')));
const now = process.env.LEDGER_NOW ? Date.parse(process.env.LEDGER_NOW) : Date.now();
console.log(dueWeeks(weeks.map(Number), schedule, played, now).join(' '));
