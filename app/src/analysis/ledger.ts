// The prediction ledger as the About page shows it: every scored week pooled (docs/ledger.md).
import type { LedgerCalibrationRow, LedgerFile, LedgerWeek } from '../data/contracts';

/** Scored weeks before the About page shows the ledger: one week has too few tagged players to read. [design] */
export const LEDGER_MIN_WEEKS = 3;

export interface PooledLedger {
  season: string;
  weeks: number[];
  games: number;
  /** Chance to play by injury group over all weeks: Questionable groups first, then Doubtful and Out. */
  calibration: LedgerCalibrationRow[];
  points: LedgerWeek['points'];
}

/** Questionable by final practice, then before the final report, Doubtful, Out (the scorer's group names). */
const ORDER = ['Questionable, Full', 'Questionable, Limited', 'Questionable, DNP', 'Questionable (before', 'Doubtful', 'Out'];
const rank = (group: string) => {
  const i = ORDER.findIndex((prefix) => group.startsWith(prefix));
  return i < 0 ? ORDER.length : i;
};

/** Every scored week pooled, each weighted by its counts; null until `minWeeks` weeks are scored. */
export function poolLedger(file: LedgerFile | null | undefined, minWeeks = LEDGER_MIN_WEEKS): PooledLedger | null {
  const weeks = file?.weeks ?? [];
  if (!file || !weeks.length || weeks.length < minWeeks) return null;
  const groups = new Map<string, { n: number; predicted: number; observed: number }>();
  for (const w of weeks) {
    for (const r of w.tagged.calibration) {
      const g = groups.get(r.group) ?? { n: 0, predicted: 0, observed: 0 };
      g.n += r.n;
      g.predicted += r.predicted * r.n;
      g.observed += r.observed * r.n;
      groups.set(r.group, g);
    }
  }
  const n = weeks.reduce((a, w) => a + w.points.n, 0);
  const mean = (f: (w: LedgerWeek) => number) => (n ? weeks.reduce((a, w) => a + f(w) * w.points.n, 0) / n : 0);
  return {
    season: file.season,
    weeks: weeks.map((w) => w.week),
    games: weeks.reduce((a, w) => a + w.games, 0),
    calibration: [...groups]
      .filter(([, g]) => g.n > 0)
      .map(([group, g]) => ({ group, n: g.n, predicted: g.predicted / g.n, observed: g.observed / g.n }))
      .sort((a, b) => rank(a.group) - rank(b.group) || b.n - a.n),
    points: {
      minProjected: weeks[0]!.points.minProjected,
      n,
      mae: mean((w) => w.points.mae),
      bias: mean((w) => w.points.bias),
      within1: mean((w) => w.points.within1),
      within2: mean((w) => w.points.within2),
    },
  };
}

/** The scorer's group names, as players read them. */
export function groupLabel(group: string): string {
  const practice: Record<string, string> = { Full: 'full practice', Limited: 'limited practice', DNP: 'missed practice' };
  const m = /^Questionable, (\w+) \(final report\)$/.exec(group);
  if (m) return `Questionable, ${practice[m[1]!] ?? m[1]}`;
  if (group === 'Questionable (before final report)') return 'Questionable, before the final report';
  return group;
}
