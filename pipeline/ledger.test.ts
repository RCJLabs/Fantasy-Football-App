import { describe, expect, it } from 'vitest';
import type { BaselineFile, PlayersFile, ScheduleFile } from '../app/src/data/contracts';
import { playProbability } from '../app/src/engine/availability';
import { buildPredictions, commitment, sha256, toRawProjection, type ArchivedProjection } from './ledger';

const H = 3_600_000;
const now = Date.UTC(2026, 9, 18, 15, 0); // Sunday 11:00 ET
const iso = (h: number) => new Date(now + h * H).toISOString();

const schedule: ScheduleFile = {
  schemaVersion: 1,
  generatedAt: iso(-10),
  season: '2026',
  games: [
    { id: '2026_06_AAA_BBB', week: 6, away: 'AAA', home: 'BBB', kickoff: iso(-1) }, // already started
    { id: '2026_06_CCC_DDD', week: 6, away: 'CCC', home: 'DDD', kickoff: iso(2) },
    { id: '2026_07_CCC_AAA', week: 7, away: 'CCC', home: 'AAA', kickoff: iso(170) },
  ],
};

const players: PlayersFile = {
  schemaVersion: 1,
  generatedAt: iso(-5),
  season: '2026',
  week: 6,
  injuryReportWeek: 6,
  players: [
    { id: 'q1', n: 'Quinn Passer', pos: 'QB', t: 'CCC', gsis: '00-0000001' },
    { id: 'w1', n: 'Final Report', pos: 'WR', t: 'DDD', inj: 'Questionable', prac: 'Limited', rpt: 'Questionable' },
    { id: 'w2', n: 'Midweek Tag', pos: 'WR', t: 'DDD', inj: 'Questionable', prac: 'DNP' },
    { id: 'r1', n: 'Early Game', pos: 'RB', t: 'AAA' },
    { id: 'ir1', n: 'Long Term', pos: 'WR', t: 'CCC', inj: 'IR' },
    { id: 'o1', n: 'Ruled Out', pos: 'RB', t: 'CCC', inj: 'Out', prac: 'DNP', rpt: 'Out' },
    { id: 'k1', n: 'Kicker', pos: 'K', t: 'DDD' },
  ],
};

// Archive rows are slimmed (player fields at the top level); the kicker keeps Sleeper's full shape.
const projections: ArchivedProjection[] = [
  { player_id: 'q1', stats: { pass_yd: 250, pass_td: 2 }, team: 'CCC', position: 'QB', injury_status: null },
  { player_id: 'w1', stats: { rec: 5, rec_yd: 60 }, team: 'DDD', position: 'WR', injury_status: 'Questionable' },
  { player_id: 'w2', stats: { rec: 4, rec_yd: 50 }, team: 'DDD', position: 'WR', injury_status: 'Questionable' },
  { player_id: 'r1', stats: { rush_yd: 80 }, team: 'AAA', position: 'RB', injury_status: null },
  { player_id: 'ir1', stats: {}, team: 'CCC', position: 'WR', injury_status: 'IR' },
  { player_id: 'o1', stats: {}, team: 'CCC', position: 'RB', injury_status: 'Out' },
  { player_id: 'k1', stats: { xpm: 2 }, team: 'DDD', player: { position: 'K', team: 'DDD', injury_status: null } },
];

