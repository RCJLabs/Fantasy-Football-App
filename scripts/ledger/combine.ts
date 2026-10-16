// Combine a season's scored weeks (ledger_<season>wNN.json, one LedgerWeek each) into the ledger release's
// ledger.json, which the data build publishes as data/ledger.json. Refuses any week that doesn't validate.
//
// Usage: tsx scripts/ledger/combine.ts <dir> <season> <out file>
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LedgerWeek } from '../../app/src/data/contracts';
import { combineLedger, validateLedgerWeek } from '../../pipeline/ledger-score';

const [dir, season, out] = process.argv.slice(2);
if (!dir || !season || !out) throw new Error('usage: combine.ts <dir> <season> <out file>');
const name = new RegExp(`^ledger_${season}w\\d{2}\\.json$`);
const weeks = readdirSync(dir)
  .filter((f) => name.test(f))
  .map((f) => {
    const week = JSON.parse(readFileSync(join(dir, f), 'utf8')) as unknown;
    const problems = validateLedgerWeek(week, season);
    if (problems.length) throw new Error(`${f}: ${problems.join('; ')}`);
    return week as LedgerWeek;
  });
const file = combineLedger(weeks, season, new Date().toISOString());
writeFileSync(out, `${JSON.stringify(file, null, 2)}\n`);
console.log(`ledger.json: ${season} weeks ${file.weeks.map((w) => w.week).join(', ') || 'none'}`);
