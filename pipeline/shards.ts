// Checks on the optional data shards before they're published, and the rule for keeping the last good copy
// when a fresh build fails (docs/PLAN.md §6, "Pipeline"). Pure; build-data.ts fetches and writes.
import { DATA_SCHEMA_VERSION } from '../app/src/data/contracts';

export type ShardName = 'accuracy.json' | 'usage.json' | 'matchups.json' | 'baseline.json';

/** Fewest rows a healthy shard has in-season; fewer means an upstream problem. */
export const MIN_ROWS: Record<ShardName, number> = { 'accuracy.json': 1, 'usage.json': 100, 'matchups.json': 20, 'baseline.json': 150 };

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown) => typeof v === 'number' && Number.isFinite(v);

/** The rows a shard carries (players, defenses, accuracy rows). */
export function rowCount(name: ShardName, shard: Json): number {
  const of = (v: unknown) => (Array.isArray(v) ? v.length : isObject(v) ? Object.keys(v).length : 0);
  if (name === 'accuracy.json') return of(shard.rows);
  if (name === 'matchups.json') return of(shard.defense);
  return of(shard.players);
}

/** Problems with a shard, empty when it's fit to publish. */
export function validateShard(name: ShardName, shard: unknown): string[] {
  if (!isObject(shard)) return ['not an object'];
  const out: string[] = [];
  if (shard.schemaVersion !== DATA_SCHEMA_VERSION) out.push(`schemaVersion ${String(shard.schemaVersion)}`);
  if (typeof shard.generatedAt !== 'string' || Number.isNaN(Date.parse(shard.generatedAt))) out.push('bad generatedAt');
  if (typeof shard.season !== 'string' || !/^\d{4}$/.test(shard.season)) out.push('bad season');
  const rows = rowCount(name, shard);
  if (rows < MIN_ROWS[name]) out.push(`${rows} rows (expected ${MIN_ROWS[name]}+)`);
  if (name === 'usage.json') {
    const weeks = shard.weeks;
    if (!Array.isArray(weeks) || !weeks.length || !weeks.every(finite)) out.push('bad weeks');
    else if (isObject(shard.players)) {
      const misaligned = Object.values(shard.players).filter((p) => !isObject(p) || ['snap', 'tgt', 'car'].some((k) => !Array.isArray(p[k]) || (p[k] as unknown[]).length !== weeks.length));
      if (misaligned.length) out.push(`${misaligned.length} players not aligned with weeks`);
    }
  }
  if (name === 'baseline.json') {
    if (!finite(shard.week) || !finite(shard.throughWeek)) out.push('bad week or throughWeek');
    else if ((shard.throughWeek as number) >= (shard.week as number)) out.push('averages include this week');
    if (isObject(shard.players)) {
      const bad = Object.values(shard.players).filter((line) => !isObject(line) || !Object.values(line).every((v) => finite(v) && (v as number) >= 0));
      if (bad.length) out.push(`${bad.length} lines with non-finite or negative stats`);
    }
  }
  if (name === 'accuracy.json' && Array.isArray(shard.rows) && !shard.rows.every((r) => isObject(r) && finite(r.n) && finite(r.mae))) out.push('bad rows');
  return out;
}

/** Whether a shard still describes the current week: same season, and for the baseline the same week. */
export function isCurrent(name: ShardName, shard: Json, season: string, week: number): boolean {
  return shard.season === season && (name !== 'baseline.json' || shard.week === week);
}

export type ShardDecision =
  | { use: 'fresh'; shard: Json; rows: number; warning?: string }
  | { use: 'kept'; shard: Json; rows: number; reason: string }
  | { use: 'none'; reason: string };

/**
 * Publish the fresh build when it's valid; otherwise keep the deployed copy if it's valid and still current.
 * A fresh build with under half the deployed copy's rows is published with a warning.
 */
export function decideShard(name: ShardName, fresh: unknown, deployed: unknown, season: string, week: number): ShardDecision {
  const freshProblems = fresh == null ? ['not built'] : validateShard(name, fresh);
  const prev = isObject(deployed) && !validateShard(name, deployed).length && isCurrent(name, deployed, season, week) ? deployed : undefined;
  if (!freshProblems.length) {
    const shard = fresh as Json;
    const rows = rowCount(name, shard);
    const prevRows = prev ? rowCount(name, prev) : 0;
    return { use: 'fresh', shard, rows, ...(prevRows && rows < prevRows / 2 ? { warning: `rows fell from ${prevRows} to ${rows}` } : {}) };
  }
  const reason = freshProblems.join('; ');
  if (prev) return { use: 'kept', shard: prev, rows: rowCount(name, prev), reason };
  return { use: 'none', reason };
}