describe('prediction ledger', () => {
  const file = buildPredictions({ season: '2026', week: 6, now, projections, players, schedule, code: 'abc123' });

  it("predicts every player in games that haven't started, as the app would", () => {
    expect(file.games).toEqual([{ id: '2026_06_CCC_DDD', kickoff: iso(2) }]);
    expect(file.players.map((p) => p.id)).toEqual(['k1', 'o1', 'q1', 'w1', 'w2']); // r1 already playing; ir1 has nothing to predict
    const by = new Map(file.players.map((p) => [p.id, p]));
    expect(by.get('q1')).toMatchObject({ gsis: '00-0000001', pos: 'QB', team: 'CCC', game: '2026_06_CCC_DDD', p: 0.99 });
    expect(by.get('q1')!.mu).toBeCloseTo(250 * 0.04 + 2 * 4, 1);
    expect(by.get('q1')!.sd).toBeGreaterThan(0);
    // Final report: practice sets the odds. Mid-week: the overall Questionable rate.
    expect(by.get('w1')).toMatchObject({ inj: 'Questionable', prac: 'Limited', final: true, p: playProbability('Questionable', 'Limited') });
    expect(by.get('w1')!.mu).toBeCloseTo(5 + 6, 1); // full PPR
    expect(by.get('w2')).toMatchObject({ inj: 'Questionable', prac: 'DNP', p: playProbability('Questionable') });
    expect(by.get('w2')!.final).toBeUndefined();
    expect(by.get('o1')).toMatchObject({ inj: 'Out', p: 0, mu: 0 });
    expect(file).toMatchObject({ schemaVersion: 1, season: '2026', week: 6, scoring: 'ppr', code: 'abc123', createdAt: new Date(now).toISOString() });
  });

  it('accepts slimmed and full projection rows', () => {
    expect(toRawProjection({ player_id: 'x', stats: { rec: 1 }, team: 'DDD', position: 'WR', injury_status: 'Doubtful' }).player).toMatchObject({ position: 'WR', team: 'DDD', injury_status: 'Doubtful' });
    expect(toRawProjection({ player_id: 'x', stats: null, player: { position: 'K' } }).player).toEqual({ position: 'K' });
  });

  it('commits to the exact bytes with SHA-256', () => {
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    const text = JSON.stringify(file);
    expect(commitment(file, text)).toEqual({ schemaVersion: 1, createdAt: file.createdAt, season: '2026', week: 6, code: 'abc123', sha256: sha256(text), players: 5, games: ['2026_06_CCC_DDD'] });
  });

  const baseline: BaselineFile = {
    schemaVersion: 1,
    generatedAt: iso(-3),
    season: '2026',
    week: 6,
    throughWeek: 5,
    players: { q1: { pass_yd: 200, pass_td: 1 }, w1: { rec: 4, rec_yd: 40 } },
  };

  it("commits the shadow baseline next to the app's own numbers", () => {
    const by = new Map(buildPredictions({ season: '2026', week: 6, now, projections, players, schedule, baseline }).players.map((p) => [p.id, p]));
    expect(by.get('q1')!.bl).toBeCloseTo(200 * 0.04 + 4, 2);
    expect(by.get('q1')!.mu).toBeCloseTo(250 * 0.04 + 2 * 4, 1); // unchanged: the baseline isn't blended
    expect(by.get('w1')!.bl).toBeCloseTo(4 + 4, 2);
    expect(by.get('w2')!.bl).toBeUndefined();
    // A file for another week is ignored.
    const stale = buildPredictions({ season: '2026', week: 6, now, projections, players, schedule, baseline: { ...baseline, week: 5 } });
    expect(stale.players.some((p) => p.bl !== undefined)).toBe(false);
  });

  it('falls back to the baseline, as the app does, in a week without offensive projections', () => {
    const kickerOnly = projections.filter((p) => p.player_id === 'k1');
    const fb = buildPredictions({ season: '2026', week: 6, now, projections: kickerOnly, players, schedule, baseline });
    expect(fb.players.map((p) => p.id)).toEqual(['k1', 'q1', 'w1']);
    const by = new Map(fb.players.map((p) => [p.id, p]));
    expect(by.get('q1')).toMatchObject({ fallback: true });
    expect(by.get('q1')!.mu).toBeCloseTo(200 * 0.04 + 4, 2);
    expect(by.get('q1')!.bl).toBeUndefined();
    expect(by.get('k1')!.fallback).toBeUndefined();
  });

  it('predicts nothing once every game has started', () => {
    expect(buildPredictions({ season: '2026', week: 6, now: now + 5 * H, projections, players, schedule }).players).toEqual([]);
  });
});
