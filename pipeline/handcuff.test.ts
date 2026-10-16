import { describe, expect, it } from 'vitest';
import { absences, inheritance, playerGame, type PlayerGame } from './handcuff';

// One team, six weeks. RB1 (s) carries the load; RB2 (b) spells him. In week 5 the RB1 is inactive and the RB2 takes
// over; in week 6 the RB1 is back. The QB1 (q) sits week 5 and the QB2 (q2) throws instead.
const G = (week: number, player: string, pos: string, usage: number, points: number): PlayerGame => ({ week, team: 'AAA', player, pos, usage, points });
const games: PlayerGame[] = [];
for (let w = 1; w <= 6; w++) {
  if (w !== 5) games.push(G(w, 's', 'RB', 20, 15), G(w, 'q', 'QB', 35, 18));
  games.push(G(w, 'b', 'RB', w === 5 ? 18 : 6, w === 5 ? 11 : 5));
  if (w === 5) games.push(G(w, 'q2', 'QB', 30, 12));
}
const status = new Map<string, { team: string; status: string }>();
for (let w = 1; w <= 6; w++) {
  for (const p of ['s', 'q']) status.set(`${w}:${p}`, { team: 'AAA', status: w === 5 ? 'INA' : 'ACT' });
  for (const p of ['b', 'q2']) status.set(`${w}:${p}`, { team: 'AAA', status: 'ACT' });
}

describe('absences', () => {
  const rows = absences({ season: 2024, games, status });

  it("finds the starter's absence and his backup's numbers", () => {
    const rb = rows.filter((a) => a.pos === 'RB');
    // Week 4 is the first with three earlier games; week 5 the absence; week 6 a control.
    expect(rb.map((a) => [a.week, a.out])).toEqual([
      [4, false],
      [5, true],
      [6, false],
    ]);
    const out = rb.find((a) => a.out)!;
    expect(out).toMatchObject({ starter: 's', backup: 'b', baseStarter: 15, baseBackup: 5, backupPoints: 11, baseGroup: 5, groupPoints: 11 });
    // Week 6 looks back over weeks 2–5: the starter's base counts only the games he played.
    const after = rb.find((a) => a.week === 6)!;
    expect(after.baseStarter).toBe(15);
    expect(after.baseBackup).toBe(5);
  });

  it('takes the quarterback who threw most as the backup, and has no QB controls', () => {
    const qb = rows.filter((a) => a.pos === 'QB');
    expect(qb).toHaveLength(1);
    expect(qb[0]).toMatchObject({ week: 5, starter: 'q', backup: 'q2', out: true, baseBackup: 0, backupPoints: 12 });
  });

  it('measures the share of the starter’s points the backup gained', () => {
    expect(inheritance(rows.filter((a) => a.pos === 'RB' && a.out))).toBeCloseTo(6 / 15, 9);
    expect(inheritance(rows.filter((a) => a.pos === 'RB' && !a.out))).toBeCloseTo(0, 9);
    expect(inheritance(rows.filter((a) => a.pos === 'QB'))).toBeCloseTo(12 / 18, 9);
  });

  it('skips weeks before rosters mark inactives', () => {
    expect(absences({ season: 2019, games, status, fromWeek: 5 }).filter((a) => a.pos === 'RB')).toEqual([]);
  });
});

describe('playerGame', () => {
  it('reads usage by position and half-PPR points from an nflverse row', () => {
    const row = { season_type: 'REG', player_id: '00-1', position: 'RB', week: '3', team: 'AAA', carries: '15', targets: '4', attempts: '0', fantasy_points: '12', fantasy_points_ppr: '15' };
    expect(playerGame(row)).toEqual({ week: 3, team: 'AAA', player: '00-1', pos: 'RB', usage: 19, points: 13.5 });
    expect(playerGame({ ...row, position: 'K' })).toBeUndefined();
    expect(playerGame({ ...row, season_type: 'POST' })).toBeUndefined();
  });
});
